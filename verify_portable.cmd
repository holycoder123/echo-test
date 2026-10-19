@echo off
cd /d "%~dp0"
if not exist runtime\node\node.exe (
  echo Portable runtime is missing. Run build_portable.cmd first.
  pause
  exit /b 1
)
runtime\node\node.exe scripts\verify-portable.cjs
if errorlevel 1 (pause & exit /b 1)
pause
