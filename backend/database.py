from sqlalchemy import create_engine, Column, Integer, String, Float, DateTime, Boolean, JSON, ForeignKey
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
import datetime
import os
from dotenv import load_dotenv

# Load .env from backend directory
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(BASE_DIR, ".env"))

DB_HOST = os.getenv("DB_HOST", "192.168.0.249")
DB_PORT = os.getenv("DB_PORT", "5432")
# Use defaults only if not set in .env
DB_USER = os.getenv("DB_USER") or "postgres"
DB_PASSWORD = os.getenv("DB_PASSWORD") or "password"
DB_NAME = os.getenv("DB_NAME") or "video_analysis"

# If user/password are empty, simplify the URL
if DB_USER and DB_PASSWORD:
    SQLALCHEMY_DATABASE_URL = f"postgresql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}"
elif DB_USER:
    SQLALCHEMY_DATABASE_URL = f"postgresql://{DB_USER}@{DB_HOST}:{DB_PORT}/{DB_NAME}"
else:
    SQLALCHEMY_DATABASE_URL = f"postgresql://{DB_HOST}:{DB_PORT}/{DB_NAME}"

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
    camera_id = Column(Integer, ForeignKey("cameras.id", ondelete="SET NULL"), nullable=True)
    polygon_points = Column(JSON)  # List of [x, y] coordinates
    activation_time = Column(DateTime, nullable=True)  # If null, active now
    is_active = Column(Boolean, default=True)

class Alert(Base):
    __tablename__ = "alerts"

    id = Column(Integer, primary_key=True, index=True)
    track_id = Column(Integer)
    global_id = Column(Integer)
    image_data = Column(String)  # Base64 encoded image data
    image_path = Column(String)  # Deprecated, keeping for safety
    timestamp = Column(DateTime, default=datetime.datetime.now)
    camera_id = Column(Integer, ForeignKey("cameras.id", ondelete="SET NULL"), nullable=True)
    camera_name = Column(String)

class VehicleCheck(Base):
    __tablename__ = "vehicle_checks"

    id = Column(Integer, primary_key=True, index=True)
    image_data = Column(String)  # Base64 encoded image data
    plate_image_path = Column(String) # Deprecated
    plate_number = Column(String, index=True)
    camera_id = Column(Integer, ForeignKey("cameras.id", ondelete="SET NULL"), nullable=True)
    camera_name = Column(String)
    time_in = Column(DateTime, default=datetime.datetime.now)
    time_out = Column(DateTime, nullable=True)

class PPEViolation(Base):
    __tablename__ = "ppe_violations"

    id = Column(Integer, primary_key=True, index=True)
    track_id = Column(Integer)
    global_id = Column(Integer)
    violation_type = Column(String)  # 'no_helmet', 'no_vest', 'helmet', 'person_with_vest'
    image_data = Column(String)  # Base64 encoded image data
    timestamp = Column(DateTime, default=datetime.datetime.now)
    camera_id = Column(Integer, ForeignKey("cameras.id", ondelete="SET NULL"), nullable=True)
    camera_name = Column(String)

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
