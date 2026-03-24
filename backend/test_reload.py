import requests
import json
import time

def test_reload():
    # 1. Start a camera if not already running (mocking camera_id 1)
    # Note: This assumes the worker is running on port 8001
    source = "c:\\Users\\sivan\\OneDrive - MSFT\\analysis_system\\test_video.mp4"
    try:
        resp = requests.post("http://localhost:8001/start/3", json={"source": source}, timeout=5)
        print(f"Start Response: {resp.json()}")
    except Exception as e:
        print(f"Failed to start: {e}")
        return

    # 2. Wait a bit for it to initialize
    time.sleep(2)

    # 3. Trigger a reload
    try:
        resp = requests.post("http://localhost:8001/reload/3", timeout=5)
        print(f"Reload Response: {resp.json()}")
    except Exception as e:
        print(f"Failed to reload: {e}")

if __name__ == "__main__":
    test_reload()
