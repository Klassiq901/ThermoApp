@echo off
chcp 65001 >nul
title Thermodynamics Simulator Launcher
color 0A
cls

echo ╔══════════════════════════════════════════════╗
echo ║   THERMODYNAMICS SIMULATOR - FASTAPI SERVER  ║
echo ╚══════════════════════════════════════════════╝
echo.

:: ==================== CONFIGURATION ====================
set "SERVER_HOST=127.0.0.1"
set "SERVER_PORT=8000"
set "SERVER_URL=http://%SERVER_HOST%:%SERVER_PORT%/"

:: ==================== INITIAL CHECKS ====================
echo [1/4] Checking current directory...
echo Current folder: %CD%
echo.

echo [2/4] Looking for main.py...
if exist "main.py" (
    echo ✓ Found main.py
) else (
    echo ❌ ERROR: main.py not found!
    echo.
    echo Files in current directory:
    dir /b
    echo.
    pause
    exit /b 1
)

echo.
echo [3/4] Checking virtual environment...
set "VENV_FOUND=0"
set "VENV_PATH=python"  :: Default to system Python

if exist ".venv\Scripts\python.exe" (
    set "VENV_PATH=.venv\Scripts\python.exe"
    set "VENV_FOUND=1"
    echo ✓ Found virtual environment: .venv
) else if exist "venv\Scripts\python.exe" (
    set "VENV_PATH=venv\Scripts\python.exe"
    set "VENV_FOUND=1"
    echo ✓ Found virtual environment: venv
) else if exist "env\Scripts\python.exe" (
    set "VENV_PATH=env\Scripts\python.exe"
    set "VENV_FOUND=1"
    echo ✓ Found virtual environment: env
) else (
    echo ⚠️ No virtual environment found, using system Python
)

:: ==================== START SERVER ====================
echo.
echo [4/4] Starting FastAPI server...
echo.
echo ════════════════════════════════════════════════════
echo    SERVER URL: %SERVER_URL%
echo    HOST: %SERVER_HOST%
echo    PORT: %SERVER_PORT%
echo ════════════════════════════════════════════════════
echo.
echo 📢 Server is starting...
echo 📢 Press Ctrl+C to stop the server
echo 📢 Auto-opening browser in 3 seconds...
echo.

:: Start browser in background
timeout /t 3 /nobreak >nul
start "" "%SERVER_URL%"

echo.
echo 🚀 Starting uvicorn server...
echo.

:: Try multiple methods to start uvicorn
:try_uvicorn
echo ===== ATTEMPT 1: Direct uvicorn command =====
uvicorn main:app --host %SERVER_HOST% --port %SERVER_PORT% --reload
if %errorlevel% equ 0 goto :success

echo.
echo ===== ATTEMPT 2: Python module method =====
%VENV_PATH% -m uvicorn main:app --host %SERVER_HOST% --port %SERVER_PORT% --reload
if %errorlevel% equ 0 goto :success

echo.
echo ===== ATTEMPT 3: Using python directly =====
%VENV_PATH% -c "import uvicorn; uvicorn.run('main:app', host='%SERVER_HOST%', port=%SERVER_PORT%, reload=True)"
if %errorlevel% equ 0 goto :success

echo.
echo ❌ All attempts failed to start the server
echo.
echo Troubleshooting steps:
echo 1. Make sure no other program is using port %SERVER_PORT%
echo 2. Check if main.py has syntax errors
echo 3. Try running: %VENV_PATH% -c "import main"
echo.
pause
exit /b 1

:success
echo.
echo ✅ Server started successfully!
echo 📍 Open your browser to: %SERVER_URL%
pause
exit /b 0