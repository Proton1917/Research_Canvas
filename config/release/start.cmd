@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
if not exist "config\server.toml" copy "config\server.example.toml" "config\server.toml" >nul
echo Research Canvas
echo 打开 http://127.0.0.1:8787
echo 停止服务：Ctrl+C
research-canvas.exe
set "RC_EXIT=%ERRORLEVEL%"
if not "%RC_EXIT%"=="0" pause
exit /b %RC_EXIT%
