from database import SessionLocal, VehicleCheck
from sqlalchemy import func

def cleanup_plates():
    db = SessionLocal()
    try:
        # Find records where plate_number length > 9
        query = db.query(VehicleCheck).filter(func.length(VehicleCheck.plate_number) > 9)
        count = query.count()
        print(f"Found {count} records with plate_number length > 9.")
        
        if count > 0:
            print("Deleting records...")
            query.delete(synchronize_session=False)
            db.commit()
            print("Deletion complete.")
        else:
            print("No records found to delete.")
            
    except Exception as e:
        print(f"Error during cleanup: {e}")
        db.rollback()
    finally:
        db.close()

if __name__ == "__main__":
    cleanup_plates()
