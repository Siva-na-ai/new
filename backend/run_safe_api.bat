@echo off
title Backend API (Port 8000)
:loop
echo [%time%] Starting API Server...
python main.py
echo.
echo [%time%] API Server exited. Restarting in 5s...
timeout /t 5
goto loop
