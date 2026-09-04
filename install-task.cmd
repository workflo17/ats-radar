@echo off
REM Registers (or re-registers) the daily ats-radar collection at 06:30.
REM Remove with: schtasks /delete /tn ats-radar-daily /f
schtasks /create /tn "ats-radar-daily" /tr "\"%~dp0run-daily.cmd\"" /sc daily /st 06:30 /f
if errorlevel 1 (
  echo FAILED to register scheduled task.
) else (
  echo Registered: ats-radar-daily, daily at 06:30
  schtasks /query /tn "ats-radar-daily"
)
