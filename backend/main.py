from fastapi import FastAPI, Depends, HTTPException, WebSocket, BackgroundTasks, Body, UploadFile, File, Response
import httpx
from typing import List, Optional
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
import shutil
from sqlalchemy.orm import Session
import cv2
import threading
import time
import json
import os
import datetime
import torch
import anyio
import yt_dlp
import redis
import json

# Define base directory for absolute paths
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] SYSTEM STARTING. BASE_DIR: {BASE_DIR}")

# Prevent background AI threads from starving the main server loop
torch.set_num_threads(1)
cv2.setNumThreads(1)

# Optimize FFMPEG for resilience and faster timeouts
# reconnect: reconnect on failure, reconnect_streamed: for network streams, probesize/analyzeduration: handle slow starts
# Using '|' as separator and ':' for key-value (more robust for some OpenCV/FFmpeg builds)
os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "reconnect:1|reconnect_streamed:1|reconnect_delay_max:5|timeout:5000000|probesize:5000000|analyzeduration:5000000"
from database import SessionLocal, init_db, Camera, RestrictionZone, Alert, VehicleCheck, User
from pipeline import Pipeline
from detector import Detector
from contextlib import asynccontextmanager
import yt_dlp
import numpy as np

@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    
    async def start_all_cameras():
        # Resume active cameras from DB in background
        db = SessionLocal()
        try:
            cameras = db.query(Camera).filter(Camera.is_active == True).all()
            for cam in cameras:
                # We use asyncio.create_task to make it truly non-blocking inside this sub-task
                asyncio.create_task(start_camera_pipeline(cam.id, cam.ip_address))
        finally:
            db.close()

    # Start camera initialization without blocking server startup
    import asyncio
    asyncio.create_task(start_all_cameras())
    
    # Start sync task in background
    app.state.sync_job = asyncio.create_task(sync_worker_task())
    
    yield
    # Shutdown
    app.state.sync_job.cancel()
    # Shutdown
    for cam_id in active_cameras:
        active_cameras[cam_id]["stop"] = True

app = FastAPI(lifespan=lifespan)

# Mount static directories with absolute paths (Standardized)
ALERTS_DIR = os.path.join(BASE_DIR, "alerts")
PLATES_DIR = os.path.join(BASE_DIR, "plates")
UPLOADS_DIR = os.path.join(BASE_DIR, "uploads")
os.makedirs(ALERTS_DIR, exist_ok=True)
os.makedirs(PLATES_DIR, exist_ok=True)
os.makedirs(UPLOADS_DIR, exist_ok=True)
app.mount("/api/media/plates", StaticFiles(directory=PLATES_DIR), name="plates")
app.mount("/api/media/alerts", StaticFiles(directory=ALERTS_DIR), name="alerts")
app.mount("/api/media/uploads", StaticFiles(directory=UPLOADS_DIR), name="uploads")

# Mount custom alarms folder
ALARAM_DIR = os.path.join(os.path.dirname(BASE_DIR), "alaram")
os.makedirs(ALARAM_DIR, exist_ok=True)
app.mount("/alaram", StaticFiles(directory=ALARAM_DIR), name="alaram")

@app.get("/api/alarm-sound")
@app.head("/api/alarm-sound")
def get_alarm_sound():
    sound_file = os.path.join(ALARAM_DIR, "clip-1773994393607.mp3")
    if os.path.exists(sound_file):
        return FileResponse(sound_file, media_type="audio/mpeg")
    return {"error": "Sound file not found"}

