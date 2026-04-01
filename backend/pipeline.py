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
                if any(k in requested for k in ["helmet", "no_helmet", "person_with_vest", "no_vest"]) or self.zones:
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
            self.zones = db.query(RestrictionZone).filter(
                RestrictionZone.camera_id == self.camera_id
            ).all()
            # Deep copy points to avoid session issues
            for z in self.zones:
                z.polygon_points = list(z.polygon_points)
                
        except Exception as e:
            print(f"[PIPELINE ERROR] Failed to reload config for Cam {self.camera_id}: {e}")
        finally:
            db.close()

    def is_near_any_zone(self, xyxy):
        """Quick check if bbox is near any restriction zone"""
        if not self.zones: return False
        x1, y1, x2, y2 = xyxy
        cx, cy = (x1 + x2) // 2, (y1 + y2) // 2
        p = Point(cx, cy)
        for zone in self.zones:
            poly = Polygon(zone.polygon_points)
            if poly.buffer(50).contains(p): # 50px buffer
                return True
        return False

    def process_frame(self, frame):
        self.frame_count += 1
        
        # Periodically refresh config from DB (approx every 4-5 seconds)
        if self.frame_count % 100 == 0:
            self.reload_config()
        
        # 1. Detection & Tracking (YOLOv11 with ByteTrack)
        detections = self.detector.detect(frame, classes=self.detections_to_run if hasattr(self, 'detections_to_run') else None)
        
        # Inject frame dimensions for scaling in renderers
        f_h, f_w = frame.shape[:2]
        
        # Mark visibility: Only detections explicitly requested by the user should be shown on the feed
        db_requested = []
        if self.camera and self.camera.detections_to_run:
            db_requested = list(self.camera.detections_to_run)
            
        for det in detections:
            det["frame_w"] = f_w
            det["frame_h"] = f_h
            # Both det["class_name"] and db_requested items are now STRINGS
            det["visible"] = (det["class_name"] in db_requested) if db_requested else True
            
            track_id = det["track_id"]
            if track_id is None:
                if det["class_name"] == "license_plate":
                    px1, py1, px2, py2 = det["xyxy"]
                    pcx, pcy = (px1 + px2) / 2, (py1 + py2) / 2
                    for v in detections:
                        if v["class_name"] in ["vehicle", "car", "bus", "truck", "motorcycle", "person", "person_working", "person_not_working", "person_standing"] and v["track_id"] is not None:
                            vx1, vy1, vx2, vy2 = v["xyxy"]
                            if vx1 <= pcx <= vx2 and vy1 <= pcy <= vy2:
                                det["track_id"] = v["track_id"]
                                track_id = v["track_id"]
                                break
                if track_id is None:
                    continue
                
            xyxy = det["xyxy"]
            
            # 2. Universal ReID - Only for person-based and vehicle classes
            if det["class_name"] in ["person", "person_working", "person_not_working", "person_standing", "vehicle"]:
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
            
            # Check Vehicle / Plate
            if det["class_name"] == "license_plate":
                self.handle_vehicle_check(det, frame)
        # 4. PPE Association Logic
        self.handle_ppe_detection(detections, frame)

        # 5. Restriction Zone Check (All classes)
        # We check zones for ALL detections here
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
            

        return detections, [z.polygon_points for z in self.zones]


    def handle_ppe_detection(self, detections, frame):
        persons = [d for d in detections if d["class_name"] in ["person", "person_working", "person_not_working", "person_standing"]]
        ppe_items = [d for d in detections if d["class_name"] in ["helmet", "no_helmet", "person_with_vest", "no_vest"]]
        
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
            
            check_vest = any(k in self.user_requested_classes for k in ["person_with_vest", "no_vest"])
            if check_vest:
                if "no_vest" in v_types or ("person_with_vest" not in v_types and "no_vest" not in v_types):
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
            
            db.add(new_v)
            db.commit()
            
            # (Email alert removed per user request for only intrusion alerts)
        except Exception as e:
            print(f"PPE DB ERROR: {e}")
            db.rollback()
        finally:
            db.close()

    def check_restriction_zones(self, detection, frame):
        if detection["class_name"] not in ["person", "person_working", "person_not_working", "person_standing", "vehicle", "car", "bus", "truck", "motorcycle"]:
            return
            
        x1, y1, x2, y2 = detection["xyxy"]
        # Use center-bottom point for zone check (more robust for people/vehicles)
        cx = (x1 + x2) // 2
        cy = y2 - 5 # 5 pixels from bottom
        point = Point(cx, cy)
        
        now = datetime.datetime.now()
        
        for zone in self.zones:
            poly = Polygon(zone.polygon_points)
            if poly.contains(point) or poly.touches(point):
                # Universal Deduplication: One alert per Global ID per zone per stay (10 min cooldown)
                gid = detection.get("global_id")
                # Fallback to track_id if no global_id available
                alert_id = gid if gid else f"T{detection['track_id']}"
                alert_key = (alert_id, f"zone_{zone.id}")
                
                can_alert = True
                if alert_key in self.delivered_alerts:
                    last_time = self.delivered_alerts[alert_key]
                    if (now - last_time).total_seconds() < 600: # 10 minute cooldown for same person/vehicle
                        can_alert = False
                
                if not can_alert:
                    # Break is fine here, we only alert once per frame per detection
                    break
                
                self.delivered_alerts[alert_key] = now
                print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] [CAM {self.camera_id}] Zone violation: {detection['class_name']} in Zone #{zone.id}")
                
                # Save alert to DB with fresh session
                db = SessionLocal()
                try:
                    # Encode frame to Base64 instead of saving to local disk
                    # Encode frame to Base64 with reduced quality (50) to save memory/bandwidth
                    try:
                        _, buffer = cv2.imencode('.jpg', frame, [int(cv2.IMWRITE_JPEG_QUALITY), 50])
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
                    
                    # Trigger Non-Blocking Local Sound Alert
                    self.play_alarm_sound()
                except Exception as e:
                    print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] [CAM {self.camera_id}] ALERT DB ERROR: {e}")
                    db.rollback()
                finally:
                    db.close()
                break

    def correct_plate_format(self, ocr_text):
        """Standardizes OCR text based on expected plate positioning (7 characters)"""
        mapping_num_to_alpha = {"0": "O", "1": "I", "5": "S", "8": "B"}
        mapping_alpha_to_num = {"O": "0", "I": "1", "Z": "2", "S": "5", "B": "8"}
        
        ocr_text = ocr_text.upper().replace(" ", "")
        # Note: Following the 7-character logic from the user provided diagram
        if len(ocr_text) != 7:
            return ""
            
        corrected = []
        for i, ch in enumerate(ocr_text):
            if i < 2 or i >= 4: # Alphabet positions
                if ch.isdigit() and ch in mapping_num_to_alpha:
                    corrected.append(mapping_num_to_alpha[ch])
                elif ch.isalpha():
                    corrected.append(ch)
                else:
                    return "" # Invalid char for this position
            else: # Numeric positions (i=2, 3)
                if ch.isalpha() and ch in mapping_alpha_to_num:
                    corrected.append(mapping_alpha_to_num[ch])
                elif ch.isdigit():
                    corrected.append(ch)
                else:
                    return "" # Invalid char for this position
                    
        return "".join(corrected)

    def handle_vehicle_check(self, detection, frame):
        track_id = detection["track_id"]
        if track_id is None: return
        
        # Initialize results buffer for this track
        if track_id not in self.plate_results:
            self.plate_results[track_id] = {"best_text": "", "best_conf": 0, "frames_checked": 0, "completed": False}
        
        res = self.plate_results[track_id]
        if res["completed"]: return # Already processed this vehicle
        
        if res["frames_checked"] >= 10: # Stop trying after 10 frames of this plate
            res["completed"] = True
            return

        x1, y1, x2, y2 = [int(v) for v in detection["xyxy"]]
        h, w = y2 - y1, x2 - x1
        
        # 1. Initial Raw Crop (YOLO + 10% safety margin)
        pad_x, pad_y = int(w * 0.10), int(h * 0.10)
        x1_pad = max(0, x1 - pad_x)
        y1_pad = max(0, y1 - pad_y)
        x2_pad = min(frame.shape[1], x2 + pad_x)
        y2_pad = min(frame.shape[0], y2 + pad_y)
        
        raw_crop = frame[y1_pad:y2_pad, x1_pad:x2_pad]
        if raw_crop.size == 0: return

        res["frames_checked"] += 1
        
        # We use a larger intermediate size for the OCR pass
        intermediate_res = cv2.resize(raw_crop, (800, 250), interpolation=cv2.INTER_CUBIC)
        
        valid_texts = []
        max_frame_conf = 0
        fine_crop_binary = intermediate_res # Sent to OCR Engine
        display_crop = intermediate_res.copy() # Saved to Database

        
        try:
            is_paddle = hasattr(self.ocr_reader, 'ocr')
            if is_paddle:
                ocr_results = self.ocr_reader.ocr(intermediate_res) 
                if ocr_results and ocr_results[0]:
                    best_line = ocr_results[0][0] # Focus on primary detected line
                    text, conf = best_line[1][0], best_line[1][1]
                    
                    if conf > 0.4:
                        clean = "".join([c for c in text if c.isalnum()]).upper()
                        if len(clean) >= 4: 
                            valid_texts.append(clean)
                            max_frame_conf = conf
                            
                            # -- STAGE 2: Precise 4-Point Cropping --
                            # Extract the 4-point polygon from OCR results
                            poly_points = np.array(best_line[0], dtype=np.float32)
                            
                            # Get bounding box of the OCR polygon to crop tighter
                            bx, by, bw, bh = cv2.boundingRect(poly_points)
                            # Add a very tiny 5% margin around the text
                            mx, my = int(bw * 0.05), int(bh * 0.05)
                            
                            px1 = max(0, bx - mx)
                            py1 = max(0, by - my)
                            px2 = min(intermediate_res.shape[1], bx + bw + mx)
                            py2 = min(intermediate_res.shape[0], by + bh + my)
                            
                            # Create the 'Fine Crop' which is exactly the plate text
                            raw_plate_crop = intermediate_res[py1:py2, px1:px2]
                            if raw_plate_crop.size > 0:
                                display_crop = cv2.resize(raw_plate_crop, (800, 250), interpolation=cv2.INTER_CUBIC)
                                
                                # Final Preprocessing: Adaptive Threshold for OCR clarity ONLY
                                gray_fine = cv2.cvtColor(raw_plate_crop, cv2.COLOR_BGR2GRAY)
                                thresh_fine = cv2.adaptiveThreshold(
                                    gray_fine, 255,
                                    cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                                    cv2.THRESH_BINARY_INV, 11, 2
                                )
                                fine_crop_binary = cv2.resize(thresh_fine, (800, 250), interpolation=cv2.INTER_CUBIC)
                                
                                # We MUST send the binarized image to OCR if we used a second pass, but we've already done OCR on intermediate.
                                # The loop actually doesn't run OCR again, it just did OCR on intermediate. 
                                # So here we only care about `display_crop` which will go to DB.
            else:
                # EasyOCR fallback
                gray = cv2.cvtColor(intermediate_res, cv2.COLOR_BGR2GRAY)
                processed = cv2.bilateralFilter(gray, 11, 25, 25)
                results = self.ocr_reader.readtext(processed, detail=1)
                for (bbox, text, conf) in results:
                    if conf > 0.3:
                        clean = "".join([c for c in text if c.isalnum()]).upper()
                        if len(clean) >= 2: 
                            valid_texts.append(clean)
                            max_frame_conf = max(max_frame_conf, conf)
        except Exception as e:
            print(f"[OCR ERROR] Cam {self.camera_id}: {e}")
            return

        if not valid_texts: return
        
        raw_text = "".join(valid_texts)
        # Check against Indian format
        if self.validate_indian_plate(raw_text):
            plate_text = raw_text.replace(" ", "")
        else:
            plate_text = self.correct_plate_format(raw_text)
            if not plate_text and len(raw_text) >= 4:
                plate_text = raw_text # Fallback
            
        if not plate_text: return
        
        # USER REQUEST: Always send the LAST crop (latest)
        res["best_image"] = display_crop
        if max_frame_conf > res["best_conf"] or not res["best_text"]:
            res["best_text"] = plate_text
            res["best_conf"] = max_frame_conf
            
        # 3. Decision Logic: Commit to DB if we hit high confidence OR we've reached 8 frames
        if res["best_conf"] > 0.8 or res["frames_checked"] >= 10:
            self.commit_vehicle_to_db(res["best_text"], res["best_image"])
            res["completed"] = True

    def commit_vehicle_to_db(self, plate_text, plate_image):
        print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] [CAM {self.camera_id}] [DB ACTION] COMMITTING PLATE: {plate_text}")
        
        # Encode high-res crop to Base64
        img_base64 = None
        try:
            _, buffer = cv2.imencode('.jpg', plate_image, [int(cv2.IMWRITE_JPEG_QUALITY), 70])
            img_base64 = base64.b64encode(buffer).decode('utf-8')
        except Exception as e:
            print(f"PLATE ENCODING ERROR: {e}")

        db = SessionLocal()
        try:
            now = datetime.datetime.now()
            # Check for recent same plate to avoid duplicates (within 30s)
            existing = db.query(VehicleCheck).filter(
                VehicleCheck.plate_number == plate_text,
                VehicleCheck.time_out == None
            ).first()
            
            if existing:
                if (now - existing.time_in).total_seconds() > 30: 
                    existing.time_out = now
                    print(f"[CAM {self.camera_id}] Updated Checkout for {plate_text}")
            else:
                new_check = VehicleCheck(
                    image_data=img_base64,
                    plate_number=plate_text,
                    camera_id=self.camera_id,
                    camera_name=self.camera_name,
                    time_in=now
                )
                db.add(new_check)
                print(f"[CAM {self.camera_id}] New Check-in for {plate_text} SAVED TO DB.")
            db.commit()
        except Exception as e:
            db.rollback()
            print(f"VEHICLE DB ERROR: {e}")
        finally:
            db.close()

    def validate_indian_plate(self, text):
        """Strict regex for Indian license plates as provided by the user."""
        # Formats: KA 02 MN 1826, DL 4C AB 1234, TN 38 N 5489
        pattern = r"^[A-Z]{2}[0-9]{1,2}[A-Z]{1,3}[0-9]{4}$"
        clean_text = text.replace(" ", "")
        return re.match(pattern, clean_text) is not None

    def correct_plate_format(self, text):
        """Attempts to fix common OCR misreads in standard formats."""
        if not text: return None
        clean = "".join([c for c in text if c.isalnum()]).upper()
        if len(clean) < 4: return None
        return clean

    def close(self):
        """Explicitly close the database session (No-op after refactor)"""
        pass
