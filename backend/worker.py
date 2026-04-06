import cv2
import threading
import time
import os
import json
import numpy as np
import datetime
import base64
import torch
from typing import Dict, Any, Optional
from fastapi import FastAPI, HTTPException, Body, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

# Optimization for IP Webcams: Force TCP and set 5s timeout for FFmpeg
os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp|stimeout;5000000"


import urllib.request
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
active_cameras: Dict[int, Dict[str, Any]] = {} 
active_cameras_lock = threading.Lock()
status_queue: list[dict] = [] # Queue for background status sender
status_lock = threading.Lock()
MAX_STATUS_QUEUE = 100
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

def status_sender_thread():
    """Background thread to send status updates to Node server without blocking camera threads"""
    while True:
        try:
            update = None
            with status_lock:
                if status_queue:
                    update = status_queue.pop(0)
            
            if update:
                req = urllib.request.Request('http://127.0.0.1:5000/api/internal/socket-trigger', 
                    data=json.dumps(update).encode('utf-8'), 
                    headers={'Content-Type': 'application/json'}, method='POST')
                try:
                    # Very short timeout for the internal trigger
                    urllib.request.urlopen(req, timeout=0.2)
                except:
                    pass # Silently fail if Node is down
            else:
                time.sleep(0.1)
        except Exception:
            time.sleep(1)

# Start background status sender
threading.Thread(target=status_sender_thread, daemon=True).start()

def set_camera_status(camera_id, status):
    """Queue a status update for the background sender"""
    with active_cameras_lock:
        cam = active_cameras.get(camera_id)
        if not cam: return
        if cam.get("status") == status: return
        cam["status"] = status
    
    with status_lock:
        if len(status_queue) < MAX_STATUS_QUEUE:
            status_queue.append({"type": "camera_status", "data": {"id": camera_id, "status": status}})


# YouTube URL Cache
yt_url_cache = {} # {url: {"resolved": url, "expires": timestamp}}

# Global AI Engine Instances (Same as before, with Lock)
ai_lock = threading.Lock()
# Initialize with automatic device detection (cuda/cpu)
shared_detector = Detector(os.path.join(os.path.dirname(BASE_DIR), "weights", "best_new.pt"))
shared_reid = ReID()
shared_global_id = GlobalIDManager()
# Initialize OCR Engine (PaddleOCR with EasyOCR Fallback)
if HAS_PADDLE:
    try:
        # Check if CUDA is available for Paddle
        use_gpu = torch.cuda.is_available()        # FIX: Ensure compatible arguments for current PaddleOCR version
        try:
            shared_ocr = PaddleOCR(use_angle_cls=True, lang='en', use_gpu=use_gpu)
            print(f"[OCR] PaddleOCR Initialized (GPU={use_gpu}).")
        except Exception as e:
            # Second attempt with minimal legacy arguments
            try:
                shared_ocr = PaddleOCR(lang='en', use_gpu=use_gpu)
                print(f"[OCR] PaddleOCR Initialized (Minimal Mode).")
            except Exception as e2:
                print(f"[OCR] PaddleOCR Final Fallback to EasyOCR due to: {e2}")
                import easyocr
                shared_ocr = easyocr.Reader(['en'], gpu=use_gpu)
                HAS_PADDLE = False
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

