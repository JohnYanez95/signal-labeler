@echo off
echo ============================================
echo   Signal Labeler
echo ============================================
echo.

echo Starting application...
echo.

REM Convert Windows path to WSL path inside WSL to avoid quoting issues
wsl bash -c "cd \"$(wslpath '%~dp0')\" && docker compose up -d"

echo.
echo Opening browser...
timeout /t 3 > nul
start http://localhost

echo.
echo ============================================
echo   Application is running at http://localhost
echo.
echo   Press any key to stop the application...
echo ============================================
pause > nul

echo.
echo Stopping application...
wsl bash -c "cd \"$(wslpath '%~dp0')\" && docker compose down"
echo Done.
timeout /t 2
