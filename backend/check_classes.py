from ultralytics import YOLO
import os
import sys

# Ensure d:\analysis_system\backend is in path
sys.path.append(r"d:\analysis_system\backend")

weight_path = r"d:\analysis_system\weights\best_new.pt"
if os.path.exists(weight_path):
    model = YOLO(weight_path)
    print("--- MODEL CLASSES ---")
    for id, name in model.names.items():
        print(f"{id}: {name}")
    print("--- END ---")
else:
    print(f"File not found: {weight_path}")
