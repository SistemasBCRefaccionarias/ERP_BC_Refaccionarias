import datetime
from decimal import Decimal
from collections import defaultdict
from flask import Blueprint, request, jsonify, session
from app.db import conectar_db, resolver_listas_precios, conectar_sqlite, detectar_columna_equivalencia
from app.config import get_current_dsn, conn_string_microsip

pv_bp = Blueprint('pv_bp', __name__)

def conectar_global_vehiculos():
    import pyodbc
    return pyodbc.connect(conn_string_microsip(dsn="GLOBALVEHICULOS"), timeout=8)

# ================= 1. CLIENTES Y CRÉDITO =================

@pv_bp.route('/api/pv/clientes/buscar', methods=['GET'])
def buscar_clientes():
    q = request.args.get('q', '').strip().upper()
    conn = None
    try:
        conn = conectar_db()
        cur = conn.cursor()

        conds = [
            "c.ESTATUS = 'A'",
            "UPPER(c.NOMBRE) NOT LIKE '%NO USAR%'",
            "UPPER(c.NOMBRE) NOT LIKE '%NO UTILIZAR%'",
            "UPPER(c.NOMBRE) NOT LIKE '%INACTIVO%'",
            "UPPER(c.NOMBRE) NOT LIKE '%CANCELADO%'"
        ]
        params = []

        if q:
            conds.append("(UPPER(c.NOMBRE) LIKE ? OR UPPER(c.CONTACTO1) LIKE ? OR CAST(c.CLIENTE_ID AS VARCHAR(20)) LIKE ?)")
            params.extend([f"%{q}%", f"%{q}%", f"%{q}%"])

        filtro = "WHERE " + " AND ".join(conds)

        cur.execute(f"""
            SELECT FIRST 25
                c.CLIENTE_ID,
                TRIM(c.NOMBRE) AS NOMBRE,
                COALESCE(c.LIMITE_CREDITO, 0) AS LIMITE_CREDITO,
                COALESCE(TRIM(tc.NOMBRE), 'Público General') AS TIPO_CLIENTE,
                COALESCE(TRIM(cp.NOMBRE), 'CONTADO') AS FORMA_COBRO,
                c.COND_PAGO_ID
            FROM CLIENTES c
            LEFT JOIN TIPOS_CLIENTES tc ON tc.TIPO_CLIENTE_ID = c.TIPO_CLIENTE_ID
            LEFT JOIN CONDICIONES_PAGO cp ON cp.COND_PAGO_ID = c.COND_PAGO_ID
            {filtro}
            ORDER BY 
                CASE WHEN UPPER(c.NOMBRE) LIKE ? THEN 0 ELSE 1 END,
                c.NOMBRE ASC
        """, params + ([f"{q}%"] if q else ["%"]))

        clientes = []
        for r in cur.fetchall():
            clientes.append({
                "id": int(r[0]),
                "nombre": str(r[1]).strip(),
                "limite_credito": float(r[2] or 0),
                "tipo_cliente": str(r[3]).strip(),
                "forma_cobro": str(r[4]).strip(),
                "cond_pago_id": int(r[5]) if r[5] else None
            })

        cur.close()
        conn.close()
        return jsonify({"success": True, "clientes": clientes})
    except Exception as e:
        if conn: conn.close()
        return jsonify({"success": False, "error": str(e), "clientes": []}), 500

@pv_bp.route('/api/pv/clientes/crear', methods=['POST'])
def crear_cliente_pv():
    data = request.get_json() or {}
    nombre = str(data.get('nombre', '')).strip().upper()
    telefono = str(data.get('telefono', '')).strip()
    email = str(data.get('email', '')).strip()
    rfc = str(data.get('rfc', '')).strip().upper() or 'XAXX010101000'
    direccion = str(data.get('direccion', '')).strip()

    if not nombre:
        return jsonify({"success": False, "error": "El nombre del cliente es obligatorio"}), 400

    conn = None
    try:
        conn = conectar_db()
        cur = conn.cursor()

        # 1. Generar ID único para el cliente
        cur.execute("SELECT GEN_ID(ID_CATALOGOS, 1) FROM RDB$DATABASE")
        cliente_id = int(cur.fetchone()[0])

        # 2. Insertar en CLIENTES
        # Valores predeterminados: Moneda MXN (1), Contado (591), Público General (156299), Zona General (582107), Cobrador (823692)
        cur.execute("""
            INSERT INTO CLIENTES (
                CLIENTE_ID, NOMBRE, CONTACTO1, ESTATUS, MONEDA_ID, COND_PAGO_ID, 
                TIPO_CLIENTE_ID, ZONA_CLIENTE_ID, COBRADOR_ID, COBRAR_IMPUESTOS, 
                LIMITE_CREDITO, FECHA_HORA_CREACION
            ) VALUES (?, ?, ?, 'A', 1, 591, 156299, 582107, 823692, 'S', 0, CURRENT_TIMESTAMP)
        """, (cliente_id, nombre, telefono[:50] if telefono else None))

        # 3. Generar clave para el cliente
        clave_cli = f"CLI{cliente_id}"
        cur.execute("SELECT GEN_ID(ID_CATALOGOS, 1) FROM RDB$DATABASE")
        clave_cli_id = int(cur.fetchone()[0])

        cur.execute("""
            INSERT INTO CLAVES_CLIENTES (
                CLAVE_CLIENTE_ID, CLAVE_CLIENTE, CLIENTE_ID, ROL_CLAVE_CLI_ID
            ) VALUES (?, ?, ?, 1)
        """, (clave_cli_id, clave_cli, cliente_id))

        # 4. Insertar Dirección Principal en DIRS_CLIENTES
        cur.execute("SELECT GEN_ID(ID_CATALOGOS, 1) FROM RDB$DATABASE")
        dir_id = int(cur.fetchone()[0])

        cur.execute("""
            INSERT INTO DIRS_CLIENTES (
                DIR_CLI_ID, CLIENTE_ID, NOMBRE_CALLE, TELEFONO1, EMAIL, RFC_CURP, ES_DIR_PPAL
            ) VALUES (?, ?, ?, ?, ?, ?, 'S')
        """, (dir_id, cliente_id, (direccion[:100] if direccion else 'CIUDAD'), (telefono[:30] if telefono else None), (email[:100] if email else None), rfc[:18]))

        conn.commit()
        cur.close()
        conn.close()

        nuevo_cliente = {
            "id": cliente_id,
            "clave": clave_cli,
            "nombre": nombre,
            "telefono": telefono,
            "email": email,
            "rfc": rfc,
            "direccion": direccion,
            "limite_credito": 0,
            "tipo_cliente": "Público General",
            "forma_cobro": "CONTADO"
        }

        return jsonify({"success": True, "cliente": nuevo_cliente, "mensaje": "Cliente dado de alta exitosamente en Microsip"})
    except Exception as e:
        if conn:
            try: conn.rollback(); conn.close()
            except: pass
        return jsonify({"success": False, "error": f"Error al crear cliente: {str(e)}"}), 500

@pv_bp.route('/api/pv/clientes/detalle/<int:cliente_id>', methods=['GET'])
def detalle_cliente(cliente_id):
    conn = None
    try:
        conn = conectar_db()
        cur = conn.cursor()

        # Datos básicos
        cur.execute("""
            SELECT 
                c.CLIENTE_ID,
                TRIM(c.NOMBRE) AS NOMBRE,
                COALESCE(c.LIMITE_CREDITO, 0) AS LIMITE_CREDITO,
                COALESCE(TRIM(tc.NOMBRE), 'Público General') AS TIPO_CLIENTE,
                COALESCE(TRIM(cp.NOMBRE), 'CONTADO') AS FORMA_COBRO,
                c.COND_PAGO_ID
            FROM CLIENTES c
            LEFT JOIN TIPOS_CLIENTES tc ON tc.TIPO_CLIENTE_ID = c.TIPO_CLIENTE_ID
            LEFT JOIN CONDICIONES_PAGO cp ON cp.COND_PAGO_ID = c.COND_PAGO_ID
            WHERE c.CLIENTE_ID = ?
        """, (cliente_id,))
        cli_row = cur.fetchone()
        if not cli_row:
            cur.close()
            conn.close()
            return jsonify({"success": False, "error": "Cliente no encontrado"}), 404

        limite_credito = float(cli_row[2] or 0)
        tipo_cliente = str(cli_row[3]).strip()
        forma_cobro = str(cli_row[4]).strip()

        # Saldo actual desde SALDOS_CC
        cur.execute("""
            SELECT COALESCE(SUM(CARGOS_CXC - CREDITOS_CXC), 0)
            FROM SALDOS_CC
            WHERE CLIENTE_ID = ?
        """, (cliente_id,))
        saldo_row = cur.fetchone()
        saldo_cliente = float(saldo_row[0] or 0) if saldo_row else 0.0

        # Saldo vencido
        saldo_vencido = 0.0
        try:
            cur.execute("""
                SELECT COALESCE(SUM(ip.IMPORTE + COALESCE(ip.IMPUESTO, 0)), 0)
                FROM DOCTOS_PEND_CC dp
                JOIN IMPORTES_DOCTOS_PEND_CC ip ON ip.DOCTO_PEND_CC_ID = dp.DOCTO_PEND_CC_ID
                LEFT JOIN VENCIMIENTOS_CARGOS_PEND_CC vc ON vc.DOCTO_PEND_CC_ID = dp.DOCTO_PEND_CC_ID
                WHERE dp.CLIENTE_ID = ? AND vc.FECHA_VENCIMIENTO < CURRENT_DATE
            """, (cliente_id,))
            v_row = cur.fetchone()
            if v_row and v_row[0]:
                saldo_vencido = float(v_row[0])
            else:
                # Si tiene saldo en cuenta y la condición no es contado, el saldo vencido refleja deudas atrasadas
                if "CREDITO" in forma_cobro.upper() and saldo_cliente > 0:
                    saldo_vencido = saldo_cliente
        except:
            saldo_vencido = saldo_cliente if ("CREDITO" in forma_cobro.upper() and saldo_cliente > 0) else 0.0

        saldo_disponible = max(0.0, limite_credito - saldo_cliente)

        # Mapear nombre comercial de lista de precios asignada
        tabla_asignada = "Público en General"
        if "TALLER" in tipo_cliente.upper() or "FLOTILLA" in tipo_cliente.upper() or "MAYOREO" in tipo_cliente.upper():
            tabla_asignada = "Talleres y Flotillas"
        elif "MAYOREO" in tipo_cliente.upper():
            tabla_asignada = "Precio Mayoreo"

        cur.close()
        conn.close()

        return jsonify({
            "success": True,
            "cliente": {
                "id": int(cli_row[0]),
                "nombre": str(cli_row[1]).strip(),
                "limite_credito": limite_credito,
                "saldo_cliente": saldo_cliente,
                "saldo_vencido": saldo_vencido,
                "saldo_disponible": saldo_disponible,
                "tipo_cliente": tipo_cliente,
                "tabla_asignada": tabla_asignada,
                "forma_cobro": forma_cobro
            }
        })
    except Exception as e:
        if conn: conn.close()
        return jsonify({"success": False, "error": str(e)}), 500

# ================= 2. CATÁLOGO VEHICULAR =================

@pv_bp.route('/api/pv/vehiculos/marcas', methods=['GET'])
def get_vehiculos_marcas():
    try:
        conn = conectar_global_vehiculos()
        cur = conn.cursor()
        cur.execute("SELECT IDMARCA, TRIM(NOMBREMARCA) FROM MARCAS WHERE UPPER(TRIM(ESTATUS)) IN ('ACTIVO', '1', 'A') ORDER BY NOMBREMARCA ASC")
        marcas = [{"id": int(r[0]), "nombre": str(r[1]).strip()} for r in cur.fetchall()]
        cur.close()
        conn.close()
        return jsonify({"success": True, "marcas": marcas})
    except Exception as e:
        return jsonify({"success": False, "error": str(e), "marcas": []}), 500

