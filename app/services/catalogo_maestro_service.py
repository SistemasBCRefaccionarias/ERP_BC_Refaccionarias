import os
import sqlite3
from app.config import BASE_DIR
from app.db import conectar_db

DB_CATALOGO_MAESTRO = os.path.join(BASE_DIR, "catalogo_maestro.db")

def conectar_sqlite_cm():
    conn = sqlite3.connect(DB_CATALOGO_MAESTRO, timeout=15)
    conn.row_factory = sqlite3.Row
    return conn

def init_catalogo_maestro_db():
    conn = conectar_sqlite_cm()
    cur = conn.cursor()
    
    cur.execute("""
        CREATE TABLE IF NOT EXISTS cm_categorias (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nombre TEXT NOT NULL UNIQUE COLLATE NOCASE,
            descripcion TEXT,
            activo INTEGER DEFAULT 1,
            orden INTEGER DEFAULT 0,
            fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    
    cur.execute("""
        CREATE TABLE IF NOT EXISTS cm_lineas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            categoria_id INTEGER,
            nombre TEXT NOT NULL COLLATE NOCASE,
            descripcion TEXT,
            activo INTEGER DEFAULT 1,
            orden INTEGER DEFAULT 0,
            fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (categoria_id) REFERENCES cm_categorias(id) ON DELETE SET NULL
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS cm_sublineas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            linea_id INTEGER,
            nombre TEXT NOT NULL COLLATE NOCASE,
            descripcion TEXT,
            activo INTEGER DEFAULT 1,
            orden INTEGER DEFAULT 0,
            fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (linea_id) REFERENCES cm_lineas(id) ON DELETE SET NULL
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS cm_marcas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nombre TEXT NOT NULL UNIQUE COLLATE NOCASE,
            descripcion TEXT,
            activo INTEGER DEFAULT 1,
            orden INTEGER DEFAULT 0,
            fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS cm_articulos (
            articulo_id INTEGER PRIMARY KEY,
            categoria_id INTEGER,
            linea_id INTEGER,
            sublinea_id INTEGER,
            marca_id INTEGER,
            multiplo INTEGER DEFAULT 1,
            multiplo_compra INTEGER DEFAULT 1,
            equivalencia_custom TEXT,
            notas TEXT,
            fecha_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    cur.execute("CREATE INDEX IF NOT EXISTS idx_cm_lineas_cat ON cm_lineas(categoria_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_cm_sublineas_lin ON cm_sublineas(linea_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_cm_art_cat ON cm_articulos(categoria_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_cm_art_lin ON cm_articulos(linea_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_cm_art_marca ON cm_articulos(marca_id)")

    conn.commit()
    conn.close()

# Inicialización al cargar el módulo
init_catalogo_maestro_db()

# =========================================================================
# CRUD: CATEGORÍAS, LÍNEAS, SUBLÍNEAS, MARCAS
# =========================================================================

def obtener_opciones_clasificacion():
    conn = conectar_sqlite_cm()
    cur = conn.cursor()
    
    cur.execute("SELECT id, nombre, descripcion, activo, orden FROM cm_categorias WHERE activo = 1 ORDER BY nombre ASC")
    categorias = [dict(r) for r in cur.fetchall()]

    cur.execute("""
        SELECT l.id, l.categoria_id, l.nombre, l.descripcion, l.activo, l.orden, c.nombre as categoria_nombre 
        FROM cm_lineas l
        LEFT JOIN cm_categorias c ON c.id = l.categoria_id
        WHERE l.activo = 1 
        ORDER BY l.nombre ASC
    """)
    lineas = [dict(r) for r in cur.fetchall()]

    cur.execute("""
        SELECT s.id, s.linea_id, s.nombre, s.descripcion, s.activo, s.orden, l.nombre as linea_nombre
        FROM cm_sublineas s
        LEFT JOIN cm_lineas l ON l.id = s.linea_id
        WHERE s.activo = 1 
        ORDER BY s.nombre ASC
    """)
    sublineas = [dict(r) for r in cur.fetchall()]

    cur.execute("SELECT id, nombre, descripcion, activo, orden FROM cm_marcas WHERE activo = 1 ORDER BY nombre ASC")
    marcas = [dict(r) for r in cur.fetchall()]

    conn.close()
    return {
        "categorias": categorias,
        "lineas": lineas,
        "sublineas": sublineas,
        "marcas": marcas
    }

# --- Categorías ---
def crear_categoria(nombre, descripcion=""):
    nombre = (nombre or "").strip()
    if not nombre:
        raise ValueError("El nombre de la categoría es obligatorio")
    conn = conectar_sqlite_cm()
    cur = conn.cursor()
    cur.execute("INSERT INTO cm_categorias (nombre, descripcion) VALUES (?, ?)", (nombre, (descripcion or "").strip()))
    cat_id = cur.lastrowid
    conn.commit()
    conn.close()
    return {"id": cat_id, "nombre": nombre, "descripcion": descripcion}

def actualizar_categoria(cat_id, nombre, descripcion=""):
    nombre = (nombre or "").strip()
    if not nombre:
        raise ValueError("El nombre de la categoría es obligatorio")
    conn = conectar_sqlite_cm()
    cur = conn.cursor()
    cur.execute("UPDATE cm_categorias SET nombre = ?, descripcion = ? WHERE id = ?", (nombre, (descripcion or "").strip(), cat_id))
    conn.commit()
    conn.close()
    return {"id": cat_id, "nombre": nombre, "descripcion": descripcion}

def eliminar_categoria(cat_id):
    conn = conectar_sqlite_cm()
    cur = conn.cursor()
    cur.execute("DELETE FROM cm_categorias WHERE id = ?", (cat_id,))
    cur.execute("UPDATE cm_lineas SET categoria_id = NULL WHERE categoria_id = ?", (cat_id,))
    cur.execute("UPDATE cm_articulos SET categoria_id = NULL WHERE categoria_id = ?", (cat_id,))
    conn.commit()
    conn.close()
    return True

# --- Líneas ---
def crear_linea(nombre, categoria_id=None, descripcion=""):
    nombre = (nombre or "").strip()
    if not nombre:
        raise ValueError("El nombre de la línea es obligatorio")
    conn = conectar_sqlite_cm()
    cur = conn.cursor()
    cur.execute("INSERT INTO cm_lineas (nombre, categoria_id, descripcion) VALUES (?, ?, ?)", 
                (nombre, categoria_id if categoria_id else None, (descripcion or "").strip()))
    linea_id = cur.lastrowid
    conn.commit()
    conn.close()
    return {"id": linea_id, "nombre": nombre, "categoria_id": categoria_id}

def actualizar_linea(linea_id, nombre, categoria_id=None, descripcion=""):
    nombre = (nombre or "").strip()
    if not nombre:
        raise ValueError("El nombre de la línea es obligatorio")
    conn = conectar_sqlite_cm()
    cur = conn.cursor()
    cur.execute("UPDATE cm_lineas SET nombre = ?, categoria_id = ?, descripcion = ? WHERE id = ?", 
                (nombre, categoria_id if categoria_id else None, (descripcion or "").strip(), linea_id))
    conn.commit()
    conn.close()
    return {"id": linea_id, "nombre": nombre, "categoria_id": categoria_id}

def eliminar_linea(linea_id):
    conn = conectar_sqlite_cm()
    cur = conn.cursor()
    cur.execute("DELETE FROM cm_lineas WHERE id = ?", (linea_id,))
    cur.execute("UPDATE cm_sublineas SET linea_id = NULL WHERE linea_id = ?", (linea_id,))
    cur.execute("UPDATE cm_articulos SET linea_id = NULL WHERE linea_id = ?", (linea_id,))
    conn.commit()
    conn.close()
    return True

# --- Sublíneas ---
def crear_sublinea(nombre, linea_id=None, descripcion=""):
    nombre = (nombre or "").strip()
    if not nombre:
        raise ValueError("El nombre de la sublínea es obligatorio")
    conn = conectar_sqlite_cm()
    cur = conn.cursor()
    cur.execute("INSERT INTO cm_sublineas (nombre, linea_id, descripcion) VALUES (?, ?, ?)", 
                (nombre, linea_id if linea_id else None, (descripcion or "").strip()))
    sub_id = cur.lastrowid
    conn.commit()
    conn.close()
    return {"id": sub_id, "nombre": nombre, "linea_id": linea_id}

def actualizar_sublinea(sub_id, nombre, linea_id=None, descripcion=""):
    nombre = (nombre or "").strip()
    if not nombre:
        raise ValueError("El nombre de la sublínea es obligatorio")
    conn = conectar_sqlite_cm()
    cur = conn.cursor()
    cur.execute("UPDATE cm_sublineas SET nombre = ?, linea_id = ?, descripcion = ? WHERE id = ?", 
                (nombre, linea_id if linea_id else None, (descripcion or "").strip(), sub_id))
    conn.commit()
    conn.close()
    return {"id": sub_id, "nombre": nombre, "linea_id": linea_id}

def eliminar_sublinea(sub_id):
    conn = conectar_sqlite_cm()
    cur = conn.cursor()
    cur.execute("DELETE FROM cm_sublineas WHERE id = ?", (sub_id,))
    cur.execute("UPDATE cm_articulos SET sublinea_id = NULL WHERE sublinea_id = ?", (sub_id,))
    conn.commit()
    conn.close()
    return True

# --- Marcas ---
def crear_marca(nombre, descripcion=""):
    nombre = (nombre or "").strip()
    if not nombre:
        raise ValueError("El nombre de la marca es obligatorio")
    conn = conectar_sqlite_cm()
    cur = conn.cursor()
    cur.execute("INSERT INTO cm_marcas (nombre, descripcion) VALUES (?, ?)", (nombre, (descripcion or "").strip()))
    marca_id = cur.lastrowid
    conn.commit()
    conn.close()
    return {"id": marca_id, "nombre": nombre}

def actualizar_marca(marca_id, nombre, descripcion=""):
    nombre = (nombre or "").strip()
    if not nombre:
        raise ValueError("El nombre de la marca es obligatorio")
    conn = conectar_sqlite_cm()
    cur = conn.cursor()
    cur.execute("UPDATE cm_marcas SET nombre = ?, descripcion = ? WHERE id = ?", (nombre, (descripcion or "").strip(), marca_id))
    conn.commit()
    conn.close()
    return {"id": marca_id, "nombre": nombre}

def eliminar_marca(marca_id):
    conn = conectar_sqlite_cm()
    cur = conn.cursor()
    cur.execute("DELETE FROM cm_marcas WHERE id = ?", (marca_id,))
    cur.execute("UPDATE cm_articulos SET marca_id = NULL WHERE marca_id = ?", (marca_id,))
    conn.commit()
    conn.close()
    return True

# =========================================================================
# MAPA DE EMBLEMAS DE SUCURSALES Y CLASIFICACIONES DE MICROSIP
# =========================================================================

SUCURSALES_EMBLEMAS = [
    {"emblema": "SA", "nombre": "Sucursal Saulo", "almacen_id": 166719, "col_clasif": "C_SAULO_S"},
    {"emblema": "AE", "nombre": "Sucursal Aeropuerto", "almacen_id": 1423447, "col_clasif": "C_AEROPUERTO_S"},
    {"emblema": "AG", "nombre": "Sucursal Artes Gráficas", "almacen_id": 1147933, "col_clasif": "C_ARTESG_S"},
    {"emblema": "BR", "nombre": "Sucursal Bravo", "almacen_id": 99934, "col_clasif": "C_BRAVO_S"},
    {"emblema": "CD", "nombre": "Sucursal Cárdenas", "almacen_id": 1629323, "col_clasif": "C_CARDENAS_S"},
    {"emblema": "DV", "nombre": "Sucursal División", "almacen_id": 412880, "col_clasif": "C_DIVISION_S"},
    {"emblema": "FC", "nombre": "Sucursal Fco. I. Madero", "almacen_id": 1473736, "col_clasif": "C_FCOIMADERO_S"},
    {"emblema": "GO", "nombre": "Sucursal Gómez Hidalgo", "almacen_id": 1800730, "col_clasif": "C_GHIDALGO_S"},
    {"emblema": "MA", "nombre": "Sucursal Matamoros", "almacen_id": 1820837, "col_clasif": "C_MATAMOROS_S"},
    {"emblema": "NA", "nombre": "Sucursal Nazas", "almacen_id": 1254317, "col_clasif": "C_NAZAS_S"},
    {"emblema": "RV", "nombre": "Sucursal Revolución", "almacen_id": 158254, "col_clasif": "C_REVOLUCION_S"},
    {"emblema": "TJ", "nombre": "Sucursal Tajito", "almacen_id": 202797, "col_clasif": "C_TAJITO_S"},
    {"emblema": "GD", "nombre": "Alm Go Guadalupe", "almacen_id": 2168433, "col_clasif": "C_ALMGOGPE_S"},
    {"emblema": "CE", "nombre": "CEDIS Matriz", "almacen_id": 620110, "col_clasif": "C_CEDIS_S"},
]

def obtener_clasificaciones_sucursales(art_id, cur_fb):
    """
    Lee de LIBRES_ARTICULOS las clasificaciones vigentes de cada sucursal
    y las retorna formateadas por su emblema representativo (SA, AE, etc.).
    """
    res = []
    try:
        cur_fb.execute("SELECT * FROM LIBRES_ARTICULOS WHERE ARTICULO_ID = ?", (art_id,))
        row = cur_fb.fetchone()
        row_dict = {}
        if row:
            cols = [d[0].upper() for d in cur_fb.description]
            row_dict = {col: str(val).strip() for col, val in zip(cols, row) if val is not None}

        for suc in SUCURSALES_EMBLEMAS:
            col = suc["col_clasif"].upper()
            clasif = row_dict.get(col, "N/A") or "N/A"
            res.append({
                "emblema": suc["emblema"],
                "nombre": suc["nombre"],
                "almacen_id": suc["almacen_id"],
                "clasificacion": clasif.strip() if clasif else "N/A"
            })
    except Exception as e:
        print("Aviso al obtener clasificaciones de sucursales:", e)
        for suc in SUCURSALES_EMBLEMAS:
            res.append({
                "emblema": suc["emblema"],
                "nombre": suc["nombre"],
                "almacen_id": suc["almacen_id"],
                "clasificacion": "N/A"
            })
    return res

# =========================================================================
# GESTIÓN Y LISTADO DE ARTÍCULOS EN CATÁLOGO MAESTRO
# =========================================================================

def listar_articulos_maestro(busqueda="", categoria_id=None, linea_id=None, sublinea_id=None, marca_id=None, pagina=1, limite=50):
    """
    Retorna la lista de artículos combinando Firebird (Clave, Nombre, Unidad)
    con las asignaciones de Catálogo Maestro en SQLite.
    """
    pagina = max(1, int(pagina or 1))
    limite = max(10, min(200, int(limite or 50)))
    offset = (pagina - 1) * limite

    conn_cm = conectar_sqlite_cm()
    cur_cm = conn_cm.cursor()

    # Mapeo de artículos maestro
    cur_cm.execute("""
        SELECT 
            cm.articulo_id,
            cm.categoria_id, c.nombre as categoria_nombre,
            cm.linea_id, l.nombre as linea_nombre,
            cm.sublinea_id, s.nombre as sublinea_nombre,
            cm.marca_id, m.nombre as marca_nombre,
            cm.multiplo, cm.multiplo_compra, cm.notas
        FROM cm_articulos cm
        LEFT JOIN cm_categorias c ON c.id = cm.categoria_id
        LEFT JOIN cm_lineas l ON l.id = cm.linea_id
        LEFT JOIN cm_sublineas s ON s.id = cm.sublinea_id
        LEFT JOIN cm_marcas m ON m.id = cm.marca_id
    """)
    art_cm_map = {}
    for r in cur_cm.fetchall():
        art_cm_map[int(r["articulo_id"])] = dict(r)

    conn_fb = conectar_db()
    cur_fb = conn_fb.cursor()

    busq_clean = (busqueda or "").strip().upper()
    where_clauses = ["ar.ESTATUS = 'A'"]
    params = []

    # Excluir bonificaciones y chatarra
    where_clauses.append("(UPPER(ar.NOMBRE) NOT LIKE '%BONIFICAC%' AND ar.LINEA_ARTICULO_ID NOT IN (847057, 842886, 150854))")

    if busq_clean:
        where_clauses.append("(UPPER(ca.CLAVE_ARTICULO) LIKE ? OR UPPER(ar.NOMBRE) LIKE ?)")
        params.extend([f"%{busq_clean}%", f"%{busq_clean}%"])

    where_sql = " AND ".join(where_clauses)

    query_count = f"""
        SELECT COUNT(DISTINCT ar.ARTICULO_ID)
        FROM ARTICULOS ar
        JOIN CLAVES_ARTICULOS ca ON ca.ARTICULO_ID = ar.ARTICULO_ID AND ca.ROL_CLAVE_ART_ID = 17
        WHERE {where_sql}
    """
    cur_fb.execute(query_count, params)
    total_total = cur_fb.fetchone()[0] or 0

    query_arts = f"""
        SELECT 
            ar.ARTICULO_ID,
            TRIM(ca.CLAVE_ARTICULO) AS CLAVE,
            TRIM(ar.NOMBRE) AS NOMBRE,
            TRIM(ar.UNIDAD_VENTA) AS UNIDAD,
            la.EQUIVALENCIA1,
            la.MULTIPLO,
            la.MULTIPLO_COMPRA
        FROM ARTICULOS ar
        JOIN CLAVES_ARTICULOS ca ON ca.ARTICULO_ID = ar.ARTICULO_ID AND ca.ROL_CLAVE_ART_ID = 17
        LEFT JOIN LIBRES_ARTICULOS la ON la.ARTICULO_ID = ar.ARTICULO_ID
        WHERE {where_sql}
        ORDER BY ca.CLAVE_ARTICULO ASC
    """
    cur_fb.execute(query_arts, params)
    rows_all = cur_fb.fetchall()

    articulos_filtrados = []
    for r in rows_all:
        a_id = int(r[0])
        cm_info = art_cm_map.get(a_id, {})

        # Aplicar filtros de Catálogo Maestro si se enviaron
        if categoria_id and str(cm_info.get("categoria_id") or "") != str(categoria_id):
            continue
        if linea_id and str(cm_info.get("linea_id") or "") != str(linea_id):
            continue
        if sublinea_id and str(cm_info.get("sublinea_id") or "") != str(sublinea_id):
            continue
        if marca_id and str(cm_info.get("marca_id") or "") != str(marca_id):
            continue

        multiplo_calc = cm_info.get("multiplo") or (int(r[5]) if r[5] else 1)
        multiplo_c_calc = cm_info.get("multiplo_compra") or (int(r[6]) if r[6] else 1)

        articulos_filtrados.append({
            "articulo_id": a_id,
            "clave": r[1] or "",
            "nombre": r[2] or "",
            "unidad": r[3] or "PZA",
            "equivalencia": (r[4] or "").strip(),
            "multiplo": multiplo_calc,
            "multiplo_compra": multiplo_c_calc,
            "categoria_id": cm_info.get("categoria_id"),
            "categoria_nombre": cm_info.get("categoria_nombre") or "-- Sin categoría --",
            "linea_id": cm_info.get("linea_id"),
            "linea_nombre": cm_info.get("linea_nombre") or "-- Sin línea --",
            "sublinea_id": cm_info.get("sublinea_id"),
            "sublinea_nombre": cm_info.get("sublinea_nombre") or "-- Sin sublínea --",
            "marca_id": cm_info.get("marca_id"),
            "marca_nombre": cm_info.get("marca_nombre") or "-- Sin marca --",
            "notas": cm_info.get("notas") or ""
        })

    total_filtrados = len(articulos_filtrados)
    items_pagina = articulos_filtrados[offset:offset + limite]

    conn_fb.close()
    conn_cm.close()

    total_paginas = (total_filtrados + limite - 1) // limite if limite > 0 else 1

    return {
        "items": items_pagina,
        "total": total_filtrados,
        "total_global": total_total,
        "pagina": pagina,
        "limite": limite,
        "total_paginas": total_paginas
    }

def obtener_detalle_articulo_maestro(art_id):
    """
    Obtiene el detalle completo de un artículo:
    - Información básica de Firebird.
    - Claves y códigos alternos.
    - Clasificaciones de cada sucursal por emblema (SA, AE, etc.).
    - Asignación actual en Catálogo Maestro (Categoría, Línea, Sublínea, Marca, Múltiplos).
    """
    art_id = int(art_id)
    conn_fb = conectar_db()
    cur_fb = conn_fb.cursor()

    cur_fb.execute("""
        SELECT 
            ar.ARTICULO_ID,
            TRIM(ca.CLAVE_ARTICULO) AS CLAVE,
            TRIM(ar.NOMBRE) AS NOMBRE,
            TRIM(ar.UNIDAD_VENTA) AS UNIDAD,
            la.EQUIVALENCIA1,
            la.MULTIPLO,
            la.MULTIPLO_COMPRA
        FROM ARTICULOS ar
        JOIN CLAVES_ARTICULOS ca ON ca.ARTICULO_ID = ar.ARTICULO_ID AND ca.ROL_CLAVE_ART_ID = 17
        LEFT JOIN LIBRES_ARTICULOS la ON la.ARTICULO_ID = ar.ARTICULO_ID
        WHERE ar.ARTICULO_ID = ?
    """, (art_id,))
    row_fb = cur_fb.fetchone()
    if not row_fb:
        conn_fb.close()
        raise ValueError("Artículo no encontrado en la base de datos")

    # Claves alternas y códigos de barras
    cur_fb.execute("""
        SELECT TRIM(CLAVE_ARTICULO), ROL_CLAVE_ART_ID
        FROM CLAVES_ARTICULOS
        WHERE ARTICULO_ID = ? AND ROL_CLAVE_ART_ID <> 17
        ORDER BY CLAVE_ARTICULO ASC
    """, (art_id,))
    claves_alternas = [{"clave": r[0], "rol": r[1]} for r in cur_fb.fetchall()]

    # Clasificaciones por sucursal con emblemas
    clasificaciones_sucursales = obtener_clasificaciones_sucursales(art_id, cur_fb)

    # Equivalencias de este artículo (si tiene clave o grupo equivalente en EQUIVALENCIA1)
    equiv_code = (row_fb[4] or "").strip()
    articulos_equivalentes = []
    if equiv_code:
        cur_fb.execute("""
            SELECT 
                ar.ARTICULO_ID,
                TRIM(ca.CLAVE_ARTICULO) AS CLAVE,
                TRIM(ar.NOMBRE) AS NOMBRE,
                la.EQUIVALENCIA1
            FROM ARTICULOS ar
            JOIN CLAVES_ARTICULOS ca ON ca.ARTICULO_ID = ar.ARTICULO_ID AND ca.ROL_CLAVE_ART_ID = 17
            JOIN LIBRES_ARTICULOS la ON la.ARTICULO_ID = ar.ARTICULO_ID
            WHERE la.EQUIVALENCIA1 = ? AND ar.ARTICULO_ID <> ? AND ar.ESTATUS = 'A'
            ORDER BY ca.CLAVE_ARTICULO ASC
        """, (equiv_code, art_id))
        for r_eq in cur_fb.fetchall():
            articulos_equivalentes.append({
                "articulo_id": int(r_eq[0]),
                "clave": r_eq[1],
                "nombre": r_eq[2],
                "equivalencia": r_eq[3]
            })

    conn_fb.close()

    # Datos en SQLite Catálogo Maestro
    conn_cm = conectar_sqlite_cm()
    cur_cm = conn_cm.cursor()
    cur_cm.execute("SELECT * FROM cm_articulos WHERE articulo_id = ?", (art_id,))
    row_cm = cur_cm.fetchone()
    cm_dict = dict(row_cm) if row_cm else {}
    conn_cm.close()

    multiplo_val = cm_dict.get("multiplo") or (int(row_fb[5]) if row_fb[5] else 1)
    multiplo_compra_val = cm_dict.get("multiplo_compra") or (int(row_fb[6]) if row_fb[6] else 1)

    return {
        "articulo_id": art_id,
        "clave": row_fb[1] or "",
        "nombre": row_fb[2] or "",
        "unidad": row_fb[3] or "PZA",
        "equivalencia": equiv_code,
        "multiplo": multiplo_val,
        "multiplo_compra": multiplo_compra_val,
        "categoria_id": cm_dict.get("categoria_id"),
        "linea_id": cm_dict.get("linea_id"),
        "sublinea_id": cm_dict.get("sublinea_id"),
        "marca_id": cm_dict.get("marca_id"),
        "notas": cm_dict.get("notas") or "",
        "claves_alternas": claves_alternas,
        "clasificaciones_sucursales": clasificaciones_sucursales,
        "articulos_equivalentes": articulos_equivalentes
    }

def guardar_articulo_maestro(art_id, data):
    """
    Guarda la asignación de Categoría, Línea, Sublínea, Marca y Múltiplos
    en SQLite y actualiza MULTIPLO y EQUIVALENCIA1 en Firebird si se modificaron.
    """
    art_id = int(art_id)
    cat_id = data.get("categoria_id")
    lin_id = data.get("linea_id")
    sub_id = data.get("sublinea_id")
    mar_id = data.get("marca_id")
    multiplo = int(data.get("multiplo", 1) or 1)
    multiplo_c = int(data.get("multiplo_compra", 1) or 1)
    equiv = (data.get("equivalencia") or "").strip()
    notas = (data.get("notas") or "").strip()

    conn_cm = conectar_sqlite_cm()
    cur_cm = conn_cm.cursor()
    cur_cm.execute("""
        INSERT INTO cm_articulos (articulo_id, categoria_id, linea_id, sublinea_id, marca_id, multiplo, multiplo_compra, equivalencia_custom, notas, fecha_actualizacion)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(articulo_id) DO UPDATE SET
            categoria_id = excluded.categoria_id,
            linea_id = excluded.linea_id,
            sublinea_id = excluded.sublinea_id,
            marca_id = excluded.marca_id,
            multiplo = excluded.multiplo,
            multiplo_compra = excluded.multiplo_compra,
            equivalencia_custom = excluded.equivalencia_custom,
            notas = excluded.notas,
            fecha_actualizacion = CURRENT_TIMESTAMP
    """, (art_id, cat_id if cat_id else None, lin_id if lin_id else None, 
          sub_id if sub_id else None, mar_id if mar_id else None, 
          multiplo, multiplo_c, equiv, notas))
    conn_cm.commit()
    conn_cm.close()

    # Opcional: Sincronizar en Firebird MULTIPLO y EQUIVALENCIA1 en LIBRES_ARTICULOS
    try:
        conn_fb = conectar_db()
        cur_fb = conn_fb.cursor()
        cur_fb.execute("SELECT ARTICULO_ID FROM LIBRES_ARTICULOS WHERE ARTICULO_ID = ?", (art_id,))
        existe_la = cur_fb.fetchone()
        if existe_la:
            cur_fb.execute("""
                UPDATE LIBRES_ARTICULOS 
                SET MULTIPLO = ?, MULTIPLO_COMPRA = ?, EQUIVALENCIA1 = ?
                WHERE ARTICULO_ID = ?
            """, (multiplo, multiplo_c, equiv if equiv else None, art_id))
        else:
            cur_fb.execute("""
                INSERT INTO LIBRES_ARTICULOS (ARTICULO_ID, MULTIPLO, MULTIPLO_COMPRA, EQUIVALENCIA1)
                VALUES (?, ?, ?, ?)
            """, (art_id, multiplo, multiplo_c, equiv if equiv else None))
        conn_fb.commit()
        conn_fb.close()
    except Exception as e_fb:
        print("Aviso al sincronizar MULTIPLO/EQUIVALENCIA1 en Firebird:", e_fb)

    return {"success": True, "articulo_id": art_id}

