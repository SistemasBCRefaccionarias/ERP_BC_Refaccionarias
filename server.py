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

# Cargar credenciales locales si existen y configurar entorno
for _ruta_creds in [
    os.path.join(BASE_DIR, ".microsip_conn.json"),
    os.path.join(BASE_DIR, "app", ".microsip_conn.json"),
    r"C:\app\.microsip_conn.json",
]:
    if os.path.exists(_ruta_creds):
        try:
            import json
            with open(_ruta_creds, "r", encoding="utf-8") as _f:
                _d = json.load(_f)
            if _d.get("pwd") and not os.environ.get("MICROSIP_PWD"):
                os.environ["MICROSIP_PWD"] = _d["pwd"]
            if _d.get("uid") and not os.environ.get("MICROSIP_UID"):
                os.environ["MICROSIP_UID"] = _d["uid"]
            if _d.get("server") and not os.environ.get("MICROSIP_SERVER"):
                os.environ["MICROSIP_SERVER"] = _d["server"]
        except Exception:
            pass

os.environ.setdefault("MICROSIP_UID", "SYSDBA")
os.environ.setdefault("MICROSIP_PWD", "bc6580.1")
os.environ.setdefault("MICROSIP_SERVER", "192.168.1.127")
os.environ.setdefault("ERP_BASE_DIR", BASE_DIR)

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

    # Si es el servidor central (192.168.1.253), abre a toda la red (0.0.0.0)
    # En cualquier otra máquina (tu PC local Z840), escucha ÚNICAMENTE en 127.0.0.1 (privado/bloqueado a la red)
    host = os.environ.get("ERP_HOST")
    if not host:
        host = "0.0.0.0" if ip_actual == "192.168.1.253" else "127.0.0.1"

    print("==================================================")
    if host == "127.0.0.1":
        print(" ERP BC Refaccionarias - Modo Local Privado")
        print(" Acceso a la red: BLOQUEADO (Solo accesible desde esta PC)")
        print(f" Tu enlace exclusivo: http://localhost:{port}")
    else:
        print(" ERP BC Refaccionarias - Servidor Central de Producción")
        print(f" Localhost: http://localhost:{port}")
        print(f" Acceso Red: http://{ip_actual}:{port}")
    print(" Motor WSGI: Waitress (8 hilos concurrentes)")
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
            print(f"Servidor Waitress Iniciado en http://{host}:{port}...")
            serve(app, host=host, port=port, threads=8)
        except Exception as e:
            print(f"Aviso en Waitress: {e}. Reintentando arranque en 3 segundos...")
            time.sleep(3)