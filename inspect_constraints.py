import psycopg2
import os
from dotenv import load_dotenv

load_dotenv('backend/.env')

def get_constraints():
    conn = psycopg2.connect(
        host="192.168.0.249",
        port=5432,
        database=os.getenv('DB_NAME') or 'video_analysis',
        user=os.getenv('DB_USER') or 'postgres',
        password=os.getenv('DB_PASSWORD') or 'password'
    )
    cur = conn.cursor()
    
    tables = ['alerts', 'restriction_zones', 'vehicle_checks']
    for table in tables:
        print(f"\n--- {table} ---")
        cur.execute(f"""
            SELECT conname 
            FROM pg_constraint 
            WHERE conrelid = '{table}'::regclass 
            AND contype = 'f';
        """)
        constraints = cur.fetchall()
        for con in constraints:
            print(f"Constraint: {con[0]}")
            
    cur.close()
    conn.close()

if __name__ == "__main__":
    get_constraints()
