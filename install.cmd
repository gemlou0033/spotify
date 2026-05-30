@echo off
setlocal
set "ROOT=%~dp0"
set "NODEDIR=%ROOT%.tools\node-v24.16.0-win-x64"
set "NODEZIP=%ROOT%.tools\node-v24.16.0-win-x64.zip"

if not exist "%NODEDIR%\node.exe" (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "New-Item -ItemType Directory -Force -Path '%ROOT%.tools' | Out-Null; Invoke-WebRequest -Uri 'https://nodejs.org/dist/v24.16.0/node-v24.16.0-win-x64.zip' -OutFile '%NODEZIP%'; Expand-Archive -LiteralPath '%NODEZIP%' -DestinationPath '%ROOT%.tools' -Force"
)

set "PATH=%NODEDIR%;%PATH%"
cd /d "%ROOT%"
npm install
