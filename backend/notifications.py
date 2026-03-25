import os
from dotenv import load_dotenv
load_dotenv()
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.image import MIMEImage
from twilio.rest import Client
import datetime
import threading
import base64

class NotificationManager:
    def __init__(self):
        # Email Config (Hardcoded per USER REQUEST)
        self.smtp_server = "smtp.gmail.com"
        self.smtp_port = 587
        self.sender_email = "sivanarayanam27@gmail.com"
        self.sender_password = "ydqvmfxtrsypyyio" # Removed spaces
        self.recipient_email = "sivanarayanam27@gmail.com" # Assuming same recipient

        # Twilio Config
        self.twilio_sid = os.getenv("TWILIO_ACCOUNT_SID", "")
        self.twilio_token = os.getenv("TWILIO_AUTH_TOKEN", "")
        self.twilio_from = os.getenv("TWILIO_FROM_NUMBER", "")
        self.target_phone = os.getenv("TARGET_PHONE_NUMBER", "")

    def send_email_alert(self, subject, body, image_base64=None):
        if not all([self.sender_email, self.sender_password, self.recipient_email]):
            print("[NOTIFY] Email credentials missing. Skipping email.")
            return False

        try:
            msg = MIMEMultipart()
            msg['From'] = self.sender_email
            msg['To'] = self.recipient_email
            msg['Subject'] = subject
            msg.attach(MIMEText(body, 'plain'))

            if image_base64:
                try:
                    # Decode base64 and attach as image
                    image_data = base64.b64decode(image_base64)
                    image_part = MIMEImage(image_data)
                    image_part.add_header('Content-Disposition', 'attachment', filename='violation.jpg')
                    msg.attach(image_part)
                except Exception as img_err:
                    print(f"[NOTIFY] Failed to attach image: {img_err}")

            server = smtplib.SMTP(self.smtp_server, self.smtp_port)
            server.starttls()
            server.login(self.sender_email, self.sender_password)
            server.send_message(msg)
            server.quit()
            print(f"[NOTIFY] Visual Email alert sent to {self.recipient_email}")
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

    def broadcast_security_alert(self, camera_name, violation_type, image_base64=None):
        """Dispatches alerts in background threads to avoid blocking camera processing."""
        timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        subject = f"🚨 IMPORTANT: {camera_name} - {violation_type}"
        message = (
            f"URGENT: SECURITY BREACH DETECTED\n"
            f"---------------------------------\n"
            f"Camera Source: {camera_name}\n"
            f"Incident Type: {violation_type}\n"
            f"Time: {timestamp}\n"
            f"Status: IMPORTANT / ACTION REQUIRED\n\n"
            f"Please check the live Analytical Dashboard immediately."
        )
        
        # Dispatch in background threads
        print(f"[NOTIFY] Dispatching background alerts for {camera_name}...")
        
        # 1. Email with Image (Background)
        threading.Thread(target=self.send_email_alert, args=(subject, message, image_base64), daemon=True).start()
        
        # 2. SMS (Background)
        threading.Thread(target=self.send_sms_alert, args=(message,), daemon=True).start()

# Global Instance
notification_manager = NotificationManager()
