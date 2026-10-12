import os
import sqlite3
import datetime
from flask import Blueprint, request, jsonify, session

from app.config import SQLITE_DB, EMPRESAS_DISPONIBLES, get_current_dsn
from app.db import conectar_db, conectar_sqlite
from app.services.pos_printer import (
    imprimir_etiqueta_td401,
    generar_etiqueta_tspl_bytes,
    generar_etiqueta_zpl_text,
    quitar_acentos
)

embarques_bp = Blueprint('embarques_bp', __name__)

MAPEO_SIGLAS_SUCURSALES = {
    'AEROPUERTO': 'AE', 'ARTES GRAFICAS': 'AG', 'ARTES GRÁFICAS': 'AG',
    'BRAVO': 'BR', 'CARDENAS': 'CA', 'CÁRDENAS': 'CA', 'DIVISION': 'DI',
    'DIVISIÓN': 'DI', 'FCO. I. MADERO': 'FM', 'FRANCISCO I. MADERO': 'FM',
    'GOMEZ HIDALGO': 'GH', 'GÓMEZ HIDALGO': 'GH', 'GOMEZ': 'GO', 'GÓMEZ': 'GO',
    'MATAMOROS': 'MA', 'NAZAS': 'NA', 'REVOLUCION': 'RE', 'REVOLUCIÓN': 'RE',
    'SAULO': 'SA', 'TAJITO': 'TA', 'VALDEZ': 'VA', 'CEDIS': 'CD',
    'DURANGO': 'DGO', 'GUADALUPE': 'GUA', 'GENERAL': 'AG'
}

def obtener_siglas_sucursal(nombre):
    if not nombre:
        return "SUC"
    import unicodedata, re
    t = unicodedata.normalize('NFKD', str(nombre)).encode('ascii', 'ignore').decode('ascii').upper()
    for k, v in MAPEO_SIGLAS_SUCURSALES.items():
        k_norm = unicodedata.normalize('NFKD', k).encode('ascii', 'ignore').decode('ascii').upper()
        if k_norm in t:
            return v
    t_limpio = re.sub(r'^(SUCURSAL|ALMACEN|ALM|DE|DEL|LA|EL)\s+', '', t).strip()
    words = t_limpio.split()
    if len(words) >= 2:
        return (words[0][0] + words[1][0]).upper()
    elif len(words) == 1 and len(words[0]) >= 2:
        return words[0][:2].upper()
    return t[:2].upper()