@app.post("/api/upload-video")
def upload_video(file: UploadFile = File(...)):
    print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] Receiving: {file.filename}")
    try:
        # Generate a unique path for the video
        filename = f"upload-{int(datetime.datetime.now().timestamp())}-{file.filename}"
        file_path = os.path.join(UPLOADS_DIR, filename)
        
        # Using a regular "def" route in FastAPI executes in a threadpool, 
        # which is perfect for blocking file I/O like this copyfileobj.
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
            
        print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] FINALIZING Video Upload: {filename}")
        return JSONResponse({
            "status": "success",
            "filename": filename,
            "path": file_path, # Absolute path for OpenCV
            "url": f"/uploads/{filename}"
        })
    except Exception as e:
        import traceback
        print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] UPLOAD CRITICAL ERROR: {str(e)}")
        traceback.print_exc()
        return JSONResponse({"status": "error", "message": str(e)}, status_code=500)

# CORS for React frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global dictionary to store active pipelines and their latest status
active_cameras = {}

# Redis Client for Frame Retrieval
r = redis.Redis(host='localhost', port=6379, db=0, decode_responses=False)

# Placeholder frame for when camera is connecting
placeholder_frame = None

def get_placeholder_frame():
    global placeholder_frame
    if placeholder_frame is None:
        img = np.zeros((720, 1280, 3), dtype=np.uint8)
        font = cv2.FONT_HERSHEY_SIMPLEX
        cv2.putText(img, "Connecting to Camera...", (400, 360), font, 1.5, (255, 255, 255), 3, cv2.LINE_AA)
        _, buffer = cv2.imencode('.jpg', img)
        placeholder_frame = buffer.tobytes()
    return placeholder_frame

def get_ended_frame():
    img = np.zeros((720, 1280, 3), dtype=np.uint8)
    font = cv2.FONT_HERSHEY_SIMPLEX
    cv2.putText(img, "STREAM ENDED / FINISHED", (350, 360), font, 1.5, (0, 255, 255), 3, cv2.LINE_AA)
    cv2.putText(img, "Please reload to watch again", (450, 420), font, 0.8, (200, 200, 200), 1, cv2.LINE_AA)
    _, buffer = cv2.imencode('.jpg', img)
    return buffer.tobytes()

# API Server NO LONGER loads Detector/ReID/OCR to save memory and CPU
# shared_detector, shared_reid, shared_ocr moved to worker.py
print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] AI Engines Ready.")

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@app.post("/api/login")
def login(data: dict, db: Session = Depends(get_db)):
    username = data.get("username", "").strip()
    password = data.get("password", "").strip()
    
    print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] Login attempt for user: '{username}'")
    
    # Simple case-insensitive match for username, case-sensitive for password
    user = db.query(User).filter(User.username.ilike(username)).first()
    
    if user and user.password == password:
        print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] Login SUCCESS for user: '{username}'")
        return {"status": "success", "username": user.username}
    
    print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] Login FAILED for user: '{username}'")
    raise HTTPException(status_code=401, detail="Security Alert: Access denied. Please verify your credentials.")





# Cache for resolved YouTube URLs to avoid re-resolving on every toggle
# {youtube_url: {"resolved_url": url, "expires": timestamp}}
yt_url_cache = {}

def get_yt_stream_url(url, force_refresh=False):
    now = time.time()
    if not force_refresh and url in yt_url_cache and yt_url_cache[url]["expires"] > now:
        print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] Using cached YT URL for: {url[:30]}...")
        return yt_url_cache[url]["resolved_url"]

    if "youtube.com" in url or "youtu.be" in url:
        # Use format that is more likely to work with OpenCV/FFmpeg
        ydl_opts = {
            'format': 'best[ext=mp4][height<=720]/best[ext=mp4]/best', 
            'quiet': True, 
            'no_warnings': True,
        }
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            try:
                info = ydl.extract_info(url, download=False)
                res_url = info.get('url')
                if res_url:
                    print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] Resolved YT URL: {url[:30]}...")
                    # Cache for 10 minutes
                    yt_url_cache[url] = {"resolved_url": res_url, "expires": now + 600}
                return res_url
            except Exception as e:
                print(f"YT-DLP Error: {e}")
                return None
    return url

