@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

where python >nul 2>nul
if %errorlevel%==0 (
    python server.py %*
    goto done
)

where py >nul 2>nul
if %errorlevel%==0 (
    py -3 server.py %*
    goto done
)

echo.
echo [ERROR] Python not found.
echo Install Python 3.8+ from https://www.python.org/downloads/
echo and make sure "Add Python to PATH" is checked.
echo.
pause

:done
endlocal
