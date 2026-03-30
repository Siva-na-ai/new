import cv2
import threading
import time
import os
import numpy as np
import datetime
import base64
import torch
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

# YouTube URL Cache
yt_url_cache = {} # {url: {"resolved": url, "expires": timestamp}}

# Global AI Engine Instances (Same as before, with Lock)
ai_lock = threading.Lock()
# Initialize with automatic device detection (cuda/cpu)
shared_detector = Detector(os.path.join(os.path.dirname(BASE_DIR), "weights", "C:/Users/user/Downloads/yolo_models/runs/detect/yolov8_cus_emp9/weights/last.pt"))
shared_reid = ReID()
shared_global_id = GlobalIDManager()
# Initialize OCR Engine (PaddleOCR with EasyOCR Fallback)
if HAS_PADDLE:
    try:
        # Check if CUDA is available for Paddle
        use_gpu = torch.cuda.is_available()
        shared_ocr = PaddleOCR(use_angle_cls=True, lang='en', use_gpu=use_gpu, use_mkldnn=not use_gpu)
        print(f"[OCR] PaddleOCR Initialized (GPU={use_gpu}).")
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
    # This worker will handle its own YT resolution with caching
    import yt_dlp
    import time
    
    now = time.time()
    if not force_refresh and url in yt_url_cache and yt_url_cache[url]["expires"] > now:
        return yt_url_cache[url]["resolved"]

    try:
        ydl_opts = {
            'format': 'best',
            'quiet': True,
            'no_warnings': True,
            'skip_download': True,
            'nocheckcertificate': True,
            'hls_use_mpegts': True
        }
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            res_url = info.get('url')
            if res_url:
                # Cache for 15 minutes
                yt_url_cache[url] = {"resolved": res_url, "expires": now + 900}
            return res_url
    except Exception as e:
        print(f"Worker YT Error: {e}")
        return None

def camera_thread(camera_id, source):
    """
    Supervisor loop for a single camera. 
    Never exits unless active_cameras[camera_id]['stop'] is True.
    """
    pipeline = None
    is_file = not (source.startswith("rtsp") or "youtube.com" in source or "youtu.be" in source or source.startswith("http"))
    
    while not active_cameras[camera_id].get("stop", False):
        try:
            # 1. Initialize Pipeline (if not already done)
            if pipeline is None:
                pipeline = Pipeline(camera_id, shared_detector, shared_reid, shared_global_id, shared_ocr)
                active_cameras[camera_id]["pipeline"] = pipeline

            # 2. Resolve Source (for YouTube)
            actual_source = source
            if "youtube.com" in source or "youtu.be" in source:
                active_cameras[camera_id]["status"] = "Resolving YT..."
                actual_source = get_yt_stream_url(source)
                if not actual_source:
                    active_cameras[camera_id]["status"] = "YT Resolve Failed"
                    time.sleep(10)
                    continue

            # 3. Connect to Stream
            print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] [CAM {camera_id}] Connecting to: {actual_source[:50]}...")
            active_cameras[camera_id]["status"] = "Connecting..."
            cap = cv2.VideoCapture(actual_source)
            
            if not cap.isOpened():
                print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] [CAM {camera_id}] Connection Failed.")
                active_cameras[camera_id]["status"] = "Connection Failed, Retrying..."
                time.sleep(5)
                continue

            print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] [CAM {camera_id}] Success: Connected.")
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
            
            # 4. Inner Processing Loop
            failure_count = 0
            while not active_cameras[camera_id].get("stop", False):
                try:
                    ret, frame = cap.read()
                    
                    if not ret:
                        # Handle stream end
                        if is_file:
                            print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] [CAM {camera_id}] File Ended. Restarting...")
                            cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                            continue
                        else:
                            print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] [CAM {camera_id}] Stream Ended/Lost.")
                            break # Break to outer loop for reconnection
                    
                    failure_count = 0 # Reset on success
                    
                    # Update Shared State
                    active_cameras[camera_id]["frame"] = frame.copy()
                    active_cameras[camera_id]["status"] = "Active"
                    active_cameras[camera_id]["last_heartbeat"] = time.time()
                    
                    f_count = active_cameras[camera_id].get("processed_frames", 0)
                    active_cameras[camera_id]["processed_frames"] = f_count + 1

                    # Push Frame to Redis
                    try:
                        _, jpeg_buf = cv2.imencode('.jpg', frame, [int(cv2.IMWRITE_JPEG_QUALITY), 75])
                        r.set(f"camera:{camera_id}:frame", jpeg_buf.tobytes())
                    except:
                        pass
                    
                    # AI Inference (Throttle to ~4-5 FPS for processing)
                    if f_count % 6 == 0:
                        if ai_lock.acquire(blocking=False):
                            try:
                                res = pipeline.process_frame(frame)
                                if isinstance(res, tuple):
                                    dets, zones = res
                                else:
                                    dets, zones = res, []
                                
                                active_cameras[camera_id]["detections"] = dets
                                active_cameras[camera_id]["zones"] = zones
                                
                                # ATOMIC REDIS UPDATE: Store frame and dets together
                                try:
                                    _, jpeg_buf = cv2.imencode('.jpg', frame, [int(cv2.IMWRITE_JPEG_QUALITY), 75])
                                    data = {
                                        "frame": base64.b64encode(jpeg_buf).decode('utf-8'),
                                        "detections": dets,
                                        "zones": zones,
                                        "timestamp": time.time()
                                    }
                                    r.set(f"camera:{camera_id}:batch", json.dumps(data))
                                except Exception as r_err:
                                    print(f"Redis Broadcast Error: {r_err}")
                            except Exception as ai_err:
                                print(f"[AI ERROR] Cam {camera_id}: {ai_err}")
                            finally:
                                ai_lock.release()
                    
                    # Prevent 100% CPU usage
                    time.sleep(0.005)
                    
                except Exception as inner_e:
                    print(f"[INNER ERROR] Cam {camera_id}: {inner_e}")
                    time.sleep(1)
                    break
            
            # Cleanup Capture for this attempt
            cap.release()
            
        except Exception as outer_e:
            print(f"[SUPERVISOR ERROR] Cam {camera_id} crashed. Restarting in 5s... Error: {outer_e}")
            active_cameras[camera_id]["status"] = "Crashed, Restarting..."
            time.sleep(5)

    print(f"[SHUTDOWN] Worker Thread for Cam {camera_id} stopped permanently.")
    active_cameras[camera_id]["status"] = "Stopped"