async def start_camera_pipeline(camera_id, source):
    """Notify the Analysis Worker (Port 8001) to start processing with retry logic"""
    active_cameras[camera_id] = {"status": "Starting...", "stop": False}
    
    # Retry up to 10 times (Worker takes time to load AI models)
    for i in range(12): 
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.post(f"http://127.0.0.1:8001/start/{camera_id}", json={"source": source}, timeout=5.0)
                if resp.status_code == 200:
                    print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] Success: Started Worker for Cam {camera_id}")
                    active_cameras[camera_id]["status"] = "Active"
                    return
        except Exception as e:
            if i % 3 == 0: # Log every 3rd failure to keep console clean
                print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] Waiting for Worker... (Attempt {i+1}/12)")
        
        await anyio.sleep(5) # Wait 5s between retries
        
    print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] CRITICAL: Could not reach Worker for Cam {camera_id}")
    active_cameras[camera_id]["status"] = "Worker Offline"

async def stop_camera_pipeline(camera_id):
    """Notify the Analysis Worker (Port 8001) to stop processing"""
    try:
        async with httpx.AsyncClient() as client:
            await client.post(f"http://127.0.0.1:8001/stop/{camera_id}", timeout=5.0)
            print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] Stopped Worker for Cam {camera_id}")
    except Exception as e:
        print(f"Worker Communication Error (Stop): {e}")
    
    if camera_id in active_cameras:
        active_cameras[camera_id]["stop"] = True
        active_cameras[camera_id]["status"] = "No connection"

async def sync_worker_task():
    """Background task to ensure Worker is always in sync with DB"""
    print("[SYNC] Background Sync Task Started.")
    while True:
        try:
            db = SessionLocal()
            active_db_cams = db.query(Camera).filter(Camera.is_active == True).all()
            db.close()
            
            async with httpx.AsyncClient() as client:
                try:
                    resp = await client.get("http://127.0.0.1:8001/status", timeout=2.0)
                    if resp.status_code == 200:
                        data = resp.json()
                        worker_ids = data.get("active_cameras", [])
                        worker_details = data.get("details", {})
                        
                        # Update main.py's view of camera health
                        for cam_id_str, details in worker_details.items():
                            cam_id = int(cam_id_str)
                            if cam_id not in active_cameras:
                                active_cameras[cam_id] = {}
                            active_cameras[cam_id].update(details)
                        
                        for cam in active_db_cams:
                            if cam.id not in worker_ids:
                                print(f"[SYNC] Worker missing active Cam {cam.id}. Syncing...")
                                import asyncio
                                asyncio.create_task(start_camera_pipeline(cam.id, cam.ip_address))
                except Exception as e:
                    print(f"[SYNC] Worker unreachable: {e}")
                    pass
        except Exception as e:
            print(f"[SYNC ERROR] {e}")
            
        await anyio.sleep(30) # Check every 30s

# API Endpoints

