from sqlalchemy import create_engine, Column, Integer, String, Float, DateTime, Boolean, JSON, ForeignKey
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
import datetime

SQLALCHEMY_DATABASE_URL = "postgresql://postgres:password@localhost/video_analysis"

engine = create_engine(SQLALCHEMY_DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

class Camera(Base):
    __tablename__ = "cameras"

    id = Column(Integer, primary_key=True, index=True)
    ip_address = Column(String, index=True)
    place_name = Column(String)
    detections_to_run = Column(JSON)  # List of class IDs to detect
    is_active = Column(Boolean, default=True)

class RestrictionZone(Base):
    __tablename__ = "restriction_zones"

    id = Column(Integer, primary_key=True, index=True)
    camera_id = Column(Integer, ForeignKey("cameras.id"))
    polygon_points = Column(JSON)  # List of [x, y] coordinates
    activation_time = Column(DateTime, nullable=True)  # If null, active now
    is_active = Column(Boolean, default=True)

class Alert(Base):
    __tablename__ = "alerts"

    id = Column(Integer, primary_key=True, index=True)
    track_id = Column(Integer)
    global_id = Column(Integer)
    image_path = Column(String)
    timestamp = Column(DateTime, default=datetime.datetime.utcnow)
    camera_id = Column(Integer, ForeignKey("cameras.id"))
    camera_name = Column(String)

class VehicleCheck(Base):
    __tablename__ = "vehicle_checks"

    id = Column(Integer, primary_key=True, index=True)
    plate_image_path = Column(String)
    plate_number = Column(String, index=True)
    camera_id = Column(Integer, ForeignKey("cameras.id"))
    camera_name = Column(String)
    time_in = Column(DateTime, default=datetime.datetime.utcnow)
    time_out = Column(DateTime, nullable=True)

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True)
    password = Column(String)

def init_db():
    Base.metadata.create_all(bind=engine)
    
    # Create default admin user if it doesn't exist
    db = SessionLocal()
    admin = db.query(User).filter(User.username == "admin").first()
    if not admin:
        new_admin = User(username="admin", password="password") # In production, use hashed passwords
        db.add(new_admin)
        db.commit()
        print("Default admin user created.")
    db.close()

if __name__ == "__main__":
    init_db()
    print("Database tables created.")
