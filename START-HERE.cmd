@echo off
REM Menu launcher for the ats-radar tools. Double-click this file.
REM Deliberately .cmd and not .ps1: AVG deletes scheduled PowerShell scripts on this box.
setlocal enabledelayedexpansion
cd /d "%~dp0"
title Greenhouse SDR tools

:menu
cls
echo.
echo   GREENHOUSE SDR TOOLS
echo   ====================
echo.
echo   Every morning
echo     1   Today's call list and what changed overnight
echo.
echo   You just booked a meeting
echo     2   Do all of it: confirmation messages, AE brief, and log it
echo.
echo   The meeting happened, or did not
echo     3   Mark it held / no-showed / advanced / closed
echo.
echo   Now and then
echo     4   This month's attainment and what the plan says you earned
echo     5   Load a new territory list from a CSV export
echo     6   What is actually converting
echo     7   Collect now (the 6:30am job already does this)
echo.
echo     0   Quit  (or just press Enter)
echo.
set "choice="
set /p "choice=  Pick a number: "
REM An empty answer quits. Without this the loop spins forever when stdin ends,
REM which is what happens if this file is ever run from a script instead of a click.
if not defined choice goto :eof

if "%choice%"=="1" goto morning
if "%choice%"=="2" goto booked
if "%choice%"=="3" goto ledgerstatus
if "%choice%"=="4" goto month
if "%choice%"=="5" goto ingest
if "%choice%"=="6" goto learn
if "%choice%"=="7" goto collect
if "%choice%"=="0" goto :eof
goto menu

REM ---------------------------------------------------------------- morning
:morning
cls
REM Order matters. Is the data real, then what did you already commit to, then what
REM is new. A new signal you work before noticing the collector died eight days ago
REM is a call made on stale facts.
echo   GOOD MORNING
echo   ===========
node "src\health.mjs"
node "src\queue.mjs"
REM Clearing yesterday's calls happens here because this is when you look at the list
REM and recognise one you already handled. One keystroke to skip.
set "QID="
set /p "QID=  Already handled one of these? (id, or Enter to skip):  "
if defined QID (
  node "src\queue.mjs" done "!QID!"
  echo.
)
echo.
echo   Opening the dashboard...
REM Rebuilt here as well as at 06:30, so the page is current even on a morning the
REM scheduled run did not happen.
node "src\dashboard.mjs"
if exist "data\dashboard.html" (
  start "" "data\dashboard.html"
) else (
  echo   Could not build it. Run option 7 to collect first.
)
echo.
echo   Work the priority 10s and 9s first. They are dated and they expire.
goto done

REM ----------------------------------------------------------- just booked
REM One flow, asked once. These three used to be three menu items, which meant
REM typing the same company, contact, title, time and AE three times per booking.
:booked
cls
echo YOU JUST BOOKED A MEETING
echo.
echo This produces all three in one pass: the confirmation messages, the AE brief,
echo and the ledger entry. Answer once.
echo.
call :askmeeting
if not defined ACCOUNT goto menu
set "TRIGGER="
set /p "TRIGGER=  Why now (the signal that made you call):  "
set "NOTES="
set /p "NOTES=  What they said that got you the meeting:  "
set "WHENDAY="
set /p "WHENDAY=  Meeting date as YYYY-MM-DD (for the ledger):  "
echo.
echo ---------------------------------------------------------------- 1 of 3
echo Show-rate pack
echo.
node "src\brief.mjs" --account "%ACCOUNT%" --contact "%CONTACT%" --role "%ROLE%" --when "%WHEN%" --ae "%AE%" --copy
if errorlevel 1 (
  echo.
  echo   Nothing written. If it said "no account matching", that company is not on
  echo   your target list yet. Add it to config\targets.csv and run option 7.
  goto done
)
echo.
echo ---------------------------------------------------------------- 2 of 3
echo AE handoff brief
echo.
node "src\handoff.mjs" --account "%ACCOUNT%" --contact "%CONTACT%" --role "%ROLE%" --when "%WHEN%" --ae "%AE%" --trigger "%TRIGGER%" --notes "%NOTES%"
echo.
echo ---------------------------------------------------------------- 3 of 3
echo Ledger
echo.
if defined WHENDAY (
  node "src\ledger.mjs" add --account "%ACCOUNT%" --contact "%CONTACT%" --when "%WHENDAY%"
) else (
  node "src\ledger.mjs" add --account "%ACCOUNT%" --contact "%CONTACT%"
)
echo.
echo   DONE. Both pages are in data\briefs\.
echo   1. Message 1 is already on your clipboard. Paste it and send, now.
echo   2. Paste the handoff to %AE% today. Every meeting, no exceptions.
echo   3. The short id above is how you mark this held or advanced later.
goto done

