@echo off
chcp 65001 > nul
title Actualizar ERP BC Refaccionarias
cd /d "%~dp0"
echo ========================================================
echo   ACTUALIZANDO ERP BC REFACCIONARIAS (PRODUCCION)
echo ========================================================
echo.
echo [1/3] Deteniendo servidor en segundo plano...
taskkill /f /im pythonw.exe 2>nul
taskkill /f /im python.exe /fi "WINDOWTITLE eq ERP_BC_PROD*" 2>nul
timeout /t 2 /nobreak > nul
echo.
echo [2/3] Descargando última versión compilada desde GitHub...
git pull origin production
if %errorlevel% neq 0 (
    echo.
    echo ❌ ERROR: No se pudo descargar la actualización desde GitHub.
    echo Revisa tu conexión a internet o tus credenciales de Git.
    pause
    exit /b 1
)
echo.
echo [3/3] Reiniciando servidor en segundo plano...
wscript.exe "%~dp0iniciar_silencioso.vbs"
echo.
echo ========================================================
echo   ✅ ¡SISTEMA ACTUALIZADO Y EN EJECUCIÓN!
echo   Accede desde cualquier PC de la red en:
echo   http://192.168.1.253:6060
echo ========================================================
echo.
timeout /t 5

