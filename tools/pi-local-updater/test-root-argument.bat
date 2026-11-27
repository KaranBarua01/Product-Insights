@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0quoted-root.test.ps1" -RootPath "%CD%"
exit /b %ERRORLEVEL%
