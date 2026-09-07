@echo off
title AI Companion Hub - Launcher
color 0A
echo.
echo  Starting AI Backend...
start "AI Backend" cmd /k "cd /d %~dp0backend && python main.py"
timeout /t 3 /nobreak > nul
echo  Starting Global Ngrok Tunnel...
start "Ngrok Tunnel" cmd /k "%USERPROFILE%\ngrok-new\ngrok.exe http 8000"
echo.
echo  Both services started!
echo  Global URL: https://nonsterilely-pharmacognostic-coralee.ngrok-free.dev
echo.
pause
