@echo off
chcp 65001 > nul
title Desplegar ERP BC Refaccionarias - Servidor 6060
cd /d "%~dp0"
echo ========================================================
echo   DESPLIEGUE LIMPIO ERP BC REFACCIONARIAS (PUERTO 6060)
echo   Modo: Binarios Nativos Protegidos C (.pyd)
echo ========================================================
echo.

echo [1/4] Deteniendo proceso previo en puerto 6060...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":6060" ^| findstr "LISTENING"') do taskkill /f /pid %%a 2>nul
timeout /t 2 /nobreak > nul

echo.
echo [2/4] Limpiando archivos antiguos y descargando rama 'production'...
git fetch origin production
git checkout -f production
git reset --hard origin/production
git clean -fd

echo.
echo [3/4] Verificando dependencias de Python 3.12...
py -3.12 -m pip install -r requirements.txt 2>nul || python -m pip install -r requirements.txt

echo.
echo [4/4] Configurando arranque automatico 24/7 e iniciando...
call instalar_arranque_automatico.bat

echo.
echo ========================================================
echo   ✅ ¡SISTEMA PUBLICADO Y LISTO EN PUERTO 6060!
echo   Acceso en red: http://192.168.1.253:6060
echo ========================================================
echo.
pause