def get_ended_frame_cv2():
    img = np.zeros((480, 640, 3), dtype=np.uint8)
    cv2.putText(img, "STREAM ENDED", (180, 240), cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 0, 255), 2)
    return img

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
    
    my_session_id = active_cameras.get(camera_id, {}).get("session_id")
    
    def check_stop():
        with active_cameras_lock:
            state = active_cameras.get(camera_id)
            if not state: return True
            if state.get("session_id") != my_session_id: return True
            return state.get("stop", False)

    while not check_stop():
        try:
            # 1. Initialize Pipeline (if not already done)
            if pipeline is None:
                pipeline = Pipeline(camera_id, shared_detector, shared_reid, shared_global_id, shared_ocr)
                active_cameras[camera_id]["pipeline"] = pipeline

            # 2. Resolve Source (for YouTube)
            actual_source = source
            if "youtube.com" in source or "youtu.be" in source:
                set_camera_status(camera_id, "Resolving YT...")
                actual_source = get_yt_stream_url(source)
                if not actual_source:
                    set_camera_status(camera_id, "YT Resolve Failed")
                    time.sleep(10)
                    continue

            # 3. Connect to Stream with exponential backoff for persistent failures
            retry_count = 0
            while not check_stop():
                print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] [CAM {camera_id}] Connecting to: {actual_source[:50]}...")
                set_camera_status(camera_id, "Connecting...")
                cap = cv2.VideoCapture(actual_source)
                
                if cap.isOpened():
                    break
                
                retry_count += 1
                # Exponential backoff: 5s, 10s, 20s, 40s, max 60s
                wait_time = min(5 * (2 ** (min(retry_count, 4) - 1)), 60) if retry_count > 0 else 5
                print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] [CAM {camera_id}] Connection Failed. Retrying in {wait_time}s... (Attempt {retry_count})")
                set_camera_status(camera_id, f"Conn Failed, Retrying in {wait_time}s...")
                time.sleep(wait_time)
                
            if check_stop(): break

            print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] [CAM {camera_id}] Success: Connected.")
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
            
            # 4. Inner Processing Loop
            failure_count = 0
            while not check_stop():
                try:
                    ret, frame = cap.read()
                    
                    if not ret:
                        # Handle stream end or connection loss
                        # IMMEDIATELY clear the stale frame to prevent "frozen screen"
                        active_cameras[camera_id]["frame"] = None
                        
                        failure_count += 1
                        # Relaxed termination: Files/YouTube allow 5 fails, IP cams allow 10 in the processing loop
                        threshold = 5 if (is_file or "youtube" in source or "youtu.be" in source) else 10
                        
                        if failure_count >= threshold:
                            # If it's a file, YouTube, or we've failed too many times, end the stream
                            print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] [CAM {camera_id}] Stream Ended permanently (Failures: {failure_count}).")
                            with active_cameras_lock:
                                active_cameras[camera_id]["frame"] = get_ended_frame_cv2()
                                active_cameras[camera_id]["ended"] = True
                            set_camera_status(camera_id, "Stream Ended")
                            break
                        else:
                            # For IP cams, try a quick reconnect by breaking to outer loop
                            print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] [CAM {camera_id}] Stream Connection Lost. Reconnecting (Attempt {failure_count})...")
                            set_camera_status(camera_id, "Reconnecting...")
                            time.sleep(1)
                            break # Break to outer loop for reconnection
                    
                    failure_count = 0 # Reset on success
                    
                    # Update Shared State with Lock
                    with active_cameras_lock:
                        active_cameras[camera_id]["frame"] = frame.copy()
                        active_cameras[camera_id]["last_heartbeat"] = time.time()
                        # NEW: Capture native resolution for zone scaling
                        if "native_size" not in active_cameras[camera_id]:
                             active_cameras[camera_id]["native_size"] = { "w": frame.shape[1], "h": frame.shape[0] }
                        f_count = active_cameras[camera_id].get("processed_frames", 0)
                        active_cameras[camera_id]["processed_frames"] = f_count + 1
                    
                    set_camera_status(camera_id, "Active")

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
            
            if active_cameras[camera_id].get("ended", False):
                break # Exit the supervisor loop completely
            
        except Exception as outer_e:
            print(f"[SUPERVISOR ERROR] Cam {camera_id} crashed. Restarting in 5s... Error: {outer_e}")
            set_camera_status(camera_id, "Crashed, Restarting...")
            time.sleep(5)

    print(f"[SHUTDOWN] Worker Thread for Cam {camera_id} stopped permanently.")
    if not active_cameras[camera_id].get("ended", False):
        set_camera_status(camera_id, "Stopped")

