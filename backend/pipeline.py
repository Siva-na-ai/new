import re
import cv2
import numpy as np
from shapely.geometry import Point, Polygon
from detector import Detector
from reid import ReID
from global_id import GlobalIDManager
from database import SessionLocal, Alert, VehicleCheck, Camera, PPEViolation, RestrictionZone
import datetime
import os
import base64
import threading
import sys
import subprocess
import urllib.request
import json

class Pipeline:
    def __init__(self, camera_id, detector, reid, global_id_manager, ocr_reader):
        self.camera_id = camera_id
        self.detector = detector
        self.reid = reid
        self.global_id_manager = global_id_manager
        self.ocr_reader = ocr_reader
        self.frame_count = 0
        self.camera = None
        self.camera_name = f"Cam_{camera_id}"
        self.zones = []
        self.track_embeddings = {} # {track_id: [last_n_embeddings]}
        self.delivered_alerts = {} # {(global_id, alert_type): datetime}
        self.plate_results = {} # {track_id: {best_text: str, score: float, frames_checked: int}}
        self.last_reset_date = datetime.date.today()
        
        # Audio Alert Config
        self.alarm_sound_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "alarm", "clip-1773994393607.mp3")
        
        # Initial config load
        self.reload_config()

    def play_alarm_sound(self):
        """Play local alarm sound in background on Windows (non-blocking)"""
        if not os.path.exists(self.alarm_sound_path):
            return
            
        def _play():
            try:
                # Use powershell to play sound silently in background
                # This doesn't require any 3rd party python libraries
                player_cmd = f"(New-Object Media.SoundPlayer '{self.alarm_sound_path}').PlaySync();"
                # If it's an MP3, we might need a different approach for PS, 
                # but simplest for MP3 is 'start' or using the MediaPlayer class
                ps_script = f"""
                $player = New-Object System.Windows.Media.MediaPlayer
                $player.Open('{self.alarm_sound_path}')
                $player.Play()
                Start-Sleep -Seconds 5
                $player.Stop()
                """
                subprocess.run(["powershell", "-Command", ps_script], capture_output=True)
            except Exception as e:
                print(f"[PIPELINE] Local Sound Play Error: {e}")

        threading.Thread(target=_play, daemon=True).start()

    def reload_config(self):
        """Reload camera settings and restricted zones from DB"""
        from database import RestrictionZone
        db = SessionLocal()
        try:
            # Refresh camera settings
            self.camera = db.query(Camera).filter(Camera.id == self.camera_id).first()
            if self.camera:
                self.camera_name = self.camera.place_name
                # Detach the detections list
                # NEW: Keep track of user's ORIGINAL choices for UI/Alert filtering
                self.user_requested_classes = list(self.camera.detections_to_run) if self.camera.detections_to_run else []
                requested = list(self.camera.detections_to_run) if self.camera.detections_to_run else []
                
                # ESSENTIAL: We MUST detect people if PPE or Zones are active, 
                # even if not requested by user for "visible" display.
                if any(k in requested for k in ["helmet", "no_helmet", "vest", "no_vest"]) or self.zones:
                    if "person" not in requested: requested.append("person")
                    for p_cls in ["person_working", "person_not_working", "person_standing"]:
                        if p_cls not in requested: requested.append(p_cls)
                
                if self.zones and "vehicle" not in requested:
                    requested.append("vehicle")
                
                self.detections_to_run = requested
                print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] [PIPELINE] Cam {self.camera_id} reloaded. User Requests: {self.user_requested_classes}")
            else:
                self.camera_name = f"Cam_{self.camera_id}"
                self.detections_to_run = []
            
            # Refresh zones (only if active)
            raw_zones = db.query(RestrictionZone).filter(
                RestrictionZone.camera_id == self.camera_id
            ).all()
            
            self.zones = []
            for rz in raw_zones:
                zp_raw = rz.polygon_points
                if isinstance(zp_raw, dict):
                    # New Format: { "points": [], "width": 1280, "height": 720 }
                    points = zp_raw.get("points", [])
                    ref_w = zp_raw.get("width", 640) # Default to 640 for user's latest
                    ref_h = zp_raw.get("height", 480)
                else:
                    # Old Format: [ [x,y], ... ]
                    points = zp_raw
                    ref_w = 640 # Heuristic for existing zones based on user logs
                    ref_h = 480
                
                # We store a "normalized" version of the points in self.zones 
                # so detection is resolution-independent
                # (We don't modify rz.polygon_points which goes back to DB)
                # Tag zones for scaling logic
                rz.points = points
                rz.ref_w = ref_w
                rz.ref_h = ref_h
                # Check for explicit 'normalized' flag from UI
                rz.is_normalized = (isinstance(zp_raw, dict) and zp_raw.get("type") == "normalized")
                self.zones.append(rz)
                
        except Exception as e:
            print(f"[PIPELINE ERROR] Failed to reload config for Cam {self.camera_id}: {e}")
        finally:
            db.close()

    def is_near_any_zone(self, xyxy):
        """Quick check if bbox is near any restriction zone"""
        if not self.zones: return False
        x1, y1, x2, y2 = xyxy
        w, h = (x2-x1), (y2-y1)
        cx, cy = (x1 + x2) // 2, (y1 + y2) // 2
        
        # Determine Frame Resolution (from detector metadata or first detection)
        # Assuming xyxy is in native resolution.
        # We need to scale native cx/cy to the zone's ref_w/ref_h
        
        for zone in self.zones:
            # Scale coordinates for comparison
            native_w = getattr(self, 'frame_w', 1280)
            native_h = getattr(self, 'frame_h', 720)
            
            if getattr(zone, 'is_normalized', False):
                zx = cx / native_w
                zy = cy / native_h
                p = Point(zx, zy)
                poly = Polygon(zone.points)
            else:
                zx = cx * (zone.ref_w / native_w)
                zy = cy * (zone.ref_h / native_h)
                p = Point(zx, zy)
                poly = Polygon(zone.points)
                
            if poly.buffer(0.02 if getattr(zone, 'is_normalized', False) else 20).contains(p):
                return True
        return False

    def merge_overlapping_detections(self, detections, iou_threshold=0.5):
        """Consolidates fragmented boxes and resolves multi-class conflicts (e.g. Vehicle vs Truck)."""
        if not detections: return []
        # Sort by area (largest first) to prioritize parent containers
        sorted_dets = sorted(detections, key=lambda d: (d['xyxy'][2]-d['xyxy'][0])*(d['xyxy'][3]-d['xyxy'][1]), reverse=True)
        merged = []
        
        # Specificity ranking: Lower index = more specific
        SPECIFICITY = ["covered_vehicle", "forklift", "truck", "license_plate", "no_helmet", "no_vest", "helmet", "vest", "person_working", "person_standing"]

        for det in sorted_dets:
            is_redundant = False
            d_cls = det['class_name'].lower()
            
            for parent in merged:
                p_cls = parent['class_name'].lower()
                
                # Calculate Intersection over Detection Area (IoDA)
                px1, py1, px2, py2 = parent['xyxy']
                dx1, dy1, dx2, dy2 = det['xyxy']
                ix1, iy1, ix2, iy2 = max(px1, dx1), max(py1, dy1), min(px2, dx2), min(py2, dy2)
                
                if ix2 > ix1 and iy2 > iy1:
                    inter_area = (ix2 - ix1) * (iy2 - iy1)
                    det_area = (dx2 - dx1) * (dy2 - dy1)
                    # If Current Box is >75% inside Parent, or they share high IOU
                    if inter_area / det_area > 0.75:
                        # Match: Resolve which one is more "valuable"
                        # If the smaller one is more specific (e.g. Helmet inside a Person), we keep both
                        # But if they are just conflicting types (e.g. Vehicle vs Truck), we pick the best one
                        is_related = (d_cls in SPECIFICITY and p_cls in SPECIFICITY) or (d_cls in ["vehicle", "truck", "covered_vehicle"] and p_cls in ["vehicle", "truck", "covered_vehicle"])
                        
                        if is_related:
                            # If they are very overlapping, only keep the more specific one
                            d_idx = SPECIFICITY.index(d_cls) if d_cls in SPECIFICITY else 99
                            p_idx = SPECIFICITY.index(p_cls) if p_cls in SPECIFICITY else 99
                            
                            if d_idx < p_idx: # Current is more specific!
                                # Swap them if the current one is significantly better
                                # For simplicity, we just mark redundant if parent is good enough
                                pass 
                            else:
                                is_redundant = True
                                break
            if not is_redundant: merged.append(det)
        return merged

    def process_frame(self, frame):
        self.frame_count += 1
        if self.frame_count % 100 == 0:
            self.reload_config()
        
        # 1. Detection
        detections = self.detector.detect(frame, classes=self.detections_to_run if hasattr(self, 'detections_to_run') else None)
        
        # 2. Fragment Merging (Fixes the "Improper" multi-box issue on trucks/forklifts)
        detections = self.merge_overlapping_detections(detections)
        
        # Inject frame dimensions for scaling in renderers
        f_h, f_w = frame.shape[:2]
        det_res = (f_w, f_h)
        
        # Mark visibility: Only detections explicitly requested by the user should be shown on the feed
        db_requested = []
        if self.camera and self.camera.detections_to_run:
            db_requested = list(self.camera.detections_to_run)
            
        for det in detections:
            det["frame_w"] = f_w
            det["frame_h"] = f_h
            det["det_res"] = det_res
            det["visible"] = (det["class_name"] in db_requested) if db_requested else True
            
            cls_lower = str(det["class_name"]).lower()

            # --- PRIORITY 1: License Plate OCR (Must run even without track_id) ---
            if cls_lower in ["license_plate", "13"]:
                # print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] [PIPELINE] Found Plate Object - Triggering OCR Handler.")
                self.handle_vehicle_check(det, frame)

            # --- PRIORITY 2: Tracking & ReID Logic ---
            track_id = det.get("track_id")
            
            # If no track_id, try to associate plate with a vehicle
            if track_id is None and cls_lower == "license_plate":
                px1, py1, px2, py2 = det["xyxy"]
                pcx, pcy = (px1 + px2) / 2, (py1 + py2) / 2
                for v in detections:
                    if v["class_name"] in ["vehicle", "covered_vehicle", "uncovered_vehicle", "forklift"] and v.get("track_id") is not None:
                        vx1, vy1, vx2, vy2 = v["xyxy"]
                        if vx1 <= pcx <= vx2 and vy1 <= pcy <= vy2:
                            det["track_id"] = v["track_id"]
                            track_id = v["track_id"]
                            break
            
            if track_id is None:
                continue
                
            xyxy = det["xyxy"]
            
            # Universal ReID - Only for person-based and vehicle classes
            if det["class_name"] in ["person", "person_working", "person_not_working", "person_standing", "vehicle", "covered_vehicle", "uncovered_vehicle", "forklift"]:
                in_or_near_zone = self.is_near_any_zone(xyxy)
                is_new = track_id not in self.track_embeddings
                
                # Frequency: Every 15 frames for existing, every frame for new until matched
                should_reid = is_new or (in_or_near_zone and self.frame_count % 15 == 0)
                
                if should_reid:
                    x1, y1, x2, y2 = xyxy
                    if (x2-x1) > 25 and (y2-y1) > 25:
                        crop = frame[max(0, y1):min(frame.shape[0], y2), max(0, x1):min(frame.shape[1], x2)]
                        if crop.size > 0:
                            embedding = self.reid.extract_embedding(crop)
                            if track_id not in self.track_embeddings:
                                self.track_embeddings[track_id] = []
                            self.track_embeddings[track_id].append(embedding)
                            if len(self.track_embeddings[track_id]) > 5:
                                self.track_embeddings[track_id].pop(0)
                            
                            mean_embedding = np.mean(self.track_embeddings[track_id], axis=0)
                            global_id = self.global_id_manager.match_new_track(self.camera_id, track_id, mean_embedding, self.frame_count)
                            det["global_id"] = global_id
                else:
                    det["global_id"] = self.global_id_manager.get_active_global_id(self.camera_id, track_id)
            
        # 4. PPE Association Logic
        self.handle_ppe_detection(detections, frame)

        # 5. Restriction Zone Check (All classes)
        for det in detections:
            self.check_restriction_zones(det, frame)

        # 6. Cleanup & Daily Reset
        if self.frame_count % 100 == 0:
            today = datetime.date.today()
            if today != self.last_reset_date:
                print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] [PIPELINE] NEW DAY - Resetting trackers.")
                self.delivered_alerts = {}
                self.last_reset_date = today
                
            self.global_id_manager.cleanup(self.frame_count)
            # Cleanup finished plate results older than 5 minutes
            now = datetime.datetime.now()
            self.plate_results = {
                tid: res for tid, res in self.plate_results.items()
                if not (res.get("completed") and (now - res.get("finish_time", now)).total_seconds() > 300)
            }
            now = datetime.datetime.now()
            self.plate_results = {tid: res for tid, res in self.plate_results.items() if not res.get("completed") or (now - res.get("finish_time", now)).total_seconds() < 300}
        # Set frame info for zone scaling
        self.frame_h, self.frame_w = frame.shape[:2]

        return detections, self.zones


    def handle_ppe_detection(self, detections, frame):
        persons = [d for d in detections if d["class_name"] in ["person", "person_working", "person_not_working", "person_standing"]]
        ppe_items = [d for d in detections if d["class_name"] in ["helmet", "no_helmet", "vest", "no_vest"]]
        
        for person in persons:
            p_x1, p_y1, p_x2, p_y2 = person["xyxy"]
            gid = person.get("global_id")
            if gid is None: continue
            
            # Find PPE items that are inside this person's box
            associated_ppe = []
            for item in ppe_items:
                i_x1, i_y1, i_x2, i_y2 = item["xyxy"]
                # Center point check
                icx, icy = (i_x1 + i_x2) // 2, (i_y1 + i_y2) // 2
                if p_x1 <= icx <= p_x2 and p_y1 <= icy <= p_y2:
                    associated_ppe.append(item)
            
            # Identify violations
            v_types = [ppe["class_name"] for ppe in associated_ppe]
            
            # Logic: If person is missing helmet OR explicitly has 'no_helmet'
            # ONLY if the user actually requested helmet monitoring for this camera!
            potential_violations = []
            
            check_helmet = any(k in self.user_requested_classes for k in ["helmet", "no_helmet"])
            if check_helmet:
                if "no_helmet" in v_types or ("helmet" not in v_types and "no_helmet" not in v_types):
                    explicit_item = next((item for item in associated_ppe if item["class_name"] == "no_helmet"), None)
                    potential_violations.append(("no_helmet", explicit_item))
            
            check_vest = any(k in self.user_requested_classes for k in ["vest", "no_vest"])
            if check_vest:
                if "no_vest" in v_types or ("vest" not in v_types and "no_vest" not in v_types):
                    explicit_item = next((item for item in associated_ppe if item["class_name"] == "no_vest"), None)
                    potential_violations.append(("no_vest", explicit_item))
                
            for v_type, explicit_item in potential_violations:
                alert_key = (gid, v_type)
                if alert_key not in self.delivered_alerts:
                    self.save_ppe_violation(person, v_type, frame, explicit_item)
                    self.delivered_alerts[alert_key] = datetime.datetime.now()

    def save_ppe_violation(self, person, v_type, frame, explicit_item=None):
        print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] [CAM {self.camera_id}] PPE VIOLATION: {v_type} for GID {person.get('global_id')}")
        db = SessionLocal()
        try:
            if explicit_item:
                # Crop exactly the violation item with 20% padding instead of the whole person
                x1, y1, x2, y2 = explicit_item["xyxy"]
                h, w = y2 - y1, x2 - x1
                px, py = int(w*0.2), int(h*0.2)
                crop = frame[max(0, y1-py):min(frame.shape[0], y2+py), max(0, x1-px):min(frame.shape[1], x2+px)]
            else:
                # If inferred, show the relevant region of the person
                x1, y1, x2, y2 = person["xyxy"]
                h, w = y2 - y1, x2 - x1
                px, py = int(w*0.1), int(h*0.1)
                if v_type == "no_helmet": # Only need top 30% of person
                    y2 = y1 + int(h*0.3)
                elif v_type == "no_vest": # Upper torso
                    y1 = y1 + int(h*0.2)
                    y2 = y1 + int(h*0.6)
                crop = frame[max(0, y1-py):min(frame.shape[0], y2+py), max(0, x1-px):min(frame.shape[1], x2+px)]
            
            img_base64 = None
            if crop.size > 0:
                _, buffer = cv2.imencode('.jpg', crop, [int(cv2.IMWRITE_JPEG_QUALITY), 60])
                img_base64 = base64.b64encode(buffer).decode('utf-8')
            
            from database import PPEViolation
            new_v = PPEViolation(
                track_id=person["track_id"],
                global_id=person.get("global_id"),
                violation_type=v_type,
                image_data=img_base64,
                camera_id=self.camera_id,
                camera_name=self.camera_name
            )
            db.add(new_v)
            db.commit()
            
            # (Email alert removed per user request for only intrusion alerts)
        except Exception as e:
            print(f"PPE DB ERROR: {e}")
            db.rollback()
        finally:
            db.close()

    def check_restriction_zones(self, detection, frame):
        if detection["class_name"] not in ["person", "person_working", "person_not_working", "person_standing", "vehicle", "covered_vehicle", "uncovered_vehicle", "forklift", "forklift_collision"]:
            return
            
        # Set frame info if not already set (fallback for first frame)
        if not hasattr(self, 'frame_w') or not self.frame_w:
             self.frame_h, self.frame_w = frame.shape[:2]
             
        x1, y1, x2, y2 = detection["xyxy"]
        # Robust check: Feet center AND Box center
        test_points = [
            ((x1 + x2) // 2, y2 - 5), # Bottom center (Feet)
            ((x1 + x2) // 2, (y1 + y2) // 2) # True center (Body)
        ]
        
        now = datetime.datetime.now()
        
        for zone in self.zones:
            in_zone = False
            poly = Polygon(zone.points)
            # Add a 10px buffer (or equivalent normalized 0.01) for jitter robustness
            buffer_size = 0.01 if getattr(zone, 'is_normalized', False) else 10
            buffered_poly = poly.buffer(buffer_size)
            
            for cx, cy in test_points:
                # Scale detection point (Native Space) to Zone Space
                if getattr(zone, 'is_normalized', False):
                    zx = cx / self.frame_w
                    zy = cy / self.frame_h
                else:
                    zx = cx * (zone.ref_w / self.frame_w)
                    zy = cy * (zone.ref_h / self.frame_h)
                    
                point_in_zone = Point(zx, zy)
                if buffered_poly.contains(point_in_zone) or buffered_poly.touches(point_in_zone):
                    in_zone = True
                    break
            
            if in_zone:
                # Stable deduplication: Use track_id primarily to avoid double alerts when Global ID is late
                # (A track_id is unique per visit in the current session)
                alert_key = (f"T{detection['track_id']}", f"zone_{zone.id}")
                
                can_alert = True
                if alert_key in self.delivered_alerts:
                    last_time = self.delivered_alerts[alert_key]
                    if (now - last_time).total_seconds() < 30: # 30 second cooldown (Improved from 60s)
                        can_alert = False
                
                if not can_alert:
                    continue # Check other zones or wait for next frame
                
                self.delivered_alerts[alert_key] = now
                print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] 🚨 INTRUSION DETECTED: Cam {self.camera_id}, Zone {zone.id}, Class {detection['class_name']} (Track {detection['track_id']})")
                
                # Save alert to DB with fresh session
                db = SessionLocal()
                try:
                    # Encode frame to Base64 instead of saving to local disk
                    try:
                        # Resize frame to avoid massive base64 payloads crashing the DB socket
                        scaled_w = min(1280, frame.shape[1])
                        scaled_h = int(scaled_w * frame.shape[0] / frame.shape[1])
                        resized_frame = cv2.resize(frame, (scaled_w, scaled_h))
                        
                        _, buffer = cv2.imencode('.jpg', resized_frame, [int(cv2.IMWRITE_JPEG_QUALITY), 60])
                        img_base64 = base64.b64encode(buffer).decode('utf-8')
                        print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] [CAM {self.camera_id}] Alert Image Optimized & Encoded.")
                    except Exception as e:
                        print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] [CAM {self.camera_id}] ENCODING ERROR: {e}")
                        img_base64 = None
                    
                    new_alert = Alert(
                        track_id=detection["track_id"],
                        global_id=detection.get("global_id"),
                        image_data=img_base64,
                        camera_id=self.camera_id,
                        camera_name=self.camera_name,
                        timestamp=datetime.datetime.now()
                    )
                    db.add(new_alert)
                    db.commit()
                    
                    # Trigger Email Alert for Zone Breach
                    from notifications import notification_manager
                    notification_manager.broadcast_security_alert(self.camera_name, self.camera_id, f"Security Breach: {detection['class_name']} entered restricted zone", image_base64=img_base64)
                    db.commit()
                    print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] [CAM {self.camera_id}] Alert Saved to DB.")
                    
                    # Trigger Non-Blocking Local Sound Alert (Disabled: already handled by desktop notifier)
                    # self.play_alarm_sound()
                    
                    # Notify Node.js server via Webhook to broadcast via Socket.io
                    try:
                        req = urllib.request.Request('http://127.0.0.1:5000/api/internal/socket-trigger', data=json.dumps({
                            "type": "alert",
                            "data": {
                                "id": new_alert.id,
                                "camera_name": self.camera_name,
                                "class_name": detection['class_name'],
                                "timestamp": new_alert.timestamp.isoformat()
                            }
                        }).encode('utf-8'), headers={'Content-Type': 'application/json'}, method='POST')
                        urllib.request.urlopen(req, timeout=10.0) # Increased to 10s for high reliability
                    except Exception as he:
                        print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] Webhook Notification Error: {he}")
                except Exception as e:
                    print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] [CAM {self.camera_id}] ALERT DB ERROR: {e}")
                    db.rollback()
                finally:
                    db.close()
                break

    def correct_plate_format(self, text):
        if not text: return None
        clean = "".join([c for c in text if c.isalnum()]).upper()
        if len(clean) < 4: return None
        
        # Positions: 0,1=State, 2,3=District, rest=Unique
        corrected = []
        for i, ch in enumerate(clean):
            if i in [0, 1]:
                # SPECIAL SNAP: Fix '74' or '4' as 'KA' (Common in user's car)
                if i == 0 and ch in ['7', '4']: corrected.append('K')
                elif i == 1 and ch in ['4', '1', '8']: corrected.append('A')
                elif ch == 'L': corrected.append('A')
                else: corrected.append(ch)
            else:
                corrected.append(ch)
        return "".join(corrected)

    def handle_vehicle_check(self, detection, frame):
        # Entry Trace
        print(f"[OCR TRACE] Cam {self.camera_id} | Enter Handle for {detection.get('class_name', 'UNKNOWN')}")
        
        track_id = str(detection.get("track_id")) if detection.get("track_id") is not None else None
        x1, y1, x2, y2 = [int(v) for v in detection["xyxy"]]
        cx, cy = (x1 + x2) // 2, (y1 + y2) // 2
        
        # Link current track to a "known" proximity plate result (250px radius)
        found_id = None
        for tid, res in self.plate_results.items():
            if not res.get("completed") and "last_pos" in res:
                lx, ly = res["last_pos"]
                dist = ((cx - lx)**2 + (cy - ly)**2)**0.5
                if dist < 250:
                    found_id = tid
                    break
        
        if found_id:
            track_id = found_id
        elif track_id is None:
            track_id = f"anon_{cx}_{cy}_{self.frame_count}"
        
        if track_id not in self.plate_results:
            self.plate_results[track_id] = {
                "best_text": "", "best_conf": 0, "frames_checked": 0, "completed": False
            }
        
        res = self.plate_results[track_id]
        res["last_pos"] = (cx, cy) 
        if res.get("completed"): return 
        if res["frames_checked"] >= 25: 
            res["completed"] = True
            return

        res["frames_checked"] += 1
        h, w = y2 - y1, x2 - x1
        
        # Crop + 15% padding
        px, py = int(w * 0.15), int(h * 0.15)
        raw_crop = frame[max(0, y1-py):min(frame.shape[0], y2+py), max(0, x1-px):min(frame.shape[1], x2+px)]
        if raw_crop.size == 0: return

        # Enhance (CLAHE Contrast Boost)
        gray = cv2.cvtColor(raw_crop, cv2.COLOR_BGR2GRAY)
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8,8))
        enhanced = cv2.cvtColor(clahe.apply(gray), cv2.COLOR_GRAY2BGR)

        # Resize for OCR (800x250)
        intermediate = cv2.resize(enhanced, (800, 250), interpolation=cv2.INTER_CUBIC)
        
        valid_texts = []
        max_f_conf = 0
        try:
            if self.ocr_reader:
                # 1. PADDLE OCR SUPPORT
                if hasattr(self.ocr_reader, 'ocr'):
                    ocr_results = self.ocr_reader.ocr(intermediate) 
                    if ocr_results and ocr_results[0]:
                        for line in ocr_results[0]:
                            text, conf = line[1][0], line[1][1]
                            if conf > 0.35:
                                valid_texts.append(text)
                                max_f_conf = max(max_f_conf, conf)
                                print(f"[OCR DEBUG] Cam {self.camera_id} (Paddle) | Raw: {text} | Conf: {conf:.2f}")
                # 2. EASY OCR FALLBACK
                elif hasattr(self.ocr_reader, 'readtext'):
                    results = self.ocr_reader.readtext(intermediate, detail=1)
                    for (bbox, text, conf) in results:
                        if conf > 0.25:
                            valid_texts.append(text)
                            max_f_conf = max(max_f_conf, conf)
                            print(f"[OCR DEBUG] Cam {self.camera_id} (EasyOCR) | Raw: {text} | Conf: {conf:.2f}")
        except Exception as e:
            print(f"OCR ERROR: {e}")
            return

        if not valid_texts: return
        raw_text = "".join(valid_texts)
        plate_text = self.correct_plate_format(raw_text)
        if not plate_text: return
        
        if max_f_conf > res["best_conf"] or not res["best_text"]:
            res["best_text"] = plate_text
            res["best_conf"] = max_f_conf
            res["best_image"] = intermediate.copy()
            
        if (res["best_conf"] > 0.40 and res["frames_checked"] >= 2) or res["frames_checked"] >= 8:
            if res["best_text"]:
                self.commit_vehicle_to_db(res["best_text"], res["best_image"])
                res["completed"] = True
                res["finish_time"] = datetime.datetime.now()

    def commit_vehicle_to_db(self, plate_text, plate_image):
        if not plate_text or len(plate_text) > 9:
            print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] [CAM {self.camera_id}] Skipping record: Plate length ({len(plate_text) if plate_text else 0}) > 9 or empty.")
            return

        print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] [CAM {self.camera_id}] [DB ACTION] COMMITTING PLATE: {plate_text}")
        
        # Physical File Save for Dashboard Visibility 
        os.makedirs(os.path.join("static", "plates"), exist_ok=True)
        img_filename = f"plate_{self.camera_id}_{datetime.datetime.now().strftime('%Y%m%d_%H%M%S')}.jpg"
        img_path = os.path.join("static", "plates", img_filename)
        
        try:
            cv2.imwrite(img_path, plate_image, [int(cv2.IMWRITE_JPEG_QUALITY), 90])
        except Exception as e:
            print(f"IMAGE WRITE ERROR: {e}")

        # Encode to Base64 for database legacy support
        img_base64 = None
        try:
            _, buffer = cv2.imencode('.jpg', plate_image, [int(cv2.IMWRITE_JPEG_QUALITY), 70])
            img_base64 = base64.b64encode(buffer).decode('utf-8')
        except Exception as e:
            print(f"ENCODING ERROR: {e}")

        db = SessionLocal()
        try:
            now = datetime.datetime.now()
            # Double checking recent entries
            recent = db.query(VehicleCheck).filter(
                VehicleCheck.plate_number == plate_text,
                VehicleCheck.time_in > now - datetime.timedelta(seconds=60)
            ).first()
            
            if not recent:
                new_check = VehicleCheck(
                    image_data=img_base64,
                    plate_number=plate_text,
                    camera_id=self.camera_id,
                    camera_name=self.camera_name,
                    time_in=now
                )
                db.add(new_check)
                db.commit()
                db.refresh(new_check)
                print(f"[CAM {self.camera_id}] Success: Saved {plate_text} to DB.")
                
                # Notify Node Server
                try:
                    req = urllib.request.Request('http://127.0.0.1:5000/api/internal/socket-trigger', data=json.dumps({
                        "type": "vehicle",
                        "data": { "id": new_check.id, "camera_name": self.camera_name, "plate_number": plate_text, "timestamp": now.isoformat() }
                    }).encode('utf-8'), headers={'Content-Type': 'application/json'}, method='POST')
                    urllib.request.urlopen(req, timeout=2.0)
                except: pass
        except Exception as e:
            db.rollback()
            print(f"DB ERROR: {e}")
        finally:
            db.close()

    def validate_indian_plate(self, text):
        pattern = r"^[A-Z]{2}[0-9]{1,2}[A-Z]{1,3}[0-9]{4}$"
        return re.match(pattern, text.replace(" ", "")) is not None

    def close(self):
        pass