@pv_bp.route('/api/pv/vehiculos/modelos', methods=['GET'])
def get_vehiculos_modelos():
    marca = request.args.get('marca', '').strip()
    id_marca = request.args.get('id_marca', '')
    try:
        conn = conectar_global_vehiculos()
        cur = conn.cursor()
        if id_marca and id_marca.isdigit():
            cur.execute("SELECT IDMODELO, TRIM(NOMBREMODELO) FROM MODELOS WHERE IDMARCA = ? AND UPPER(TRIM(ESTATUS)) IN ('ACTIVO', '1', 'A') ORDER BY NOMBREMODELO ASC", (int(id_marca),))
        elif marca:
            cur.execute("""
                SELECT mo.IDMODELO, TRIM(mo.NOMBREMODELO) 
                FROM MODELOS mo
                JOIN MARCAS ma ON ma.IDMARCA = mo.IDMARCA
                WHERE UPPER(TRIM(ma.NOMBREMARCA)) = UPPER(TRIM(?))
                  AND UPPER(TRIM(mo.ESTATUS)) IN ('ACTIVO', '1', 'A')
                ORDER BY mo.NOMBREMODELO ASC
            """, (marca,))
        else:
            cur.execute("SELECT FIRST 50 IDMODELO, TRIM(NOMBREMODELO) FROM MODELOS ORDER BY NOMBREMODELO ASC")

        modelos = [{"id": int(r[0]), "nombre": str(r[1]).strip()} for r in cur.fetchall()]
        cur.close()
        conn.close()
        return jsonify({"success": True, "modelos": modelos})
    except Exception as e:
        return jsonify({"success": False, "error": str(e), "modelos": []}), 500

@pv_bp.route('/api/pv/vehiculos/submodelos', methods=['GET'])
def get_vehiculos_submodelos():
    modelo_id = request.args.get('modelo_id', '')
    modelo = request.args.get('modelo', '').strip()
    try:
        conn = conectar_global_vehiculos()
        cur = conn.cursor()
        if modelo_id and modelo_id.isdigit():
            cur.execute("SELECT IDSUBMODELO, TRIM(NOMBRESUBMODELO) FROM SUBMODELOS WHERE IDMODELO = ? ORDER BY NOMBRESUBMODELO ASC", (int(modelo_id),))
        elif modelo:
            cur.execute("""
                SELECT s.IDSUBMODELO, TRIM(s.NOMBRESUBMODELO)
                FROM SUBMODELOS s
                JOIN MODELOS m ON m.IDMODELO = s.IDMODELO
                WHERE UPPER(TRIM(m.NOMBREMODELO)) = UPPER(TRIM(?))
                ORDER BY s.NOMBRESUBMODELO ASC
            """, (modelo,))
        else:
            return jsonify({"success": True, "submodelos": []})

        submodelos = [{"id": int(r[0]), "nombre": str(r[1]).strip()} for r in cur.fetchall()]
        cur.close()
        conn.close()
        return jsonify({"success": True, "submodelos": submodelos})
    except Exception as e:
        return jsonify({"success": False, "error": str(e), "submodelos": []}), 500

@pv_bp.route('/api/pv/vehiculos/anios-motores', methods=['GET'])
def get_vehiculos_anios_motores():
    modelo_id = request.args.get('modelo_id', '')
    submodelo_id = request.args.get('submodelo_id', '')
    try:
        conn = conectar_global_vehiculos()
        cur = conn.cursor()

        filtros = []
        params = []
        if modelo_id and modelo_id.isdigit():
            filtros.append("IDMODELO = ?")
            params.append(int(modelo_id))
        if submodelo_id and submodelo_id.isdigit():
            filtros.append("IDSUBMODELO = ?")
            params.append(int(submodelo_id))

        where_sql = f"WHERE {' AND '.join(filtros)}" if filtros else ""

        cur.execute(f"SELECT DISTINCT ANIO FROM MODELOSUBMODELOANIOSMOTORES {where_sql} ORDER BY ANIO DESC", params)
        anios = [int(r[0]) for r in cur.fetchall() if r[0]]

        cur.execute(f"SELECT DISTINCT TRIM(MOTOR) FROM MODELOSUBMODELOANIOSMOTORES {where_sql} ORDER BY 1 ASC", params)
        motores = [str(r[0]).strip() for r in cur.fetchall() if r[0]]

        cur.close()
        conn.close()
        return jsonify({"success": True, "anios": anios, "motores": motores})
    except Exception as e:
        return jsonify({"success": False, "error": str(e), "anios": [], "motores": []}), 500

@pv_bp.route('/api/pv/vehiculos/productos', methods=['GET'])
def get_vehiculos_productos():
    marca = request.args.get('marca', '').strip().upper()
    modelo = request.args.get('modelo', '').strip().upper()
    anio = request.args.get('anio', '').strip()
    submodelo = request.args.get('submodelo', '').strip().upper()

    try:
        conn_gv = conectar_global_vehiculos()
        cur_gv = conn_gv.cursor()
        filtros = []
        params = []
        if marca and marca != 'TODOS':
            filtros.append("UPPER(TRIM(MARCA)) = ?")
            params.append(marca)
        if modelo and modelo != 'TODOS':
            filtros.append("UPPER(TRIM(MODELO)) = ?")
            params.append(modelo)
        if anio and anio != 'TODOS' and anio.isdigit():
            filtros.append("ANO = ?")
            params.append(int(anio))
        if submodelo and submodelo != 'TODOS':
            filtros.append("(UPPER(TRIM(SUBMODELO)) = ? OR SUBMODELO IS NULL OR TRIM(SUBMODELO) = '' OR UPPER(TRIM(SUBMODELO)) = 'TODOS')")
            params.append(submodelo)

        filtros.append("TIPODEPIEZA IS NOT NULL AND TRIM(TIPODEPIEZA) <> ''")
        where_sql = f"WHERE {' AND '.join(filtros)}" if filtros else ""
        cur_gv.execute(f"SELECT DISTINCT TRIM(TIPODEPIEZA) FROM NUMEROSDEPARTES {where_sql} ORDER BY 1 ASC", params)
        productos = [str(r[0]).strip() for r in cur_gv.fetchall() if r[0]]
        cur_gv.close()
        conn_gv.close()
        return jsonify({"success": True, "productos": productos})
    except Exception as e:
        return jsonify({"success": False, "error": str(e), "productos": []}), 500

def obtener_saldos_rt_por_claves(claves):
    """Consulta rápida en RT de las existencias agrupadas por clave de artículo.
    Retorna un diccionario {clave_mayuscula: stock_total}."""
    if not claves:
        return {}
    res = defaultdict(float)
    conn_rt = None
    try:
        conn_rt = conectar_db("RT")
        cur_rt = conn_rt.cursor()
        claves_unicas = list(set(c.strip().upper() for c in claves if c and c.strip()))
        if claves_unicas:
            placeholders = ",".join("?" for _ in claves_unicas)
            cur_rt.execute(f"""
                SELECT TRIM(ca.CLAVE_ARTICULO), COALESCE(SUM(s.ENTRADAS_UNIDADES - s.SALIDAS_UNIDADES), 0)
                FROM CLAVES_ARTICULOS ca
                JOIN SALDOS_IN s ON s.ARTICULO_ID = ca.ARTICULO_ID
                WHERE UPPER(ca.CLAVE_ARTICULO) IN ({placeholders})
                GROUP BY ca.CLAVE_ARTICULO
            """, claves_unicas)
            for r in cur_rt.fetchall():
                if r[0]:
                    res[str(r[0]).strip().upper()] = max(0.0, float(r[1] or 0))
        cur_rt.close()
        conn_rt.close()
    except Exception as e_rt:
        print("Aviso al consultar existencias en RT:", e_rt)
        if conn_rt:
            try: conn_rt.close()
            except: pass
    return res

def obtener_almacenes_rt_por_clave(clave):
    """Consulta existencias por almacén en RT para una clave de artículo.
    Retorna lista de dicts: [{'almacen_id': ..., 'nombre': ..., 'piezas': ..., 'empresa': 'RT'}]"""
    almacenes_rt = []
    conn_rt = None
    try:
        conn_rt = conectar_db("RT")
        cur_rt = conn_rt.cursor()
        cur_rt.execute("""
            SELECT 
                a.ALMACEN_ID,
                TRIM(a.NOMBRE) AS NOMBRE_ALMACEN,
                COALESCE(SUM(s.ENTRADAS_UNIDADES - s.SALIDAS_UNIDADES), 0) AS EXISTENCIA
            FROM ALMACENES a
            JOIN SALDOS_IN s ON s.ALMACEN_ID = a.ALMACEN_ID
            JOIN CLAVES_ARTICULOS ca ON ca.ARTICULO_ID = s.ARTICULO_ID
            WHERE UPPER(ca.CLAVE_ARTICULO) = UPPER(TRIM(?))
              AND a.NOMBRE NOT LIKE 'NO UTILIZAR%'
            GROUP BY a.ALMACEN_ID, a.NOMBRE
            HAVING COALESCE(SUM(s.ENTRADAS_UNIDADES - s.SALIDAS_UNIDADES), 0) > 0
            ORDER BY EXISTENCIA DESC
        """, (clave,))
        for r in cur_rt.fetchall():
            almacenes_rt.append({
                "almacen_id": int(r[0]),
                "nombre": str(r[1]).strip(),
                "piezas": max(0, int(r[2] or 0)),
                "empresa": "RT"
            })
        cur_rt.close()
        conn_rt.close()
    except Exception as e:
        print("Aviso al consultar almacenes de RT:", e)
        if conn_rt:
            try: conn_rt.close()
            except: pass
    return almacenes_rt

# Mapeo de almacén / sucursal a columna de clasificación en LIBRES_ARTICULOS
MAPA_COLUMNA_POR_ALMACEN = {
    620110: ("CE", "C_CEDIS_S", "CEDIS"),
    166719: ("SA", "C_SAULO_S", "Sucursal Saulo"),
    99934: ("BR", "C_BRAVO_S", "Sucursal Bravo"),
    412880: ("DV", "C_DIVISION_S", "Sucursal División"),
    158254: ("RV", "C_REVOLUCION_S", "Sucursal Revolución"),
    202797: ("TJ", "C_TAJITO_S", "Sucursal Tajito"),
    1147933: ("AG", "C_ARTESG_S", "Sucursal Artes Gráficas"),
    1254317: ("NA", "C_NAZAS_S", "Sucursal Nazas"),
    1423447: ("AE", "C_AEROPUERTO_S", "Sucursal Aeropuerto"),
    1473736: ("FC", "C_FCOIMADERO_S", "Sucursal Fco. I. Madero"),
    1629323: ("CD", "C_CARDENAS_S", "Sucursal Cárdenas"),
    1800730: ("GO", "C_GHIDALGO_S", "Sucursal Gómez Hidalgo"),
    1820837: ("MA", "C_MATAMOROS_S", "Sucursal Matamoros"),
    2168433: ("GD", "C_ALMGOGPE_S", "Alm Go Guadalupe"),
    486662: ("VA", "C_SALTILLO_S", "Sucursal Valdez"),
}

MAPA_NOMBRE_SUCURSAL = [
    ("CEDIS", ("CE", "C_CEDIS_S", "CEDIS")),
    ("SAULO", ("SA", "C_SAULO_S", "Sucursal Saulo")),
    ("BRAVO", ("BR", "C_BRAVO_S", "Sucursal Bravo")),
    ("DIVISION", ("DV", "C_DIVISION_S", "Sucursal División")),
    ("DIVISIÓN", ("DV", "C_DIVISION_S", "Sucursal División")),
    ("REVOLUCION", ("RV", "C_REVOLUCION_S", "Sucursal Revolución")),
    ("REVOLUCIÓN", ("RV", "C_REVOLUCION_S", "Sucursal Revolución")),
    ("TAJITO", ("TJ", "C_TAJITO_S", "Sucursal Tajito")),
    ("ARTES", ("AG", "C_ARTESG_S", "Sucursal Artes Gráficas")),
    ("NAZAS", ("NA", "C_NAZAS_S", "Sucursal Nazas")),
    ("AEROPUERTO", ("AE", "C_AEROPUERTO_S", "Sucursal Aeropuerto")),
    ("MADERO", ("FC", "C_FCOIMADERO_S", "Sucursal Fco. I. Madero")),
    ("CARDENAS", ("CD", "C_CARDENAS_S", "Sucursal Cárdenas")),
    ("CÁRDENAS", ("CD", "C_CARDENAS_S", "Sucursal Cárdenas")),
    ("HIDALGO", ("GO", "C_GHIDALGO_S", "Sucursal Gómez Hidalgo")),
    ("GOMEZ", ("GO", "C_GHIDALGO_S", "Sucursal Gómez Hidalgo")),
    ("GÓMEZ", ("GO", "C_GHIDALGO_S", "Sucursal Gómez Hidalgo")),
    ("MATAMOROS", ("MA", "C_MATAMOROS_S", "Sucursal Matamoros")),
    ("GUADALUPE", ("GD", "C_ALMGOGPE_S", "Alm Go Guadalupe")),
    ("VALDEZ", ("VA", "C_SALTILLO_S", "Sucursal Valdez")),
    ("SALTILLO", ("VA", "C_SALTILLO_S", "Sucursal Valdez")),
]

