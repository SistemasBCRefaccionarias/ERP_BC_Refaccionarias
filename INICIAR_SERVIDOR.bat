@echo off
chcp 65001 > nul
title ERP BC Refaccionarias - Servidor
cd /d "%~dp0"
echo ========================================================
echo   ERP BC REFACCIONARIAS - SERVIDOR CENTRAL
echo   Modo: Producción (Binarios Compilados C)
echo ========================================================
echo.
python server.py 5000
pause
