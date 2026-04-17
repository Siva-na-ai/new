import psycopg2
import os
from dotenv import load_dotenv

load_dotenv('d:/analysis_system/backend/.env')

def list_tables():
    try:
        conn = psycopg2.connect(
            host=os.getenv('DB_HOST'),
            user=os.getenv('DB_USER'),
            password=os.getenv('DB_PASSWORD'),
            database=os.getenv('DB_NAME'),
            port=os.getenv('DB_PORT')
        )
        cur = conn.cursor()
        
        # List all tables
        cur.execute("""
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public'
        """)
        tables = cur.fetchall()
        print("Tables in database:")
        for table in tables:
            print(f"- {table[0]}")
            # Get columns for each table
            cur.execute(f"SELECT column_name, data_type FROM information_schema.columns WHERE table_name = '{table[0]}'")
            columns = cur.fetchall()
            for col in columns:
                print(f"  * {col[0]} ({col[1]})")
        
        cur.close()
        conn.close()
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    list_tables()
