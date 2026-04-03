@echo off
echo ========================================
echo   Video Analysis System Starter
echo ========================================
echo.

:: Auto-detect location: If in backend folder, cd up
if exist "..\node_backend\server.js" (
    cd ..
)

:: Check for Redis (required for streaming)
echo [0/4] Checking Redis Status...
netstat -ano | findstr :6379 > nul
if %errorlevel% neq 0 (
    echo [ERROR] Redis is not running on port 6379. 
    echo Please start the Redis server before running the system.
    pause
    exit /b
)
echo [OK] Redis is active.

:: Check for Node backend
if not exist "node_backend\server.js" (
    echo [ERROR] Node Backend not found in .\node_backend\server.js
    echo Current Directory: %cd%
    pause
    exit /b
)

:: Check for frontend
if not exist "frontend\package.json" (
    echo [ERROR] Frontend not found in .\frontend\package.json
    pause
    exit /b
)

echo [1/3] Launching Analysis Worker (Port 8001)...
start "Analysis Worker" cmd /k "cd backend && run_safe_worker.bat"

timeout /t 20 /nobreak > nul

echo [2/3] Launching Management API (Port 5000)...
start "Backend API" cmd /k "cd node_backend && npm install && npm run start"

timeout /t 5 /nobreak > nul

echo [3/3] Launching Frontend Dashboard...
if not exist "frontend\node_modules" (
    echo [WARNING] node_modules not found. Running npm install...
    start "Frontend Setup" cmd /k "cd frontend && npm install && npm run dev"
) else (
    start "Frontend Dashboard" cmd /k "cd frontend && npm run dev"
)

echo [4/4] Launching Desktop Notifier...
start "Desktop Notifier" cmd /k "cd backend && python notifier.py"

echo.
echo ========================================
echo SYSTEM STARTING...
echo - Backend: http://localhost:5000
echo - Frontend: http://localhost:3000
echo.
echo IF WINDOWS CLOSE IMMEDIATELY: Check your terminal for errors.
echo IF PORT 8000 IS TAKEN: Close previous python processes.
echo ========================================
pause
