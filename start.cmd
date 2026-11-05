@echo off
setlocal EnableExtensions
chcp 65001 >nul

set "DIR=%ProgramFiles%\VirtualBrowser"
set "EXE=%DIR%\VirtualBrowser.Runtime.exe"
set "APP=%DIR%\resources\app"

if not exist "%EXE%" set "EXE=%DIR%\VirtualBrowser.exe"

if not exist "%EXE%" (
  echo [VirtualBrowser] 找不到已安装程序:
  echo         %DIR%
  echo         这个仓库不是完整桌面端，需要安装目录里的 VirtualBrowser。
  pause
  exit /b 1
)

if not exist "%APP%\dist\app\app.js" (
  echo [VirtualBrowser] 安装目录没有接到本仓库:
  echo         %APP%
  echo         需要 resources\app 指向本仓库的 _asar_extract。
  pause
  exit /b 1
)

echo [VirtualBrowser] 启动 %EXE%
start "" "%EXE%"
exit /b 0