@app.get("/video_feed/{camera_id}")
async def video_feed(camera_id: int, detect: str = "false"):
    is_detect = detect.lower() == "true"
    import anyio
    
    def render_and_encode(frame_data, enable_detect, dets, zones_data):
        disp = frame_data.copy() if enable_detect else frame_data
        h, w = disp.shape[:2]
        
        if enable_detect:
            # 1. Draw Zones (with dynamic scaling based on data-stored reference resolution)
            for zone in zones_data:
                # Handle both new 'RestrictionZone' objects and old 'polygon_points' lists
                if hasattr(zone, 'points'):
                    # New format from modified Pipeline
                    zp_raw = zone.points
                    ref_w = getattr(zone, 'ref_w', 640)
                    ref_h = getattr(zone, 'ref_h', 480)
                elif isinstance(zone, dict) and 'points' in zone:
                    # Raw dict format
                    zp_raw = zone['points']
                    ref_w = zone.get('width', 640)
                    ref_h = zone.get('height', 480)
                else:
                    # Legacy list format
                    zp_raw = zone
                    # Guess resolution for legacy: if points > 640, assume 1280
                    max_x = max([p[0] for p in zp_raw]) if zp_raw else 0
                    ref_w = 1280 if max_x > 640 else 640
                    ref_h = 720 if max_x > 640 else 480

                if zp_raw and len(zp_raw) > 2:
                    scale_x = w / ref_w
                    scale_y = h / ref_h
                    
                    scaled_pts = [[int(p[0] * scale_x), int(p[1] * scale_y)] for p in zp_raw]
                    pts = np.array(scaled_pts, np.int32).reshape((-1, 1, 2))
                    
                    cv2.polylines(disp, [pts], True, (255, 0, 0), 1) # Thin blue line
                    overlay = disp.copy()
                    cv2.fillPoly(overlay, [pts], (255, 0, 0))
                    cv2.addWeighted(overlay, 0.15, disp, 0.85, 0, disp)
            
            # 2. Draw Detections
            for det in dets:
                if not det.get("visible", True): continue
                x1, y1, x2, y2 = det["xyxy"]
                rx1, ry1, rx2, ry2 = int(x1), int(y1), int(x2), int(y2)
                rx1, rx2 = max(0, min(w, rx1)), max(0, min(w, rx2))
                ry1, ry2 = max(0, min(h, ry1)), max(0, min(h, ry2))
                
                # MODERN COLOR MAP
                cls = det['class_name'].lower()
                # Vibrant Neon Palette
                color = (255, 255, 0) # Cyan for People
                if any(k in cls for k in ['no_helmet', 'no_vest', 'collision', 'throwing']):
                    color = (0, 0, 255) # Warning Red
                elif any(k in cls for k in ['vehicle', 'truck', 'forklift']):
                    color = (0, 215, 255) # Gold/Amber for Vehicles
                elif 'license' in cls:
                    color = (0, 255, 0) # Success Green
                
                # SLEEK BOX STYLE (2px default)
                thick = 2
                cv2.rectangle(disp, (rx1, ry1), (rx2, ry2), color, thick)
                
                # PREMIUM LABEL
                gid = det.get('global_id', '')
                label = f"{det['class_name'].upper()} #{gid}" if gid else det['class_name'].upper()
                
                font = cv2.FONT_HERSHEY_DUPLEX
                f_scale = 0.5
                f_thick = 1
                (tw, th), _ = cv2.getTextSize(label, font, f_scale, f_thick)
                
                # Label positioning (Slightly above or inside)
                txt_y1 = max(ry1 - 10, th + 10)
                cv2.rectangle(disp, (rx1, txt_y1 - th - 5), (rx1 + tw + 5, txt_y1 + 5), color, -1)
                cv2.putText(disp, label, (rx1 + 2, txt_y1), font, f_scale, (0, 0, 0), f_thick)
        
        _, buffer = cv2.imencode('.jpg', disp, [int(cv2.IMWRITE_JPEG_QUALITY), 75])
        return buffer.tobytes()

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
                    
                    # Offload massive CPU bottlenecks off the primary asyncio HTTP event loop!
                    zones = active_cameras[camera_id].get("zones", [])
                    buffer_bytes = await anyio.to_thread.run_sync(render_and_encode, frame, is_detect, detections, zones)
                    
                    yield (b'--frame\r\nContent-Type: image/jpeg\r\n\r\n' + buffer_bytes + b'\r\n')
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
        # If the stream naturally ended, we allow restarting!
        if active_cameras[camera_id].get("ended", False):
            active_cameras[camera_id]["stop"] = True # Ensure old thread dies just in case
            time.sleep(0.5)
        else:
            # If already running, trigger a configuration reload just in case detections changed
            if "pipeline" in active_cameras[camera_id] and active_cameras[camera_id]["pipeline"]:
                print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] Triggering RELOAD for already running Cam {camera_id}")
                active_cameras[camera_id]["pipeline"].reload_config()
                return {"status": "Already running, reloaded config"}
            return {"status": "Already running"}
    
    session_id = str(time.time())
    active_cameras[camera_id] = {
        "stop": False, 
        "frame": None, 
        "detections": [], 
        "status": "Starting...", 
        "pipeline": None,
        "session_id": session_id
    }
    set_camera_status(camera_id, "Starting...")
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
    """Return the health and synchronization status of the worker (Thread-safe)"""
    with active_cameras_lock:
        # Create a snapshot to avoid RuntimeError: dictionary changed size during iteration
        snapshot = dict(active_cameras)
        
    return {
        "status": "online",
        "active_cameras": [id for id, cam in snapshot.items() if not cam.get("stop")],
        "details": {
            id: {
                "status": cam.get("status", "Unknown"),
                "frames": cam.get("processed_frames", 0),
                "last_seen": cam.get("last_heartbeat", 0)
            } for id, cam in snapshot.items() if not cam.get("stop")
        }
    }

if __name__ == "__main__":
    import uvicorn
    # Worker runs on 8001
    uvicorn.run(app, host="0.0.0.0", port=8001)
