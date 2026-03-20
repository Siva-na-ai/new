from fastapi import FastAPI, Depends, HTTPException, WebSocket, BackgroundTasks, Body
from typing import Optional
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session
import cv2
import threading
import time
import json
import os
import datetime
from database import SessionLocal, init_db, Camera, RestrictionZone, Alert, VehicleCheck, User
from pipeline import Pipeline
from detector import Detector
from contextlib import asynccontextmanager
import yt_dlp
import numpy as np

@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    # Resume active cameras from DB
    db = SessionLocal()
    cameras = db.query(Camera).filter(Camera.is_active == True).all()
    for cam in cameras:
        start_camera_pipeline(cam.id, cam.ip_address)
    db.close()
    yield
    # Shutdown
    for cam_id in active_cameras:
        active_cameras[cam_id]["stop"] = True

app = FastAPI(lifespan=lifespan)

# Mount static directories
os.makedirs("plates", exist_ok=True)
os.makedirs("alerts", exist_ok=True)
app.mount("/api/plates", StaticFiles(directory="plates"), name="plates")
app.mount("/api/alerts", StaticFiles(directory="alerts"), name="alerts")

# CORS for React frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global dictionary to store active pipelines and their latest frames
# {camera_id: {"pipeline": Pipeline, "frame": frame, "detections": detections, "stop": False}}
active_cameras = {}

# Global AI Engine Instances
shared_detector = Detector(r"c:\Users\sivan\OneDrive - MSFT\analysis_system\weights\last_v8.pt")
from reid import ReID
shared_reid = ReID()
from global_id import GlobalIDManager
shared_global_id = GlobalIDManager()
import easyocr
shared_ocr = easyocr.Reader(['en'], gpu=False)

# Placeholder frame for when camera is connecting
placeholder_frame = None

def get_placeholder_frame():
    global placeholder_frame
    if placeholder_frame is None:
        # Create a black image with "Connecting..." text
        img = np.zeros((720, 1280, 3), dtype=np.uint8)
        font = cv2.FONT_HERSHEY_SIMPLEX
        cv2.putText(img, "Connecting to Camera...", (400, 360), font, 1.5, (255, 255, 255), 3, cv2.LINE_AA)
        _, buffer = cv2.imencode('.jpg', img)
        placeholder_frame = buffer.tobytes()
    return placeholder_frame
shared_global_id = GlobalIDManager()
import easyocr
shared_ocr = easyocr.Reader(['en'], gpu=False)
print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] AI Engines Ready.")

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@app.post("/login")
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


# Global AI Engine Instances
# ... (rest of imports)

# Cache for resolved YouTube URLs to avoid re-resolving on every toggle
# {youtube_url: {"resolved_url": url, "expires": timestamp}}
yt_url_cache = {}

def get_yt_stream_url(url):
    now = time.time()
    if url in yt_url_cache and yt_url_cache[url]["expires"] > now:
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

def camera_thread(camera_id, source, frame_interval=1):
    try:
        pipeline = Pipeline(camera_id, shared_detector, shared_reid, shared_global_id, shared_ocr)
        
        # Background resolution
        active_cameras[camera_id]["status"] = "Resolving..."
        actual_source = source
        if "youtube.com" in source or "youtu.be" in source:
            actual_source = get_yt_stream_url(source)
            if not actual_source:
                active_cameras[camera_id]["status"] = "YT Resolution Failed"
                return
        
        # Initial attempt with FFMPEG
        active_cameras[camera_id]["status"] = "Connecting..."
        cap = cv2.VideoCapture(actual_source, cv2.CAP_FFMPEG)
        
        # Fallback to default backend if FFMPEG fails
        if not cap.isOpened():
            print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] [CAM {camera_id}] FFMPEG failed, trying default...")
            cap = cv2.VideoCapture(actual_source)

        # If still fails and it's not a YouTube URL, try discovery
        if not cap.isOpened() and not ("youtube.com" in source or "youtu.be" in source):
            active_cameras[camera_id]["status"] = "Discovering Port..."
            actual_source = find_best_url(source) or source
            cap = cv2.VideoCapture(actual_source, cv2.CAP_FFMPEG)
            if not cap.isOpened():
                cap = cv2.VideoCapture(actual_source)

        # Set buffer size to 1 to reduce latency
        if cap.isOpened():
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        else:
            print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] [CAM {camera_id}] FAILED to open source: {source[:50]}...")
            active_cameras[camera_id]["status"] = "Connection Failed"
            # It will enter the retry loop below
        
        frame_count = 0
        while not active_cameras[camera_id]["stop"]:
            # Check for config reload trigger
            if active_cameras[camera_id].get("reload_config"):
                pipeline.reload_config()
                active_cameras[camera_id]["reload_config"] = False
                
            ret, frame = cap.read()
            # ...
            if not ret:
                active_cameras[camera_id]["status"] = "Retrying..."
                cap.release()
                time.sleep(5)
                actual_source = get_yt_stream_url(source)
                cap = cv2.VideoCapture(actual_source or source, cv2.CAP_FFMPEG)
                if not cap.isOpened():
                    cap = cv2.VideoCapture(actual_source or source)
                if cap.isOpened():
                    cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
                continue
                
            active_cameras[camera_id]["status"] = "Active"
            active_cameras[camera_id]["frame_id"] = active_cameras[camera_id].get("frame_id", 0) + 1
            # Update raw frame immediately for fast streaming
            active_cameras[camera_id]["frame"] = frame.copy()
            
            try:
                # Process 1 frame every frame_interval
                if frame_count % frame_interval == 0:
                    detections = pipeline.process_frame(frame)
                    active_cameras[camera_id]["detections"] = detections
                frame_count += 1
            except Exception as e:
                print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] [CAM {camera_id}] AI Error: {e}")
                active_cameras[camera_id]["status"] = f"AI Error: {e}"
            
        cap.release()
        pipeline.close()
    except Exception as e:
        print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] [CAM {camera_id}] CRITICAL ERROR: {e}")
        if camera_id in active_cameras:
            active_cameras[camera_id]["status"] = f"Error: {e}"
        # Ensure cleanup on critical error
        if 'pipeline' in locals():
            pipeline.close()

