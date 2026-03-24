import redis
import cv2
import numpy as np
import json
import time

def test_redis():
    print("Connecting to Redis...")
    r = redis.Redis(host='localhost', port=6379, db=0)
    try:
        r.ping()
        print("Redis Connection: SUCCESS")
    except Exception as e:
        print(f"Redis Connection: FAILED - {e}")
        return

    # Test setting a frame
    test_frame = np.zeros((100, 100, 3), dtype=np.uint8)
    cv2.putText(test_frame, "TEST", (10, 50), cv2.FONT_HERSHEY_SIMPLEX, 1, (255, 255, 255), 2)
    _, buffer = cv2.imencode('.jpg', test_frame)
    
    print("Attempting to write test frame to Redis...")
    r.set("camera:999:frame", buffer.tobytes())
    
    # Test reading the frame
    print("Attempting to read test frame from Redis...")
    read_data = r.get("camera:999:frame")
    if read_data:
        print("Read Frame: SUCCESS")
    else:
        print("Read Frame: FAILED")

    # Test detections
    test_dets = [{"xyxy": [10, 10, 50, 50], "class_name": "person"}]
    print("Attempting to write test detections to Redis...")
    r.set("camera:999:detections", json.dumps(test_dets))
    
    read_dets = r.get("camera:999:detections")
    if read_dets:
        print(f"Read Detections: SUCCESS - {read_dets.decode('utf-8')}")
    else:
        print("Read Detections: FAILED")

if __name__ == "__main__":
    test_redis()
