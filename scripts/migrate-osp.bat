@echo off
chcp 65001 >nul
setlocal

REM ── Migrate old config.osp files to the new compact format ──
REM Double-click this .bat (or run from a terminal). It auto-detects the osu!
REM install path from the app config, shows a dry-run preview, and asks before
REM writing. Pass an explicit osu path as the first arg to override.

REM Resolve the repo root (parent of this script's folder) so node can find the JS.
set "SCRIPT_DIR=%~dp0"
set "JS=%SCRIPT_DIR%migrate-osp.js"

REM Pick the osu path: explicit arg, else auto-detect via the app config.
set "OSU_PATH=%~1"

echo === osp migration: dry run ===
if "%OSU_PATH%"=="" (
  node "%JS%" --auto
) else (
  node "%JS%" "%OSU_PATH%"
)
if errorlevel 1 goto :nodeerror

echo.
echo Review the savings above. Apply for real?
choice /C yn /M "Write the converted files"
if errorlevel 2 goto :end

echo.
echo === osp migration: writing ===
if "%OSU_PATH%"=="" (
  node "%JS%" --auto --write
) else (
  node "%JS%" "%OSU_PATH%" --write
)
echo.
echo Done.
goto :end

:nodeerror
echo.
echo Node.js failed or is not installed. Install Node.js (https://nodejs.org) and retry.

:end
echo.
pause
endlocal