@app.post("/api/cameras")
def add_camera(ip_address: str, place_name: str, detections: str, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    ip_address = ip_address.strip()
    # detections is expected as comma-separated IDs
    try:
        if not detections.strip():
            det_list = [] # None selected
        else:
            # Store names as strings directly to avoid ID mismatch with different models
            VALID_CLASSES = [
                "person", "helmet", "no_helmet", "vest", "no_vest", "license_plate",
                "box_opened", "box_closed", "forklift", "collision", "truck_covered", 
                "truck_not_covered", "person_not_working", "person_standing", "person_working",
                "vehicle", "car", "bus", "truck", "motorcycle"
            ]
            det_list = sorted(list(set(i.strip().lower() for i in detections.split(",") if i.strip().lower() in VALID_CLASSES)))
    except Exception as e:
        print(f"ADD ERROR (Parsing Detections): {e}")
        det_list = ["person"] # Safety Default
        
    # Store the ORIGINAL ip_address in DB so frontend filtering works
    new_cam = Camera(ip_address=ip_address, place_name=place_name, detections_to_run=det_list)
    db.add(new_cam)
    db.commit()
    db.refresh(new_cam)
    
    background_tasks.add_task(start_camera_pipeline, new_cam.id, ip_address)
    return new_cam

@app.put("/api/cameras/{camera_id}")
def update_camera(camera_id: int, ip_address: str, place_name: str, detections: str, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    ip_address = ip_address.strip()
    cam = db.query(Camera).filter(Camera.id == camera_id).first()
    if not cam:
        raise HTTPException(status_code=404, detail="Resource Unavailable: surveillance node ID not registered.")
    
    try:
        if not detections.strip():
            det_list = []
        else:
            # Store names as strings directly
            VALID_CLASSES = [
                "person", "helmet", "no_helmet", "vest", "no_vest", "license_plate",
                "box_opened", "box_closed", "forklift", "collision", "truck_covered", 
                "truck_not_covered", "person_not_working", "person_standing", "person_working",
                "vehicle", "car", "bus", "truck", "motorcycle"
            ]
            det_list = sorted(list(set(i.strip().lower() for i in detections.split(",") if i.strip().lower() in VALID_CLASSES)))
    except Exception as e:
        print(f"UPDATE ERROR (Parsing Detections): {e}")
        det_list = cam.detections_to_run
        
    # Store ORIGINAL in DB
    cam.ip_address = ip_address
    cam.place_name = place_name
    cam.detections_to_run = det_list
    db.commit()
    
    # Restart pipeline (non-blocking) - start_camera_pipeline will handle smart skip if source is same
    background_tasks.add_task(start_camera_pipeline, camera_id, ip_address)
        
    return cam

@app.delete("/api/cameras/{camera_id}")
def delete_camera(camera_id: int, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    cam = db.query(Camera).filter(Camera.id == camera_id).first()
    if not cam:
        raise HTTPException(status_code=404, detail="Resource Unavailable: surveillance node ID not registered.")
    
    try:
        # Stop pipeline in Worker
        background_tasks.add_task(stop_camera_pipeline, camera_id)
        
        # We no longer delete dependent records manually. 
        # The database is configured with ON DELETE SET NULL to preserve them.
        db.delete(cam)
        db.commit()
        return {"status": "success"}
    except Exception as e:
        db.rollback()
        print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] DELETE ERROR Cam {camera_id}: {e}")
        raise HTTPException(status_code=500, detail=f"System Error: Could not delete camera. {str(e)}")

def find_best_url(url):
    print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] Test Connection Request: {url[:50]}...")
    # YouTube handling
    if "youtube.com" in url or "youtu.be" in url:
        yt_url = get_yt_stream_url(url)
        if yt_url:
            print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] YouTube Success: {url[:30]}")
            return yt_url
        print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] YouTube FAILED to resolve")
        return None

    # Try as is with FFMPEG
    cap = cv2.VideoCapture(url, cv2.CAP_FFMPEG)
    if cap.isOpened():
        ret, _ = cap.read()
        cap.release()
        if ret: return url
    
    # Try prepending http://
    if not url.startswith(('http://', 'https://', 'rtsp://')):
        test_url = 'http://' + url
        cap = cv2.VideoCapture(test_url, cv2.CAP_FFMPEG)
        if cap.isOpened():
            ret, _ = cap.read()
            cap.release()
            if ret: return test_url
            
        # Try common suffixes
        for suffix in ['/video', '/shot.jpg', '/stream', '/live']:
            test_url = 'http://' + url.rstrip('/') + suffix
            cap = cv2.VideoCapture(test_url, cv2.CAP_FFMPEG)
            if cap.isOpened():
                ret, _ = cap.read()
                cap.release()
                if ret: return test_url
            
    return None

