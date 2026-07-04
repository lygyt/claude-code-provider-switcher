@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0claude-deepseek.ps1" %*
exit /b %ERRORLEVEL%
