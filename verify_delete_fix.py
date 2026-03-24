import sys
import os
sys.path.append(os.path.join(os.getcwd(), 'backend'))

from database import SessionLocal, Camera, Alert, RestrictionZone, VehicleCheck
from sqlalchemy.orm import Session

def test_delete_fixed():
    db = SessionLocal()
    # Find a camera that exists
    cam = db.query(Camera).filter(Camera.id == 3).first()
    if not cam:
        print("Camera 3 not found. Trying another one.")
        cam = db.query(Camera).first()
        if not cam:
            print("No cameras found.")
            return
    
    print(f"Attempting to delete Camera ID: {cam.id} ({cam.place_name}) with related records cleanup.")
    try:
        # Simulate the fix in main.py
        db.query(Alert).filter(Alert.camera_id == cam.id).delete()
        db.query(RestrictionZone).filter(RestrictionZone.camera_id == cam.id).delete()
        db.query(VehicleCheck).filter(VehicleCheck.camera_id == cam.id).delete()
        
        db.delete(cam)
        db.commit()
        print("Successfully deleted camera and all related records.")
    except Exception as e:
        db.rollback()
        print(f"Caught error: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    test_delete_fixed()