@app.get("/api/test_camera")
def test_camera(ip_address: str):
    best_url = find_best_url(ip_address)
    if best_url:
        return {"status": "success", "url": best_url}
    return {"status": "error", "message": "Could not connect to camera. Try adding http:// or check if /video is needed."}

@app.get("/api/cameras")
def list_cameras(db: Session = Depends(get_db)):
    cameras = db.query(Camera).all()
    result = []
    for cam in cameras:
        # If deactivated in DB, show 'No connection' immediately
        cam_info = active_cameras.get(cam.id, {})
        status = "No connection"
        if cam.is_active:
            status = cam_info.get("status", "Starting...")
            
        result.append({
            "id": cam.id,
            "ip_address": cam.ip_address,
            "place_name": cam.place_name,
            "detections_to_run": cam.detections_to_run,
            "status": status,
            "is_active": cam.is_active,
            "frames": cam_info.get("frames", 0),
            "last_seen": cam_info.get("last_seen", 0)
        })
    return result

@app.post("/api/cameras-toggle/{camera_id}")
def toggle_camera(camera_id: int, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] TOGGLE REQUEST RECEIVED for Cam {camera_id}")
    cam = db.query(Camera).filter(Camera.id == camera_id).first()
    if not cam:
        raise HTTPException(status_code=404, detail="Resource Unavailable: surveillance node ID not registered.")
    
    cam.is_active = not cam.is_active
    db.commit()
    
    if not cam.is_active:
        # Stop pipeline in Worker
        background_tasks.add_task(stop_camera_pipeline, camera_id)
    else:
        # Start pipeline in Worker
        print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] Camera {camera_id} activated. Starting Worker...")
        background_tasks.add_task(start_camera_pipeline, camera_id, cam.ip_address)
        
    return {"is_active": cam.is_active}

@app.get("/api/stats")
def get_stats(response: Response, db: Session = Depends(get_db)):
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    total_alerts = db.query(Alert).count()
    total_vehicles = db.query(VehicleCheck).count()
    active_count = len([c for c in active_cameras.values() if not c.get("stop")])
    print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] Stats Requested: Alerts={total_alerts}, Vehicles={total_vehicles}, ActiveCams={active_count}")
    return {
        "total_alerts": total_alerts,
        "total_vehicles": total_vehicles,
        "active_cameras": active_count
    }

@app.post("/api/zones")
def add_zone(camera_id: int, points: list = Body(...), activation_time: Optional[str] = None, db: Session = Depends(get_db)):
    # points format: [[x,y], [x,y], ...]
    print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] Adding Zone for Cam {camera_id}: {len(points)} points")
    parsed_time = None
    if activation_time:
        try:
            parsed_time = datetime.datetime.fromisoformat(activation_time)
        except:
            pass
            
    try:
        new_zone = RestrictionZone(camera_id=camera_id, polygon_points=points, activation_time=parsed_time)
        db.add(new_zone)
        db.commit()
        print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] Zone Saved Successfully.")
        return {"status": "Zone added"}
    except Exception as e:
        print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] ZONE DB ERROR: {e}")
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/alerts")
def get_alerts(response: Response, db: Session = Depends(get_db)):
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    return db.query(Alert).order_by(Alert.timestamp.desc()).limit(30).all()

@app.get("/api/vehicles")
def get_vehicle_checks(response: Response, db: Session = Depends(get_db)):
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    return db.query(VehicleCheck).order_by(VehicleCheck.time_in.desc()).limit(30).all()

@app.get("/api/ppe/stats")
def get_ppe_stats(response: Response, db: Session = Depends(get_db)):
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    today = datetime.date.today()
    tomorrow = today + datetime.timedelta(days=1)
    
    from database import PPEViolation
    stats = {}
    for v_type in ["helmet", "no_helmet", "vest", "no_vest"]:
        count = db.query(PPEViolation).filter(
            PPEViolation.violation_type == v_type,
            PPEViolation.timestamp >= today,
            PPEViolation.timestamp < tomorrow
        ).count()
        stats[v_type] = count
    return stats

