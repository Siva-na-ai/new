import os
from dotenv import load_dotenv
load_dotenv()
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from twilio.rest import Client
import datetime
import threading

class NotificationManager:
    def __init__(self):
        # Email Config (Use environment variables or placeholders)
        self.smtp_server = os.getenv("SMTP_SERVER", "smtp.gmail.com")
        self.smtp_port = int(os.getenv("SMTP_PORT", "587"))
        self.sender_email = os.getenv("SENDER_EMAIL", "")
        self.sender_password = os.getenv("SENDER_PASSWORD", "")
        self.recipient_email = os.getenv("RECIPIENT_EMAIL", "")

        # Twilio Config
        self.twilio_sid = os.getenv("TWILIO_ACCOUNT_SID", "")
        self.twilio_token = os.getenv("TWILIO_AUTH_TOKEN", "")
        self.twilio_from = os.getenv("TWILIO_FROM_NUMBER", "")
        self.target_phone = os.getenv("TARGET_PHONE_NUMBER", "")

    def send_email_alert(self, subject, body):
        if not all([self.sender_email, self.sender_password, self.recipient_email]):
            print("[NOTIFY] Email credentials missing. Skipping email.")
            return False

        try:
            msg = MIMEMultipart()
            msg['From'] = self.sender_email
            msg['To'] = self.recipient_email
            msg['Subject'] = subject
            msg.attach(MIMEText(body, 'plain'))

            server = smtplib.SMTP(self.smtp_server, self.smtp_port)
            server.starttls()
            server.login(self.sender_email, self.sender_password)
            server.send_message(msg)
            server.quit()
            print(f"[NOTIFY] Email alert sent to {self.recipient_email}")
            return True
        except Exception as e:
            print(f"[NOTIFY] Email ERROR: {e}")
            return False

    def send_sms_alert(self, message):
        if not all([self.twilio_sid, self.twilio_token, self.twilio_from, self.target_phone]):
            print("[NOTIFY] Twilio credentials missing. Skipping SMS.")
            return False

        try:
            client = Client(self.twilio_sid, self.twilio_token)
            client.messages.create(
                body=message,
                from_=self.twilio_from,
                to=self.target_phone
            )
            print(f"[NOTIFY] SMS alert sent to {self.target_phone}")
            return True
        except Exception as e:
            print(f"[NOTIFY] Twilio SMS ERROR: {e}")
            return False

    def make_voice_call(self, message):
        if not all([self.twilio_sid, self.twilio_token, self.twilio_from, self.target_phone]):
            print("[NOTIFY] Twilio credentials missing. Skipping Voice Call.")
            return False

        try:
            client = Client(self.twilio_sid, self.twilio_token)
            # Create a simple TwiML for the message
            twiml = f'<Response><Say voice="alice">{message}</Say></Response>'
            client.calls.create(
                to=self.target_phone,
                from_=self.twilio_from,
                twiml=twiml
            )
            print(f"[NOTIFY] Voice call initiated to {self.target_phone}")
            return True
        except Exception as e:
            print(f"[NOTIFY] Twilio Voice ERROR: {e}")
            return False

    def broadcast_security_alert(self, camera_name, violation_type):
        """Dispatches alerts in background threads to avoid blocking camera processing."""
        timestamp = datetime.datetime.now().strftime("%H:%M:%S")
        subject = f"🚨 SECURITY BREACH: {camera_name}"
        message = f"URGENT: {violation_type} detected at {camera_name} (Time: {timestamp}). Please check the Dashboard immediately."
        
        # Dispatch in background threads
        print(f"[NOTIFY] Dispatching background alerts for {camera_name}...")
        
        # 1. Email (Background)
        threading.Thread(target=self.send_email_alert, args=(subject, message), daemon=True).start()
        
        # 2. SMS (Background)
        threading.Thread(target=self.send_sms_alert, args=(message,), daemon=True).start()
        
        # 3. Voice Call (Background)
        # threading.Thread(target=self.make_voice_call, args=(message,), daemon=True).start()

# Global Instance
notification_manager = NotificationManager()
