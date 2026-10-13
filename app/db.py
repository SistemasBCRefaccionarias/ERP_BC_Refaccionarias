import sqlite3
import pyodbc
import hashlib
import datetime
from app.config import SQLITE_DB, get_current_dsn, conn_string_microsip

def init_sqlite():
    conn = sqlite3.connect(SQLITE_DB)
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS usuarios (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            usuario TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            nombre TEXT NOT NULL,
            rol TEXT DEFAULT 'ADMIN',
            permisos TEXT DEFAULT '["*"]',
            activo INTEGER DEFAULT 1,
            creado_en TEXT DEFAULT '',
            ultimo_login TEXT DEFAULT ''
        )
    """)
    cur.execute("PRAGMA table_info(usuarios)")
    cols = [row[1] for row in cur.fetchall()]
    if 'permisos' not in cols:
        cur.execute("ALTER TABLE usuarios ADD COLUMN permisos TEXT DEFAULT '[\"*\"]'")
    if 'activo' not in cols:
        cur.execute("ALTER TABLE usuarios ADD COLUMN activo INTEGER DEFAULT 1")
    if 'creado_en' not in cols:
        cur.execute("ALTER TABLE usuarios ADD COLUMN creado_en TEXT DEFAULT ''")
    if 'ultimo_login' not in cols:
        cur.execute("ALTER TABLE usuarios ADD COLUMN ultimo_login TEXT DEFAULT ''")
    if 'sucursal_id' not in cols:
        cur.execute("ALTER TABLE usuarios ADD COLUMN sucursal_id INTEGER DEFAULT NULL")
    if 'sucursal_nombre' not in cols:
        cur.execute("ALTER TABLE usuarios ADD COLUMN sucursal_nombre TEXT DEFAULT ''")
    if 'vendedor_id' not in cols:
        cur.execute("ALTER TABLE usuarios ADD COLUMN vendedor_id INTEGER DEFAULT NULL")
    if 'vendedor_nombre' not in cols:
        cur.execute("ALTER TABLE usuarios ADD COLUMN vendedor_nombre TEXT DEFAULT ''")

    cur.execute("SELECT id, permisos FROM usuarios WHERE LOWER(usuario) = 'admin'")
    admin_row = cur.fetchone()
    if not admin_row:
        from werkzeug.security import generate_password_hash
        pwd_hash = generate_password_hash("admin123")
        cur.execute(
            "INSERT INTO usuarios (usuario, password_hash, nombre, rol, permisos, activo, creado_en) VALUES (?, ?, ?, ?, ?, ?, ?)",
            ('admin', pwd_hash, 'Administrador General', 'ADMIN', '["*"]', 1, datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
        )
    else:
        cur.execute("UPDATE usuarios SET rol = 'ADMIN', permisos = '[\"*\"]', activo = 1 WHERE id = ?", (admin_row[0],))

    cur.execute("SELECT id FROM usuarios WHERE LOWER(usuario) = 'jcmartinez'")
    jc_row = cur.fetchone()
    if not jc_row:
        from werkzeug.security import generate_password_hash
        pwd_hash_jc = generate_password_hash("Sudowoodo.1701")
        cur.execute(
            "INSERT INTO usuarios (usuario, password_hash, nombre, rol, permisos, activo, creado_en) VALUES (?, ?, ?, ?, ?, ?, ?)",
            ('JCMartinez', pwd_hash_jc, 'JC Martínez', 'ADMIN', '["*"]', 1, datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
        )
    else:
        cur.execute("UPDATE usuarios SET rol = 'ADMIN', permisos = '[\"*\"]', activo = 1 WHERE id = ?", (jc_row[0],))

    # Tabla de solicitudes de traspaso desde Punto de Venta hacia CEDIS para validación de Compras
    cur.execute("""
        CREATE TABLE IF NOT EXISTS solicitudes_traspasos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            folio TEXT UNIQUE NOT NULL,
            fecha_solicitud TEXT NOT NULL,
            sucursal_origen_id INTEGER DEFAULT 620110,
            sucursal_origen_nombre TEXT DEFAULT 'CEDIS',
            sucursal_destino_id INTEGER NOT NULL,
            sucursal_destino_nombre TEXT NOT NULL,
            articulo_id INTEGER NOT NULL,
            clave TEXT NOT NULL,
            nombre TEXT NOT NULL,
            cantidad REAL NOT NULL,
            stock_cedis_al_solicitar REAL DEFAULT 0,
            stock_local_al_solicitar REAL DEFAULT 0,
            cliente_nombre TEXT DEFAULT '',
            notas TEXT DEFAULT '',
            usuario_solicita TEXT NOT NULL,
            vendedor_nombre TEXT DEFAULT '',
            estatus TEXT DEFAULT 'PENDIENTE_COMPRAS',
            usuario_autoriza TEXT DEFAULT '',
            fecha_autorizacion TEXT DEFAULT '',
            motivo_rechazo TEXT DEFAULT '',
            docto_in_id INTEGER DEFAULT NULL,
            folio_traspaso_generado TEXT DEFAULT ''
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_sol_traspasos_estatus ON solicitudes_traspasos(estatus)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_sol_traspasos_sucursal ON solicitudes_traspasos(sucursal_destino_id)")

    # Tablas intermedias de aceleración y alto rendimiento (BI / Dashboard / Sucursales)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS resumen_almacenes_cache (
            almacen_id INTEGER,
            empresa TEXT NOT NULL,
            nombre TEXT NOT NULL,
            tipo TEXT NOT NULL,
            piezas REAL DEFAULT 0,
            articulos INTEGER DEFAULT 0,
            es_cedis INTEGER DEFAULT 0,
            es_sucursal INTEGER DEFAULT 0,
            costo_existencia REAL DEFAULT 0,
            venta_hoy REAL DEFAULT 0,
            venta_promedio_diaria REAL DEFAULT 0,
            dias_activos INTEGER DEFAULT 0,
            porcentaje_red REAL DEFAULT 0,
            actualizado_en TEXT NOT NULL,
            PRIMARY KEY (almacen_id, empresa)
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_cache_alm_emp ON resumen_almacenes_cache(empresa, es_sucursal)")

    cur.execute("""
        CREATE TABLE IF NOT EXISTS cache_metricas_globales (
            clave TEXT,
            empresa TEXT NOT NULL,
            valor_json TEXT NOT NULL,
            actualizado_en TEXT NOT NULL,
            PRIMARY KEY (clave, empresa)
        )
    """)

    # Tabla de registro de asistencia / reloj checador (Módulo de Nóminas)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS reloj_checadas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            fecha TEXT NOT NULL,
            hora TEXT NOT NULL,
            tipo TEXT NOT NULL,
            colaborador_id TEXT DEFAULT '',
            colaborador_nombre TEXT NOT NULL,
            sucursal_id INTEGER DEFAULT NULL,
            sucursal_nombre TEXT DEFAULT '',
            notas TEXT DEFAULT '',
            creado_en TEXT NOT NULL,
            usuario_registro TEXT DEFAULT ''
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_reloj_fecha ON reloj_checadas(fecha)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_reloj_colaborador ON reloj_checadas(colaborador_nombre)")

    # Tabla de Ventas Perdidas para Compras (Demanda no satisfecha en mostrador)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS ventas_perdidas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            fecha TEXT NOT NULL,
            sucursal_id INTEGER DEFAULT NULL,
            sucursal_nombre TEXT DEFAULT '',
            vendedor_id INTEGER DEFAULT NULL,
            vendedor_nombre TEXT DEFAULT '',
            cliente_nombre TEXT DEFAULT '',
            clave_articulo TEXT NOT NULL,
            articulo_nombre TEXT DEFAULT '',
            cantidad REAL DEFAULT 1,
            precio_estimado REAL DEFAULT 0,
            motivo TEXT NOT NULL,
            notas TEXT DEFAULT '',
            estatus_compras TEXT DEFAULT 'PENDIENTE'
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_vp_fecha ON ventas_perdidas(fecha)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_vp_clave ON ventas_perdidas(clave_articulo)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_vp_estatus ON ventas_perdidas(estatus_compras)")

    # Tabla de Configuración de Visibilidad de Sucursales y Vendedores en el Sistema
    cur.execute("""
        CREATE TABLE IF NOT EXISTS config_visibilidad (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            empresa TEXT NOT NULL DEFAULT 'BC',
            tipo TEXT NOT NULL,
            entidad_id INTEGER NOT NULL,
            nombre TEXT NOT NULL DEFAULT '',
            visible INTEGER NOT NULL DEFAULT 1,
            modificado_en TEXT DEFAULT '',
            UNIQUE(empresa, tipo, entidad_id)
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_cfg_visib ON config_visibilidad(empresa, tipo)")

    conn.commit()
    conn.close()

def obtener_visibilidad_dict(tipo, empresa='BC'):
    """Retorna un dict {entidad_id: bool_visible} para el tipo ('SUCURSAL' o 'VENDEDOR')"""
    conn = conectar_sqlite()
    cur = conn.cursor()
    emp = str(empresa or 'BC').strip().upper()
    emp_key = 'RT' if ('RT' in emp or 'TOMMY' in emp) else 'BC'
    cur.execute("SELECT entidad_id, visible FROM config_visibilidad WHERE empresa = ? AND tipo = ?", (emp_key, tipo.upper()))
    res = {row[0]: bool(row[1]) for row in cur.fetchall()}
    conn.close()
    return res

def guardar_visibilidad_item(tipo, entidad_id, visible, nombre='', empresa='BC'):
    conn = conectar_sqlite()
    cur = conn.cursor()
    emp = str(empresa or 'BC').strip().upper()
    emp_key = 'RT' if ('RT' in emp or 'TOMMY' in emp) else 'BC'
    ahora = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    cur.execute("""
        INSERT INTO config_visibilidad (empresa, tipo, entidad_id, nombre, visible, modificado_en)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(empresa, tipo, entidad_id) DO UPDATE SET
            visible = excluded.visible,
            nombre = CASE WHEN excluded.nombre != '' THEN excluded.nombre ELSE config_visibilidad.nombre END,
            modificado_en = excluded.modificado_en
    """, (emp_key, tipo.upper(), int(entidad_id), nombre, 1 if visible else 0, ahora))
    conn.commit()
    conn.close()

def conectar_sqlite():
    return sqlite3.connect(SQLITE_DB)

def get_connection_string(dsn=None):
    target = str(dsn or get_current_dsn() or "BATTERY CENTER").strip()
    if target.upper() in ('BC', 'BATTERY', 'BATTERY CENTER'):
        target = 'BATTERY CENTER'
    elif target.upper() in ('RT', 'BASESRTT'):
        target = 'RT'
    
    # 1. Buscar en la configuración de empresas
    try:
        from app.config import cargar_empresas_config
        empresas = cargar_empresas_config()
        emp_info = next((e for e in empresas if str(e.get("id")).upper() == str(target).upper() or str(e.get("nombre")).upper() == str(target).upper() or str(e.get("dsn", "")).upper() == str(target).upper()), None)
    except Exception:
        emp_info = None

    # Si tiene un DSN ODBC configurado (basesmp, basesrenoher, basesRTT)
    if emp_info and emp_info.get("dsn"):
        dsn_name = emp_info["dsn"]
        return conn_string_microsip(dsn=dsn_name)

    # Si tiene un archivo .FDB definido, conectarse directamente por el driver Firebird
    if emp_info and emp_info.get("archivo"):
        archivo = emp_info["archivo"]
        return conn_string_microsip(archivo=archivo)

    # Conexión directa por DSN si no se especificó archivo
    try:
        return conn_string_microsip(dsn=target)
    except Exception:
        return conn_string_microsip(dsn="basesmp")

def conectar_db(dsn=None):
    conn = pyodbc.connect(get_connection_string(dsn), timeout=10)
    conn.autocommit = False
    return conn

# Caché de catálogos consultados dentro de la sesión (por empresa)
_cache_precios_db = {}
_cache_precios_ttl = 300  # segundos

def resolver_listas_precios(conn):
    mapeo = {"publico": 42, "talleres": 67032, "mayoreo": 67031, "minimo": 43}
    key = get_current_dsn()
    now = datetime.datetime.now()
    hit = _cache_precios_db.get(key)
    if hit:
        datos, ts = hit
        if (now - ts).total_seconds() < _cache_precios_ttl:
            return dict(datos)
    try:
        cur = conn.cursor()
        cur.execute("SELECT PRECIO_EMPRESA_ID, UPPER(TRIM(NOMBRE)) FROM PRECIOS_EMPRESA")
        for p_id, p_nom in cur.fetchall():
            if "LISTA" in p_nom:
                mapeo["publico"] = int(p_id)
            elif "TALLER" in p_nom:
                mapeo["talleres"] = int(p_id)
            elif "MAYOREO" in p_nom:
                mapeo["mayoreo"] = int(p_id)
            elif "MINIMO" in p_nom or "MÍNIMO" in p_nom:
                mapeo["minimo"] = int(p_id)
        cur.close()
        _cache_precios_db[key] = (dict(mapeo), now)
    except Exception as e:
        print(f"Aviso: usando listas por defecto ({e})")
    return mapeo

def obtener_siguiente_id(cursor, generador, tabla, campo_id):
    try:
        cursor.execute(f"SELECT GEN_ID({generador}, 1) FROM RDB$DATABASE")
        r = cursor.fetchone()
        if r and r[0] is not None:
            return int(r[0])
    except:
        pass
    cursor.execute(f"SELECT COALESCE(MAX({campo_id}), 0) + 1 FROM {tabla}")
    return int(cursor.fetchone()[0])

def obtener_columnas_libres_articulos(cursor):
    try:
        cursor.execute("""
            SELECT TRIM(RDB$FIELD_NAME) 
            FROM RDB$RELATION_FIELDS 
            WHERE RDB$RELATION_NAME = 'LIBRES_ARTICULOS'
        """)
        return {str(row[0]).strip().upper() for row in cursor.fetchall() if row[0]}
    except Exception as e:
        print("Aviso al detectar columnas de LIBRES_ARTICULOS:", e)
        return set()

_cache_col_equiv = {}
_cache_col_equiv_ttl = 600  # segundos

def detectar_columna_equivalencia(cursor):
    key = get_current_dsn()
    now = datetime.datetime.now()
    hit = _cache_col_equiv.get(key)
    if hit:
        datos, ts = hit
        if (now - ts).total_seconds() < _cache_col_equiv_ttl:
            return datos
    cols = obtener_columnas_libres_articulos(cursor)
    resultado = None
    for col in ["EQUIVALENCIA1", "EQUIVALENCIA_1", "EQUIV1", "EQUIV_1"]:
        if col in cols:
            resultado = col
            break
    if not resultado:
        for col in cols:
            if "EQUIV" in col:
                resultado = col
                break
    if not resultado:
        resultado = "EQUIVALENCIA1" if "EQUIVALENCIA1" in cols else None
    _cache_col_equiv[key] = (resultado, now)
    return resultado
