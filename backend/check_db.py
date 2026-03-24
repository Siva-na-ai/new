import psycopg2
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from database import User, Camera, RestrictionZone, Base, SQLALCHEMY_DATABASE_URL

def check_db():
    try:
        engine = create_engine(SQLALCHEMY_DATABASE_URL)
        SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
        db = SessionLocal()
        
        users = db.query(User).all()
        print(f"Total users: {len(users)}")
        for user in users:
            print(f"User: {user.username}, Password: {user.password}")
            
        cameras = db.query(Camera).all()
        print(f"\nTotal cameras: {len(cameras)}")
        for cam in cameras:
            print(f"ID: {cam.id}, Place: {cam.place_name}, IP: {cam.ip_address}, Active: {cam.is_active}, Detections: {cam.detections_to_run}")
            
        zones = db.query(RestrictionZone).all()
        print(f"\nTotal restriction zones: {len(zones)}")
        for zone in zones:
            print(f"ID: {zone.id}, CamID: {zone.camera_id}, Points: {zone.polygon_points}, Active: {zone.is_active}")
            
        db.close()
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    check_db()
