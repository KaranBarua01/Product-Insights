@echo off
setlocal
cd /d "%~dp0"
echo PRODUCT INSIGHTS - ONE-TIME GITHUB UPDATER SETUP
echo This enables automatic source-only updates; it preserves SQLite, results and credentials.
echo Close localhost 8791 and stop the PI Agent before installing.
if not exist "%~dp0START_WITH_AGENT.bat" (
  echo ERROR: Place this BAT beside START_WITH_AGENT.bat in the Phase 4 unified application.
  pause
  exit /b 1
)
where node.exe >nul 2>&1
if errorlevel 1 (echo ERROR: Node.js 24 is required. & pause & exit /b 1)
where powershell.exe >nul 2>&1
if errorlevel 1 (echo ERROR: Windows PowerShell is required. & pause & exit /b 1)
set "PI_BOOT_TMP=%TEMP%\pi-github-bootstrap-%RANDOM%-%RANDOM%.ps1"
echo Downloading the exact reviewed GitHub updater bootstrap...
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; Invoke-WebRequest -Uri 'https://raw.githubusercontent.com/KaranBarua01/Product-Insights/fea79ea6cef3f2c39d271924df6604cb6115dfe3/tools/pi-local-updater/enable-github-updates.ps1' -UseBasicParsing -MaximumRedirection 0 -TimeoutSec 45 -OutFile $env:PI_BOOT_TMP"
if errorlevel 1 (echo ERROR: GitHub download failed. & goto :error)
node.exe -e "const fs=require('node:fs'),crypto=require('node:crypto');const b=fs.readFileSync(process.argv[1]);const h=crypto.createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex');if(h!=='852430fdb28d65675e13d09a99842100cc9d3b90'){console.error('Bootstrap source hash mismatch. Refusing execution.');process.exit(1)}" "%PI_BOOT_TMP%"
if errorlevel 1 goto :error
echo Source verified. Installing fixed update actions and performing regression tests...
echo Installation folder: "%CD%"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PI_BOOT_TMP%" -RootPath "%CD%"
if errorlevel 1 goto :error
del /q "%PI_BOOT_TMP%" >nul 2>&1
echo.
echo GITHUB UPDATES ENABLED.
echo From now on use START_GITHUB_AGENT.bat or START_GITHUB_LOCALHOST.bat.
echo Automatic checks happen in the running app. Staged updates activate on next startup.
pause
exit /b 0
:error
del /q "%PI_BOOT_TMP%" >nul 2>&1
echo Setup failed; original application remains available.
pause
exit /b 1
