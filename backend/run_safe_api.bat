@echo off
title Backend API (Port 5000)
:loop
echo [%time%] Starting API Server...
cd ../node_backend
node server.js
echo.
echo [%time%] API Server exited. Restarting in 5s...
timeout /t 5
goto loop
