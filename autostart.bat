@echo off
:: Parts API — Auto-start on Windows login
:: Registered in Task Scheduler — do not move this file
cd /d C:\Users\allmo\parts-api
node server.js >> C:\Users\allmo\parts-api\server.log 2>&1
