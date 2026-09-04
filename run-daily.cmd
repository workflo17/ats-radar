@echo off
REM ats-radar daily collection. Registered as scheduled task "ats-radar-daily".
REM Deliberately .cmd and not .ps1: AVG deletes scheduled PowerShell scripts on this box.
setlocal
cd /d "%~dp0"
if not exist "logs" mkdir "logs"
echo. >> "logs\daily.log"
echo ===== %DATE% %TIME% ===== >> "logs\daily.log"
node "src\collect.mjs" >> "logs\daily.log" 2>&1
node "src\report.mjs"  >> "logs\daily.log" 2>&1
endlocal