def init_embarques_db():
    conn = conectar_sqlite()
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS embarques (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            folio TEXT UNIQUE NOT NULL,
            empresa TEXT DEFAULT 'BC',
            tipo_origen TEXT DEFAULT 'TRASPASO',
            documento_referencia TEXT DEFAULT '',
            almacen_origen_id INTEGER DEFAULT 620110,
            almacen_origen_nombre TEXT DEFAULT 'CEDIS',
            almacen_destino_id INTEGER DEFAULT NULL,
            almacen_destino_nombre TEXT DEFAULT '',
            cliente_nombre TEXT DEFAULT '',
            estatus TEXT DEFAULT 'PREPARANDO',
            total_cajas INTEGER DEFAULT 0,
            total_piezas REAL DEFAULT 0,
            chofer_nombre TEXT DEFAULT '',
            creado_por TEXT DEFAULT '',
            creado_en TEXT DEFAULT '',
            recolectado_por TEXT DEFAULT '',
            recolectado_en TEXT DEFAULT '',
            recibido_por TEXT DEFAULT '',
            recibido_en TEXT DEFAULT '',
            notas TEXT DEFAULT ''
        )
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS embarque_cajas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            embarque_id INTEGER NOT NULL,
            folio_caja TEXT UNIQUE NOT NULL,
            numero_caja INTEGER NOT NULL,
            piezas_en_caja REAL DEFAULT 0,
            estatus TEXT DEFAULT 'EMPACADA',
            empacado_por TEXT DEFAULT '',
            empacado_en TEXT DEFAULT '',
            recolectado_por TEXT DEFAULT '',
            recolectado_en TEXT DEFAULT '',
            recibido_por TEXT DEFAULT '',
            recibido_en TEXT DEFAULT '',
            notas TEXT DEFAULT '',
            FOREIGN KEY (embarque_id) REFERENCES embarques(id) ON DELETE CASCADE
        )
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS embarque_caja_detalles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            caja_id INTEGER NOT NULL,
            embarque_id INTEGER NOT NULL,
            articulo_id INTEGER,
            clave TEXT NOT NULL,
            codigo_barras TEXT DEFAULT '',
            nombre TEXT NOT NULL,
            unidades REAL DEFAULT 1,
            FOREIGN KEY (caja_id) REFERENCES embarque_cajas(id) ON DELETE CASCADE
        )
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS embarque_tracking (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            embarque_id INTEGER NOT NULL,
            caja_id INTEGER DEFAULT NULL,
            folio_caja TEXT DEFAULT '',
            estatus TEXT NOT NULL,
            descripcion TEXT NOT NULL,
            usuario TEXT DEFAULT '',
            fecha_hora TEXT NOT NULL,
            FOREIGN KEY (embarque_id) REFERENCES embarques(id) ON DELETE CASCADE
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_emb_folio ON embarques(folio)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_emb_estatus ON embarques(estatus)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_emb_cajas_folio ON embarque_cajas(folio_caja)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_emb_cajas_embid ON embarque_cajas(embarque_id)")

    for tabla in ('embarques', 'embarque_cajas'):
        for col in ('firma_path', 'foto_path'):
            try:
                cur.execute(f"ALTER TABLE {tabla} ADD COLUMN {col} TEXT DEFAULT ''")
            except Exception:
                pass

    conn.commit()
    conn.close()

# Inicializar tablas al importar el módulo
init_embarques_db()

def _obtener_empresa_activa():
    try:
        dsn = get_current_dsn()
        if dsn:
            return str(dsn).strip().upper()
    except Exception:
        pass
    return 'BC'

def _empresa_filtro_sql(empresa, prefix=""):
    """
    Retorna clausula SQL y parámetros para soportar tanto 'BC'/'RT' como nombres largos.
    """
    col = f"{prefix}empresa" if prefix else "empresa"
    if not empresa:
        return "", []
    emp = str(empresa).strip().upper()
    if 'RT' in emp or 'TOMMY' in emp:
        return f"({col} = 'RT' OR UPPER({col}) LIKE '%RT%' OR UPPER({col}) LIKE '%TOMMY%')", []
    elif 'BC' in emp or 'BATTERY' in emp:
        return f"({col} = 'BC' OR UPPER({col}) LIKE '%BC%' OR UPPER({col}) LIKE '%BATTERY%')", []
    else:
        return f"({col} = ? OR UPPER({col}) LIKE ?)", [empresa, f"%{empresa}%"]

def _generar_siguiente_folio_embarque():
    conn = conectar_sqlite()
    cur = conn.cursor()
    cur.execute("SELECT folio FROM embarques ORDER BY id DESC LIMIT 1")
    row = cur.fetchone()
    conn.close()
    if row and row[0]:
        try:
            ultimo = str(row[0]).strip()
            # Si tiene números al final
            import re
            m = re.search(r'(\d+)$', ultimo)
            if m:
                num = int(m.group(1)) + 1
                return f"{num}"
        except Exception:
            pass
    return "10001"

def _registrar_tracking(conn, embarque_id, estatus, descripcion, usuario, caja_id=None, folio_caja=""):
    cur = conn.cursor()
    ahora = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    cur.execute("""
        INSERT INTO embarque_tracking (embarque_id, caja_id, folio_caja, estatus, descripcion, usuario, fecha_hora)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    """, (embarque_id, caja_id, folio_caja, estatus, descripcion, usuario, ahora))

# ================= RUTAS DE EMBARQUES =================

@embarques_bp.route('/api/embarques/dashboard', methods=['GET'])
def get_dashboard_embarques():
    conn = conectar_sqlite()
    cur = conn.cursor()
    
    empresa = request.args.get('empresa', '').strip()
    where_emp = ""
    params_emp = []
    if empresa:
        clausula, p = _empresa_filtro_sql(empresa)
        where_emp = f"WHERE {clausula}"
        params_emp.extend(p)

    cur.execute(f"""
        SELECT 
            SUM(CASE WHEN estatus = 'PREPARANDO' THEN 1 ELSE 0 END) AS preparando,
            SUM(CASE WHEN estatus = 'EN_TRANSITO' THEN 1 ELSE 0 END) AS en_transito,
            SUM(CASE WHEN estatus = 'RECIBIDO' THEN 1 ELSE 0 END) AS recibidos,
            COUNT(id) AS total_embarques,
            COALESCE(SUM(total_cajas), 0) AS total_cajas,
            COALESCE(SUM(total_piezas), 0) AS total_piezas
        FROM embarques
        {where_emp}
    """, params_emp)
    r = cur.fetchone()

    # Cajas activas hoy
    hoy_str = datetime.date.today().strftime("%Y-%m-%d")
    cur.execute("""
        SELECT COUNT(id) FROM embarque_cajas WHERE empacado_en LIKE ?
    """, (f"{hoy_str}%",))
    cajas_hoy = cur.fetchone()[0] or 0

    conn.close()
    return jsonify({
        "success": True,
        "kpis": {
            "preparando": int(r[0] or 0),
            "en_transito": int(r[1] or 0),
            "recibidos": int(r[2] or 0),
            "total_embarques": int(r[3] or 0),
            "total_cajas": int(r[4] or 0),
            "total_piezas": float(r[5] or 0),
            "cajas_hoy": cajas_hoy
        }
    })

@embarques_bp.route('/api/embarques/listar', methods=['GET'])
def listar_embarques():
    conn = conectar_sqlite()
    cur = conn.cursor()

    estatus = request.args.get('estatus', '').strip()
    sucursal_id = request.args.get('sucursal_id', '').strip()
    empresa = request.args.get('empresa', '').strip()
    q = request.args.get('q', '').strip().upper()

    filtros = []
    params = []
    if estatus:
        filtros.append("estatus = ?")
        params.append(estatus)
    if sucursal_id:
        filtros.append("almacen_destino_id = ?")
        params.append(int(sucursal_id))
    if empresa:
        clausula_emp, p_emp = _empresa_filtro_sql(empresa)
        filtros.append(clausula_emp)
        params.extend(p_emp)
    if q:
        filtros.append("(folio LIKE ? OR almacen_destino_nombre LIKE ? OR cliente_nombre LIKE ? OR documento_referencia LIKE ?)")
        term = f"%{q}%"
        params.extend([term, term, term, term])

    where = ("WHERE " + " AND ".join(filtros)) if filtros else ""

    cur.execute(f"""
        SELECT 
            id, folio, empresa, tipo_origen, documento_referencia,
            almacen_origen_id, almacen_origen_nombre,
            almacen_destino_id, almacen_destino_nombre, cliente_nombre,
            estatus, total_cajas, total_piezas, chofer_nombre,
            creado_por, creado_en, recolectado_por, recolectado_en,
            recibido_por, recibido_en, notas
        FROM embarques
        {where}
        ORDER BY id DESC
        LIMIT 200
    """, params)

    filas = []
    for r in cur.fetchall():
        filas.append({
            "id": r[0],
            "folio": r[1],
            "empresa": r[2],
            "tipo_origen": r[3],
            "documento_referencia": r[4],
            "almacen_origen_id": r[5],
            "almacen_origen_nombre": r[6],
            "almacen_destino_id": r[7],
            "almacen_destino_nombre": r[8],
            "cliente_nombre": r[9],
            "destino_texto": r[8] or r[9] or 'Destino no especificado',
            "estatus": r[10],
            "total_cajas": r[11],
            "total_piezas": float(r[12] or 0),
            "chofer_nombre": r[13],
            "creado_por": r[14],
            "creado_en": r[15],
            "recolectado_por": r[16],
            "recolectado_en": r[17],
            "recibido_por": r[18],
            "recibido_en": r[19],
            "notas": r[20]
        })

    conn.close()
    return jsonify({"success": True, "embarques": filas})

@embarques_bp.route('/api/embarques/detalle/<int:embarque_id>', methods=['GET'])
def detalle_embarque(embarque_id):
    conn = conectar_sqlite()
    cur = conn.cursor()

    cur.execute("""
        SELECT 
            id, folio, empresa, tipo_origen, documento_referencia,
            almacen_origen_id, almacen_origen_nombre,
            almacen_destino_id, almacen_destino_nombre, cliente_nombre,
            estatus, total_cajas, total_piezas, chofer_nombre,
            creado_por, creado_en, recolectado_por, recolectado_en,
            recibido_por, recibido_en, notas
        FROM embarques
        WHERE id = ?
    """, (embarque_id,))
    row = cur.fetchone()
    if not row:
        conn.close()
        return jsonify({"success": False, "error": "Embarque no encontrado"}), 404

    emb = {
        "id": row[0],
        "folio": row[1],
        "empresa": row[2],
        "tipo_origen": row[3],
        "documento_referencia": row[4],
        "almacen_origen_id": row[5],
        "almacen_origen_nombre": row[6],
        "almacen_destino_id": row[7],
        "almacen_destino_nombre": row[8],
        "cliente_nombre": row[9],
        "destino_texto": row[8] or row[9] or 'Destino no especificado',
        "estatus": row[10],
        "total_cajas": row[11],
        "total_piezas": float(row[12] or 0),
        "chofer_nombre": row[13],
        "creado_por": row[14],
        "creado_en": row[15],
        "recolectado_por": row[16],
        "recolectado_en": row[17],
        "recibido_por": row[18],
        "recibido_en": row[19],
        "notas": row[20]
    }

    # Cajas del embarque
    cur.execute("""
        SELECT 
            id, folio_caja, numero_caja, piezas_en_caja, estatus,
            empacado_por, empacado_en, recolectado_por, recolectado_en,
            recibido_por, recibido_en, notas,
            COALESCE(firma_path, ''), COALESCE(foto_path, '')
        FROM embarque_cajas
        WHERE embarque_id = ?
        ORDER BY numero_caja ASC
    """, (embarque_id,))
    cajas = []
    for c in cur.fetchall():
        caja_id = c[0]
        # Partidas de la caja
        cur.execute("""
            SELECT id, articulo_id, clave, codigo_barras, nombre, unidades
            FROM embarque_caja_detalles
            WHERE caja_id = ?
        """, (caja_id,))
        detalles = []
        for d in cur.fetchall():
            detalles.append({
                "id": d[0],
                "articulo_id": d[1],
                "clave": d[2],
                "codigo_barras": d[3],
                "nombre": d[4],
                "unidades": float(d[5] or 0)
            })

        cajas.append({
            "id": c[0],
            "folio_caja": c[1],
            "numero_caja": c[2],
            "piezas_en_caja": float(c[3] or 0),
            "estatus": c[4],
            "empacado_por": c[5],
            "empacado_en": c[6],
            "recolectado_por": c[7],
            "recolectado_en": c[8],
            "recibido_por": c[9],
            "recibido_en": c[10],
            "notas": c[11],
            "firma_path": c[12],
            "foto_path": c[13],
            "detalles": detalles
        })

    # Historial de tracking
    cur.execute("""
        SELECT id, caja_id, folio_caja, estatus, descripcion, usuario, fecha_hora
        FROM embarque_tracking
        WHERE embarque_id = ?
        ORDER BY id ASC
    """, (embarque_id,))
    tracking = []
    for t in cur.fetchall():
        tracking.append({
            "id": t[0],
            "caja_id": t[1],
            "folio_caja": t[2],
            "estatus": t[3],
            "descripcion": t[4],
            "usuario": t[5],
            "fecha_hora": t[6]
        })

    conn.close()
    return jsonify({
        "success": True,
        "embarque": emb,
        "cajas": cajas,
        "tracking": tracking
    })

@embarques_bp.route('/api/embarques/crear', methods=['POST'])
def crear_embarque():
    data = request.get_json() or {}
    usuario_actual = session.get('usuario') or session.get('nombre') or 'Admin'
    empresa_activa = _obtener_empresa_activa()

    folio = str(data.get('folio') or '').strip()
    if not folio:
        folio = _generar_siguiente_folio_embarque()

    tipo_origen = str(data.get('tipo_origen', 'TRASPASO')).strip().upper()
    doc_ref = str(data.get('documento_referencia', '')).strip()
    
    alm_orig_id = int(data.get('almacen_origen_id') or 620110)
    alm_orig_nom = str(data.get('almacen_origen_nombre', 'CEDIS')).strip()

    alm_dest_id = data.get('almacen_destino_id')
    alm_dest_nom = str(data.get('almacen_destino_nombre', '')).strip()
    cliente_nom = str(data.get('cliente_nombre', '')).strip()
    notas = str(data.get('notas', '')).strip()

    if not alm_dest_id and not cliente_nom and not alm_dest_nom:
        return jsonify({"success": False, "error": "Debe especificar una sucursal destino o cliente"}), 400

    ahora = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    conn = conectar_sqlite()
    cur = conn.cursor()
    try:
        cur.execute("""
            INSERT INTO embarques (
                folio, empresa, tipo_origen, documento_referencia,
                almacen_origen_id, almacen_origen_nombre,
                almacen_destino_id, almacen_destino_nombre, cliente_nombre,
                estatus, total_cajas, total_piezas,
                creado_por, creado_en, notas
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PREPARANDO', 0, 0, ?, ?, ?)
        """, (
            folio, empresa_activa, tipo_origen, doc_ref,
            alm_orig_id, alm_orig_nom,
            alm_dest_id, alm_dest_nom, cliente_nom,
            usuario_actual, ahora, notas
        ))
        emb_id = cur.lastrowid

        destino_desc = alm_dest_nom or cliente_nom
        _registrar_tracking(conn, emb_id, 'PREPARANDO', f"Embarque iniciado con destino a {destino_desc}", usuario_actual)
        conn.commit()
        conn.close()

        return jsonify({
            "success": True,
            "embarque_id": emb_id,
            "folio": folio,
            "mensaje": f"Embarque Folio {folio} creado exitosamente."
        })
    except sqlite3.IntegrityError:
        conn.close()
        # Si el folio ya existía, intentar con siguiente
        nuevo_folio = f"{folio}-A"
        return jsonify({"success": False, "error": f"El folio '{folio}' ya existe. Prueba con otro folio o genera el siguiente."}), 409
    except Exception as e:
        conn.close()
        return jsonify({"success": False, "error": str(e)}), 500

@embarques_bp.route('/api/embarques/eliminar/<int:embarque_id>', methods=['POST', 'DELETE'])
def eliminar_embarque(embarque_id):
    """
    Elimina un embarque en preparación o prueba y sus cajas/detalles asociados.
    """
    conn = conectar_sqlite()
    cur = conn.cursor()
    try:
        cur.execute("SELECT folio, estatus FROM embarques WHERE id = ?", (embarque_id,))
        row = cur.fetchone()
        if not row:
            conn.close()
            return jsonify({"success": False, "error": "Embarque no encontrado"}), 404

        folio_del = row[0]

        # Borrar detalles de cajas, cajas, tracking y embarque
        cur.execute("DELETE FROM embarque_caja_detalles WHERE caja_id IN (SELECT id FROM embarque_cajas WHERE embarque_id = ?)", (embarque_id,))
        cur.execute("DELETE FROM embarque_cajas WHERE embarque_id = ?", (embarque_id,))
        cur.execute("DELETE FROM embarque_tracking WHERE embarque_id = ?", (embarque_id,))
        cur.execute("DELETE FROM embarques WHERE id = ?", (embarque_id,))

        # Si ya no quedan embarques, resetear secuencia de SQLite
        cur.execute("SELECT count(*) FROM embarques")
        total_restantes = cur.fetchone()[0]
        if total_restantes == 0:
            cur.execute("DELETE FROM sqlite_sequence WHERE name IN ('embarques', 'embarque_cajas', 'embarque_caja_detalles', 'embarque_tracking')")

        conn.commit()
        conn.close()
        return jsonify({"success": True, "mensaje": f"Embarque #{folio_del} eliminado correctamente."})
    except Exception as e:
        conn.close()
        return jsonify({"success": False, "error": str(e)}), 500

@embarques_bp.route('/api/embarques/cerrar-caja', methods=['POST'])
def cerrar_caja():
    """
    Cierra una caja del embarque, genera su folio_caja (ej. 10003-1),
    guarda las partidas escaneadas y genera los datos de la etiqueta Zebra.
    """
    data = request.get_json() or {}
    usuario_actual = session.get('usuario') or session.get('nombre') or 'Admin'
    
    embarque_id = data.get('embarque_id')
    if not embarque_id:
        return jsonify({"success": False, "error": "Falta el ID del embarque"}), 400

    partidas = data.get('partidas', [])
    if not partidas:
        partidas = [{
            "articulo_id": None,
            "clave": "CAJA-EMB",
            "nombre": "MERCANCIA DE EMBARQUE",
            "codigo_barras": "CAJA-EMB",
            "unidades": 1
        }]


    conn = conectar_sqlite()
    cur = conn.cursor()

    cur.execute("SELECT folio, empresa, almacen_destino_nombre, cliente_nombre, total_cajas, total_piezas FROM embarques WHERE id = ?", (embarque_id,))
    row_emb = cur.fetchone()
    if not row_emb:
        conn.close()
        return jsonify({"success": False, "error": "Embarque no encontrado"}), 404

    folio_base = row_emb[0]
    empresa = row_emb[1] or 'BC'
    destino_nom = row_emb[2] or row_emb[3] or 'Destino'
    total_cajas_actual = int(row_emb[4] or 0)
    total_piezas_actual = float(row_emb[5] or 0)

    num_caja = total_cajas_actual + 1
    folio_caja = f"{folio_base}-{num_caja}"

    ahora = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    piezas_caja = sum(float(p.get('unidades') or 1) for p in partidas)

    try:
        cur.execute("""
            INSERT INTO embarque_cajas (
                embarque_id, folio_caja, numero_caja, piezas_en_caja,
                estatus, empacado_por, empacado_en, notas
            ) VALUES (?, ?, ?, ?, 'EMPACADA', ?, ?, ?)
        """, (embarque_id, folio_caja, num_caja, piezas_caja, usuario_actual, ahora, data.get('notas', '')))
        caja_id = cur.lastrowid

        for p in partidas:
            cur.execute("""
                INSERT INTO embarque_caja_detalles (
                    caja_id, embarque_id, articulo_id, clave, codigo_barras, nombre, unidades
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (
                caja_id, embarque_id,
                p.get('articulo_id'),
                str(p.get('clave', '')).strip().upper(),
                str(p.get('codigo_barras', '')).strip().upper(),
                str(p.get('nombre', '')).strip(),
                float(p.get('unidades') or 1)
            ))

        # Actualizar acumulado de embarque
        nuevo_total_cajas = num_caja
        nuevo_total_piezas = total_piezas_actual + piezas_caja
        cur.execute("""
            UPDATE embarques 
            SET total_cajas = ?, total_piezas = ?
            WHERE id = ?
        """, (nuevo_total_cajas, nuevo_total_piezas, embarque_id))

        _registrar_tracking(
            conn, embarque_id, 'PREPARANDO',
            f"Caja {folio_caja} empacada con {int(piezas_caja)} pieza(s)",
            usuario_actual, caja_id, folio_caja
        )

        conn.commit()
        conn.close()

        # Generar datos para la etiqueta TD-401 / Zebra
        siglas = obtener_siglas_sucursal(destino_nom)
        es_rt = 'RT' in empresa.upper()
        nombre_empresa = 'RT REFACCIONES' if es_rt else 'BATTERY CENTER'
        logo_tag = 'logo rt' if es_rt else 'logo bc'

        etiqueta_data = {
            "folio_caja": folio_caja,
            "folio_embarque": folio_base,
            "numero_caja": num_caja,
            "total_cajas": nuevo_total_cajas,
            "empresa": empresa,
            "nombre_empresa": nombre_empresa,
            "logo_tag": logo_tag,
            "sucursal_siglas": siglas,
            "origen": "CEDIS",
            "destino": destino_nom,
            "piezas": int(piezas_caja),
            "fecha_hora": ahora,
            "fecha_empaque": ahora,
            "operador": usuario_actual,
            "total_partidas": len(partidas),
            "detalles": [
                {"clave": str(p.get('clave', '')).strip().upper(), "nombre": str(p.get('nombre', '')).strip()}
                for p in partidas
            ],
            "resumen_articulos": [
                {"clave": str(p.get('clave', '')).strip().upper(), "nombre": str(p.get('nombre', ''))[:30].strip()}
                for p in partidas
            ]
        }
        etiqueta_data["zpl"] = generar_etiqueta_zpl_text(etiqueta_data)


        return jsonify({
            "success": True,
            "caja_id": caja_id,
            "folio_caja": folio_caja,
            "numero_caja": num_caja,
            "piezas_caja": piezas_caja,
            "total_cajas": nuevo_total_cajas,
            "etiqueta": etiqueta_data
        })
    except Exception as e:
        conn.rollback()
        conn.close()
        return jsonify({"success": False, "error": str(e)}), 500

@embarques_bp.route('/api/embarques/escanear-mensajero', methods=['POST'])
def escanear_mensajero():
    """
    El chofer o mensajero escanea cada caja (código de barras, ej. 10003-1)
    al subirla al camión. Cambia el estatus de la caja y del embarque a EN_TRANSITO.
    """
    data = request.get_json() or {}
    codigo_escaneado = str(data.get('codigo') or '').strip().upper()
    chofer = str(data.get('chofer') or session.get('nombre') or session.get('usuario') or 'Mensajero').strip()

    if not codigo_escaneado:
        return jsonify({"success": False, "error": "Escanea el código de barras de la caja"}), 400

    conn = conectar_sqlite()
    cur = conn.cursor()

    cur.execute("""
        SELECT c.id, c.embarque_id, c.folio_caja, c.numero_caja, c.estatus, e.folio, e.almacen_destino_nombre, e.cliente_nombre
        FROM embarque_cajas c
        JOIN embarques e ON e.id = c.embarque_id
        WHERE UPPER(c.folio_caja) = ?
    """, (codigo_escaneado,))
    row = cur.fetchone()

    if not row:
        conn.close()
        return jsonify({"success": False, "error": f"Caja con folio '{codigo_escaneado}' no encontrada"}), 404

    caja_id = row[0]
    emb_id = row[1]
    folio_caja = row[2]
    num_caja = row[3]
    estatus_previo = row[4]
    folio_emb = row[5]
    destino_nom = row[6] or row[7] or 'Destino'

    ahora = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    # Actualizar estatus de la caja
    cur.execute("""
        UPDATE embarque_cajas
        SET estatus = 'EN_TRANSITO', recolectado_por = ?, recolectado_en = ?
        WHERE id = ?
    """, (chofer, ahora, caja_id))

    # Actualizar estatus del embarque a EN_TRANSITO
    cur.execute("""
        UPDATE embarques
        SET estatus = 'EN_TRANSITO', chofer_nombre = ?, recolectado_por = ?, recolectado_en = ?
        WHERE id = ?
    """, (chofer, chofer, ahora, emb_id))

    _registrar_tracking(
        conn, emb_id, 'EN_TRANSITO',
        f"Caja {folio_caja} escaneada y subida al camión por {chofer}",
        chofer, caja_id, folio_caja
    )

    conn.commit()
    conn.close()

    return jsonify({
        "success": True,
        "folio_caja": folio_caja,
        "folio_embarque": folio_emb,
        "destino": destino_nom,
        "chofer": chofer,
        "estatus": "EN_TRANSITO",
        "mensaje": f"Caja {folio_caja} en camino hacia {destino_nom}."
    })

@embarques_bp.route('/api/embarques/sucursal/recibir', methods=['POST'])
def sucursal_recibir_caja():
    """
    La sucursal destino escanea la caja al recibirla (ej. 10003-1).
    Cambia el estatus de la caja a RECIBIDA. Si todas las cajas del embarque
    fueron recibidas, marca el embarque completo como RECIBIDO.
    """
    data = request.get_json() or {}
    codigo_escaneado = str(data.get('codigo') or '').strip().upper()
    usuario_recibe = str(session.get('nombre') or session.get('usuario') or 'Personal Sucursal').strip()
    user_suc_id = session.get('sucursal_id')
    rol = str(session.get('rol') or '').upper()

    if not codigo_escaneado:
        return jsonify({"success": False, "error": "Escanea el código de barras de la caja recibida"}), 400

    conn = conectar_sqlite()
    cur = conn.cursor()

    cur.execute("""
        SELECT c.id, c.embarque_id, c.folio_caja, c.numero_caja, c.estatus,
               e.folio, e.almacen_destino_id, e.almacen_destino_nombre, e.total_cajas
        FROM embarque_cajas c
        JOIN embarques e ON e.id = c.embarque_id
        WHERE UPPER(c.folio_caja) = ?
    """, (codigo_escaneado,))
    row = cur.fetchone()

    if not row:
        conn.close()
        return jsonify({"success": False, "error": f"Caja con folio '{codigo_escaneado}' no encontrada"}), 404

    caja_id = row[0]
    emb_id = row[1]
    folio_caja = row[2]
    num_caja = row[3]
    estatus_caja = row[4]
    folio_emb = row[5]
    dest_id = row[6]
    dest_nom = row[7] or 'Sucursal'
    total_cajas = row[8] or 1

    # Validación de sucursal si el usuario tiene asignada una específica y no es ADMIN
    if rol != 'ADMIN' and user_suc_id and dest_id and int(user_suc_id) != int(dest_id):
        conn.close()
        return jsonify({
            "success": False,
            "error": f"Esta caja pertenece a la sucursal '{dest_nom}'. Tu usuario está asignado a otra tienda."
        }), 403

    if estatus_caja == 'RECIBIDA':
        conn.close()
        return jsonify({
            "success": True,
            "ya_recibida": True,
            "folio_caja": folio_caja,
            "mensaje": f"La caja {folio_caja} ya había sido registrada como recibida previamente."
        })

    receptor_enviado = str(data.get('receptor') or '').strip()
    if receptor_enviado:
        usuario_recibe = receptor_enviado

    ahora = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    # Guardar firma digital táctil y fotografía de entrega si fueron proporcionadas
    firma_base64 = data.get('firma') or data.get('firma_base64') or ''
    foto_base64 = data.get('foto') or data.get('foto_base64') or ''
    firma_path = ''
    foto_path = ''

    upload_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'static', 'uploads', 'evidencias_entregas')
    os.makedirs(upload_dir, exist_ok=True)
    ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    clean_folio = folio_caja.replace('-', '_').replace(' ', '_')

    if firma_base64:
        try:
            import base64
            raw_b64 = firma_base64.split(',', 1)[1] if ',' in firma_base64 else firma_base64
            firma_filename = f"firma_{clean_folio}_{ts}.png"
            firma_full = os.path.join(upload_dir, firma_filename)
            with open(firma_full, 'wb') as f:
                f.write(base64.b64decode(raw_b64))
            firma_path = f"/static/uploads/evidencias_entregas/{firma_filename}"
        except Exception as err:
            print("Error guardando firma digital:", err)

    if foto_base64:
        try:
            import base64
            raw_b64 = foto_base64.split(',', 1)[1] if ',' in foto_base64 else foto_base64
            foto_filename = f"foto_{clean_folio}_{ts}.jpg"
            foto_full = os.path.join(upload_dir, foto_filename)
            with open(foto_full, 'wb') as f:
                f.write(base64.b64decode(raw_b64))
            foto_path = f"/static/uploads/evidencias_entregas/{foto_filename}"
        except Exception as err:
            print("Error guardando foto evidencia:", err)

    # Marcar caja recibida
    cur.execute("""
        UPDATE embarque_cajas
        SET estatus = 'RECIBIDA', recibido_por = ?, recibido_en = ?,
            firma_path = CASE WHEN ? <> '' THEN ? ELSE firma_path END,
            foto_path = CASE WHEN ? <> '' THEN ? ELSE foto_path END
        WHERE id = ?
    """, (usuario_recibe, ahora, firma_path, firma_path, foto_path, foto_path, caja_id))

    # Verificar si todas las cajas del embarque están ya recibidas
    cur.execute("""
        SELECT COUNT(id) FROM embarque_cajas 
        WHERE embarque_id = ? AND estatus <> 'RECIBIDA'
    """, (emb_id,))
    pendientes = cur.fetchone()[0] or 0

    embarque_completado = False
    if pendientes == 0:
        cur.execute("""
            UPDATE embarques
            SET estatus = 'RECIBIDO', recibido_por = ?, recibido_en = ?,
                firma_path = CASE WHEN ? <> '' THEN ? ELSE firma_path END,
                foto_path = CASE WHEN ? <> '' THEN ? ELSE foto_path END
            WHERE id = ?
        """, (usuario_recibe, ahora, firma_path, firma_path, foto_path, foto_path, emb_id))
        embarque_completado = True

    desc_tracking = f"Caja {folio_caja} recibida por {usuario_recibe}"
    if firma_path:
        desc_tracking += " [Firma capturada]"
    if foto_path:
        desc_tracking += " [Foto de evidencia tomada]"
    if embarque_completado:
        desc_tracking += " (Embarque completado al 100%)"

    _registrar_tracking(
        conn, emb_id, 'RECIBIDO' if embarque_completado else 'EN_TRANSITO',
        desc_tracking,
        usuario_recibe, caja_id, folio_caja
    )

    # Obtener artículos de la caja para confirmación visual
    cur.execute("""
        SELECT clave, nombre, unidades FROM embarque_caja_detalles WHERE caja_id = ?
    """, (caja_id,))
    detalles = [{"clave": d[0], "nombre": d[1], "unidades": float(d[2] or 0)} for d in cur.fetchall()]

    conn.commit()
    conn.close()

    return jsonify({
        "success": True,
        "folio_caja": folio_caja,
        "folio_embarque": folio_emb,
        "sucursal": dest_nom,
        "embarque_completado": embarque_completado,
        "firma_path": firma_path,
        "foto_path": foto_path,
        "detalles": detalles,
        "mensaje": f"Caja {folio_caja} recibida con éxito en {dest_nom}." + (" ¡Todo el embarque ha sido completado!" if embarque_completado else "")
    })

@embarques_bp.route('/api/embarques/sucursal/pendientes', methods=['GET'])
def sucursal_pendientes_embarque():
    """
    Lista cajas y pedidos que van en camino a la sucursal del usuario
    (o seleccionable para admin).
    """
    user_suc_id = session.get('sucursal_id')
    rol = str(session.get('rol') or '').upper()

    filtro_suc = request.args.get('sucursal_id')
    if not filtro_suc and rol != 'ADMIN' and user_suc_id:
        filtro_suc = user_suc_id

    conn = conectar_sqlite()
    cur = conn.cursor()

    where_clauses = ["c.estatus IN ('EMPACADA', 'EN_TRANSITO')"]
    params = []

    if filtro_suc:
        where_clauses.append("e.almacen_destino_id = ?")
        params.append(int(filtro_suc))

    where = "WHERE " + " AND ".join(where_clauses)

    cur.execute(f"""
        SELECT 
            c.id, c.folio_caja, c.numero_caja, c.piezas_en_caja, c.estatus,
            c.empacado_por, c.empacado_en, c.recolectado_por, c.recolectado_en,
            e.id AS embarque_id, e.folio AS folio_embarque,
            e.almacen_origen_nombre, e.almacen_destino_nombre, e.total_cajas,
            e.chofer_nombre
        FROM embarque_cajas c
        JOIN embarques e ON e.id = c.embarque_id
        {where}
        ORDER BY c.id DESC
    """, params)

    cajas = []
    for r in cur.fetchall():
        cajas.append({
            "caja_id": r[0],
            "folio_caja": r[1],
            "numero_caja": r[2],
            "piezas_en_caja": float(r[3] or 0),
            "estatus": r[4],
            "empacado_por": r[5],
            "empacado_en": r[6],
            "recolectado_por": r[7],
            "recolectado_en": r[8],
            "embarque_id": r[9],
            "folio_embarque": r[10],
            "almacen_origen_nombre": r[11],
            "almacen_destino_nombre": r[12],
            "total_cajas_embarque": r[13],
            "chofer_nombre": r[14]
        })

    conn.close()
    return jsonify({"success": True, "cajas_pendientes": cajas})

@embarques_bp.route('/api/embarques/buscar-origen', methods=['GET'])
def buscar_origen_traspaso():
    """
    Busca traspasos o pedidos recientes en Microsip por folio o ID
    para precargar partidas al momento de preparar un nuevo embarque.
    """
    q = str(request.args.get('q') or '').strip().upper()
    
    conn = None
    try:
        # Obtener folios ya embarcados para marcarlos o excluirlos
        conn_sq = conectar_sqlite()
        cur_sq = conn_sq.cursor()
        cur_sq.execute("""
            SELECT UPPER(TRIM(documento_referencia)) 
            FROM embarques 
            WHERE estatus != 'CANCELADO' AND documento_referencia != ''
        """)
        embarcados = set(r[0] for r in cur_sq.fetchall() if r[0])
        conn_sq.close()

        conn = conectar_db()
        cur = conn.cursor()

        if q:
            # Buscar traspasos específicos por folio o ID (limpiando #, espacios y ceros)
            q_clean = q.replace('#', '').strip().upper()
            doc_id_num = int(q_clean) if q_clean.isdigit() else -1
            cur.execute("""
                SELECT FIRST 15
                    doc.DOCTO_IN_ID,
                    TRIM(doc.FOLIO),
                    doc.FECHA,
                    doc.ALMACEN_ID,
                    COALESCE(TRIM(ao.NOMBRE), 'CEDIS'),
                    doc.ALMACEN_DESTINO_ID,
                    COALESCE(TRIM(ad.NOMBRE), 'SUCURSAL DESTINO'),
                    COALESCE(TRIM(doc.DESCRIPCION), '')
                FROM DOCTOS_IN doc
                LEFT JOIN ALMACENES ao ON ao.ALMACEN_ID = doc.ALMACEN_ID
                LEFT JOIN ALMACENES ad ON ad.ALMACEN_ID = doc.ALMACEN_DESTINO_ID
                WHERE (UPPER(TRIM(doc.FOLIO)) = ? OR UPPER(TRIM(doc.FOLIO)) CONTAINING ? OR doc.DOCTO_IN_ID = ?)
                  AND doc.ALMACEN_DESTINO_ID IS NOT NULL
                  AND doc.CANCELADO = 'N'
                ORDER BY doc.DOCTO_IN_ID DESC
            """, (q_clean, q_clean, doc_id_num))
        else:
            # Desplegar los traspasos pendientes de embarcar más recientes (CEDIS a Sucursales)
            cur.execute("""
                SELECT FIRST 25
                    doc.DOCTO_IN_ID,
                    TRIM(doc.FOLIO),
                    doc.FECHA,
                    doc.ALMACEN_ID,
                    COALESCE(TRIM(ao.NOMBRE), 'CEDIS'),
                    doc.ALMACEN_DESTINO_ID,
                    COALESCE(TRIM(ad.NOMBRE), 'SUCURSAL DESTINO'),
                    COALESCE(TRIM(doc.DESCRIPCION), '')
                FROM DOCTOS_IN doc
                LEFT JOIN ALMACENES ao ON ao.ALMACEN_ID = doc.ALMACEN_ID
                LEFT JOIN ALMACENES ad ON ad.ALMACEN_ID = doc.ALMACEN_DESTINO_ID
                WHERE doc.ALMACEN_DESTINO_ID IS NOT NULL
                  AND doc.CANCELADO = 'N'
                ORDER BY doc.DOCTO_IN_ID DESC
            """)

        resultados = []
        for r in cur.fetchall():
            doc_id = int(r[0])
            folio_txt = str(r[1] or '').strip()
            fecha_val = r[2]
            fecha_str = fecha_val.strftime("%d/%m/%Y") if fecha_val else ""

            # Partidas del traspaso
            cur.execute("""
                SELECT 
                    det.ARTICULO_ID,
                    TRIM(ca.CLAVE_ARTICULO),
                    TRIM(a.NOMBRE),
                    det.UNIDADES,
                    (SELECT LIST(TRIM(ca2.CLAVE_ARTICULO), ',') FROM CLAVES_ARTICULOS ca2 WHERE ca2.ARTICULO_ID = det.ARTICULO_ID)
                FROM DOCTOS_IN_DET det
                JOIN ARTICULOS a ON a.ARTICULO_ID = det.ARTICULO_ID
                JOIN CLAVES_ARTICULOS ca ON ca.ARTICULO_ID = a.ARTICULO_ID
                JOIN ROLES_CLAVES_ARTICULOS rca ON rca.ROL_CLAVE_ART_ID = ca.ROL_CLAVE_ART_ID AND rca.ES_PPAL = 'S'
                WHERE det.DOCTO_IN_ID = ?
                ORDER BY det.DOCTO_IN_DET_ID
            """, (doc_id,))

            partidas = []
            for d in cur.fetchall():
                todas_claves_raw = str(d[4] or '').strip()
                todas_claves_lista = [k.strip() for k in todas_claves_raw.split(',') if k.strip()] if todas_claves_raw else []
                partidas.append({
                    "articulo_id": int(d[0]),
                    "clave": str(d[1] or '').strip(),
                    "nombre": str(d[2] or '').strip(),
                    "unidades": float(d[3] or 1),
                    "todas_claves": todas_claves_lista
                })

            total_unidades = sum(p["unidades"] for p in partidas)
            resultados.append({
                "docto_in_id": doc_id,
                "folio": folio_txt,
                "fecha": fecha_str,
                "almacen_origen_id": int(r[3]) if r[3] else 620110,
                "almacen_origen_nombre": str(r[4] or 'CEDIS').strip(),
                "almacen_destino_id": int(r[5]) if r[5] else None,
                "almacen_destino_nombre": str(r[6] or '').strip(),
                "descripcion": str(r[7] or '').strip(),
                "total_articulos": len(partidas),
                "total_piezas": total_unidades,
                "ya_embarcado": folio_txt.upper() in embarcados,
                "partidas": partidas
            })

        cur.close()
        conn.close()
        return jsonify({"success": True, "resultados": resultados})
    except Exception as e:
        if conn:
            try: conn.close()
            except: pass
        return jsonify({"success": False, "error": str(e)}), 500

@embarques_bp.route('/api/embarques/caja/<folio_caja>/etiqueta', methods=['GET'])
def get_etiqueta_caja(folio_caja):
    """
    Retorna todos los datos de la etiqueta de la caja para la impresora Zebra,
    incluyendo código ZPL puro y estructura para impresión térmica en el navegador.
    """
    folio_clean = str(folio_caja or '').strip().upper()
    conn = conectar_sqlite()
    cur = conn.cursor()

    cur.execute("""
        SELECT 
            c.id, c.folio_caja, c.numero_caja, c.piezas_en_caja, c.estatus,
            c.empacado_por, c.empacado_en,
            e.id AS embarque_id, e.folio AS folio_embarque, e.empresa,
            e.almacen_origen_nombre, e.almacen_destino_nombre, e.cliente_nombre,
            e.total_cajas
        FROM embarque_cajas c
        JOIN embarques e ON e.id = c.embarque_id
        WHERE UPPER(c.folio_caja) = ?
    """, (folio_clean,))
    row = cur.fetchone()

    if not row:
        conn.close()
        return jsonify({"success": False, "error": "Caja no encontrada"}), 404

    caja_id = row[0]
    empresa = row[9] or 'BC'
    destino = row[11] or row[12] or 'SUCURSAL DESTINO'
    origen = row[10] or 'CEDIS'
    num_caja = row[2]
    tot_cajas = row[13] or num_caja
    piezas = float(row[3] or 0)
    fecha_empaque = row[6] or datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
    operador = row[5] or 'Almacén'

    cur.execute("""
        SELECT clave, nombre, unidades
        FROM embarque_caja_detalles
        WHERE caja_id = ?
    """, (caja_id,))
    detalles = [{"clave": d[0], "nombre": d[1], "unidades": float(d[2] or 0)} for d in cur.fetchall()]
    conn.close()

    siglas = obtener_siglas_sucursal(destino)
    es_rt = 'RT' in empresa.upper()
    nombre_empresa = 'RT REFACCIONES' if es_rt else 'BATTERY CENTER'
    logo_tag = 'logo rt' if es_rt else 'logo bc'

    etiqueta_data = {
        "folio_caja": folio_clean,
        "folio_embarque": row[8],
        "numero_caja": num_caja,
        "total_cajas": tot_cajas,
        "empresa": empresa,
        "nombre_empresa": nombre_empresa,
        "logo_tag": logo_tag,
        "sucursal_siglas": siglas,
        "origen": origen,
        "destino": destino,
        "piezas": int(piezas),
        "fecha_empaque": fecha_empaque,
        "fecha_hora": fecha_empaque,
        "operador": operador,
        "detalles": [{"clave": d["clave"], "nombre": d["nombre"]} for d in detalles]
    }
    etiqueta_data["zpl"] = generar_etiqueta_zpl_text(etiqueta_data)

    return jsonify({
        "success": True,
        "etiqueta": etiqueta_data,
        "caja": etiqueta_data
    })

@embarques_bp.route('/api/embarques/imprimir-etiqueta-usb', methods=['POST'])
def api_imprimir_etiqueta_usb():
    """
    Envía la impresión de la etiqueta directo a la impresora USB 'Label TD-401'.
    """
    data = request.get_json() or {}
    etiqueta_data = data.get('etiqueta')
    
    if not etiqueta_data and data.get('folio_caja'):
        folio_caja = data.get('folio_caja')
        # Reutilizamos la lógica de get_etiqueta_caja
        res = get_etiqueta_caja(folio_caja)
        res_data = res.get_json() if hasattr(res, 'get_json') else None
        if res_data and res_data.get('success'):
            etiqueta_data = res_data.get('etiqueta')

    if not etiqueta_data:
        return jsonify({"success": False, "error": "No se recibieron datos de la etiqueta"}), 400

    nombre_impresora = data.get('impresora') or 'Label TD-401'
    modo = str(data.get('modo') or 'ZPL').upper()
    ok, msg = imprimir_etiqueta_td401(etiqueta_data, printer_name=nombre_impresora, modo=modo)
    if ok:
        return jsonify({
            "success": True,
            "mensaje": f"Etiqueta enviada correctamente a '{nombre_impresora}' ({msg})."
        })
    else:
        return jsonify({
            "success": False,
            "error": f"Fallo al imprimir en '{nombre_impresora}': {msg}"
        }), 500

@embarques_bp.route('/api/embarques/probar-impresora-usb', methods=['POST'])
def api_probar_impresora_usb():
    """
    Imprime una etiqueta de prueba en la Label TD-401 para validar conexión y calibración.
    """
    data = request.get_json() or {}
    nombre_impresora = data.get('impresora') or 'Label TD-401'
    modo = str(data.get('modo') or 'ZPL').upper()
    ahora_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
    etiqueta_prueba = {
        "sucursal_siglas": "AE",
        "destino": "SUCURSAL AEROPUERTO",
        "nombre_empresa": "BATTERY CENTER",
        "folio_caja": "TEST-10001-1",
        "numero_caja": 1,
        "total_cajas": 1,
        "fecha_hora": ahora_str,
        "fecha_empaque": ahora_str,
        "operador": session.get('usuario') or 'Admin',
        "detalles": [
            {"clave": "L-24-500", "nombre": "ACUMULADOR LTH L-24-500"},
            {"clave": "L-34-600", "nombre": "ACUMULADOR LTH L-34-600"},
            {"clave": "GP-46", "nombre": "FILTRO ACEITE GONHER GP-46"},
            {"clave": "BC-200", "nombre": "TERMINAL BATERIA LATON"}
        ]
    }
    etiqueta_prueba["zpl"] = generar_etiqueta_zpl_text(etiqueta_prueba)
    ok, msg = imprimir_etiqueta_td401(etiqueta_prueba, printer_name=nombre_impresora, modo=modo)
    if ok:
        return jsonify({
            "success": True,
            "mensaje": f"¡Prueba enviada con éxito a '{nombre_impresora}' ({msg})!",
            "etiqueta": etiqueta_prueba
        })
    else:
        return jsonify({
            "success": False,
            "error": f"No se pudo enviar a '{nombre_impresora}': {msg}"
        }), 500


