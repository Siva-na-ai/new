import torch
import torchreid
from torchreid.reid.utils import FeatureExtractor
import numpy as np
import cv2

class ReID:
    def __init__(self, model_name='osnet_ain_x1_0', device=None):
        if device is None:
            self.device = 'cuda' if torch.cuda.is_available() else 'cpu'
        else:
            self.device = device
            
        self.extractor = FeatureExtractor(
            model_name=model_name,
            model_path=None, # Use pretrained weights from torchreid
            device=self.device
        )
        print(f"[REID] Initialized on {self.device}")

    def extract_embedding(self, person_crop):
        """
        Extract embedding for a person crop.
        person_crop: numpy array (H, W, 3)
        """
        if person_crop is None or person_crop.size == 0:
            return None
        
        # Preprocessing is handled by FeatureExtractor (resize, normalize)
        # We just need to pass the image in BGR format (OpenCV default)
        # FeatureExtractor expects a list of images or a single image
        features = self.extractor([person_crop])
        embedding = features.cpu().detach().numpy()[0]
        
        # L2 Normalize the embedding
        norm = np.linalg.norm(embedding)
        if norm > 0:
            embedding = embedding / norm
            
        return embedding

if __name__ == "__main__":
    # Test initialization
    reid = ReID()
    print("ReID model initialized.")
