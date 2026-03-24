import psycopg2
from psycopg2.extensions import ISOLATION_LEVEL_AUTOCOMMIT

import os
from dotenv import load_dotenv

# Load .env from backend directory
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(BASE_DIR, ".env"))

def create_database():
    try:
        # Connect to default postgres database
        host = os.getenv("DB_HOST", "localhost")
        port = os.getenv("DB_PORT", "5432")
        user = os.getenv("DB_USER")
        password = os.getenv("DB_PASSWORD")
        
        conn_params = {
            'dbname': 'postgres',
            'host': host,
            'port': port
        }
        if user: conn_params['user'] = user
        if password: conn_params['password'] = password
        
        conn = psycopg2.connect(**conn_params)
        conn.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)
        cur = conn.cursor()
        
        # Check if database exists
        cur.execute("SELECT 1 FROM pg_catalog.pg_database WHERE datname = 'video_analysis'")
        exists = cur.fetchone()
        
        if not exists:
            cur.execute('CREATE DATABASE video_analysis')
            print("Database 'video_analysis' created successfully.")
        else:
            print("Database 'video_analysis' already exists.")
            
        cur.close()
        conn.close()
    except Exception as e:
        print(f"Error creating database: {e}")

if __name__ == "__main__":
    create_database()
