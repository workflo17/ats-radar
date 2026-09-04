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
REM diff needs two snapshots; it exits non-zero and says so on day one.
node "src\diff.mjs"    >> "logs\daily.log" 2>&1

REM Back the time series up offsite. Snapshots are the whole asset: the change
REM signals only exist because yesterday's file is still around. This also keeps
REM a continuous dated record on a third-party host, which is what makes the
REM Prior Inventions build date verifiable by someone other than me.
git add data/snapshots data/reports data/registry.json >> "logs\daily.log" 2>&1
git diff --cached --quiet
if errorlevel 1 (
  git -c user.name="Don Florencio" -c user.email="don.flo17@gmail.com" commit -m "snapshot %DATE%" >> "logs\daily.log" 2>&1
  git push origin main >> "logs\daily.log" 2>&1
) else (
  echo no snapshot changes to commit >> "logs\daily.log"
)
endlocal
