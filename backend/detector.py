from ultralytics import YOLO
import cv2

class Detector:
    def __init__(self, model_path, device='cpu'):
        self.model = YOLO(model_path)
        self.device = device
        self.classes = self.model.names

    def detect(self, frame, conf=0.25, classes=None):
        results = self.model.track(frame, persist=True, device=self.device, classes=classes, conf=conf, verbose=False)
        
        detections = []
        if results and results[0].boxes:
            for box in results[0].boxes:
                # Get xyxy, conf, cls, and id (if available from tracker)
                xyxy = box.xyxy[0].cpu().numpy().astype(int)
                conf_score = float(box.conf[0].cpu().numpy())
                cls_id = int(box.cls[0].cpu().numpy())
                track_id = int(box.id[0].cpu().numpy()) if box.id is not None else None
                
                detections.append({
                    "xyxy": xyxy.tolist(),
                    "conf": conf_score,
                    "class_id": cls_id,
                    "class_name": self.classes[cls_id],
                    "track_id": track_id
                })
        
        return detections

if __name__ == "__main__":
    # Test with a dummy image or webcam if available
    # For now, just initialize
    detector = Detector(r"c:\Users\sivan\OneDrive - MSFT\analysis_system\weights\best.pt")
    print(f"Model loaded with classes: {detector.classes}")
