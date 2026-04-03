@echo off
title Backend Server (Safe Loop)
:loop
echo [%time%] Starting Backend Server...
cd ../node_backend
node server.js
echo.
echo [%time%] Backend process exited or crashed.
echo Restarting in 5 seconds (Press Ctrl+C to stop)...
timeout /t 5
goto loop
