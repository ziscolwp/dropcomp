@echo off
setlocal
set "SRC=%~dp0"
set "DEST=%APPDATA%\Adobe\CEP\extensions\DropComp"
set "BACKUPDIR=%USERPROFILE%\Documents\DropComp"
set "BACKUP=%BACKUPDIR%\backup-previous-version.zip"

echo DropComp installer / updater
echo.

rem back up the existing install once (kept until you delete it)
if exist "%DEST%" if not exist "%BACKUP%" (
  if not exist "%BACKUPDIR%" mkdir "%BACKUPDIR%"
  powershell -NoProfile -Command "Compress-Archive -Path '%DEST%' -DestinationPath '%BACKUP%' -Force" >nul 2>&1
  if exist "%BACKUP%" echo Backed up existing extension to %BACKUP%
)

if exist "%DEST%" rmdir /s /q "%DEST%"
mkdir "%DEST%"
xcopy /e /i /q /y "%SRC%CSXS" "%DEST%\CSXS\" >nul
xcopy /e /i /q /y "%SRC%panel" "%DEST%\panel\" >nul
xcopy /e /i /q /y "%SRC%jsx" "%DEST%\jsx\" >nul

rem unsigned extensions need PlayerDebugMode (covers AE 2019-2026 CEP runtimes)
for %%v in (9 10 11 12) do reg add "HKCU\Software\Adobe\CSXS.%%v" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul

echo.
echo DropComp installed.
echo Restart After Effects, then open Window ^> Extensions ^> DropComp.
echo Your library folder and favorites are untouched by updates.
pause