def start_camera_pipeline(camera_id, source, frame_interval=1):
    # Normalize source to ensure reliable comparison
    source = source.strip()
    
    # Auto-set frame interval for YouTube if not specified
    if ("youtube.com" in source or "youtu.be" in source) and frame_interval == 1:
        frame_interval = 30
        
    if camera_id in active_cameras:
        # Check if it's already running with the SAME source
        # This prevents unnecessary restarts during simple detail updates (like place_name or detections)
        if active_cameras[camera_id].get("raw_source") == source and not active_cameras[camera_id]["stop"]:
            print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] [CAM {camera_id}] Source unchanged, triggering config reload instead of restart.")
            active_cameras[camera_id]["reload_config"] = True
            return
            
        # Mark for stop
        active_cameras[camera_id]["stop"] = True
        active_cameras[camera_id]["status"] = "Restarting..."
        
    active_cameras[camera_id] = {
        "stop": False, 
        "frame": None, 
        "detections": [], 
        "thread": None, 
        "status": "Starting...",
        "raw_source": source,
        "reload_config": False
    }
    thread = threading.Thread(target=camera_thread, args=(camera_id, source, frame_interval), name=f"cam_{camera_id}", daemon=True)
    active_cameras[camera_id]["thread"] = thread
    thread.start()

# API Endpoints

@app.post("/cameras")
def add_camera(ip_address: str, place_name: str, detections: str, db: Session = Depends(get_db)):
    ip_address = ip_address.strip()
    # detections is expected as comma-separated IDs or a JSON list
    try:
        det_list = [int(i.strip()) for i in detections.split(",")]
    except:
        det_list = [0, 1, 2, 3, 4] # Default
        
    # Store the ORIGINAL ip_address in DB so frontend filtering works
    new_cam = Camera(ip_address=ip_address, place_name=place_name, detections_to_run=det_list)
    db.add(new_cam)
    db.commit()
    db.refresh(new_cam)
    
    start_camera_pipeline(new_cam.id, ip_address)
    return new_cam

@app.put("/cameras/{camera_id}")
def update_camera(camera_id: int, ip_address: str, place_name: str, detections: str, db: Session = Depends(get_db)):
    ip_address = ip_address.strip()
    cam = db.query(Camera).filter(Camera.id == camera_id).first()
    if not cam:
        raise HTTPException(status_code=404, detail="Resource Unavailable: surveillance node ID not registered.")
    
    try:
        det_list = [int(i.strip()) for i in detections.split(",")]
    except:
        det_list = cam.detections_to_run
        
    # Store ORIGINAL in DB
    cam.ip_address = ip_address
    cam.place_name = place_name
    cam.detections_to_run = det_list
    db.commit()
    
    # Restart pipeline (non-blocking) - start_camera_pipeline will handle smart skip if source is same
    start_camera_pipeline(camera_id, ip_address)
        
    return cam

@app.delete("/cameras/{camera_id}")
def delete_camera(camera_id: int, db: Session = Depends(get_db)):
    cam = db.query(Camera).filter(Camera.id == camera_id).first()
    if not cam:
        raise HTTPException(status_code=404, detail="Resource Unavailable: surveillance node ID not registered.")
    
    # Stop pipeline
    if camera_id in active_cameras:
        active_cameras[camera_id]["stop"] = True
        # The thread will exit on next loop
        
    db.delete(cam)
    db.commit()
    return {"status": "success"}

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

@app.get("/test_camera")
def test_camera(ip_address: str):
    best_url = find_best_url(ip_address)
    if best_url:
        return {"status": "success", "url": best_url}
    return {"status": "error", "message": "Could not connect to camera. Try adding http:// or check if /video is needed."}