def resolver_info_clasificacion_sucursal(almacen_id=None, nombre_almacen=None):
    """
    Retorna tupla (emblema, columna_db, nombre_sucursal) para el almacén indicado.
    Default: ("CE", "C_CEDIS_S", "CEDIS").
    """
    if almacen_id:
        try:
            aid = int(almacen_id)
            if aid in MAPA_COLUMNA_POR_ALMACEN:
                return MAPA_COLUMNA_POR_ALMACEN[aid]
        except (ValueError, TypeError):
            pass

    if nombre_almacen:
        n_up = str(nombre_almacen).upper()
        for kw, info in MAPA_NOMBRE_SUCURSAL:
            if kw in n_up:
                return info

    return ("CE", "C_CEDIS_S", "CEDIS")

# ================= 3. BÚSQUEDA Y DETALLE DE ARTÍCULOS POS =================

@pv_bp.route('/api/pv/articulos/sugerencias', methods=['GET'])
def sugerencias_articulos_pos():
    q = request.args.get('q', '').strip().upper()
    almacen_id = request.args.get('almacen_id', '').strip()
    if len(q) < 2:
        return jsonify([])

    conn = None
    try:
        conn = conectar_db()
        cur = conn.cursor()
        col_equiv = detectar_columna_equivalencia(cur)
        col_equiv_select = f"COALESCE(TRIM(la.{col_equiv}), '')" if col_equiv else "''"
        filtro_equiv = f"OR UPPER(la.{col_equiv}) LIKE ?" if col_equiv else ""

        alm_id_num = int(almacen_id) if almacen_id and almacen_id.isdigit() else (session.get('sucursal_id') or 620110)
        emblema_suc, col_clasif, nombre_suc = resolver_info_clasificacion_sucursal(alm_id_num)

        listas = resolver_listas_precios(conn)
        precio_id = listas.get("publico", 42) or 42

        params = [alm_id_num, precio_id, f"%{q}%", f"%{q}%"]
        if col_equiv:
            params.append(f"%{q}%")
        params.extend([q, f"{q}%", f"{q}%"])

        cur.execute(f"""
            SELECT FIRST 15
                ca.CLAVE_ARTICULO,
                a.NOMBRE,
                {col_equiv_select} AS EQUIV,
                a.ARTICULO_ID,
                (SELECT COALESCE(SUM(s.ENTRADAS_UNIDADES - s.SALIDAS_UNIDADES), 0)
                 FROM SALDOS_IN s
                 WHERE s.ARTICULO_ID = a.ARTICULO_ID AND s.ALMACEN_ID = ?) AS STK_LOCAL,
                (SELECT FIRST 1 p.PRECIO
                 FROM PRECIOS_ARTICULOS p
                 WHERE p.ARTICULO_ID = a.ARTICULO_ID AND p.PRECIO_EMPRESA_ID = ?) AS PRECIO,
                COALESCE(TRIM(la.{col_clasif}), 'N/A') AS CLASIF
            FROM CLAVES_ARTICULOS ca
            JOIN ARTICULOS a ON a.ARTICULO_ID = ca.ARTICULO_ID
            JOIN ROLES_CLAVES_ARTICULOS r ON r.ROL_CLAVE_ART_ID = ca.ROL_CLAVE_ART_ID AND r.ES_PPAL = 'S'
            LEFT JOIN LIBRES_ARTICULOS la ON la.ARTICULO_ID = a.ARTICULO_ID
            WHERE UPPER(ca.CLAVE_ARTICULO) LIKE ?
               OR UPPER(a.NOMBRE) LIKE ?
               {filtro_equiv}
            ORDER BY
                CASE
                    WHEN UPPER(ca.CLAVE_ARTICULO) = ? THEN 0
                    WHEN UPPER(ca.CLAVE_ARTICULO) LIKE ? THEN 1
                    WHEN UPPER(a.NOMBRE) LIKE ? THEN 2
                    ELSE 3
                END
        """, tuple(params))

        res = []
        rows = cur.fetchall()
        art_ids = [int(r[3]) for r in rows if r[3]]

        # Stock total en BC para estas sugerencias
        stock_bc_map = defaultdict(float)
        if art_ids:
            ph_bc = ",".join("?" for _ in art_ids)
            cur.execute(f"""
                SELECT ARTICULO_ID, COALESCE(SUM(ENTRADAS_UNIDADES - SALIDAS_UNIDADES), 0)
                FROM SALDOS_IN
                WHERE ARTICULO_ID IN ({ph_bc})
                GROUP BY ARTICULO_ID
            """, art_ids)
            for r_bc in cur.fetchall():
                stock_bc_map[int(r_bc[0])] = max(0.0, float(r_bc[1] or 0))

        cur.close()
        conn.close()
        conn = None

        # Stock total en RT para estas claves
        claves_list = [str(r[0]).strip() for r in rows if r[0]]
        stock_rt_map = obtener_saldos_rt_por_claves(claves_list)

        for r in rows:
            art_id = int(r[3])
            clave_art = str(r[0]).strip()
            clasif_art = str(r[6]).strip() if (len(r) > 6 and r[6]) else "N/A"
            if not clasif_art:
                clasif_art = "N/A"
            res.append({
                "clave": clave_art,
                "nombre": str(r[1]).strip(),
                "equivalencia": str(r[2]).strip() if r[2] else "",
                "articulo_id": art_id,
                "stock_local": float(r[4] or 0),
                "stock_bc": float(stock_bc_map.get(art_id, 0.0)),
                "stock_rt": float(stock_rt_map.get(clave_art.upper(), 0.0)),
                "precio": float(r[5] or 0),
                "clasificacion": clasif_art,
                "emblema_sucursal": emblema_suc,
                "nombre_sucursal": nombre_suc
            })

        return jsonify(res)
    except Exception as e:
        if conn:
            try: conn.close()
            except: pass
        return jsonify([])

