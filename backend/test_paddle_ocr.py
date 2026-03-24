from paddleocr import PaddleOCR
import cv2
import numpy as np
import os

def test_ocr():
    print("Initializing PaddleOCR...")
    try:
        ocr = PaddleOCR(use_angle_cls=True, lang='en')
        print("PaddleOCR Initialization: SUCCESS")
    except Exception as e:
        print(f"PaddleOCR Initialization: FAILED - {e}")
        return

    # Create a dummy image with text
    img = np.zeros((100, 300, 3), dtype=np.uint8)
    cv2.putText(img, "ABC1234", (20, 60), cv2.FONT_HERSHEY_SIMPLEX, 1.5, (255, 255, 255), 3)
    
    print("Running OCR on test image...")
    try:
        result = ocr.ocr(img, cls=True)
        print(f"OCR Raw Result: {result}")
        
        if result and result[0]:
            for line in result[0]:
                text = line[1][0]
                conf = line[1][1]
                print(f"Detected Text: {text} (Confidence: {conf:.2f})")
        else:
            print("No text detected.")
    except Exception as e:
        print(f"OCR Execution: FAILED - {e}")

if __name__ == "__main__":
    test_ocr()
