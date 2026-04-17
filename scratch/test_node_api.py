import requests
import json

BASE_URL = "http://127.0.0.1:5000"

def test_api():
    try:
        # 1. Login
        print("Attempting login...")
        login_res = requests.post(f"{BASE_URL}/api/login", json={
            "username": "admin",
            "password": "password"
        })
        print(f"Login Status: {login_res.status_code}")
        if login_res.status_code != 200:
            print(f"Login Response: {login_res.text}")
            return

        token = login_res.json().get("token")
        headers = {"Authorization": f"Bearer {token}"}

        # 2. Test /api/cameras
        print("\nTesting /api/cameras...")
        cam_res = requests.get(f"{BASE_URL}/api/cameras", headers=headers)
        print(f"Cameras Status: {cam_res.status_code}")
        print(f"Cameras Response: {cam_res.text}")

        # 3. Test /api/alerts
        print("\nTesting /api/alerts...")
        alert_res = requests.get(f"{BASE_URL}/api/alerts", headers=headers)
        print(f"Alerts Status: {alert_res.status_code}")
        print(f"Alerts Response: {alert_res.text}")

    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    test_api()
