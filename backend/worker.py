import cv2
import threading
import time
import os
import numpy as np
import datetime
import base64
from typing import Dict, Any, Optional
from fastapi import FastAPI, HTTPException, Body, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

import redis
import json
try:
    from paddleocr import PaddleOCR
    HAS_PADDLE = True
except ImportError:
    import easyocr
    HAS_PADDLE = False
from database import SessionLocal, Camera, Alert, RestrictionZone, VehicleCheck
from pipeline import Pipeline
from detector import Detector
from reid import ReID
from global_id import GlobalIDManager

app = FastAPI(title="Video Analysis Worker")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global State for Worker
active_cameras = {} # {id: {"thread": thread, "stop": False, "frame": None, "detections": [], "status": "Starting..."}}
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# Global Redis Client
r = redis.Redis(host='localhost', port=6379, db=0, decode_responses=False)

# Global AI Engine Instances (Same as before, with Lock)
ai_lock = threading.Lock()
shared_detector = Detector(os.path.join(os.path.dirname(BASE_DIR), "weights", "last_v8.pt"))
shared_reid = ReID()
shared_global_id = GlobalIDManager()
# Initialize OCR Engine (PaddleOCR with EasyOCR Fallback)
if HAS_PADDLE:
    try:
        shared_ocr = PaddleOCR(use_textline_orientation=True, lang='en', use_mkldnn=False)
        print("[OCR] PaddleOCR Initialized.")
    except Exception as e:
        print(f"[OCR] PaddleOCR Init Failed: {e}. Falling back to EasyOCR.")
        import easyocr
        shared_ocr = easyocr.Reader(['en'], gpu=False)
        HAS_PADDLE = False
else:
    print("[OCR] PaddleOCR not available. Using EasyOCR.")
    shared_ocr = easyocr.Reader(['en'], gpu=False)

def get_placeholder_frame():
    img = np.zeros((480, 640, 3), dtype=np.uint8)
    cv2.putText(img, "Connecting...", (150, 240), cv2.FONT_HERSHEY_SIMPLEX, 1, (255, 255, 255), 2)
    _, buffer = cv2.imencode('.jpg', img)
    return buffer.tobytes()

def get_ended_frame():
    img = np.zeros((480, 640, 3), dtype=np.uint8)
    cv2.putText(img, "STREAM ENDED", (150, 240), cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 0, 255), 2)
    _, buffer = cv2.imencode('.jpg', img)
    return buffer.tobytes()

def get_yt_stream_url(url, force_refresh=False):
    # This worker will handle its own YT resolution
    import yt_dlp
    try:
        ydl_opts = {
            'format': 'best', # Simpler format selection
            'quiet': True,
            'no_warnings': True,
            'skip_download': True,
            'nocheckcertificate': True,
            'hls_use_mpegts': True # More stable for streaming
        }
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            return info.get('url')
    except Exception as e:
        print(f"Worker YT Error: {e}")
        return None

def camera_thread(camera_id, source):
    try:
        pipeline = Pipeline(camera_id, shared_detector, shared_reid, shared_global_id, shared_ocr)
        actual_source = source
        if "youtube.com" in source or "youtu.be" in source:
            actual_source = get_yt_stream_url(source)
            if not actual_source:
                active_cameras[camera_id]["status"] = "YT Failed"
                return

        print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] Connecting to: {actual_source[:50]}...")
        cap = cv2.VideoCapture(actual_source)
        if cap.isOpened():
            print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] Success: Cam {camera_id} connected.")
        else:
            print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] Error: Cam {camera_id} failed to open.")
            
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        
        failure_count = 0
        while not active_cameras[camera_id]["stop"]:
            try:
                ret, frame = cap.read()
                if not ret:
                    raise Exception("Stream break or empty frame")
                failure_count = 0 # Reset on success
            except Exception as e:
                failure_count += 1
                print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] Error reading Cam {camera_id} ({failure_count}/3): {e}")
                
                # Cleanup old capture
                try: cap.release()
                except: pass
                
                if failure_count >= 3:
                    print(f"[!] Critical Failure for Cam {camera_id}. Deactivating...")
                    # Notify API server to deactivate
                    try:
                        import requests
                        requests.post(f"http://localhost:8000/api/cameras-toggle/{camera_id}", timeout=5)
                    except Exception as e:
                        print(f"Failed to auto-deactivate: {e}")
                    break # Exit thread
                
                time.sleep(5)
                
                # RE-RESOLVE if it was a YouTube source
                re_source = source
                if "youtube.com" in source or "youtu.be" in source:
                    print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] Re-resolving YouTube URL for Cam {camera_id}...")
                    re_source = get_yt_stream_url(source)
                    if not re_source:
                        print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] YT Re-resolve FAILED for Cam {camera_id}. Waiting...")
                        continue
                
                cap = cv2.VideoCapture(re_source)
                continue
                
            # 1. Update In-Memory cache (for quick internal access)
            active_cameras[camera_id]["frame"] = frame.copy()
            active_cameras[camera_id]["status"] = "Active"
            active_cameras[camera_id]["pipeline"] = pipeline 
            
            f_count = active_cameras[camera_id].get("processed_frames", 0)
            active_cameras[camera_id]["processed_frames"] = f_count + 1
            
            # 2. Push Frame to Redis for external streaming (main.py)
            try:
                # Optimized JPEG encoding for Redis
                _, jpeg_buf = cv2.imencode('.jpg', frame, [int(cv2.IMWRITE_JPEG_QUALITY), 75])
                r.set(f"camera:{camera_id}:frame", jpeg_buf.tobytes())
            except Exception as e:
                if f_count % 100 == 0: print(f"Redis Frame Push Error Cam {camera_id}: {e}")
            
            # AI Inference - Non-blocking to keep stream smooth
            if f_count % 6 == 0:
                if ai_lock.acquire(blocking=False):
                    try:
                        res = pipeline.process_frame(frame)
                        if isinstance(res, tuple):
                             dets, zones = res
                             active_cameras[camera_id]["detections"] = dets
                             active_cameras[camera_id]["zones"] = zones
                             # Push Detections/Zones to Redis
                             r.set(f"camera:{camera_id}:detections", json.dumps(dets))
                             r.set(f"camera:{camera_id}:zones", json.dumps(zones))
                        else:
                             active_cameras[camera_id]["detections"] = res
                             r.set(f"camera:{camera_id}:detections", json.dumps(res))
                    except Exception as e:
                        print(f"AI Error Cam {camera_id}: {e}")
                    finally:
                        ai_lock.release()
            
            # Small sleep to prevent thread from hogging CPU
            time.sleep(0.005)
                        
        if 'cap' in locals(): cap.release()
    except Exception as e:
        print(f"Worker Thread Fatal Error Cam {camera_id}: {e}")
        if camera_id in active_cameras:
            active_cameras[camera_id]["status"] = f"Fatal Error: {str(e)[:50]}"

