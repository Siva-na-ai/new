import sys
import os
sys.path.append(os.path.join(os.getcwd(), 'backend'))

from database import SessionLocal, Camera, Alert, RestrictionZone, VehicleCheck
from sqlalchemy.exc import IntegrityError

def test_delete():
    db = SessionLocal()
    # Find a camera that exists
    cam = db.query(Camera).first()
    if not cam:
        print("No cameras to test deletion.")
        return
    
    print(f"Attempting to delete Camera ID: {cam.id} ({cam.place_name})")
    try:
        db.delete(cam)
        db.commit()
        print("Successfully deleted camera (Unexpected if it has related records).")
    except IntegrityError as e:
        db.rollback()
        print(f"Caught IntegrityError as expected: {e}")
    except Exception as e:
        db.rollback()
        print(f"Caught unexpected error: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    test_delete()
