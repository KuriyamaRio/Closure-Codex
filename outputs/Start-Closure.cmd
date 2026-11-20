@echo off
setlocal
if not exist "%~dp0closure-crt\ClosureCrt.exe" exit /b 2
if not exist "%~dp0closure-companion\launch.cmd" exit /b 2
start "" "%~dp0closure-crt\ClosureCrt.exe"
call "%~dp0closure-companion\launch.cmd"
exit /b %ERRORLEVEL%
