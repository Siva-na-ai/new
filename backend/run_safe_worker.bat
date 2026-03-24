@echo off
title Analysis Worker (Port 8001)
:loop
echo [%time%] Starting Analysis Worker...
python worker.py
echo.
echo [%time%] Worker exited/crashed. Restarting in 5s...
timeout /t 5
goto loop
