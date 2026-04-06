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

# For Audio Alert (System Sound)
def play_system_sound(sound_path):
    try:
        ps_script = f"""
        $player = New-Object System.Windows.Media.MediaPlayer
        $player.Open('{sound_path}')
        $player.Play()
        Start-Sleep -Seconds 5
        $player.Stop()
        """
        import subprocess
        subprocess.run(["powershell", "-Command", ps_script], capture_output=True)
    except Exception as e:
        print(f"Audio Alert Error: {e}")

def main():
    print("========================================")
    print("   Video Analysis: Desktop Notifier")
    print("========================================")
    
    # Use the production server IP
    DB_HOST = "192.168.0.135"
    DB_URL = f"postgresql://postgres:password@{DB_HOST}:5432/video_analysis"
    
    alarm_sound = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "alarm", "clip-1773994393607.mp3")

    # Use pool_pre_ping=True and pool_recycle=3600 to handle closed database connections gracefully
    engine = create_engine(DB_URL, pool_pre_ping=True, pool_recycle=3600)
    Session = sessionmaker(bind=engine)
    
    last_alert_id = None
    
    # Initialize last_alert_id to latest in DB so we don't spam old alerts
    # Robust initial fetch in case DB is booting up
    while last_alert_id is None:
        try:
            db = Session()
            latest = db.query(Alert).order_by(Alert.id.desc()).first()
            if latest:
                last_alert_id = latest.id
            else:
                last_alert_id = 0 # No alerts in DB yet
            db.close()
        except Exception as e:
            print(f"Waiting for database connection... ({e})")
            time.sleep(5)
    
    print(f"Notifier Active. Monitoring {DB_HOST} from Alert ID: {last_alert_id}")
    
    while True:
        db = None
        try:
            db = Session()
            new_alerts = db.query(Alert).filter(Alert.id > last_alert_id).order_by(Alert.id.asc()).all() if last_alert_id is not None else []
            
            for alert in new_alerts:
                print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] NEW ALERT: {alert.camera_name} - ID {alert.global_id}")
                show_toast(f"Security Alert: {alert.camera_name}", f"Detection Found! ID: {alert.global_id}")
                # Play audio in background
                import threading
                threading.Thread(target=play_system_sound, args=(alarm_sound,), daemon=True).start()
                last_alert_id = alert.id
            
        except Exception as e:
            print(f"Notifier Error: {e}")
        finally:
            if db:
                db.close()
            
        time.sleep(3) # Poll every 3 seconds

if __name__ == "__main__":
    main()