@app.get("/api/ppe/logs")
def get_ppe_logs(response: Response, start_date: Optional[str] = None, end_date: Optional[str] = None, db: Session = Depends(get_db)):
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    from database import PPEViolation
    query = db.query(PPEViolation)
    
    if start_date:
        query = query.filter(PPEViolation.timestamp >= datetime.datetime.fromisoformat(start_date))
    if end_date:
        query = query.filter(PPEViolation.timestamp <= datetime.datetime.fromisoformat(end_date))
        
    return query.order_by(PPEViolation.timestamp.desc()).limit(100).all()

@app.get("/api/zones/{camera_id}")
def get_zones(camera_id: int, db: Session = Depends(get_db)):
    return db.query(RestrictionZone).filter(RestrictionZone.camera_id == camera_id).all()

@app.post("/api/zones")
def create_zone(camera_id: int, activation_time: Optional[str] = None, points: list = Body(...), db: Session = Depends(get_db)):
    act_time = None
    if activation_time and activation_time.strip():
        try:
            act_time = datetime.datetime.fromisoformat(activation_time)
        except ValueError:
            pass
            
    new_zone = RestrictionZone(
        camera_id=camera_id,
        polygon_points=points,
        activation_time=act_time,
        is_active=True
    )
    db.add(new_zone)
    db.commit()
    db.refresh(new_zone)
    return {"status": "success", "zone_id": new_zone.id}

@app.delete("/api/zones/{zone_id}")
def delete_zone(zone_id: int, db: Session = Depends(get_db)):
    zone = db.query(RestrictionZone).filter(RestrictionZone.id == zone_id).first()
    if not zone:
        raise HTTPException(status_code=404, detail="Resource Unavailable: Restricted zone ID not registered.")
    camera_id = zone.camera_id
    db.delete(zone)
    db.commit()
    return {"status": "Zone deleted"}

