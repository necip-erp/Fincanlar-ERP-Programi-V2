@echo off
chcp 65001 >nul
title Fincanlar ERP - Hizli Kurulum Paketi Hazirla
cd /d "%~dp0"
set "NODE=node"
if exist "%~dp0..\node\node.exe" set "NODE=%~dp0..\node\node.exe"
if "%NODE%"=="node" (
  where node >nul 2>&1
  if errorlevel 1 (
    echo HATA: node bulunamadi. Bu betik SATIS bilgisayarinda, sunucu klasorundeki yedek-kurulum klasorunden calistirilmalidir.
    pause
    exit /b 1
  )
)
"%NODE%" paket-hazirla.js %*
echo.
pause
