import cv2
import numpy as np
from shapely.geometry import Point, Polygon
from detector import Detector
from reid import ReID
from global_id import GlobalIDManager
from database import SessionLocal, Alert, VehicleCheck, Camera
import datetime
import os
import base64

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
        self.last_alert_time = {} # {(track_id, zone_id): datetime}
        
        # Initial config load
        self.reload_config()

    def reload_config(self):
        """Reload camera settings and restricted zones from DB"""
        print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] [PIPELINE] Reloading config for Cam {self.camera_id}...")
        from database import RestrictionZone
        db = SessionLocal()
        try:
            # Refresh camera settings
            self.camera = db.query(Camera).filter(Camera.id == self.camera_id).first()
            if self.camera:
                self.camera_name = self.camera.place_name
            else:
                self.camera_name = f"Cam_{self.camera_id}"
            
            # Refresh zones (only if active)
            self.zones = db.query(RestrictionZone).filter(
                RestrictionZone.camera_id == self.camera_id
            ).all()
            
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
        detections = self.detector.detect(frame, classes=self.camera.detections_to_run if self.camera else None)
        
        for det in detections:
            track_id = det["track_id"]
            if track_id is None:
                continue
                
            xyxy = det["xyxy"]
            
            # 2. Person ReID - Optimization: Only ReID if near a Zone OR new track
            if det["class_name"] == "person":
                in_or_near_zone = self.is_near_any_zone(xyxy)
                is_new = track_id not in self.track_embeddings
                
                # Frequency: Every 15 frames for existing, Every frame for new until matched
                should_reid = is_new or (in_or_near_zone and self.frame_count % 15 == 0)
                
                if should_reid:
                    # Crop person
                    x1, y1, x2, y2 = xyxy
                    # Ensure minimum crop size for ReID
                    if (x2-x1) > 30 and (y2-y1) > 30:
                        person_crop = frame[max(0, y1):min(frame.shape[0], y2), max(0, x1):min(frame.shape[1], x2)]
                        
                        if person_crop.size > 0:
                            embedding = self.reid.extract_embedding(person_crop)
                            
                            if track_id not in self.track_embeddings:
                                self.track_embeddings[track_id] = []
                            
                            self.track_embeddings[track_id].append(embedding)
                            if len(self.track_embeddings[track_id]) > 5:
                                self.track_embeddings[track_id].pop(0)
                            
                            # Compute mean embedding
                            mean_embedding = np.mean(self.track_embeddings[track_id], axis=0)
                            
                            # 3. Global ID Matching
                            global_id = self.global_id_manager.match_new_track(self.camera_id, track_id, mean_embedding, self.frame_count)
                            det["global_id"] = global_id
                else:
                    # Reuse last known global ID if it exists
                    det["global_id"] = self.global_id_manager.get_active_global_id(self.camera_id, track_id)
            
            # Check Vehicle / Plate
            if det["class_name"] == "license_plate":
                self.handle_vehicle_check(det, frame)

            # 4. Restriction Zone Check (All classes)
            self.check_restriction_zones(det, frame)
            
        # 5. Cleanup
        if self.frame_count % 100 == 0:
            self.global_id_manager.cleanup(self.frame_count)
            
        return detections, [z.polygon_points for z in self.zones]

    def check_restriction_zones(self, detection, frame):
        x1, y1, x2, y2 = detection["xyxy"]
        # Use center-bottom point for zone check (more robust for people/vehicles)
        cx = (x1 + x2) // 2
        cy = y2 - 5 # 5 pixels from bottom
        point = Point(cx, cy)
        
        now = datetime.datetime.now()
        
        for zone in self.zones:
            # Check activation time
            if zone.activation_time and now < zone.activation_time:
                continue
                
            poly = Polygon(zone.polygon_points)
            if poly.contains(point) or poly.touches(point):
                # Throttling: Only alert once every 30 seconds per object per zone
                alert_key = (detection["track_id"], zone.id)
                can_alert = True
                if alert_key in self.last_alert_time:
                    last_time = self.last_alert_time[alert_key]
                    if (now - last_time).total_seconds() < 10:
                        can_alert = False
                
                if not can_alert:
                    print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] [CAM {self.camera_id}] Alert Throttled (Waiting for cooldown).")
                    break
                
                self.last_alert_time[alert_key] = now
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
                    print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] [CAM {self.camera_id}] Alert Saved to DB.")
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
        x1, y1, x2, y2 = [int(v) for v in detection["xyxy"]]
        
        # 1. Add padding (15%) to the crop for better character context
        h, w = y2 - y1, x2 - x1
        pad_x, pad_y = int(w * 0.15), int(h * 0.15) # Increased slightly as requested
        x1_pad = max(0, x1 - pad_x)
        y1_pad = max(0, y1 - pad_y)
        x2_pad = min(frame.shape[1], x2 + pad_x)
        y2_pad = min(frame.shape[0], y2 + pad_y)
        
        plate_crop = frame[y1_pad:y2_pad, x1_pad:x2_pad]
        
        if plate_crop.size > 0:
            # 2. Advanced Preprocessing for OCR
            # Resize with cubic interpolation
            plate_resized = cv2.resize(plate_crop, (300, 100), interpolation=cv2.INTER_CUBIC)
            gray = cv2.cvtColor(plate_resized, cv2.COLOR_BGR2GRAY)
            processed = cv2.bilateralFilter(gray, 11, 17, 17)
            
            # 3. Optimized OCR Extraction with Fallback Support
            valid_texts = []
            try:
                # Check if it's PaddleOCR or EasyOCR
                is_paddle = hasattr(self.ocr_reader, 'ocr')
                
                if is_paddle:
                    # PaddleOCR.ocr returns list of [box, [text, score]]
                    # Use the 3-channel BGR image (plate_resized) instead of processed (Gray) for better results
                    ocr_results = self.ocr_reader.ocr(plate_resized) 
                    if ocr_results and ocr_results[0]:
                        for line in ocr_results[0]:
                            text, conf = line[1][0], line[1][1]
                            if conf > 0.35:
                                clean_text = "".join([c for c in text if c.isalnum()]).upper()
                                if len(clean_text) >= 2: valid_texts.append(clean_text)
                else:
                    # EasyOCR.readtext returns list of (bbox, text, conf)
                    results = self.ocr_reader.readtext(processed, detail=1)
                    for (bbox, text, conf) in results:
                        if conf > 0.3:
                            clean_text = "".join([c for c in text if c.isalnum()]).upper()
                            if len(clean_text) >= 2: valid_texts.append(clean_text)
                            
            except Exception as e:
                print(f"[OCR ERROR] Cam {self.camera_id}: {e}")
                valid_texts = []
            
            if valid_texts:
                raw_text = "".join(valid_texts)
                plate_text = self.correct_plate_format(raw_text)
                
                print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] [CAM {self.camera_id}] OCR Raw: '{raw_text}', Corrected: '{plate_text}'")
                
                if not plate_text:
                    # If 7-char format fails, fallback to raw filtered if it's reasonably long
                    # Relaxed to 4 characters (e.g., MH12, MH04, etc.)
                    if len(raw_text) >= 4:
                         plate_text = raw_text
                    else:
                        print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] [CAM {self.camera_id}] OCR Discarded (Too short: '{raw_text}')")
                        return # Discard low-quality noise
                
                print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] [CAM {self.camera_id}] Processing Plate: {plate_text}")
                
                # Encode plate crop to Base64
                img_base64 = None
                try:
                    _, buffer = cv2.imencode('.jpg', plate_resized)
                    img_base64 = base64.b64encode(buffer).decode('utf-8')
                except Exception as e:
                    print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] [CAM {self.camera_id}] PLATE ENCODING ERROR: {e}")
                
                # 4. Update DB
                db = SessionLocal()
                try:
                    now = datetime.datetime.now()
                    existing = db.query(VehicleCheck).filter(
                        VehicleCheck.plate_number == plate_text,
                        VehicleCheck.time_out == None
                    ).first()
                    
                    if existing:
                        # Throttling update: Only checkout if seen after 30s
                        if (now - existing.time_in).total_seconds() > 30: 
                            existing.time_out = now
                            print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] [CAM {self.camera_id}] Updated Checkout for {plate_text}")
                    else:
                        new_check = VehicleCheck(
                            image_data=img_base64,
                            plate_number=plate_text,
                            camera_id=self.camera_id,
                            camera_name=self.camera_name,
                            time_in=now
                        )
                        db.add(new_check)
                        print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] [CAM {self.camera_id}] New Check-in for {plate_text} SAVED TO DB.")
                    
                    db.commit()
                except Exception as e:
                    print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] [CAM {self.camera_id}] VEHICLE DB ERROR: {e}")
                    db.rollback()
                finally:
                    db.close()

    def close(self):
        """Explicitly close the database session (No-op after refactor)"""
        pass
