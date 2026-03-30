from ultralytics import YOLO
import torch

class Detector:
    def __init__(self, model_path, device=None):
        if device is None:
            self.device = 'cuda' if torch.cuda.is_available() else 'cpu'
        else:
            self.device = device
            
        self.model = YOLO(model_path)
        self.classes = self.model.names
        print(f"[DETECTOR] Initialized on {self.device}")

    def detect(self, frame, conf=0.25, classes=None):
        # YOLO track/predict expects class IDs (integers), not names
        class_ids = None
        if classes:
            # Handle both lists of names and lists of IDs
            class_ids = []
            name_to_id = {v: k for k, v in self.classes.items()}
            for c in classes:
                if isinstance(c, str):
                    if c in name_to_id:
                        class_ids.append(name_to_id[c])
                else:
                    class_ids.append(c)
        
        results = self.model.track(frame, persist=True, device=self.device, classes=class_ids, conf=conf, verbose=False)
        
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
    detector = Detector(r"D:\analysis_system\weights\best_res1.pt")
    print(f"Model loaded with classes: {detector.classes}")