@app.get("/cameras")
def list_cameras(db: Session = Depends(get_db)):
    cameras = db.query(Camera).all()
    result = []
    for cam in cameras:
        result.append({
            "id": cam.id,
            "ip_address": cam.ip_address,
            "place_name": cam.place_name,
            "detections_to_run": cam.detections_to_run,
            "status": active_cameras.get(cam.id, {}).get("status", "Inactive"),
            "is_active": cam.is_active
        })
    return result

@app.post("/cameras-toggle/{camera_id}")
def toggle_camera(camera_id: int, db: Session = Depends(get_db)):
    print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] TOGGLE REQUEST RECEIVED for Cam {camera_id}")
    cam = db.query(Camera).filter(Camera.id == camera_id).first()
    if not cam:
        raise HTTPException(status_code=404, detail="Resource Unavailable: surveillance node ID not registered.")
    
    cam.is_active = not cam.is_active
    db.commit()
    
    if not cam.is_active:
        # Stop pipeline
        if camera_id in active_cameras:
            active_cameras[camera_id]["stop"] = True
            print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] Camera {camera_id} deactivated. Stopping pipeline.")
    else:
        # Start pipeline
        print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] Camera {camera_id} activated. Starting pipeline.")
        start_camera_pipeline(camera_id, cam.ip_address)
        
    return {"is_active": cam.is_active}

@app.get("/stats")
def get_stats(db: Session = Depends(get_db)):
    total_alerts = db.query(Alert).count()
    total_vehicles = db.query(VehicleCheck).count()
    active_count = len([c for c in active_cameras.values() if not c.get("stop")])
    print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] Stats Requested: Alerts={total_alerts}, Vehicles={total_vehicles}, ActiveCams={active_count}")
    return {
        "total_alerts": total_alerts,
        "total_vehicles": total_vehicles,
        "active_cameras": active_count
    }

@app.post("/zones")
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

@app.get("/alerts")
def get_alerts(db: Session = Depends(get_db)):
    return db.query(Alert).order_by(Alert.timestamp.desc()).limit(50).all()

@app.get("/vehicle-checks")
def get_vehicle_checks(db: Session = Depends(get_db)):
    return db.query(VehicleCheck).order_by(VehicleCheck.time_in.desc()).limit(50).all()

@app.get("/zones/{camera_id}")
def get_zones(camera_id: int, db: Session = Depends(get_db)):
    return db.query(RestrictionZone).filter(RestrictionZone.camera_id == camera_id).all()

@app.delete("/zones/{zone_id}")
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
                for det in detections:
                    x1, y1, x2, y2 = det["xyxy"]
                    color = (0, 255, 0) # Green
                    label = f"{det['class_name']} {det.get('global_id', '')}"
                    cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
                    cv2.putText(frame, label, (x1, y1 - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 2)
                
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
    # Returns a multipart stream of MJPEG frames
    def gen():
        while True:
            # Check if camera exists in active list
            if camera_id not in active_cameras:
                yield (b'--frame\r\n'
                       b'Content-Type: image/jpeg\r\n\r\n' + get_placeholder_frame() + b'\r\n')
                time.sleep(0.5)
                continue
                
            cam_data = active_cameras[camera_id]
            frame = cam_data.get("frame")
            detections = cam_data.get("detections", [])
            
            if frame is None:
                # If camera is starting/resolving, show placeholder
                yield (b'--frame\r\n'
                       b'Content-Type: image/jpeg\r\n\r\n' + get_placeholder_frame() + b'\r\n')
                time.sleep(0.1)
                continue
                
            # Create a copy to avoid modifying the original frame in other threads
            display_frame = frame.copy()
            
            # Draw detections if requested
            if detect and detections:
                for det in detections:
                    if "xyxy" in det:
                        x1, y1, x2, y2 = det["xyxy"]
                        label = f"{det.get('class_name', 'object')} {det.get('global_id', '')}".strip()
                        color = (0, 255, 0) # Green for general detections
                        
                        # Use different colors for specific classes if desired
                        if det.get("class_name") == "person":
                            color = (255, 0, 0) # Blue for person
                        
                        cv2.rectangle(display_frame, (x1, y1), (x2, y2), color, 2)
                        cv2.putText(display_frame, label, (x1, y1 - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 2)

            # Encode frame to JPEG
            ret, buffer = cv2.imencode('.jpg', display_frame)
            if not ret:
                time.sleep(0.01)
                continue
                
            frame_bytes = buffer.tobytes()
            
            # Yield the MJPEG frame
            yield (b'--frame\r\n'
                   b'Content-Type: image/jpeg\r\n\r\n' + frame_bytes + b'\r\n')
            
            # Control frame rate roughly
            time.sleep(0.03) # ~30 FPS
            
    return StreamingResponse(gen(), media_type="multipart/x-mixed-replace; boundary=frame")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
