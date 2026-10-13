@echo off
title Transtrade Buyer List Backup

set "APP_DIR=D:\transtrade office agent\buyer list software\transtrade-customer-database-main\transtrade-customer-database-main"
set "EXPORT_DIR=E:\TTI DOCS\buyer list by APP"

echo.
echo Transtrade Buyer List Backup
echo ----------------------------
echo App folder: %APP_DIR%
echo Backup folder: %EXPORT_DIR%
echo.

if not exist "%APP_DIR%" (
  echo ERROR: App folder was not found.
  echo Please check the APP_DIR path inside this file.
  pause
  exit /b 1
)

mkdir "%EXPORT_DIR%" 2>nul

cd /d "%APP_DIR%"

powershell -NoProfile -ExecutionPolicy Bypass -Command "$envPath='.env'; $line='SERVER_EXPORT_DIR=E:\TTI DOCS\buyer list by APP'; if (Test-Path $envPath) { $content=Get-Content $envPath; if ($content -match '^SERVER_EXPORT_DIR=') { $content = $content -replace '^SERVER_EXPORT_DIR=.*', $line } else { $content += $line }; Set-Content -Path $envPath -Value $content } else { Set-Content -Path $envPath -Value $line }"

echo.
echo Running live website export now...
echo.
npm run export:live-buyer-app

echo.
echo Done. Check this folder:
echo %EXPORT_DIR%
echo.
pause