REM ---------------------------------------------------------- ledger status
:ledgerstatus
cls
echo UPDATE A MEETING
echo.
node "src\ledger.mjs" list
echo.
echo   held      they showed up
echo   noshow    they did not
echo   advanced  the AE moved it to Develop  (this is the one that pays)
echo   closed    it became revenue
echo.
set "ID="
set /p "ID=  Short id:  "
if not defined ID goto menu
set "STATUS="
set /p "STATUS=  held / noshow / advanced / closed:  "
if /i "%STATUS%"=="advanced" (
  set "AE="
  set /p "AE=  Which AE:  "
  node "src\ledger.mjs" advanced "%ID%" --ae "!AE!"
  goto done
)
if /i "%STATUS%"=="closed" (
  set "VAL="
  set /p "VAL=  Contract value in dollars:  "
  node "src\ledger.mjs" closed "%ID%" --value "!VAL!"
  goto done
)
set "NOTE="
set /p "NOTE=  Note (optional, press Enter to skip):  "
if defined NOTE (
  node "src\ledger.mjs" %STATUS% "%ID%" --note "!NOTE!"
) else (
  node "src\ledger.mjs" %STATUS% "%ID%"
)
goto done

REM ------------------------------------------------------------------ month
:month
cls
set "M="
set /p "M=  Which month (YYYY-MM, Enter for this one):  "
echo.
if defined M (node "src\ledger.mjs" month "%M%") else (node "src\ledger.mjs" month)
goto done

REM ----------------------------------------------------------------- ingest
:ingest
cls
echo LOAD A TERRITORY LIST
echo Drag the CSV onto this window and press Enter, or type the path.
echo.
set "CSV="
set /p "CSV=  CSV file:  "
if not defined CSV goto menu
set CSV=%CSV:"=%
echo.
echo   Dry run first, nothing is written:
node "src\ingest.mjs" --file "%CSV%" --dry-run
echo.
set "GO="
set /p "GO=  Replace your target list with this? (y/N):  "
if /i "%GO%"=="y" (
  node "src\ingest.mjs" --file "%CSV%" --replace
  echo.
  echo   Anything that did not resolve is in data\unresolved.csv. Fix those by hand.
)
goto done

REM ------------------------------------------------------------------ learn
:learn
cls
node "src\learn.mjs"
goto done

REM ---------------------------------------------------------------- collect
:collect
cls
echo Polling every company on your target list. This takes a few minutes.
echo.
node "src\collect.mjs"
node "src\report.mjs"
node "src\diff.mjs"
node "src\dashboard.mjs"
goto done

REM ------------------------------------------------------------ shared ask
:askmeeting
set "ACCOUNT="
REM Name or domain both work: findAccount matches the domain first, then the
REM company name, then a substring of it. "Ramp" and "ramp.com" land in the same place.
set /p "ACCOUNT=  Company (name or domain, e.g. Ramp):  "
if not defined ACCOUNT exit /b
set "CONTACT="
set /p "CONTACT=  Contact name:  "
set "ROLE="
set /p "ROLE=  Their title:  "
set "WHEN="
set /p "WHEN=  Meeting time (e.g. Tue Oct 14, 2:00pm ET):  "
set "AE="
set /p "AE=  Which AE is joining:  "
exit /b

:done
echo.
pause
goto menu
