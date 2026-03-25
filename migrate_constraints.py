import psycopg2
import os
from dotenv import load_dotenv

load_dotenv('backend/.env')

def migrate_constraints():
    conn = psycopg2.connect(
        host="192.168.0.249",
        port=5432,
        database=os.getenv('DB_NAME') or 'video_analysis',
        user=os.getenv('DB_USER') or 'postgres',
        password=os.getenv('DB_PASSWORD') or 'password'
    )
    cur = conn.cursor()
    
    try:
        # Alerts
        print("Migrating alerts...")
        cur.execute("ALTER TABLE alerts DROP CONSTRAINT alerts_camera_id_fkey")
        cur.execute("ALTER TABLE alerts ADD CONSTRAINT alerts_camera_id_fkey FOREIGN KEY (camera_id) REFERENCES cameras(id) ON DELETE SET NULL")
        
        # Restriction Zones
        print("Migrating restriction_zones...")
        cur.execute("ALTER TABLE restriction_zones DROP CONSTRAINT restriction_zones_camera_id_fkey")
        cur.execute("ALTER TABLE restriction_zones ADD CONSTRAINT restriction_zones_camera_id_fkey FOREIGN KEY (camera_id) REFERENCES cameras(id) ON DELETE SET NULL")
        
        # Vehicle Checks
        print("Migrating vehicle_checks...")
        cur.execute("ALTER TABLE vehicle_checks DROP CONSTRAINT vehicle_checks_camera_id_fkey")
        cur.execute("ALTER TABLE vehicle_checks ADD CONSTRAINT vehicle_checks_camera_id_fkey FOREIGN KEY (camera_id) REFERENCES cameras(id) ON DELETE SET NULL")
        
        conn.commit()
        print("Migration successful!")
    except Exception as e:
        conn.rollback()
        print(f"Migration failed: {e}")
    finally:
        cur.close()
        conn.close()

if __name__ == "__main__":
    migrate_constraints()
