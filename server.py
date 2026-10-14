import os
import sys
import time
import socket
import threading
import subprocess

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
LOG_FILE = os.path.join(BASE_DIR, "servidor_perpetuo.log")

# Si no hay terminal interactivo conectado (ej. bajo pythonw o arranque automático de Windows)
is_interactive = hasattr(sys.stdout, 'isatty') and sys.stdout.isatty() if sys.stdout else False
if not is_interactive:
    try:
        log_fd = open(LOG_FILE, "a", encoding="utf-8", buffering=1)
        sys.stdout = log_fd
        sys.stderr = log_fd
    except Exception:
        pass

from app import create_app

app = create_app()

if __name__ == '__main__':
    def obtener_ip_local():
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect(("8.8.8.8", 80))
            ip = s.getsockname()[0]
            s.close()
            return ip
        except Exception:
            return "192.168.1.12"

    port = int(os.environ.get("PORT", os.environ.get("ERP_PORT", sys.argv[1] if len(sys.argv) > 1 and sys.argv[1].isdigit() else 6060)))
    ip_actual = obtener_ip_local()
    print("==================================================")
    print(" ERP BC Refaccionarias - Servidor Central Modular")
    print(" Módulos: Tablero | Ventas | Compras | Almacén | Administración")
    print(" Motor WSGI de Producción Multi-hilo: Waitress")
    print(f" Localhost: http://localhost:{port}")
    print(f" Acceso Red: http://{ip_actual}:{port}")
    print("==================================================")
    def is_port_in_use(p=port):
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.settimeout(1)
                return s.connect_ex(('127.0.0.1', p)) == 0
        except Exception:
            return False

    if is_port_in_use(port):
        print(f"El servidor ya está en ejecución en el puerto {port}. Omitiendo proceso duplicado.")
        sys.exit(0)

    # Bucle de persistencia perpetua: auto-recuperable ante cualquier fallo o desconexión
    while True:
        try:
            from waitress import serve
            print(f"Servidor Waitress Iniciado en http://0.0.0.0:{port} (8 hilos concurrentes)...")
            serve(app, host='0.0.0.0', port=port, threads=8)
        except Exception as e:
            print(f"Aviso en Waitress: {e}. Reintentando arranque en 3 segundos...")
            time.sleep(3)