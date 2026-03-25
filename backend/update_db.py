from sqlalchemy import create_engine, text
import os

SQLALCHEMY_DATABASE_URL = "postgresql://postgres:password@192.168.0.249:5432/video_analysis"

def update_schema():
    engine = create_engine(SQLALCHEMY_DATABASE_URL)
    with engine.connect() as conn:
        print("Checking/Updating schema...")
        try:
            # Check for image_data in alerts
            conn.execute(text("ALTER TABLE alerts ADD COLUMN IF NOT EXISTS image_data TEXT;"))
            # Check for image_data in vehicle_checks
            conn.execute(text("ALTER TABLE vehicle_checks ADD COLUMN IF NOT EXISTS image_data TEXT;"))
            conn.commit()
            print("Database schema verified and updated.")
        except Exception as e:
            print(f"Schema Update Error: {e}")

if __name__ == "__main__":
    update_schema()