def generate_frames(camera_id, show_detections=True):
    while True:
        # Check if camera exists
        if camera_id not in active_cameras:
            # Generate a black "Unknown Camera" frame
            frame = np.zeros((480, 640, 3), dtype=np.uint8)
            cv2.putText(frame, f"Unknown Camera ID: {camera_id}", (50, 240), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 255), 2)
        elif active_cameras[camera_id]["frame"] is None:
            # Generate a "Connecting..." frame
            frame = np.zeros((480, 640, 3), dtype=np.uint8)
            status = active_cameras[camera_id].get("status", "Starting...")
            cv2.putText(frame, f"CAM {camera_id}: {status}", (50, 240), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2)
            cv2.putText(frame, "Waiting for stream...", (50, 280), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (200, 200, 200), 1)
        else:
            frame = active_cameras[camera_id]["frame"].copy()
            status = active_cameras[camera_id].get("status", "Active")
            fid = active_cameras[camera_id].get("frame_id", 0)
            
            if show_detections:
                detections = active_cameras[camera_id]["detections"]
                # Get actual frame dimensions for scaling
                h, w = frame.shape[:2]
                for det in detections:
                    if not det.get("visible", True):
                        continue
                    
                    # Assuming detections are in original frame coordinates (which they are stored as)
                    # We need to scale them to the CURRENT 'frame' resolution which might be downscaled
                    orig_w = det.get("frame_w", w)
                    orig_h = det.get("frame_h", h)
                    
                    scale_x = w / orig_w if orig_w > 0 else 1
                    scale_y = h / orig_h if orig_h > 0 else 1
                    
                    x1, y1, x2, y2 = det["xyxy"]
                    rx1, ry1 = int(x1 * scale_x), int(y1 * scale_y)
                    rx2, ry2 = int(x2 * scale_x), int(y2 * scale_y)
                    
                    color = (0, 255, 0) # Green
                    gid = det.get('global_id', '')
                    if det['class_name'] == 'license_plate':
                        label = f"{det['class_name']}"
                    else:
                        label = f"{det['class_name']} {gid}"
                    cv2.rectangle(frame, (rx1, ry1), (rx2, ry2), color, 2)
                    cv2.putText(frame, label, (rx1, ry1 - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 2)
                
            # Add status overlay at the bottom (ALWAYS SHOW)
            overlay_text = f"CAM {camera_id} | {status} | FID:{fid} | {datetime.datetime.now().strftime('%H:%M:%S')}"
            # Draw a small background for better visibility
            cv2.rectangle(frame, (5, frame.shape[0] - 25), (450, frame.shape[0] - 5), (0, 0, 0), -1)
            cv2.putText(frame, overlay_text, (10, frame.shape[0] - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 255, 255), 1)

        ret, buffer = cv2.imencode('.jpg', frame)
        if not ret:
            time.sleep(0.1)
            continue
            
        frame_bytes = buffer.tobytes()
        yield (b'--frame\r\n'
               b'Content-Type: image/jpeg\r\n\r\n' + frame_bytes + b'\r\n')
        time.sleep(0.04) # ~25 FPS

@app.get("/video_feed/{camera_id}")
async def video_feed(camera_id: int, detect: bool = True):
    import anyio
    # Returns a multipart stream of MJPEG frames
    async def gen():
        try:
            while True:
                # Check if camera exists in active list
                if camera_id not in active_cameras or active_cameras[camera_id].get("stop"):
                    yield (b'--frame\r\n'
                           b'Content-Type: image/jpeg\r\n\r\n' + get_placeholder_frame() + b'\r\n')
                    await anyio.sleep(0.5)
                    continue
                    
                # --- REDIS-BASED FRAME RETRIEVAL ---
                try:
                    # 1. Pull Latest Frame from Redis
                    frame_bytes = r.get(f"camera:{camera_id}:frame")
                    
                    if frame_bytes is None:
                        # If Redis is empty, show placeholder
                        yield (b'--frame\r\n'
                               b'Content-Type: image/jpeg\r\n\r\n' + get_placeholder_frame() + b'\r\n')
                        await anyio.sleep(0.1)
                        continue
                    
                    # 2. Pull Detections from Redis (for drawing)
                    if detect:
                        dets_raw = r.get(f"camera:{camera_id}:detections")
                        if dets_raw:
                            try:
                                detections = json.loads(dets_raw.decode('utf-8'))
                                image = cv2.imdecode(np.frombuffer(frame_bytes, np.uint8), cv2.IMREAD_COLOR)
                                for det in detections:
                                    x1, y1, x2, y2 = det["xyxy"]
                                    label = f"{det.get('class_name', 'object')} {det.get('global_id', '')}".strip()
                                    color = (0, 255, 0)
                                    if det.get("class_name") == "person": color = (255, 0, 0)
                                    cv2.rectangle(image, (x1, y1), (x2, y2), color, 2)
                                    cv2.putText(image, label, (x1, y1 - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 2)
                                
                                _, buffer = cv2.imencode('.jpg', image, [cv2.IMWRITE_JPEG_QUALITY, 80])
                                frame_bytes = buffer.tobytes()
                            except Exception as e:
                                print(f"Drawing error in main.py: {e}")
                    
                    # 3. Yield the MJPEG frame
                    yield (b'--frame\r\n'
                           b'Content-Type: image/jpeg\r\n\r\n' + frame_bytes + b'\r\n')
                    
                except Exception as e:
                    print(f"Redis retrieval error Cam {camera_id}: {e}")
                    await anyio.sleep(0.1)
                
                # Control frame rate
                await anyio.sleep(0.03) # ~30 FPS
        except Exception as e:
            print(f"[MAIN FEED DEAD] Cam {camera_id}: {e}")
            
    return StreamingResponse(gen(), media_type="multipart/x-mixed-replace; boundary=frame")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