@app.get("/video_feed/{camera_id}")
async def video_feed(camera_id: int, detect: str = "false"):
    is_detect = detect.lower() == "true"
    import anyio
    async def gen():
        while True:
            if camera_id not in active_cameras:
                yield (b'--frame\r\nContent-Type: image/jpeg\r\n\r\n' + get_placeholder_frame() + b'\r\n')
                await anyio.sleep(1)
                continue
            
            frame = active_cameras[camera_id].get("frame")
            detections = active_cameras[camera_id].get("detections", [])
            
            if frame is None:
                yield (b'--frame\r\nContent-Type: image/jpeg\r\n\r\n' + get_placeholder_frame() + b'\r\n')
                await anyio.sleep(0.1)
                continue
            
            # Draw detections and zones only if requested
            if is_detect:
                disp = frame.copy() # Only copy if we are going to modify (draw)
                
                # 1. Draw Restriction Zones (Polygons)
                try:
                    zones = active_cameras[camera_id].get("zones", [])
                    for zone_pts in zones:
                        if zone_pts and len(zone_pts) > 2:
                            pts = np.array(zone_pts, np.int32).reshape((-1, 1, 2))
                            # Draw outline
                            cv2.polylines(disp, [pts], True, (0, 0, 255), 2)
                            # Draw semi-transparent fill
                            overlay = disp.copy()
                            cv2.fillPoly(overlay, [pts], (0, 0, 255))
                            cv2.addWeighted(overlay, 0.3, disp, 0.7, 0, disp)
                except Exception as e:
                    print(f"Zone visualization drawing error: {e}")
                
                # 2. Draw Object Detections
                for det in detections:
                    try:
                        x1, y1, x2, y2 = [int(v) for v in det["xyxy"]]
                        cv2.rectangle(disp, (x1, y1), (x2, y2), (0, 255, 0), 2)
                        cv2.putText(disp, f"{det['class_name']} {det.get('global_id','')}", (x1, y1-5), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 2)
                    except:
                        continue
            else:
                disp = frame # Direct reference for normal stream (saves memory)
            
            _, buffer = cv2.imencode('.jpg', disp, [int(cv2.IMWRITE_JPEG_QUALITY), 70]) # Lower quality to save bandwidth
            yield (b'--frame\r\nContent-Type: image/jpeg\r\n\r\n' + buffer.tobytes() + b'\r\n')
            await anyio.sleep(0.04) # 25fps cap to save CPU

    return StreamingResponse(gen(), media_type="multipart/x-mixed-replace; boundary=frame")

@app.post("/start/{camera_id}")
def start_worker(camera_id: int, source: str = Body(..., embed=True)):
    if camera_id in active_cameras and not active_cameras[camera_id]["stop"]:
        # If already running, trigger a configuration reload just in case detections changed
        if "pipeline" in active_cameras[camera_id] and active_cameras[camera_id]["pipeline"]:
            active_cameras[camera_id]["pipeline"].reload_config()
            return {"status": "Already running, reloaded config"}
        return {"status": "Already running"}
    
    active_cameras[camera_id] = {"stop": False, "frame": None, "detections": [], "status": "Starting...", "pipeline": None}
    t = threading.Thread(target=camera_thread, args=(camera_id, source), daemon=True)
    active_cameras[camera_id]["thread"] = t
    t.start()
    return {"status": "started"}

@app.post("/reload/{camera_id}")
def reload_worker_config(camera_id: int):
    if camera_id in active_cameras and active_cameras[camera_id].get("pipeline"):
        active_cameras[camera_id]["pipeline"].reload_config()
        return {"status": "reloaded"}
    return {"status": "not running or pipeline not initialized", "code": 404}

@app.post("/stop/{camera_id}")
def stop_worker(camera_id: int):
    if camera_id in active_cameras:
        active_cameras[camera_id]["stop"] = True
        return {"status": "stopping"}
    return {"status": "not found"}

@app.get("/status")
def get_status():
    """Return the health and synchronization status of the worker"""
    return {
        "status": "online",
        "active_cameras": [id for id, cam in active_cameras.items() if not cam["stop"]],
        "details": {id: cam.get("status", "Unknown") for id, cam in active_cameras.items() if not cam["stop"]}
    }

if __name__ == "__main__":
    import uvicorn
    # Worker runs on 8001
    uvicorn.run(app, host="0.0.0.0", port=8001)
