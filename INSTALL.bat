@echo off
title Quintara Reports — Installing...
color 0A
cd /d "%~dp0"
cls

echo.
echo  ╔══════════════════════════════════════════════════════════╗
echo  ║                                                          ║
echo  ║           Q U I N T A R A   R E P O R T S               ║
echo  ║                  Installing App...                       ║
echo  ║                                                          ║
echo  ╚══════════════════════════════════════════════════════════╝
echo.
echo  This will take 2-3 minutes (downloading Electron).
echo  Do not close this window.
echo.

:: Check Node
node --version >nul 2>&1
if errorlevel 1 (
  echo  ERROR: Node.js not found.
  echo  Go to nodejs.org, download LTS, install it, then run this again.
  echo.
  pause
  exit
)

echo  Installing packages...
call npm install

if errorlevel 1 (
  echo.
  echo  ERROR: Installation failed. Check your internet connection.
  pause
  exit
)

echo.
echo  ╔══════════════════════════════════════════════════════════╗
echo  ║             ✅  Installation complete!                   ║
echo  ║                                                          ║
echo  ║  The app is opening now.                                 ║
echo  ║  Go to Settings and enter your Anthropic API key.        ║
echo  ║  Then you are ready.                                     ║
echo  ╚══════════════════════════════════════════════════════════╝
echo.

:: Launch app
npx electron .
