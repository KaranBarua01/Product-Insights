@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" -Mode agent
set "EXITCODE=%ERRORLEVEL%"
if not "%EXITCODE%"=="0" echo Setup or run reported an error. See the output above.
pause
exit /b %EXITCODE%
