import os
from flask import Flask
from flask_cors import CORS

from app.config import BASE_DIR
from app.db import init_sqlite

from app.routes.main_routes import main_bp
from app.routes.auth_routes import auth_bp
from app.routes.catalogos_routes import catalogos_bp, registrar_limpiador_cache_almacenes
from app.routes.compras_routes import compras_bp
from app.routes.ciosa_routes import ciosa_bp
from app.routes.traspasos_routes import traspasos_bp
from app.routes.almacen_routes import almacen_bp, limpiar_cache_almacenes
from app.routes.resurtidos_routes import resurtidos_bp
from app.routes.dashboard_routes import dashboard_bp
from app.routes.ventas_routes import ventas_bp
from app.routes.administracion_routes import administracion_bp
from app.routes.pv_routes import pv_bp
from app.routes.bot_admin_routes import bot_admin_bp
from app.routes.vendedores_routes import vendedores_bp
from app.routes.cascos_routes import cascos_bp
from app.routes.embarques_routes import embarques_bp
from app.routes.nominas_routes import nominas_bp
from app.routes.facturacion_routes import facturacion_bp

def _obtener_secret_key():
    env_secret = os.environ.get("FLASK_SECRET_KEY")
    if env_secret and len(env_secret) >= 32:
        return env_secret
    secret_file = os.path.join(BASE_DIR, ".flask_secret")
    if os.path.exists(secret_file):
        try:
            with open(secret_file, "r") as f:
                key = f.read().strip()
                if len(key) >= 32:
                    return key
        except:
            pass
    import secrets
    new_key = secrets.token_hex(32)
    try:
        with open(secret_file, "w") as f:
            f.write(new_key)
    except:
        pass
    return new_key

def create_app():
    static_dir = os.path.join(BASE_DIR, 'static')
    os.makedirs(static_dir, exist_ok=True)
    os.makedirs(os.path.join(static_dir, 'js'), exist_ok=True)
    os.makedirs(os.path.join(static_dir, 'css'), exist_ok=True)

    app = Flask(
        __name__,
        static_folder=static_dir,
        static_url_path='/static'
    )
    # Clave secreta criptográfica persistente y segura
    app.secret_key = _obtener_secret_key()
    import datetime
    app.config['SESSION_COOKIE_HTTPONLY'] = True
    app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
    app.config['PERMANENT_SESSION_LIFETIME'] = datetime.timedelta(hours=12)

    CORS(app, resources={r"/api/*": {"origins": "*"}})

    # Inicializar base de datos de usuarios SQLite
    init_sqlite()

    # Enlazar limpiador de caché entre catálogo de empresas y almacenes
    registrar_limpiador_cache_almacenes(limpiar_cache_almacenes)

    # Registrar todos los Blueprints modulares
    app.register_blueprint(main_bp)
    app.register_blueprint(dashboard_bp)
    app.register_blueprint(ventas_bp)
    app.register_blueprint(auth_bp)
    app.register_blueprint(catalogos_bp)
    app.register_blueprint(compras_bp)
    app.register_blueprint(ciosa_bp)
    app.register_blueprint(traspasos_bp)
    app.register_blueprint(almacen_bp)
    app.register_blueprint(resurtidos_bp)
    app.register_blueprint(administracion_bp)
    app.register_blueprint(pv_bp)
    app.register_blueprint(bot_admin_bp)
    app.register_blueprint(vendedores_bp)
    app.register_blueprint(cascos_bp)
    app.register_blueprint(embarques_bp)
    app.register_blueprint(nominas_bp)
    app.register_blueprint(facturacion_bp)

    @app.before_request
    def verificar_seguridad_api():
        from flask import request, session, jsonify
        # Rutas de la API que requieren autenticación estricta
        if request.path.startswith('/api/'):
            # Rutas públicas indispensables para el flujo de login, facturación de clientes y app móvil
            rutas_publicas = [
                '/api/login',
                '/api/logout',
                '/api/session',
                '/api/empresas',
                '/api/config/menu-modulos'
            ]
            rutas_prefijo_publico = [
                '/api/empresas',
                '/api/logo',
                '/api/articulos/foto',
                '/api/facturacion',
                '/api/embarques/sucursal/recibir',
                '/api/embarques/escanear-mensajero'
            ]
            if request.path not in rutas_publicas and not any(request.path.startswith(r) for r in rutas_prefijo_publico):
                if 'usuario' not in session:
                    return jsonify({
                        "success": False,
                        "error": "Acceso no autorizado. Sesión expirada o no iniciada.",
                        "authenticated": False
                    }), 401

                # Control de Acceso Basado en Roles (RBAC) a nivel API
                rutas_solo_admin = [
                    '/api/usuarios',
                    '/api/admin/reiniciar-servicio',
                    '/api/config/empresas',
                    '/api/config/empresas/sincronizar-microsip'
                ]
                if any(request.path.startswith(r) for r in rutas_solo_admin):
                    rol = session.get('rol', '')
                    permisos = session.get('permisos', [])
                    if rol != 'ADMIN' and '*' not in permisos and 'configuracion' not in permisos:
                        return jsonify({
                            "success": False,
                            "error": "Acceso denegado. Se requiere rol de Administrador para realizar esta acción.",
                            "authenticated": True
                        }), 403

    @app.after_request
    def add_header(response):
        # Cabeceras de blindaje de seguridad HTTP
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['X-Frame-Options'] = 'SAMEORIGIN'
        response.headers['X-XSS-Protection'] = '1; mode=block'
        response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'

        # Compresión GZIP transparente para acelerar descargas en un 85%
        from flask import request
        accept_encoding = request.headers.get('Accept-Encoding', '')
        if (
            'gzip' in accept_encoding
            and response.status_code == 200
            and not response.direct_passthrough
            and response.headers.get('Content-Encoding') is None
        ):
            c_type = response.headers.get('Content-Type', '')
            if any(t in c_type for t in ['text/html', 'application/json', 'text/css', 'application/javascript', 'text/javascript']):
                data = response.get_data()
                if len(data) > 500:
                    import gzip
                    compressed = gzip.compress(data)
                    response.set_data(compressed)
                    response.headers['Content-Encoding'] = 'gzip'
                    response.headers['Content-Length'] = len(compressed)

        if request_is_static(response):
            if any(t in response.headers.get('Content-Type', '') for t in ['javascript', 'css']):
                response.headers['Cache-Control'] = 'public, max-age=86400, must-revalidate'
            else:
                response.headers['Cache-Control'] = 'public, max-age=86400'
        return response

    # Iniciar precarga de tablas intermedias en segundo plano para que el sistema esté caliente
    try:
        from app.services.cache_service import iniciar_warmup_tablas_intermedias
        iniciar_warmup_tablas_intermedias()
    except Exception as e:
        print("[AVISO] No se pudo iniciar warmup de cache:", e)

    return app

def request_is_static(response):
    content_type = response.headers.get('Content-Type', '')
    return any(t in content_type for t in ['javascript', 'css', 'image/', 'font/'])
