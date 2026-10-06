@echo off
REM Start the multi-chart trading desk on Windows.
REM Installs the MCP server if it is missing, then runs the app.

where python >nul 2>&1
if errorlevel 1 (
  echo Python 3.10-3.13 is required and was not found on PATH.
  pause
  exit /b 1
)

python -c "import tradingview_mcp" >nul 2>&1
if errorlevel 1 (
  echo Installing tradingview-mcp-server...
  python -m pip install tradingview-mcp-server
)

if not exist node_modules (
  echo Installing node dependencies...
  call npm.cmd install
)

echo.
echo Trading desk -> http://127.0.0.1:8787
node server\index.js