@pv_bp.route('/api/pv/articulos/buscar', methods=['GET'])
def buscar_articulos_pos():
    q_raw = request.args.get('q', '').strip()
    q = q_raw.upper()
    anio = request.args.get('anio', '').strip()
    marca = request.args.get('marca', '').strip().upper()
    modelo = request.args.get('modelo', '').strip().upper()
    submodelo = request.args.get('submodelo', '').strip().upper()
    motor = request.args.get('motor', '').strip().upper()
    producto = request.args.get('producto', '').strip().upper()
    almacen_id = request.args.get('almacen_id', '')
    limite = min(60, int(request.args.get('limite', 40)))

    if marca in ['TODOS', 'TODAS', 'TODAS LAS MARCAS']: marca = ''
    if modelo in ['TODOS', 'TODAS', 'TODOS LOS MODELOS']: modelo = ''
    if submodelo in ['TODOS', 'TODAS', 'CUALQUIER VERSIÓN', 'CUALQUIER VERSION']: submodelo = ''
    if motor in ['TODOS', 'TODAS', 'CUALQUIER MOTOR']: motor = ''
    if anio in ['TODOS', 'TODAS', 'TODOS LOS AÑOS', 'TODOS LOS ANOS']: anio = ''
    if producto in ['TODOS', 'TODAS', 'TODAS LAS FAMILIAS']: producto = ''

    # Analizar términos libres en q para extraer año o tipo de producto si el usuario escribió libremente
    q_term = q.strip()
    if q:
        import re
        # Dividir por espacios y comas, NUNCA por guiones (-) para no mutilar números de parte como A-30G o GP-48
        tokens = [t for t in re.split(r'[\s,]+', q) if t]
        
        # Extraer año si no estaba fijado
        if not anio:
            for t in tokens:
                if re.match(r'^(19\d\d|20\d\d)$', t):
                    anio = t
                    break
                    
        # Extraer familia de producto si no estaba fijada
        if not producto:
            for t in tokens:
                t_u = t.upper()
                if t_u in ['AMORTIGUADOR', 'AMORTIGUADORES']:
                    producto = 'AMORTIGUADOR'
                    break
                elif t_u in ['BUJIA', 'BUJIAS', 'BUJÍA', 'BUJÍAS']:
                    producto = 'BUJIA'
                    break
                elif t_u in ['FILTRO', 'FILTROS']:
                    producto = 'FILTRO'
                    break
                elif t_u in ['ACUMULADOR', 'ACUMULADORES', 'BATERIA', 'BATERIAS', 'BATERÍA', 'BATERÍAS']:
                    producto = 'ACUMULADOR'
                    break
                elif t_u in ['BALATA', 'BALATAS', 'FRENO', 'FRENOS']:
                    producto = 'BALATA'
                    break
                elif t_u in ['ACEITE', 'ACEITES', 'LUBRICANTE', 'LUBRICANTES']:
                    producto = 'ACEITE'
                    break
                elif t_u in ['BANDA', 'BANDAS', 'CORREA', 'CORREAS']:
                    producto = 'BANDA'
                    break

        stop_words = {'TODOS', 'TODAS', 'DE', 'DEL', 'PARA', 'POR', 'EN', 'EL', 'LA', 'LOS', 'LAS', 'CON'}
        prod_words = {'AMORTIGUADOR', 'AMORTIGUADORES', 'BUJIA', 'BUJIAS', 'BUJÍA', 'BUJÍAS', 'FILTRO', 'FILTROS', 'ACUMULADOR', 'ACUMULADORES', 'BATERIA', 'BATERIAS', 'BATERÍA', 'BATERÍAS', 'BALATA', 'BALATAS', 'FRENO', 'FRENOS', 'ACEITE', 'ACEITES', 'BANDA', 'BANDAS'}
        
        # Filtrar tokens para el término de búsqueda textual para que no rompa la búsqueda de artículos por nombre
        tokens_filtrados = [t for t in tokens if t.upper() not in stop_words and t.upper() not in prod_words and t != anio]
        q_term = " ".join(tokens_filtrados).strip()
        # Si todos los tokens eran de producto/stop words pero q tenía valor, conservar q original para buscar
        if not q_term and q.strip():
            q_term = q.strip()

    # 1. Si hay filtro vehicular, buscar claves compatibles en GLOBALVEHICULOS
    claves_compatibles = set()
    tiene_filtro_vehicular = bool(marca or modelo or anio)
    
    if tiene_filtro_vehicular:
        try:
            conn_gv = conectar_global_vehiculos()
            cur_gv = conn_gv.cursor()

            filtros_gv = []
            params_gv = []
            if marca:
                filtros_gv.append("UPPER(TRIM(MARCA)) = ?")
                params_gv.append(marca)
            if modelo:
                filtros_gv.append("UPPER(TRIM(MODELO)) = ?")
                params_gv.append(modelo)
            if submodelo:
                # El submodelo debe permitir piezas universales (SUBMODELO vacío o nulo o TODOS)
                filtros_gv.append("(UPPER(TRIM(SUBMODELO)) = ? OR SUBMODELO IS NULL OR TRIM(SUBMODELO) = '' OR UPPER(TRIM(SUBMODELO)) = 'TODOS')")
                params_gv.append(submodelo)
            if anio and anio.isdigit():
                filtros_gv.append("ANO = ?")
                params_gv.append(int(anio))
            if motor:
                # El motor debe permitir piezas universales (MOTOR vacío o nulo o TODOS)
                filtros_gv.append("(UPPER(TRIM(MOTOR)) LIKE ? OR MOTOR IS NULL OR TRIM(MOTOR) = '' OR UPPER(TRIM(MOTOR)) = 'TODOS')")
                params_gv.append(f"%{motor}%")

            # Filtrar por tipo de pieza en catálogo vehicular
            if producto:
                if 'AMORTIGUADOR' in producto:
                    if 'BASE' in producto:
                        filtros_gv.append("(UPPER(TRIM(TIPODEPIEZA)) LIKE '%BASE%')")
                    elif producto in ['AMORTIGUADOR', 'AMORTIGUADORES']:
                        filtros_gv.append("(UPPER(TRIM(TIPODEPIEZA)) = 'AMORTIGUADOR' OR (UPPER(TRIM(TIPODEPIEZA)) LIKE '%AMORTIGUADOR%' AND UPPER(TRIM(TIPODEPIEZA)) NOT LIKE '%BASE%'))")
                    else:
                        filtros_gv.append("(UPPER(TRIM(TIPODEPIEZA)) LIKE '%AMORTIGUADOR%')")
                elif 'ACUMULADOR' in producto or 'BATERIA' in producto:
                    filtros_gv.append("(UPPER(TRIM(TIPODEPIEZA)) LIKE '%ACUMULADOR%' OR UPPER(TRIM(TIPODEPIEZA)) LIKE '%BATERIA%')")
                elif 'FILTRO' in producto:
                    filtros_gv.append("UPPER(TRIM(TIPODEPIEZA)) LIKE '%FILTRO%'")
                elif 'BUJIA' in producto:
                    filtros_gv.append("(UPPER(TRIM(TIPODEPIEZA)) LIKE '%BUJIA%' OR UPPER(TRIM(TIPODEPIEZA)) LIKE '%BUJÍA%')")
                elif 'ACEITE' in producto:
                    filtros_gv.append("UPPER(TRIM(TIPODEPIEZA)) LIKE '%ACEITE%'")
                elif 'BALATA' in producto or 'FRENO' in producto:
                    filtros_gv.append("(UPPER(TRIM(TIPODEPIEZA)) LIKE '%BALATA%' OR UPPER(TRIM(TIPODEPIEZA)) LIKE '%FRENO%')")
                elif 'BANDA' in producto or 'CORREA' in producto:
                    filtros_gv.append("(UPPER(TRIM(TIPODEPIEZA)) LIKE '%BANDA%' OR UPPER(TRIM(TIPODEPIEZA)) LIKE '%CORREA%')")
                else:
                    filtros_gv.append("UPPER(TRIM(TIPODEPIEZA)) LIKE ?")
                    params_gv.append(f"%{producto}%")

            where_gv = f"WHERE {' AND '.join(filtros_gv)}" if filtros_gv else ""
            cur_gv.execute(f"SELECT DISTINCT TRIM(NUMERODEPARTE) FROM NUMEROSDEPARTES {where_gv}", params_gv)
            for r in cur_gv.fetchall():
                if r[0]:
                    claves_compatibles.add(str(r[0]).strip().upper())
            cur_gv.close()
            conn_gv.close()
        except Exception as e_gv:
            print("Aviso al consultar GLOBALVEHICULOS:", e_gv)

    # 2. Consultar artículos en base de datos Microsip activa
    conn = None
    try:
        conn = conectar_db()
        cur = conn.cursor()

        # Resolver lista de precios para talleres y flotillas y público
        listas = resolver_listas_precios(conn)
        precio_taller_id = listas.get("talleres", 67032)
        precio_pub_id = listas.get("publico", 42)

        # Resolver almacén local (de parámetro o de la sucursal del usuario)
        usr_suc_id = session.get('sucursal_id')
        alm_id_num = int(almacen_id) if (almacen_id and str(almacen_id).isdigit()) else (int(usr_suc_id) if usr_suc_id else 620110)
        emblema_suc, col_clasif, nombre_suc = resolver_info_clasificacion_sucursal(alm_id_num)

        # Preparar filtro WHERE en Microsip
        filtros_mp = [
            "a.ESTATUS = 'A'",
            "UPPER(a.NOMBRE) NOT LIKE '%NO USAR%'",
            "UPPER(a.NOMBRE) NOT LIKE '%NO UTILIZAR%'",
            "UPPER(a.NOMBRE) NOT LIKE '%INACTIVO%'"
        ]
        params_mp = []

        if q_term:
            # Buscar por clave, nombre o equivalencia (tolerante a guiones)
            q_alt = q_term.replace('-', '')
            if q_alt != q_term and len(q_alt) >= 3:
                filtros_mp.append("""(
                    UPPER(ca.CLAVE_ARTICULO) LIKE ? 
                    OR UPPER(ca.CLAVE_ARTICULO) LIKE ?
                    OR UPPER(a.NOMBRE) LIKE ? 
                    OR UPPER(la.EQUIVALENCIA1) LIKE ?
                )""")
                params_mp.extend([f"%{q_term}%", f"%{q_alt}%", f"%{q_term}%", f"%{q_term}%"])
            else:
                filtros_mp.append("""(
                    UPPER(ca.CLAVE_ARTICULO) LIKE ? 
                    OR UPPER(a.NOMBRE) LIKE ? 
                    OR UPPER(la.EQUIVALENCIA1) LIKE ?
                )""")
                params_mp.extend([f"%{q_term}%", f"%{q_term}%", f"%{q_term}%"])

        if tiene_filtro_vehicular:
            if claves_compatibles:
                # Filtrar por las claves encontradas en el catálogo vehicular
                claves_list = list(claves_compatibles)[:250]
                placeholders = ",".join("?" for _ in claves_list)
                filtros_mp.append(f"UPPER(ca.CLAVE_ARTICULO) IN ({placeholders})")
                params_mp.extend(claves_list)
            else:
                # Si no hubo claves en GLOBALVEHICULOS pero el usuario buscó vehículo, buscar en descripciones de Microsip
                veh_conds = []
                if modelo and len(modelo) >= 3:
                    veh_conds.append("(UPPER(a.NOMBRE) LIKE ? OR UPPER(a.NOMBRE) LIKE ? OR UPPER(a.NOMBRE) LIKE ?)")
                    params_mp.extend([f"% {modelo} %", f"% {modelo}", f"% FT {modelo}%"])
                elif marca:
                    veh_conds.append("UPPER(a.NOMBRE) LIKE ?")
                    params_mp.append(f"%{marca}%")

                if veh_conds:
                    filtros_mp.append(f"({' OR '.join(veh_conds)})")
                else:
                    cur.close()
                    conn.close()
                    return jsonify({"success": True, "articulos": [], "total_encontrados": 0})

        # FILTRO ESTRICTO DE FAMILIA DE PRODUCTO EN MICROSIP
        if producto:
            if 'AMORTIGUADOR' in producto:
                if 'BASE' in producto:
                    filtros_mp.append("""(
                        UPPER(a.NOMBRE) LIKE '%BASE%' AND (UPPER(a.NOMBRE) LIKE '%AMORTIGUADOR%' OR UPPER(li.NOMBRE) LIKE '%BASE%')
                    )""")
                elif producto in ['AMORTIGUADOR', 'AMORTIGUADORES']:
                    filtros_mp.append("""(
                        (UPPER(a.NOMBRE) LIKE '%AMORTIGUADOR%' OR UPPER(li.NOMBRE) LIKE '%AMORTIGUADOR%')
                        AND UPPER(a.NOMBRE) NOT LIKE '%BASE%'
                    ) AND UPPER(a.NOMBRE) NOT LIKE '%FILTRO%' AND UPPER(a.NOMBRE) NOT LIKE '%ACUMULADOR%' AND UPPER(a.NOMBRE) NOT LIKE '%BUJIA%'""")
                else:
                    filtros_mp.append("""(
                        UPPER(a.NOMBRE) LIKE '%AMORTIGUADOR%' OR UPPER(li.NOMBRE) LIKE '%AMORTIGUADOR%'
                    ) AND UPPER(a.NOMBRE) NOT LIKE '%FILTRO%' AND UPPER(a.NOMBRE) NOT LIKE '%ACUMULADOR%' AND UPPER(a.NOMBRE) NOT LIKE '%BUJIA%'""")
            elif 'ACUMULADOR' in producto or 'BATERIA' in producto:
                filtros_mp.append("""(
                    UPPER(a.NOMBRE) LIKE '%ACUMULADOR%' OR UPPER(a.NOMBRE) LIKE '%BATERIA%' 
                    OR UPPER(li.NOMBRE) LIKE '%ACUMULADOR%' OR UPPER(li.NOMBRE) LIKE '%BATERIA%'
                    OR UPPER(ca.CLAVE_ARTICULO) LIKE 'G-%' OR UPPER(ca.CLAVE_ARTICULO) LIKE 'CH-%'
                    OR UPPER(ca.CLAVE_ARTICULO) LIKE 'GS-%' OR UPPER(ca.CLAVE_ARTICULO) LIKE 'GP-%-6%'
                ) AND UPPER(a.NOMBRE) NOT LIKE '%FILTRO%' AND UPPER(a.NOMBRE) NOT LIKE '%ACEITE%' AND UPPER(a.NOMBRE) NOT LIKE '%BUJIA%'""")
            elif 'FILTRO' in producto:
                filtros_mp.append("""(
                    UPPER(a.NOMBRE) LIKE '%FILTRO%' OR UPPER(li.NOMBRE) LIKE '%FILTRO%'
                    OR UPPER(ca.CLAVE_ARTICULO) LIKE 'GP-%' OR UPPER(ca.CLAVE_ARTICULO) LIKE 'GA-%'
                    OR UPPER(ca.CLAVE_ARTICULO) LIKE 'GG-%' OR UPPER(ca.CLAVE_ARTICULO) LIKE 'GAC-%'
                    OR UPPER(ca.CLAVE_ARTICULO) LIKE 'GPS-%'
                ) AND UPPER(a.NOMBRE) NOT LIKE '%ACUMULADOR%' AND UPPER(a.NOMBRE) NOT LIKE '%BATERIA%' AND UPPER(a.NOMBRE) NOT LIKE '%BUJIA%' AND UPPER(ca.CLAVE_ARTICULO) NOT LIKE 'G-%-6%'""")
            elif 'BUJIA' in producto:
                filtros_mp.append("""(
                    UPPER(a.NOMBRE) LIKE '%BUJIA%' OR UPPER(a.NOMBRE) LIKE '%BUJÍA%'
                    OR UPPER(li.NOMBRE) LIKE '%BUJIA%' OR UPPER(li.NOMBRE) LIKE '%BUJÍA%'
                ) AND UPPER(a.NOMBRE) NOT LIKE '%FILTRO%' AND UPPER(a.NOMBRE) NOT LIKE '%ACUMULADOR%' 
                  AND UPPER(a.NOMBRE) NOT LIKE '%BATERIA%' AND UPPER(a.NOMBRE) NOT LIKE '%ACEITE%'
                  AND UPPER(ca.CLAVE_ARTICULO) NOT LIKE 'GP-%' AND UPPER(ca.CLAVE_ARTICULO) NOT LIKE 'GA-%' 
                  AND UPPER(ca.CLAVE_ARTICULO) NOT LIKE 'G-%'""")
            elif 'ACEITE' in producto:
                filtros_mp.append("""(
                    UPPER(a.NOMBRE) LIKE '%ACEITE%' OR UPPER(a.NOMBRE) LIKE '%LUBRICANTE%'
                    OR UPPER(li.NOMBRE) LIKE '%ACEITE%' OR UPPER(li.NOMBRE) LIKE '%LUBRICANTE%'
                ) AND UPPER(a.NOMBRE) NOT LIKE '%FILTRO%' AND UPPER(a.NOMBRE) NOT LIKE '%ACUMULADOR%' AND UPPER(a.NOMBRE) NOT LIKE '%BUJIA%'""")
            elif 'BALATA' in producto or 'FRENO' in producto:
                filtros_mp.append("""(
                    UPPER(a.NOMBRE) LIKE '%BALATA%' OR UPPER(a.NOMBRE) LIKE '%FRENO%'
                    OR UPPER(li.NOMBRE) LIKE '%BALATA%' OR UPPER(li.NOMBRE) LIKE '%FRENO%'
                ) AND UPPER(a.NOMBRE) NOT LIKE '%FILTRO%' AND UPPER(a.NOMBRE) NOT LIKE '%ACUMULADOR%' AND UPPER(a.NOMBRE) NOT LIKE '%BUJIA%'""")
            elif 'BANDA' in producto or 'CORREA' in producto:
                filtros_mp.append("""(
                    UPPER(a.NOMBRE) LIKE '%BANDA%' OR UPPER(a.NOMBRE) LIKE '%CORREA%'
                    OR UPPER(li.NOMBRE) LIKE '%BANDA%' OR UPPER(li.NOMBRE) LIKE '%CORREA%'
                ) AND UPPER(a.NOMBRE) NOT LIKE '%FILTRO%' AND UPPER(a.NOMBRE) NOT LIKE '%ACUMULADOR%' AND UPPER(a.NOMBRE) NOT LIKE '%BUJIA%'""")

        where_mp_sql = f"WHERE {' AND '.join(filtros_mp)}" if filtros_mp else ""

        # Determinar si el cliente seleccionado tiene condición de taller/flotilla/mayoreo
        cliente_id_param = request.args.get('cliente_id', '').strip()
        es_cliente_taller = False
        if cliente_id_param and cliente_id_param.isdigit():
            try:
                cur.execute("SELECT TIPO_CLIENTE FROM CLIENTES WHERE CLIENTE_ID = ?", (int(cliente_id_param),))
                r_tc = cur.fetchone()
                if r_tc and r_tc[0]:
                    tc_str = str(r_tc[0]).upper()
                    if "TALLER" in tc_str or "FLOTILLA" in tc_str or "MAYOREO" in tc_str:
                        es_cliente_taller = True
            except:
                pass

        precio_venta_expr = "COALESCE(p_tal.PRECIO, p_pub.PRECIO, 0)" if es_cliente_taller else "COALESCE(p_pub.PRECIO, p_tal.PRECIO, 0)"

        # Query principal de artículos (FASE 1: Búsqueda rápida indexada)
        cur.execute(f"""
            SELECT FIRST {limite}
                a.ARTICULO_ID,
                TRIM(ca.CLAVE_ARTICULO) AS CLAVE,
                TRIM(a.NOMBRE) AS NOMBRE,
                COALESCE(TRIM(la.EQUIVALENCIA1), '') AS EQUIV,
                {precio_venta_expr} AS PRECIO_VENTA,
                COALESCE(p_pub.PRECIO, 0) AS PRECIO_PUBLICO,
                COALESCE(p_tal.PRECIO, 0) AS PRECIO_TALLER,
                COALESCE(TRIM(li.NOMBRE), '') AS LINEA,
                COALESCE(TRIM(la.{col_clasif}), 'N/A') AS CLASIFICACION
            FROM ARTICULOS a
            JOIN CLAVES_ARTICULOS ca ON ca.ARTICULO_ID = a.ARTICULO_ID
            JOIN ROLES_CLAVES_ARTICULOS r ON r.ROL_CLAVE_ART_ID = ca.ROL_CLAVE_ART_ID AND r.ES_PPAL = 'S'
            LEFT JOIN LIBRES_ARTICULOS la ON la.ARTICULO_ID = a.ARTICULO_ID
            LEFT JOIN LINEAS_ARTICULOS li ON li.LINEA_ARTICULO_ID = a.LINEA_ARTICULO_ID
            LEFT JOIN PRECIOS_ARTICULOS p_tal ON p_tal.ARTICULO_ID = a.ARTICULO_ID AND p_tal.PRECIO_EMPRESA_ID = {precio_taller_id}
            LEFT JOIN PRECIOS_ARTICULOS p_pub ON p_pub.ARTICULO_ID = a.ARTICULO_ID AND p_pub.PRECIO_EMPRESA_ID = {precio_pub_id}
            {where_mp_sql}
            ORDER BY 
                CASE WHEN UPPER(ca.CLAVE_ARTICULO) = ? THEN 0 ELSE 1 END,
                CASE WHEN UPPER(a.NOMBRE) NOT LIKE '%CABLE%' AND (UPPER(a.NOMBRE) LIKE '%BUJIA%' OR UPPER(li.NOMBRE) LIKE '%BUJIA%') THEN 0 ELSE 1 END,
                a.NOMBRE ASC
        """, params_mp + [q_term if q_term else ""])

        rows = cur.fetchall()

        # FASE 2: Consulta de saldos por almacén únicamente para los artículos encontrados
        art_ids = [int(r[0]) for r in rows if r[0] is not None]
        stock_global_map = defaultdict(int)
        stock_local_map = defaultdict(int)
        stock_cedis_map = defaultdict(int)

        if art_ids:
            ph_saldos = ",".join("?" for _ in art_ids)
            cur.execute(f"""
                SELECT ARTICULO_ID, ALMACEN_ID, SUM(ENTRADAS_UNIDADES - SALIDAS_UNIDADES)
                FROM SALDOS_IN
                WHERE ARTICULO_ID IN ({ph_saldos})
                GROUP BY ARTICULO_ID, ALMACEN_ID
            """, art_ids)
            for r_s in cur.fetchall():
                s_art_id = int(r_s[0])
                s_alm_id = int(r_s[1]) if r_s[1] is not None else 0
                s_cant = max(0, int(float(r_s[2] or 0)))
                stock_global_map[s_art_id] += s_cant
                if alm_id_num and s_alm_id == alm_id_num:
                    stock_local_map[s_art_id] += s_cant
                if s_alm_id == 620110:
                    stock_cedis_map[s_art_id] += s_cant

        # FASE 2.1: Detección de fotos en IMAGENES_ARTICULOS
        art_ids_con_foto = set()
        if art_ids:
            try:
                cur.execute(f"""
                    SELECT DISTINCT ARTICULO_ID 
                    FROM IMAGENES_ARTICULOS 
                    WHERE ARTICULO_ID IN ({ph_saldos}) AND IMAGEN IS NOT NULL
                """, art_ids)
                art_ids_con_foto = set(int(r[0]) for r in cur.fetchall() if r[0] is not None)
            except Exception:
                pass

        # Determinar marca del artículo desde nombre o catálogo
        articulos = []
        for r in rows:
            art_id = int(r[0])
            clave = str(r[1]).strip()
            nombre = str(r[2]).strip()
            equiv = str(r[3]).strip()
            precio = float(r[4] or 0)
            precio_pub = float(r[5] or 0)
            precio_taller = float(r[6] or 0)
            stk_global = stock_global_map[art_id]
            stk_local = stock_local_map[art_id]
            stk_cedis = stock_cedis_map[art_id]
            linea = str(r[7]).strip()
            clasif_art = str(r[8]).strip() if (len(r) > 8 and r[8]) else "N/A"
            if not clasif_art:
                clasif_art = "N/A"

            marca_detectada = "GONHER"
            for m_test in ["GONHER", "CHECKER", "MORESA", "GROB", "VOLTMAX", "SAFETY", "GATES", "MOBIL", "NGK", "CARTEK", "LUBRAL", "FULO"]:
                if m_test in nombre.upper() or m_test in linea.upper() or m_test in clave.upper():
                    marca_detectada = m_test
                    break

            # Bonificación sugerida (si es acumulador)
            bonif_sugerida = None
            if "ACUMULADOR" in nombre.upper() or "BATERIA" in nombre.upper() or "BAT" in linea.upper() or clave.startswith("G-") or clave.startswith("CH-"):
                if "GRUPO 1" in nombre.upper() or "GP 1" in nombre.upper():
                    bonif_sugerida = {"clave": "B01", "monto": 300.0, "nombre": "BONIFICACION ACUMULADOR USADO GRUPO 1"}
                elif "GRUPO 2" in nombre.upper() or "GP 2" in nombre.upper():
                    bonif_sugerida = {"clave": "B02", "monto": 400.0, "nombre": "BONIFICACION ACUMULADOR USADO GRUPO 2"}
                elif "GRUPO 3" in nombre.upper() or "GP 3" in nombre.upper():
                    bonif_sugerida = {"clave": "B03", "monto": 525.0, "nombre": "BONIFICACION ACUMULADOR USADO GRUPO 3"}
                elif "GRUPO 4" in nombre.upper() or "GP 4" in nombre.upper():
                    bonif_sugerida = {"clave": "B04", "monto": 600.0, "nombre": "BONIFICACION ACUMULADOR USADO GRUPO 4"}
                else:
                    bonif_sugerida = {"clave": "B03", "monto": 525.0, "nombre": "BONIFICACION ACUMULADOR USADO GRUPO 3"}

            tiene_foto = art_id in art_ids_con_foto
            articulos.append({
                "articulo_id": art_id,
                "clave": clave,
                "nombre": nombre,
                "equivalencia": equiv,
                "precio": precio,
                "precio_publico": precio_pub,
                "precio_taller": precio_taller,
                "stock_global": stk_global,
                "stock_local": stk_local,
                "stock_cedis": stk_cedis,
                "marca": marca_detectada,
                "linea": linea,
                "clasificacion": clasif_art,
                "emblema_sucursal": emblema_suc,
                "nombre_sucursal": nombre_suc,
                "tiene_foto": tiene_foto,
                "foto_url": f"/api/articulos/foto/{art_id}" if tiene_foto else None,
                "bonificacion": bonif_sugerida
            })

        cur.close()
        conn.close()

        return jsonify({
            "success": True,
            "articulos": articulos,
            "total_encontrados": len(articulos)
        })
    except Exception as e:
        if conn: conn.close()
        return jsonify({"success": False, "error": str(e), "articulos": []}), 500

