@echo off
setlocal DisableDelayedExpansion
set "APP=%~dp0."
set "ELECTRON_RUN_AS_NODE="
if not defined CLOSURE_ELECTRON_EXE set "CLOSURE_ELECTRON_EXE=%~dp0..\..\work\companion-runtime\electron\electron.exe"
if not defined CLOSURE_STATE_DIR set "CLOSURE_STATE_DIR=%~dp0..\..\work\companion-profile"
if not exist "%CLOSURE_ELECTRON_EXE%" (
    echo Electron is missing. Set CLOSURE_ELECTRON_EXE to an Electron 45 Windows x64 executable.
    pause
    exit /b 1
)
start "" "%CLOSURE_ELECTRON_EXE%" "%APP%" %*
