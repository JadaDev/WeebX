@echo off
setlocal EnableExtensions
title WeebX Location Repair

set "WEEBX_FOLDER=%~dp0"
set "WEEBX_APP="

if exist "%WEEBX_FOLDER%WeebX.exe" set "WEEBX_APP=%WEEBX_FOLDER%WeebX.exe"
if not defined WEEBX_APP if exist "%WEEBX_FOLDER%win-unpacked\WeebX.exe" set "WEEBX_APP=%WEEBX_FOLDER%win-unpacked\WeebX.exe"
if not defined WEEBX_APP if exist "%LOCALAPPDATA%\Programs\WeebX\WeebX.exe" set "WEEBX_APP=%LOCALAPPDATA%\Programs\WeebX\WeebX.exe"
if not defined WEEBX_APP if exist "%LOCALAPPDATA%\Programs\weebx\WeebX.exe" set "WEEBX_APP=%LOCALAPPDATA%\Programs\weebx\WeebX.exe"

if not defined WEEBX_APP (
  echo WeebX.exe was not found beside this repair file or in the normal installation folder.
  echo.
  echo Copy setup_weebx.bat into the folder that contains WeebX.exe, then run it again.
  echo If you only have the installer, install WeebX first.
  echo.
  pause
  exit /b 1
)

for %%I in ("%WEEBX_APP%") do set "WEEBX_APP_DIR=%%~dpI"
if exist "%WEEBX_APP_DIR%data\runtime\apache\bin\httpd.exe" goto portable
if exist "%WEEBX_FOLDER%data\runtime\apache\bin\httpd.exe" (
  set "WEEBX_APP_DIR=%WEEBX_FOLDER%"
  goto portable
)
if /I "%WEEBX_APP_DIR%"=="%WEEBX_FOLDER%" goto portable

echo Starting the installed WeebX location repair...
echo %WEEBX_APP%
start "" "%WEEBX_APP%" --repair-location
exit /b 0

:portable
echo Repairing this WeebX copy:
echo %WEEBX_APP_DIR%
echo.
echo Portable settings will be stored in:
echo %WEEBX_APP_DIR%data
start "" "%WEEBX_APP%" "--weebx-data-dir=%WEEBX_APP_DIR%data" --repair-location
exit /b 0