@pv_bp.route('/api/articulos/foto/<int:articulo_id>', methods=['GET'])
def get_foto_articulo_blob(articulo_id):
    try:
        conn = conectar_db()
        cur = conn.cursor()
        cur.execute("SELECT FIRST 1 IMAGEN FROM IMAGENES_ARTICULOS WHERE ARTICULO_ID = ? AND IMAGEN IS NOT NULL", (articulo_id,))
        row = cur.fetchone()
        cur.close()
        conn.close()
        if row and row[0]:
            from flask import Response
            return Response(bytes(row[0]), mimetype="image/jpeg", headers={
                "Cache-Control": "public, max-age=604800",
                "Content-Type": "image/jpeg"
            })
    except Exception:
        pass
    from flask import abort
    abort(404)

@pv_bp.route('/api/pv/articulos/detalle/<string:clave>', methods=['GET'])
def detalle_articulo_pos(clave):
    almacen_id = request.args.get('almacen_id', '')
    conn = None
    try:
        conn = conectar_db()
        cur = conn.cursor()

        alm_id_num = int(almacen_id) if (almacen_id and str(almacen_id).isdigit()) else (int(session.get('sucursal_id')) if session.get('sucursal_id') else 620110)
        emblema_suc, col_clasif, nombre_suc = resolver_info_clasificacion_sucursal(alm_id_num)

        listas = resolver_listas_precios(conn)
        precio_taller_id = listas.get("talleres", 67032)
        precio_pub_id = listas.get("publico", 42)

        # Evaluar condición del cliente si fue proporcionado
        cliente_id_param = request.args.get('cliente_id', '').strip()
        es_cliente_taller = False
        if cliente_id_param and cliente_id_param.isdigit():
            try:
                cur.execute("SELECT TIPO_CLIENTE FROM CLIENTES WHERE CLIENTE_ID = ?", (int(cliente_id_param),))
                r_tc = cur.fetchone()
                if r_tc and r_tc[0]:
                    tc_str = str(r_tc[0]).upper()
                    if "TALLER" in tc_str or "FLOTILLA" in tc_str or "MAYOREO" in tc_str:
                        es_cliente_taller = True
            except:
                pass

        precio_venta_expr = "COALESCE(p_tal.PRECIO, p_pub.PRECIO, 0)" if es_cliente_taller else "COALESCE(p_pub.PRECIO, p_tal.PRECIO, 0)"

        cur.execute(f"""
            SELECT FIRST 1
                a.ARTICULO_ID,
                TRIM(ca.CLAVE_ARTICULO) AS CLAVE,
                TRIM(a.NOMBRE) AS NOMBRE,
                COALESCE(TRIM(la.EQUIVALENCIA1), '') AS EQUIV,
                {precio_venta_expr} AS PRECIO_VENTA,
                COALESCE(TRIM(li.NOMBRE), '') AS LINEA,
                COALESCE(p_pub.PRECIO, 0) AS PRECIO_PUBLICO,
                COALESCE(p_tal.PRECIO, 0) AS PRECIO_TALLER,
                COALESCE(TRIM(la.{col_clasif}), 'N/A') AS CLASIFICACION
            FROM ARTICULOS a
            JOIN CLAVES_ARTICULOS ca ON ca.ARTICULO_ID = a.ARTICULO_ID
            JOIN ROLES_CLAVES_ARTICULOS r ON r.ROL_CLAVE_ART_ID = ca.ROL_CLAVE_ART_ID AND r.ES_PPAL = 'S'
            LEFT JOIN LIBRES_ARTICULOS la ON la.ARTICULO_ID = a.ARTICULO_ID
            LEFT JOIN LINEAS_ARTICULOS li ON li.LINEA_ARTICULO_ID = a.LINEA_ARTICULO_ID
            LEFT JOIN PRECIOS_ARTICULOS p_tal ON p_tal.ARTICULO_ID = a.ARTICULO_ID AND p_tal.PRECIO_EMPRESA_ID = ?
            LEFT JOIN PRECIOS_ARTICULOS p_pub ON p_pub.ARTICULO_ID = a.ARTICULO_ID AND p_pub.PRECIO_EMPRESA_ID = ?
            WHERE UPPER(TRIM(ca.CLAVE_ARTICULO)) = UPPER(TRIM(?))
        """, (precio_taller_id, precio_pub_id, clave))

        art_row = cur.fetchone()
        if not art_row:
            cur.close()
            conn.close()
            return jsonify({"success": False, "error": f"Artículo '{clave}' no encontrado"}), 404

        art_id = int(art_row[0])
        clave_art = str(art_row[1]).strip()
        nombre_art = str(art_row[2]).strip()
        equiv_art = str(art_row[3]).strip()
        precio_art = float(art_row[4] or 0)
        linea_art = str(art_row[5]).strip()
        precio_pub_art = float(art_row[6] or 0)
        precio_tal_art = float(art_row[7] or 0)
        clasif_art = str(art_row[8]).strip() if (len(art_row) > 8 and art_row[8]) else "N/A"
        if not clasif_art:
            clasif_art = "N/A"

        # Obtener clasificaciones de todas las sucursales para este artículo
        clasif_sucursales_map = {}
        try:
            cur.execute("""
                SELECT 
                    COALESCE(TRIM(C_CEDIS_S), 'N/A'),
                    COALESCE(TRIM(C_SAULO_S), 'N/A'),
                    COALESCE(TRIM(C_BRAVO_S), 'N/A'),
                    COALESCE(TRIM(C_DIVISION_S), 'N/A'),
                    COALESCE(TRIM(C_REVOLUCION_S), 'N/A'),
                    COALESCE(TRIM(C_TAJITO_S), 'N/A'),
                    COALESCE(TRIM(C_ARTESG_S), 'N/A'),
                    COALESCE(TRIM(C_NAZAS_S), 'N/A'),
                    COALESCE(TRIM(C_AEROPUERTO_S), 'N/A'),
                    COALESCE(TRIM(C_FCOIMADERO_S), 'N/A'),
                    COALESCE(TRIM(C_CARDENAS_S), 'N/A'),
                    COALESCE(TRIM(C_GHIDALGO_S), 'N/A'),
                    COALESCE(TRIM(C_MATAMOROS_S), 'N/A'),
                    COALESCE(TRIM(C_ALMGOGPE_S), 'N/A'),
                    COALESCE(TRIM(C_SALTILLO_S), 'N/A')
                FROM LIBRES_ARTICULOS
                WHERE ARTICULO_ID = ?
            """, (art_id,))
            r_c = cur.fetchone()
            if r_c:
                cols_nombres = [
                    "C_CEDIS_S", "C_SAULO_S", "C_BRAVO_S", "C_DIVISION_S", "C_REVOLUCION_S",
                    "C_TAJITO_S", "C_ARTESG_S", "C_NAZAS_S", "C_AEROPUERTO_S", "C_FCOIMADERO_S",
                    "C_CARDENAS_S", "C_GHIDALGO_S", "C_MATAMOROS_S", "C_ALMGOGPE_S", "C_SALTILLO_S"
                ]
                for idx_col, col_name in enumerate(cols_nombres):
                    val = str(r_c[idx_col]).strip() if r_c[idx_col] else "N/A"
                    clasif_sucursales_map[col_name] = val if val else "N/A"
        except Exception as e_c:
            print("Aviso al consultar clasificaciones por sucursal:", e_c)

        # Existencias desglosadas por almacén
        cur.execute("""
            SELECT 
                a.ALMACEN_ID,
                TRIM(a.NOMBRE) AS NOMBRE_ALMACEN,
                COALESCE(SUM(s.ENTRADAS_UNIDADES - s.SALIDAS_UNIDADES), 0) AS EXISTENCIA
            FROM ALMACENES a
            LEFT JOIN SALDOS_IN s ON s.ALMACEN_ID = a.ALMACEN_ID AND s.ARTICULO_ID = ?
            WHERE a.NOMBRE NOT LIKE 'NO UTILIZAR%'
            GROUP BY a.ALMACEN_ID, a.NOMBRE
            HAVING COALESCE(SUM(s.ENTRADAS_UNIDADES - s.SALIDAS_UNIDADES), 0) > 0
            ORDER BY 
                CASE WHEN UPPER(a.NOMBRE) LIKE '%CEDIS%' THEN 0 ELSE 1 END,
                EXISTENCIA DESC
        """, (art_id,))
        
        existencias_almacenes = []
        almacenes_bc = []
        stock_bc_total = 0
        stock_tu_almacen = 0
        stock_cedis = 0

        for r_alm in cur.fetchall():
            alm_id = int(r_alm[0])
            nom_alm = str(r_alm[1]).strip()
            pzas = max(0, int(r_alm[2] or 0))
            stock_bc_total += pzas

            if alm_id_num and alm_id == alm_id_num:
                stock_tu_almacen = pzas
            if alm_id == 620110 or 'CEDIS' in nom_alm.upper():
                stock_cedis += pzas

            alm_emb, alm_col, _ = resolver_info_clasificacion_sucursal(alm_id, nom_alm)
            alm_clasif = clasif_sucursales_map.get(alm_col, "N/A")

            item_alm = {
                "almacen_id": alm_id,
                "nombre": nom_alm,
                "piezas": pzas,
                "empresa": "BC",
                "comprometidas": 1 if "CEDIS" in nom_alm or "AEROPUERTO" in nom_alm else 0,
                "clasificacion": alm_clasif,
                "emblema": alm_emb
            }
            almacenes_bc.append(item_alm)
            existencias_almacenes.append(item_alm)

        # Existencias en RT
        almacenes_rt = obtener_almacenes_rt_por_clave(clave_art)
        stock_rt_total = sum(a["piezas"] for a in almacenes_rt)
        for a_rt in almacenes_rt:
            existencias_almacenes.append(a_rt)

        total_piezas = stock_bc_total + stock_rt_total

        # Equivalencias (hasta 20)
        equivalencias = []
        precio_eq_expr = "COALESCE(p_tal.PRECIO, p_pub.PRECIO, 0)" if es_cliente_taller else "COALESCE(p_pub.PRECIO, p_tal.PRECIO, 0)"
        if equiv_art:
            cur.execute(f"""
                SELECT FIRST 20
                    a.ARTICULO_ID,
                    TRIM(ca.CLAVE_ARTICULO) AS CLAVE,
                    TRIM(a.NOMBRE) AS NOMBRE,
                    {precio_eq_expr} AS PRECIO,
                    COALESCE(TRIM(la.{col_clasif}), 'N/A') AS CLASIFICACION
                FROM ARTICULOS a
                JOIN CLAVES_ARTICULOS ca ON ca.ARTICULO_ID = a.ARTICULO_ID
                JOIN ROLES_CLAVES_ARTICULOS r ON r.ROL_CLAVE_ART_ID = ca.ROL_CLAVE_ART_ID AND r.ES_PPAL = 'S'
                LEFT JOIN LIBRES_ARTICULOS la ON la.ARTICULO_ID = a.ARTICULO_ID
                LEFT JOIN PRECIOS_ARTICULOS p_pub ON p_pub.ARTICULO_ID = a.ARTICULO_ID AND p_pub.PRECIO_EMPRESA_ID = ?
                LEFT JOIN PRECIOS_ARTICULOS p_tal ON p_tal.ARTICULO_ID = a.ARTICULO_ID AND p_tal.PRECIO_EMPRESA_ID = ?
                WHERE (UPPER(TRIM(la.EQUIVALENCIA1)) = UPPER(TRIM(?)) OR UPPER(TRIM(ca.CLAVE_ARTICULO)) = UPPER(TRIM(?)))
                  AND a.ARTICULO_ID <> ?
                ORDER BY a.NOMBRE ASC
            """, (precio_pub_id, precio_taller_id, equiv_art, equiv_art, art_id))

            eq_rows = cur.fetchall()
            eq_ids = [int(r[0]) for r in eq_rows if r[0] is not None]
            eq_stock_bc_map = defaultdict(int)
            if eq_ids:
                ph_eq = ",".join("?" for _ in eq_ids)
                cur.execute(f"""
                    SELECT ARTICULO_ID, SUM(ENTRADAS_UNIDADES - SALIDAS_UNIDADES)
                    FROM SALDOS_IN
                    WHERE ARTICULO_ID IN ({ph_eq})
                    GROUP BY ARTICULO_ID
                """, eq_ids)
                for r_stk in cur.fetchall():
                    eq_stock_bc_map[int(r_stk[0])] = max(0, int(float(r_stk[1] or 0)))

            eq_claves = [str(r[1]).strip() for r in eq_rows if r[1]]
            eq_stock_rt_map = obtener_saldos_rt_por_claves(eq_claves)

            for r_eq in eq_rows:
                eq_id = int(r_eq[0])
                eq_clv = str(r_eq[1]).strip()
                stk_bc_eq = eq_stock_bc_map.get(eq_id, 0)
                stk_rt_eq = int(eq_stock_rt_map.get(eq_clv.upper(), 0))
                eq_clasif = str(r_eq[4]).strip() if (len(r_eq) > 4 and r_eq[4]) else "N/A"
                if not eq_clasif:
                    eq_clasif = "N/A"
                equivalencias.append({
                    "articulo_id": eq_id,
                    "clave": eq_clv,
                    "nombre": str(r_eq[2]).strip(),
                    "precio": float(r_eq[3] or 0),
                    "stock_bc": stk_bc_eq,
                    "stock_rt": stk_rt_eq,
                    "stock": stk_bc_eq + stk_rt_eq,
                    "clasificacion": eq_clasif
                })

            # Ordenar equivalencias por existencia descendente (prioridad piezas con stock en BC y total)
            equivalencias.sort(key=lambda x: (x.get("stock_bc", 0) > 0, x.get("stock", 0), x.get("stock_bc", 0)), reverse=True)

        # Verificar foto
        tiene_foto = False
        try:
            cur.execute("SELECT FIRST 1 IMAGEN_ARTICULO_ID FROM IMAGENES_ARTICULOS WHERE ARTICULO_ID = ? AND IMAGEN IS NOT NULL", (art_id,))
            tiene_foto = cur.fetchone() is not None
        except Exception:
            pass

        cur.close()
        conn.close()

        return jsonify({
            "success": True,
            "articulo": {
                "articulo_id": art_id,
                "clave": clave_art,
                "nombre": nombre_art,
                "equivalencia": equiv_art,
                "precio": precio_art,
                "precio_publico": precio_pub_art,
                "precio_taller": precio_tal_art,
                "linea": linea_art,
                "clasificacion": clasif_art,
                "emblema_sucursal": emblema_suc,
                "nombre_sucursal": nombre_suc,
                "tiene_foto": tiene_foto,
                "foto_url": f"/api/articulos/foto/{art_id}" if tiene_foto else None,
                "total_piezas": total_piezas,
                "stock_bc_total": stock_bc_total,
                "stock_rt_total": stock_rt_total,
                "stock_tu_almacen": stock_tu_almacen,
                "stock_cedis": stock_cedis,
                "existencias_almacenes": existencias_almacenes,
                "almacenes_bc": almacenes_bc,
                "almacenes_rt": almacenes_rt,
                "equivalencias": equivalencias
            }
        })
    except Exception as e:
        if conn: conn.close()
        return jsonify({"success": False, "error": str(e)}), 500

