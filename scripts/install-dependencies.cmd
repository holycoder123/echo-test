@echo off
cd /d "%~dp0.."
if exist runtime\manifest.json if exist runtime\node\node.exe (
  runtime\node\node.exe scripts\verify-portable.cjs
  if errorlevel 1 (pause & exit /b 1)
  pause
  exit /b 0
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0build-portable.ps1" -SkipArchive
if errorlevel 1 (pause & exit /b 1)
pause
