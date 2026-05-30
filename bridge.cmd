@echo off
setlocal
set "ROOT=%~dp0"
set "NODEDIR=%ROOT%.tools\node-v24.16.0-win-x64"

if not exist "%NODEDIR%\node.exe" (
  call "%ROOT%install.cmd"
)

set "PATH=%NODEDIR%;%PATH%"
cd /d "%ROOT%"
node scripts\bridge-server.mjs