# ================= 4. ENVIAR A CAJA (ORDEN DE VENTA MICROSIP) =================

@pv_bp.route('/api/pv/enviar-a-caja', methods=['POST'])
def enviar_a_caja():
    data = request.get_json() or {}
    cliente_id = data.get('cliente_id')
    almacen_id = data.get('almacen_id')
    vendedor_id = data.get('vendedor_id')
    caja_id = data.get('caja_id')
    partidas = data.get('partidas', [])
    observaciones = str(data.get('observaciones', '')).strip()

    if not partidas:
        return jsonify({"success": False, "error": "No hay partidas en el punto de venta para enviar a caja."}), 400

    conn = None
    try:
        conn = conectar_db()
        cur = conn.cursor()

        # 1. Determinar Almacén y Sucursal
        usr_sucursal_id = session.get('sucursal_id')
        if not almacen_id and usr_sucursal_id:
            almacen_id = int(usr_sucursal_id)

        if not almacen_id:
            cur.execute("SELECT FIRST 1 ALMACEN_ID FROM ALMACENES WHERE UPPER(NOMBRE) LIKE '%CEDIS%' OR ES_PPAL = 'S'")
            row_a = cur.fetchone()
            almacen_id = int(row_a[0]) if row_a else 1800730
        else:
            almacen_id = int(almacen_id)

        sucursal_id = 1236917
        try:
            cur.execute("SELECT FIRST 1 SUCURSAL_ID FROM SUCURSALES WHERE ES_MATRIZ = 'S' OR ES_MATRIZ = 1")
            r_mat = cur.fetchone()
            if r_mat and r_mat[0]:
                sucursal_id = int(r_mat[0])
        except:
            pass

        # 2. Determinar Caja y Cajero de la sucursal seleccionada
        if not caja_id:
            cur.execute("SELECT FIRST 1 CAJA_ID FROM CAJAS WHERE ALMACEN_ID = ? AND PERMITE_COBRAR = 'S'", (almacen_id,))
            row_c = cur.fetchone()
            if row_c:
                caja_id = int(row_c[0])
            else:
                cur.execute("SELECT FIRST 1 CAJA_ID FROM CAJAS WHERE ALMACEN_ID = ?", (almacen_id,))
                row_c2 = cur.fetchone()
                if row_c2:
                    caja_id = int(row_c2[0])
                else:
                    cur.execute("SELECT FIRST 1 CAJA_ID FROM CAJAS WHERE PERMITE_COBRAR = 'S'")
                    row_cg = cur.fetchone()
                    caja_id = int(row_cg[0]) if row_cg else 1807505
        else:
            caja_id = int(caja_id)

        cajero_id = None
        try:
            cur.execute("SELECT FIRST 1 CAJERO_ID FROM DOCTOS_PV WHERE CAJA_ID = ? AND CAJERO_ID IS NOT NULL ORDER BY DOCTO_PV_ID DESC", (caja_id,))
            r_caj = cur.fetchone()
            if r_caj and r_caj[0]:
                cajero_id = int(r_caj[0])
            else:
                cur.execute("SELECT FIRST 1 CAJERO_ID FROM CAJEROS")
                r_caj_gen = cur.fetchone()
                cajero_id = int(r_caj_gen[0]) if r_caj_gen else None
        except:
            cajero_id = None

        # 3. Determinar Vendedor (de usuario, payload o vendedor de la sucursal)
        usr_vendedor_id = session.get('vendedor_id')
        if not vendedor_id and usr_vendedor_id:
            vendedor_id = int(usr_vendedor_id)

        if not vendedor_id:
            # Buscar vendedor por coincidencia de nombre de sucursal
            cur.execute("SELECT NOMBRE FROM ALMACENES WHERE ALMACEN_ID = ?", (almacen_id,))
            alm_r = cur.fetchone()
            alm_nom = str(alm_r[0]).strip().upper() if alm_r else ""
            palabras = [w for w in alm_nom.replace("SUCURSAL", "").replace("NO UTILIZAR", "").split() if len(w) > 3]
            v_encontrado = None
            for p in palabras:
                cur.execute("SELECT FIRST 1 VENDEDOR_ID FROM VENDEDORES WHERE UPPER(NOMBRE) LIKE ? AND (OCULTO IS NULL OR OCULTO <> 'S')", (f"%{p}%",))
                rv = cur.fetchone()
                if rv and rv[0]:
                    v_encontrado = int(rv[0])
                    break

            if v_encontrado:
                vendedor_id = v_encontrado
            else:
                cur.execute("SELECT FIRST 1 VENDEDOR_ID FROM VENDEDORES WHERE OCULTO IS NULL OR OCULTO <> 'S'")
                row_v = cur.fetchone()
                vendedor_id = int(row_v[0]) if row_v else 1808066
        else:
            vendedor_id = int(vendedor_id)

        # 4. Determinar Cliente
        clave_cliente = None
        if not cliente_id:
            cur.execute("SELECT FIRST 1 CLIENTE_ID FROM CLIENTES WHERE UPPER(NOMBRE) LIKE '%MOSTRADOR%'")
            row_cl = cur.fetchone()
            cliente_id = int(row_cl[0]) if row_cl else 165529
        else:
            cliente_id = int(cliente_id)

        try:
            cur.execute("SELECT FIRST 1 TRIM(CLAVE_CLIENTE) FROM CLAVES_CLIENTES WHERE CLIENTE_ID = ?", (cliente_id,))
            r_cc = cur.fetchone()
            if r_cc and r_cc[0]:
                clave_cliente = str(r_cc[0]).strip()
        except:
            clave_cliente = None

        # 5. Obtener Serie y Consecutivo desde FOLIOS_CAJAS para TIPO_DOCTO = 'O'
        cur.execute("SELECT SERIE, CONSECUTIVO FROM FOLIOS_CAJAS WHERE CAJA_ID = ? AND TIPO_DOCTO = 'O'", (caja_id,))
        row_fc = cur.fetchone()
        if row_fc:
            prefijo = str(row_fc[0]).strip() if row_fc[0] else 'XG'
            consec_num = int(row_fc[1] or 0) + 1
            folio = f"{prefijo}{consec_num:07d}"
            # Incrementar consecutivo
            cur.execute("UPDATE FOLIOS_CAJAS SET CONSECUTIVO = ? WHERE CAJA_ID = ? AND TIPO_DOCTO = 'O'", (consec_num, caja_id))
        else:
            # Fallback seguro
            cur.execute("SELECT COALESCE(MAX(DOCTO_PV_ID), 0) FROM DOCTOS_PV")
            max_id = int(cur.fetchone()[0] or 1)
            folio = f"OV{max_id % 1000000:07d}"

        # 6. Calcular Totales
        ahorro_total = 0.0
        bonificacion_total = 0.0
        importe_neto_total = 0.0
        iva_total = 0.0

        # Validar existencia local en el almacén de venta antes de generar la orden
        for p in partidas:
            art_id_raw = p.get('articulo_id')
            if str(art_id_raw).startswith('BONIF_'):
                continue
            try:
                art_id_num = int(art_id_raw)
            except:
                continue
            clave_art = str(p.get('clave', '')).strip()
            cantidad = float(p.get('cantidad', 1))

            cur.execute("""
                SELECT COALESCE(SUM(ENTRADAS_UNIDADES - SALIDAS_UNIDADES), 0)
                FROM SALDOS_IN
                WHERE ARTICULO_ID = ? AND ALMACEN_ID = ?
            """, (art_id_num, almacen_id))
            row_stk = cur.fetchone()
            stk_actual = float(row_stk[0] or 0) if row_stk else 0.0
            if stk_actual < cantidad:
                cur.close()
                conn.close()
                return jsonify({
                    "success": False,
                    "error": f"Existencia física insuficiente en tu sucursal para '{clave_art}'. Disponible: {int(stk_actual)}, Solicitado: {int(cantidad)}. Si hay en CEDIS, solicite el traspaso a CEDIS para autorización de Compras."
                }), 400

        for p in partidas:
            art_id = int(p.get('articulo_id'))
            clave_art = str(p.get('clave', '')).strip()
            cantidad = float(p.get('cantidad', 1))
            precio_con_impto = float(p.get('precio_unitario', 0))
            descuento_pct = float(p.get('descuento_pct', 0))

            # Precio neto sin IVA (16% IVA México)
            precio_neto_unit = round(precio_con_impto / 1.16, 6)
            importe_linea_neto = round(precio_neto_unit * cantidad * (1 - descuento_pct / 100.0), 2)
            iva_linea = round(importe_linea_neto * 0.16, 2)

            importe_neto_total += importe_linea_neto
            iva_total += iva_linea

            lineas_procesadas.append({
                "art_id": art_id,
                "clave": clave_art,
                "cantidad": cantidad,
                "precio_neto": precio_neto_unit,
                "precio_con_impto": precio_con_impto,
                "descuento_pct": descuento_pct,
                "total_neto": importe_linea_neto,
                "posicion": posicion
            })
            posicion += 1

            # Verificar si tiene bonificación asociada (ej. casco B03)
            bonif = p.get('bonificacion')
            if bonif and isinstance(bonif, dict) and bonif.get('monto'):
                m_bonif = float(bonif['monto'])
                bonificacion_total += m_bonif
                # Si existe clave de bonificación en ARTICULOS, agregar como partida de crédito
                clave_b = str(bonif.get('clave', 'B03')).strip()
                cur.execute("""
                    SELECT FIRST 1 a.ARTICULO_ID, a.NOMBRE 
                    FROM ARTICULOS a
                    JOIN CLAVES_ARTICULOS ca ON ca.ARTICULO_ID = a.ARTICULO_ID
                    WHERE UPPER(TRIM(ca.CLAVE_ARTICULO)) = UPPER(?)
                """, (clave_b,))
                r_b = cur.fetchone()
                if r_b:
                    b_art_id = int(r_b[0])
                    b_neto = round(m_bonif / 1.16, 6)
                    lineas_procesadas.append({
                        "art_id": b_art_id,
                        "clave": clave_b,
                        "cantidad": cantidad,
                        "precio_neto": b_neto,
                        "precio_con_impto": m_bonif,
                        "descuento_pct": 100.0,  # Bonificación descontada al 100%
                        "total_neto": b_neto,
                        "posicion": posicion
                    })
                    posicion += 1

        # Determinar usuario creador (de sesión web o respaldo POS_WEB)
        usr_sesion = session.get('usuario') or data.get('usuario') or 'POS_WEB'
        usuario_creador = str(usr_sesion).strip().upper()[:31]

        # 7. Insertar DOCTOS_PV (-1 activa trigger para generar ID_DOCTOS)
        ahora = datetime.datetime.now()
        cur.execute("""
            INSERT INTO DOCTOS_PV (
                DOCTO_PV_ID, CAJA_ID, TIPO_DOCTO, SUCURSAL_ID, FOLIO,
                FECHA, HORA, CAJERO_ID, CLAVE_CLIENTE, CLIENTE_ID,
                ALMACEN_ID, MONEDA_ID, IMPUESTO_INCLUIDO, TIPO_CAMBIO,
                TIPO_DSCTO, DSCTO_PCTJE, DSCTO_IMPORTE, ESTATUS, APLICADO,
                IMPORTE_NETO, TOTAL_IMPUESTOS, TOTAL_RETENCIONES, PESO_EMBARQUE,
                IMPORTE_DONATIVO, TOTAL_FPGC, TICKET_EMITIDO, FORMA_GLOBAL_EMITIDA,
                FORMA_EMITIDA, CONTABILIZADO, SISTEMA_ORIGEN, PROCESO_ORIGEN,
                VENDEDOR_ID, CARGAR_SUN, ES_FAC_GLOBAL, INCL_FACTURADOS_FAC_GLOBAL,
                UNID_COMPROM, ES_CFD, ENVIADO, USUARIO_CREADOR, CFDI_CERTIFICADO,
                PRECIO_ORIG_PARTIDA_AJUSTE, FECHA_HORA_CREACION, DESCRIPCION
            ) VALUES (
                -1, ?, 'O', ?, ?,
                CURRENT_DATE, CURRENT_TIME, ?, ?, ?,
                ?, 1, 'S', 1.0,
                'P', 0, 0, 'P', 'S',
                ?, ?, 0, 0,
                0, 0, 'N', 'N',
                'N', 'N', 'PV', 'N',
                ?, 'S', 'N', 'N',
                'S', 'N', 'N', ?, 'N',
                0, CURRENT_TIMESTAMP, ?
            )
        """, (
            caja_id, sucursal_id, folio,
            cajero_id, clave_cliente, cliente_id,
            almacen_id,
            round(importe_neto_total, 2), round(iva_total, 2),
            vendedor_id, usuario_creador, observaciones or None
        ))

        # Obtener el DOCTO_PV_ID generado
        cur.execute("SELECT FIRST 1 DOCTO_PV_ID FROM DOCTOS_PV WHERE FOLIO = ? ORDER BY DOCTO_PV_ID DESC", (folio,))
        r_gen = cur.fetchone()
        docto_pv_id = int(r_gen[0]) if r_gen else -1

        # 8. Insertar Partidas en DOCTOS_PV_DET
        for lp in lineas_procesadas:
            cur.execute("""
                INSERT INTO DOCTOS_PV_DET (
                    DOCTO_PV_DET_ID, DOCTO_PV_ID, CLAVE_ARTICULO, ARTICULO_ID,
                    UNIDADES, UNIDADES_DEV, UNIDADES_SURT, UNIDADES_A_SURTIR,
                    TIPO_CONTAB_UNID, PRECIO_UNITARIO, PRECIO_UNITARIO_IMPTO,
                    IMPUESTO_POR_UNIDAD, PCTJE_DSCTO, PRECIO_TOTAL_NETO,
                    PRECIO_MODIFICADO, VENDEDOR_ID, PCTJE_COMIS, ROL,
                    ES_TRAN_ELECT, POSICION, DSCTO_ART, DSCTO_EXTRA
                ) VALUES (
                    -1, ?, ?, ?,
                    ?, 0, 0, 0,
                    '0', ?, ?,
                    0, ?, ?,
                    'P', ?, 2.0, 'N',
                    'N', ?, 0, 0
                )
            """, (
                docto_pv_id, lp["clave"], lp["art_id"],
                lp["cantidad"],
                lp["precio_neto"], lp["precio_con_impto"],
                lp["descuento_pct"], lp["total_neto"],
                vendedor_id, lp["posicion"]
            ))

        # 9. Afectar unidades comprometidas para que cuadren inventarios y permita cobro o cancelación
        try:
            cur.execute("EXECUTE PROCEDURE AFECTA_UNID_COMPROM_PV ?, 1", (docto_pv_id,))
        except Exception as e_comprom:
            print("Aviso al afectar unidades comprometidas:", e_comprom)

        conn.commit()
        cur.close()
        conn.close()

        total_a_pagar = round(importe_neto_total + iva_total - bonificacion_total, 2)

        return jsonify({
            "success": True,
            "folio": folio,
            "docto_pv_id": docto_pv_id,
            "total_a_pagar": total_a_pagar,
            "total_partidas": len(lineas_procesadas),
            "mensaje": f"Orden de venta enviada a caja exitosamente con folio {folio}."
        })
    except Exception as e:
        if conn:
            try: conn.rollback()
            except: pass
            conn.close()
        return jsonify({"success": False, "error": str(e)}), 500


