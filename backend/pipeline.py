import cv2
import numpy as np
from shapely.geometry import Point, Polygon
from detector import Detector
from reid import ReID
from global_id import GlobalIDManager
from database import SessionLocal, Alert, VehicleCheck, Camera
import datetime
import os

class Pipeline:
    def __init__(self, camera_id, detector, reid, global_id_manager, ocr_reader):
        self.camera_id = camera_id
        self.detector = detector
        self.reid = reid
        self.global_id_manager = global_id_manager
        self.ocr_reader = ocr_reader
        self.frame_count = 0
        self.db = SessionLocal()
        self.camera = None
        self.camera_name = f"Cam_{camera_id}"
        self.zones = []
        self.track_embeddings = {} # {track_id: [last_n_embeddings]}
        
        # Initial config load
        self.reload_config()

    def reload_config(self):
        """Reload camera settings and restricted zones from DB"""
        from database import RestrictionZone
        try:
            # Ensure session sees latest data from other threads
            self.db.expire_all()
            
            # Refresh camera settings
            self.camera = self.db.query(Camera).filter(Camera.id == self.camera_id).first()
            if self.camera:
                self.camera_name = self.camera.place_name
            else:
                self.camera_name = f"Cam_{self.camera_id}"
            
            # Refresh zones (only if active)
            self.zones = self.db.query(RestrictionZone).filter(
                RestrictionZone.camera_id == self.camera_id
            ).all()
            
        except Exception as e:
            print(f"[PIPELINE ERROR] Failed to reload config for Cam {self.camera_id}: {e}")

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
            
            # 2. Person ReID (Only for "person" class, every 3 frames or if new)
            if det["class_name"] == "person":
                if self.frame_count % 3 == 0 or track_id not in self.track_embeddings:
                    # Crop person
                    x1, y1, x2, y2 = xyxy
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
                        global_id = self.global_id_manager.match_new_track(track_id, mean_embedding, self.frame_count)
                        det["global_id"] = global_id
            
            # Check Vehicle / Plate
            if det["class_name"] == "license_plate":
                self.handle_vehicle_check(det, frame)

            # 4. Restriction Zone Check (All classes)
            self.check_restriction_zones(det, frame)
            
        # 5. Cleanup
        if self.frame_count % 100 == 0:
            self.global_id_manager.cleanup(self.frame_count)
            
        return detections

    def check_restriction_zones(self, detection, frame):
        x1, y1, x2, y2 = detection["xyxy"]
        # Use a point slightly above the bottom (10% up) to be more robust
        h = y2 - y1
        cx = (x1 + x2) // 2
        cy = y2 - int(h * 0.1)
        point = Point(cx, cy)
        
        now = datetime.datetime.now()
        
        for zone in self.zones:
            # Check activation time
            if zone.activation_time and now < zone.activation_time:
                continue
                
            poly = Polygon(zone.polygon_points)
            if poly.contains(point) or poly.touches(point):
                print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] [CAM {self.camera_id}] Zone violation: {detection['class_name']} in Zone #{zone.id}")
                
                # Save alert to DB with fresh session
                db = SessionLocal()
                try:
                    alert_dir = "alerts"
                    if not os.path.exists(alert_dir): os.makedirs(alert_dir)
                    img_name = f"alert_{self.camera_id}_{self.frame_count}.jpg"
                    img_path = os.path.join(alert_dir, img_name)
                    cv2.imwrite(img_path, frame)
                    
                    new_alert = Alert(
                        track_id=detection["track_id"],
                        global_id=detection.get("global_id"),
                        image_path=img_path,
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

    def handle_vehicle_check(self, detection, frame):
        x1, y1, x2, y2 = detection["xyxy"]
        plate_crop = frame[max(0, y1):min(frame.shape[0], y2), max(0, x1):min(frame.shape[1], x2)]
        
        if plate_crop.size > 0:
            # Simple OCR
            results = self.ocr_reader.readtext(plate_crop)
            if results:
                plate_text = "".join([res[1] for res in results]).upper().replace(" ", "")
                print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] [CAM {self.camera_id}] OCR Success: {plate_text}")
                
                # Save plate image
                plate_dir = "plates"
                if not os.path.exists(plate_dir): os.makedirs(plate_dir)
                img_name = f"plate_{plate_text}_{datetime.datetime.now().strftime('%Y%m%d%H%M%S')}.jpg"
                img_path = os.path.join(plate_dir, img_name)
                cv2.imwrite(img_path, plate_crop)
                
                # Update DB (Check if time_in or time_out)
                now = datetime.datetime.now()
                existing = self.db.query(VehicleCheck).filter(
                    VehicleCheck.plate_number == plate_text,
                    VehicleCheck.time_out == None
                ).first()
                
                if existing:
                    # If seen after > 10 sec (for testing/demo persistence)
                    if (now - existing.time_in).total_seconds() > 10: 
                        existing.time_out = now
                        print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] [CAM {self.camera_id}] Updated Checkout for {plate_text}")
                else:
                    new_check = VehicleCheck(
                        plate_image_path=img_path,
                        plate_number=plate_text,
                        camera_id=self.camera_id,
                        camera_name=self.camera_name,
                        time_in=now
                    )
                    self.db.add(new_check)
                    print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] [CAM {self.camera_id}] New Check-in for {plate_text}")
                
                self.db.commit()

    def close(self):
        """Explicitly close the database session"""
        if self.db:
            self.db.close()

    def __del__(self):
        self.close()
