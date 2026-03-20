# Video Analysis System

This project consists of a FastAPI backend and a React (Vite) frontend for real-time video analysis and tracking.

## Installation

### Backend Setup
1. Navigate to the backend directory:
   ```bash
   cd backend
   ```
2. Install the required Python packages:
   ```bash
   pip install -r requirements.txt
   ```
3. Run the backend server:
   ```bash
   python main.py
   ```
   *Note: The server runs on `http://localhost:8000` by default.*

### Frontend Setup
1. Navigate to the frontend directory:
   ```bash
   cd frontend
   ```
2. Install the required npm packages:
   ```bash
   npm install
   ```
3. Run the development server:
   ```bash
   npm run dev
   ```
   *Note: The frontend will be available at the URL provided in the terminal (usually `http://localhost:5173`).*

## Model Weights (.pt files)
The YOLO weight files (e.g., `last_v8.pt`) are not included in this repository due to their size. 

**For the `.pt` files and model weights, please contact the author.**