# ================= 6. SOLICITUDES DE TRASPASO A CEDIS (VALIDADAS POR COMPRAS) =================

@pv_bp.route('/api/pv/solicitar-traspaso-cedis', methods=['POST'])
def solicitar_traspaso_cedis():
    if 'usuario' not in session:
        return jsonify({"success": False, "error": "No has iniciado sesión"}), 401

    data = request.get_json() or {}
    art_id = data.get('articulo_id')
    clave = str(data.get('clave', '')).strip().upper()
    nombre = str(data.get('nombre', '')).strip()
    try:
        cantidad = float(data.get('cantidad', 1))
    except:
        cantidad = 1.0

    sucursal_destino_id = data.get('sucursal_destino_id') or session.get('sucursal_id')
    sucursal_destino_nombre = str(data.get('sucursal_destino_nombre') or session.get('sucursal_nombre') or 'SUCURSAL').strip()
    cliente_nombre = str(data.get('cliente_nombre', '')).strip()
    notas = str(data.get('notas', '')).strip()

    if not art_id or not clave or cantidad <= 0 or not sucursal_destino_id:
        return jsonify({"success": False, "error": "Datos incompletos para solicitar el traspaso"}), 400

    # Consultar existencias reales en CEDIS (620110) y sucursal solicitante
    stock_cedis = 0
    stock_local = 0
    conn = None
    try:
        conn = conectar_db()
        cur = conn.cursor()
        cur.execute("""
            SELECT ALMACEN_ID, SUM(ENTRADAS_UNIDADES - SALIDAS_UNIDADES)
            FROM SALDOS_IN
            WHERE ARTICULO_ID = ? AND ALMACEN_ID IN (620110, ?)
            GROUP BY ALMACEN_ID
        """, (int(art_id), int(sucursal_destino_id)))
        for r in cur.fetchall():
            alm_id = int(r[0])
            stk = max(0, int(float(r[1] or 0)))
            if alm_id == 620110:
                stock_cedis = stk
            elif alm_id == int(sucursal_destino_id):
                stock_local = stk
        cur.close()
        conn.close()
    except Exception as e:
        if conn:
            try: conn.close()
            except: pass
        print("Error consultando stock CEDIS en solicitud traspaso:", e)

    if stock_cedis <= 0:
        return jsonify({
            "success": False,
            "error": f"El artículo {clave} no cuenta con existencias disponibles en CEDIS actualmente."
        }), 400

    # Guardar solicitud en SQLite con estatus PENDIENTE_COMPRAS (no se traspasa directo)
    ahora_dt = datetime.datetime.now()
    fecha_str = ahora_dt.strftime("%Y-%m-%d %H:%M:%S")
    folio_prefijo = f"SOL-{ahora_dt.strftime('%Y%m%d')}"

    conn_sq = conectar_sqlite()
    cur_sq = conn_sq.cursor()
    cur_sq.execute("SELECT COUNT(*) FROM solicitudes_traspasos WHERE folio LIKE ?", (f"{folio_prefijo}%",))
    num_consecutivo = (cur_sq.fetchone()[0] or 0) + 1
    folio = f"{folio_prefijo}-{num_consecutivo:03d}"

    usr_sol = session.get('usuario', 'CAJERO')
    vend_nom = session.get('vendedor_nombre') or session.get('nombre') or usr_sol

    cur_sq.execute("""
        INSERT INTO solicitudes_traspasos (
            folio, fecha_solicitud, sucursal_origen_id, sucursal_origen_nombre,
            sucursal_destino_id, sucursal_destino_nombre, articulo_id, clave, nombre,
            cantidad, stock_cedis_al_solicitar, stock_local_al_solicitar,
            cliente_nombre, notas, usuario_solicita, vendedor_nombre,
            estatus
        ) VALUES (?, ?, 620110, 'CEDIS', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDIENTE_COMPRAS')
    """, (
        folio, fecha_str, int(sucursal_destino_id), sucursal_destino_nombre,
        int(art_id), clave, nombre, cantidad, stock_cedis, stock_local,
        cliente_nombre, notas, usr_sol, vend_nom
    ))
    conn_sq.commit()
    conn_sq.close()

    return jsonify({
        "success": True,
        "folio": folio,
        "stock_cedis": stock_cedis,
        "mensaje": f"Solicitud {folio} registrada y enviada exitosamente a Compras para su validación y autorización."
    })

