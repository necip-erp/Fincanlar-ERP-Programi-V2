@echo off
title Fincanlar ERP - Sunucuyu Durdur
echo Fincanlar ERP yerel sunucu durduruluyor...
rem 1) Once yeniden baslatma dongusunu (BASLAT.bat) kapat, yoksa sunucuyu tekrar acar
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -like '*BASLAT.bat*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
rem 2) Sonra sunucunun kendisini kapat
taskkill /f /im node.exe >nul 2>nul
echo.
echo Sunucu durduruldu. Tekrar acmak icin BASLAT-GIZLI.vbs dosyasina cift tiklayin.
pause
