@echo off
chcp 65001 >nul
title Fincanlar ERP - Hizli Kurulum
setlocal
set "PAKET=%~dp0"

net session >nul 2>&1
if errorlevel 1 (
  echo Yonetici izni isteniyor, acilan pencerede "Evet" deyin...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

set "NODE=%PAKET%node\node.exe"
if not exist "%NODE%" (
  where node >nul 2>&1
  if errorlevel 1 (
    echo HATA: node bulunamadi. Pakette node\node.exe olmali.
    echo Paket eksik kopyalanmis olabilir; flash'taki HIZLI-KURULUM klasorunun tamamini kopyalayin.
    pause
    exit /b 1
  )
  set "NODE=node"
)

"%NODE%" "%PAKET%kur\kur.js"
echo.
pause