@pv_bp.route('/api/pv/mis-solicitudes-traspasos', methods=['GET'])
def mis_solicitudes_traspasos():
    suc_id = request.args.get('sucursal_id') or session.get('sucursal_id')
    conn_sq = conectar_sqlite()
    cur_sq = conn_sq.cursor()

    if suc_id:
        cur_sq.execute("""
            SELECT id, folio, fecha_solicitud, sucursal_destino_nombre, clave, nombre,
                   cantidad, stock_cedis_al_solicitar, cliente_nombre, notas,
                   usuario_solicita, vendedor_nombre, estatus, usuario_autoriza,
                   fecha_autorizacion, motivo_rechazo, folio_traspaso_generado
            FROM solicitudes_traspasos
            WHERE sucursal_destino_id = ?
            ORDER BY id DESC LIMIT 50
        """, (int(suc_id),))
    else:
        cur_sq.execute("""
            SELECT id, folio, fecha_solicitud, sucursal_destino_nombre, clave, nombre,
                   cantidad, stock_cedis_al_solicitar, cliente_nombre, notas,
                   usuario_solicita, vendedor_nombre, estatus, usuario_autoriza,
                   fecha_autorizacion, motivo_rechazo, folio_traspaso_generado
            FROM solicitudes_traspasos
            ORDER BY id DESC LIMIT 50
        """)

    solicitudes = []
    for r in cur_sq.fetchall():
        solicitudes.append({
            "id": r[0],
            "folio": r[1],
            "fecha": r[2],
            "sucursal_destino": r[3],
            "clave": r[4],
            "nombre": r[5],
            "cantidad": float(r[6] or 0),
            "stock_cedis_inicial": float(r[7] or 0),
            "cliente": r[8] or '',
            "notas": r[9] or '',
            "solicitado_por": r[10],
            "vendedor": r[11] or '',
            "estatus": r[12],
            "autorizado_por": r[13] or '',
            "fecha_autorizacion": r[14] or '',
            "motivo_rechazo": r[15] or '',
            "folio_traspaso": r[16] or ''
        })
    conn_sq.close()

    return jsonify({"success": True, "solicitudes": solicitudes})

# ================= COTIZACIONES FORMALES EN PDF =================

@pv_bp.route('/api/pv/cotizacion/pdf', methods=['POST'])
def generar_cotizacion_pdf():
    try:
        import os
        import datetime
        from app.services.cotizacion_pdf_service import generar_pdf_cotizacion

        data = request.get_json() or {}
        partidas = data.get('partidas', [])
        if not partidas:
            return jsonify({"success": False, "error": "No hay partidas para cotizar"}), 400

        now_dt = datetime.datetime.now()
        folio = data.get('folio') or f"COT-{now_dt.strftime('%Y%m%d-%H%M%S')}"
        data['folio'] = folio
        data['fecha'] = data.get('fecha') or now_dt.strftime('%Y-%m-%d %H:%M')

        filename = f"{folio}.pdf".replace(" ", "_").replace("/", "_").replace("\\", "_")
        static_dir = os.path.join(os.getcwd(), 'static', 'cotizaciones')
        os.makedirs(static_dir, exist_ok=True)
        pdf_path = os.path.join(static_dir, filename)

        total = generar_pdf_cotizacion(data, pdf_path)

        pdf_url = f"/static/cotizaciones/{filename}"
        return jsonify({
            "success": True,
            "folio": folio,
            "filename": filename,
            "pdf_url": pdf_url,
            "total": total
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


