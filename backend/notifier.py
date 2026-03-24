import time
import os
import sqlite3 # If using sqlite, but we are using postgres
from sqlalchemy import create_engine, desc
from sqlalchemy.orm import sessionmaker
from database import Base, Alert, Camera, SQLALCHEMY_DATABASE_URL
import datetime

# For Windows Toast Notifications (using powershell to avoid extra dependencies)
def show_toast(title, message):
    try:
        ps_script = f"""
        [void] [System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms');
        $objNotifyIcon = New-Object System.Windows.Forms.NotifyIcon;
        $objNotifyIcon.Icon = [System.Drawing.SystemIcons]::Exclamation;
        $objNotifyIcon.BalloonTipIcon = 'Warning';
        $objNotifyIcon.BalloonTipTitle = '{title}';
        $objNotifyIcon.BalloonTipText = '{message}';
        $objNotifyIcon.Visible = $True;
        $objNotifyIcon.ShowBalloonTip(10000);
        """
        import subprocess
        subprocess.run(["powershell", "-Command", ps_script], capture_output=True)
    except Exception as e:
        print(f"Notification Error: {e}")

def main():
    print("========================================")
    print("   Video Analysis: Desktop Notifier")
    print("========================================")
    
    engine = create_engine(SQLALCHEMY_DATABASE_URL)
    Session = sessionmaker(bind=engine)
    
    last_alert_id = None
    
    # Initialize last_alert_id to latest in DB so we don't spam old alerts
    db = Session()
    latest = db.query(Alert).order_by(Alert.id.desc()).first()
    if latest:
        last_alert_id = latest.id
    db.close()
    
    print(f"Notifier Active. Starting from Alert ID: {last_alert_id}")
    
    while True:
        try:
            db = Session()
            new_alerts = db.query(Alert).filter(Alert.id > last_alert_id).order_by(Alert.id.asc()).all() if last_alert_id else []
            
            if not last_alert_id:
                latest = db.query(Alert).order_by(Alert.id.desc()).first()
                if latest: last_alert_id = latest.id
            
            for alert in new_alerts:
                print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] NEW ALERT: {alert.camera_name} - ID {alert.global_id}")
                show_toast(f"Security Alert: {alert.camera_name}", f"Detection Found! ID: {alert.global_id}")
                last_alert_id = alert.id
            
            db.close()
        except Exception as e:
            print(f"Notifier Error: {e}")
            
        time.sleep(5) # Poll every 5 seconds

if __name__ == "__main__":
    main()
