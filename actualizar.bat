@echo off
chcp 65001 > nul
title Actualizar ERP BC Refaccionarias
cd /d "%~dp0"
echo ========================================================
echo   ACTUALIZANDO ERP BC REFACCIONARIAS (PRODUCCION)
echo ========================================================
echo.
echo [1/3] Deteniendo servidor en puerto 6060...
taskkill /F /IM python.exe /IM pythonw.exe 2>nul
powershell -Command "$p = Get-NetTCPConnection -LocalPort 6060 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique; if ($p) { Stop-Process -Id $p -Force -ErrorAction SilentlyContinue }"
echo.
echo [2/3] Descargando última versión compilada desde GitHub...
where git >nul 2>&1
if %errorlevel% equ 0 (
    git pull origin main 2>nul || git pull origin production
) else (
    echo   (Git no detectado, descargando paquete mediante PowerShell...)
    powershell -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://github.com/SistemasBCRefaccionarias/ERP_BC_Refaccionarias/archive/refs/heads/main.zip' -OutFile '%~dp0update.zip' -UseBasicParsing; Expand-Archive -Path '%~dp0update.zip' -DestinationPath '%~dp0temp_update' -Force; Copy-Item '%~dp0temp_update\ERP_BC_Refaccionarias-main\*' '%~dp0' -Recurse -Force; Remove-Item '%~dp0update.zip','%~dp0temp_update' -Recurse -Force -ErrorAction SilentlyContinue"
)
echo.
echo [3/3] Reiniciando servidor en segundo plano...
powershell -Command "$pyw = (py -3.12 -c 'import sys; print(sys.executable.replace(\"python.exe\", \"pythonw.exe\"))' 2>$null); if (-not $pyw) { $pyw = 'pythonw.exe' }; Start-Process $pyw -ArgumentList 'server.py 6060' -WorkingDirectory '%~dp0' -WindowStyle Hidden"
echo.
echo ========================================================
echo   ✅ ¡SISTEMA ACTUALIZADO Y EN EJECUCIÓN!
echo   Accede desde cualquier PC de la red en:
echo   http://192.168.1.253:6060
echo ========================================================
echo.
timeout /t 5