@app.get("/video_feed/{camera_id}")
async def video_feed(camera_id: int, detect: str = "false"):
    is_detect = detect.lower() == "true"
    import anyio
    async def gen():
        try:
            while True:
                try:
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
                                if not det.get("visible", True):
                                    continue
                                    
                                # Scale coordinates from original frame size to 640x360
                                # Original size is unknown here but we can infer from detection range if needed,
                                # however, better to store frame_width/height in Redis or Pipeline.
                                # Assuming 1280x720 or 1920x1080 as common, but let's calculate scale relative to original.
                                orig_w = det.get("frame_w", frame.shape[1])
                                orig_h = det.get("frame_h", frame.shape[0])
                                
                                scale_x = disp.shape[1] / orig_w if orig_w > 0 else 1
                                scale_y = disp.shape[0] / orig_h if orig_h > 0 else 1
                                
                                x1, y1, x2, y2 = det["xyxy"]
                                rx1, ry1 = int(x1 * scale_x), int(y1 * scale_y)
                                rx2, ry2 = int(x2 * scale_x), int(y2 * scale_y)
                                
                                cv2.rectangle(disp, (rx1, ry1), (rx2, ry2), (0, 255, 0), 2)
                                gid = det.get('global_id', '')
                                if det['class_name'] == 'license_plate':
                                    label = f"{det['class_name']}"
                                else:
                                    label = f"{det['class_name']} {gid}"
                                cv2.putText(disp, label, (rx1, ry1-5), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 2)
                            except:
                                continue
                    else:
                        disp = frame # Direct reference for normal stream (saves memory)
                    
                    _, buffer = cv2.imencode('.jpg', disp, [int(cv2.IMWRITE_JPEG_QUALITY), 70]) # Lower quality to save bandwidth
                    yield (b'--frame\r\nContent-Type: image/jpeg\r\n\r\n' + buffer.tobytes() + b'\r\n')
                    await anyio.sleep(0.04) # 25fps cap to save CPU
                except Exception as e:
                    print(f"[FEED ERROR] Cam {camera_id} loop: {e}")
                    await anyio.sleep(0.5)
        except Exception as e:
            print(f"[FEED DEAD] Cam {camera_id}: {e}")

    return StreamingResponse(gen(), media_type="multipart/x-mixed-replace; boundary=frame")

@app.post("/start/{camera_id}")
def start_worker(camera_id: int, source: str = Body(..., embed=True)):
    if camera_id in active_cameras and not active_cameras[camera_id]["stop"]:
        # If already running, trigger a configuration reload just in case detections changed
        if "pipeline" in active_cameras[camera_id] and active_cameras[camera_id]["pipeline"]:
            print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] Triggering RELOAD for already running Cam {camera_id}")
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
    print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] Manual RELOAD requested for Cam {camera_id}")
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
        "active_cameras": [id for id, cam in active_cameras.items() if not cam.get("stop")],
        "details": {
            id: {
                "status": cam.get("status", "Unknown"),
                "frames": cam.get("processed_frames", 0),
                "last_seen": cam.get("last_heartbeat", 0)
            } for id, cam in active_cameras.items() if not cam.get("stop")
        }
    }

if __name__ == "__main__":
    import uvicorn
    # Worker runs on 8001
    uvicorn.run(app, host="0.0.0.0", port=8001)
