@echo off
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-studio.ps1" -Admin -Mcp
if errorlevel 1 pause
