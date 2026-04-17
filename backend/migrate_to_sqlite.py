import os
import sys
import sqlite3
import datetime
from sqlalchemy import create_engine, MetaData, Table, select, insert, delete, text
from dotenv import load_dotenv

# Force unbuffered output
sys.stdout.reconfigure(line_buffering=True)

# 1. Environment and Constants
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(BASE_DIR, ".env"))

DB_HOST = os.getenv("DB_HOST", "192.168.0.135")
DB_USER = os.getenv("DB_USER", "postgres")
DB_PASSWORD = os.getenv("DB_PASSWORD", "password")
DB_NAME = os.getenv("DB_NAME", "video_analysis")
DB_PORT = os.getenv("DB_PORT", "5432")

PG_URL = f"postgresql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}"
SL_PATH = os.path.join(BASE_DIR, "video_analysis.db")
SL_URL = f"sqlite:///{SL_PATH}"

print(f"DEBUG: Source: {PG_URL.replace(DB_PASSWORD, '****')}")
print(f"DEBUG: Target: {SL_URL}")

# 2. Setup Engines
pg_engine = create_engine(PG_URL, connect_args={'connect_timeout': 10})
sl_engine = create_engine(SL_URL)

# 3. Migration Logic
def migrate():
    print("\n--- STARTING DATA MIGRATION: POSTGRESQL -> SQLITE ---")
    
    tables_to_migrate = [
        "users",
        "cameras",
        "restriction_zones",
        "alerts",
        "vehicle_checks",
        "ppe_violations"
    ]

    with pg_engine.connect() as pg_conn:
        with sl_engine.connect() as sl_conn:
            
            metadata = MetaData()
            
            for table_name in tables_to_migrate:
                print(f"\n[PROCESS] Table: {table_name}")
                
                try:
                    # Reflect only this table
                    table = Table(table_name, metadata, autoload_with=pg_engine)
                except Exception as e:
                    print(f"  [SKIP] Could not reflect '{table_name}': {e}")
                    continue
                
                # Fetch data
                print(f"  - Fetching rows from PostgreSQL...")
                rows = pg_conn.execute(select(table)).fetchall()
                data = [dict(row._mapping) for row in rows]
                print(f"  - Found {len(data)} rows.")
                
                if not data:
                    continue

                # Prepare SQLite target
                print(f"  - Inserting into SQLite...")
                
                if table_name == "users":
                    # For users, check one by one to avoid collisions with fresh admin
                    for user in data:
                        check_stmt = select(table).where(table.c.username == user['username'])
                        exists = sl_conn.execute(check_stmt).first()
                        if not exists:
                            sl_conn.execute(insert(table).values(user))
                else:
                    # Clean sync for others
                    sl_conn.execute(delete(table))
                    # SQLite has a limit on variables per statement (usually 999 or 32766)
                    # We chunk it to be safe (e.g. 100 rows at a time)
                    chunk_size = 100
                    for i in range(0, len(data), chunk_size):
                        chunk = data[i : i + chunk_size]
                        sl_conn.execute(insert(table), chunk)
                
                sl_conn.commit()
                print(f"  [DONE] Successfully migrated {table_name}.")

    print("\n--- MIGRATION COMPLETE ---")

if __name__ == "__main__":
    try:
        migrate()
    except Exception as e:
        import traceback
        print(f"\nCRITICAL MIGRATION ERROR:")
        traceback.print_exc()
