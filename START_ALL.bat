@echo off
title Parts API — Full Stack
color 0A

echo.
echo  ============================================
echo    Parts API — Starting All Services
echo  ============================================
echo.

:: Start the API server in background
cd /d C:\Users\allmo\parts-api
start "Parts API Server" cmd /k "node server.js"

:: Wait for server to boot
timeout /t 3 /nobreak > nul

:: Start the Cloudflare tunnel
echo  Starting Cloudflare tunnel...
start "Cloudflare Tunnel" cmd /k "C:\Users\allmo\cloudflared\cloudflared.exe tunnel run parts-api"

echo.
echo  ✅ All services started!
echo  ✅ Local:  http://localhost:3000/dashboard
echo  ✅ Remote: Check the Cloudflare Tunnel window for your URL
echo.
pause
