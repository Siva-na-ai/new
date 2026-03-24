import requests
import json
import sys

def test_backend():
    base_url = "http://127.0.0.1:8000"
    print(f"Testing backend at {base_url}...")
    
    # 1. Test Login
    try:
        resp = requests.post(f"{base_url}/login", json={"username": "admin", "password": "password"}, timeout=5)
        print(f"Login Response: {resp.status_code}")
        print(f"Login Body: {resp.text}")
    except Exception as e:
        print(f"Login Error: {e}")

    # 2. Test alarm-sound
    try:
        resp = requests.get(f"{base_url}/alarm-sound", timeout=5)
        print(f"Alarm Sound Response: {resp.status_code}")
    except Exception as e:
        print(f"Alarm Sound Error: {e}")

if __name__ == "__main__":
    test_backend()
