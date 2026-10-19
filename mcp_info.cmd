@echo off
cd /d "%~dp0"
if exist runtime\node\node.exe (
  runtime\node\node.exe scripts\mcp-connect-info.cjs
) else (
  node scripts\mcp-connect-info.cjs
)
pause
