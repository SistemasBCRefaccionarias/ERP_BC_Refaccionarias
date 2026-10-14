@echo off
chcp 65001 > nul
title Configurar Arranque Automatico - ERP BC Refaccionarias
cd /d "%~dp0"
echo ========================================================
echo   CONFIGURACION DE ARRANQUE AUTOMATICO 24/7 (WINDOWS)
echo ========================================================
echo.
echo Este script creará una tarea programada para que el servidor
echo inicie automáticamente cuando el equipo encienda o reinicie.
echo.

:: Verificar permisos de administrador
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [AVISO] Se requieren permisos de Administrador para registrar la tarea.
    echo Haz clic derecho sobre este archivo y selecciona "Ejecutar como administrador".
    echo.
    pause
    exit /b 1
)

set SCRIPT_PATH=%~dp0iniciar_silencioso.vbs
set TASK_NAME=ERP_BC_Servidor_Perpetuo

echo Registrando tarea programada: %TASK_NAME%...
schtasks /create /tn "%TASK_NAME%" /tr "wscript.exe \"%SCRIPT_PATH%\"" /sc onstart /ru SYSTEM /f

if %errorlevel% equ 0 (
    echo.
    echo ========================================================
    echo   ✅ ¡ARRANQUE AUTOMATICO CONFIGURADO CON EXITO!
    echo   El servidor iniciará solo en cada reinicio del equipo.
    echo ========================================================
) else (
    echo.
    echo [ADVERTENCIA] No se pudo crear la tarea de sistema.
    echo Creando acceso directo en la carpeta Inicio de Windows como alternativa...
    copy "%SCRIPT_PATH%" "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\" >nul
    echo Listo, se iniciará al iniciar sesión de usuario.
)

echo.
echo Iniciando el servidor en este momento...
wscript.exe "%SCRIPT_PATH%"
echo.
echo El servidor ya está corriendo en segundo plano.
timeout /t 5

