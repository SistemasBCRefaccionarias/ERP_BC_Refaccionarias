import os
import re
import math
import sqlite3
import datetime
from collections import defaultdict
from app.db import conectar_db, conectar_sqlite
from app.config import SQLITE_DB

# Grupos excluidos administrativos por defecto (Acumuladores usados, Artículos de publicidad, Cargos, Insumos)
DEFAULT_GRUPOS_EXCLUIDOS = {521794, 1373505, 197314, 2050267}

# Grupos maestros sin filtrar por defecto (Bujías, Aceites, Filtros, Acumuladores, Químicos, etc.)
DEFAULT_GRUPOS_SIN_FILTRAR = {
    527174, 2144867, 99851, 2144878, 240807, 221477, 2144872, 521797, 
    99850, 2144868, 158630, 2144855, 158616, 521786, 521793, 620943, 521787, 
    521791, 2144880, 221670, 1045818, 2144909, 221728
}

# Diccionario de columnas de clasificación por almacén conocido
ALMACEN_CLASIF_MAP = {
    620110: "C_CEDIS_S",
    99934: "C_BRAVO_S",
    166719: "C_SAULO_S",
    412880: "C_DIVISION_S",
    158254: "C_REVOLUCION_S",
    202797: "C_TAJITO_S",
    1147933: "C_ARTESG_S",
    1254317: "C_NAZAS_S",
    1423447: "C_AEROPUERTO_S",
    1473736: "C_FCOIMADERO_S",
    1629323: "C_CARDENAS_S",
    1800730: "C_GHIDALGO_S",
    1820837: "C_MATAMOROS_S",
    486662: "C_EMPRESA_E",
    2168433: "C_ALMGOGPE_S"
}

_resurtidos_init_done = False

def init_resurtidos_sqlite():
    global _resurtidos_init_done
    if _resurtidos_init_done:
        return
    conn = conectar_sqlite()
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS config_multiplos (
            articulo_id INTEGER PRIMARY KEY,
            clave TEXT,
            multiplo INTEGER DEFAULT 1,
            actualizado_en TEXT DEFAULT ''
        )
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS config_resurtidos_grupos (
            tipo TEXT,
            grupo_id INTEGER,
            PRIMARY KEY (tipo, grupo_id)
        )
    """)
    cur.execute("SELECT COUNT(*) FROM config_resurtidos_grupos")
    if cur.fetchone()[0] == 0:
        for gid in DEFAULT_GRUPOS_EXCLUIDOS:
            cur.execute("INSERT OR IGNORE INTO config_resurtidos_grupos (tipo, grupo_id) VALUES ('excluido', ?)", (gid,))
        for gid in DEFAULT_GRUPOS_SIN_FILTRAR:
            cur.execute("INSERT OR IGNORE INTO config_resurtidos_grupos (tipo, grupo_id) VALUES ('sin_filtrar', ?)", (gid,))
        conn.commit()
    conn.commit()
    conn.close()
    _resurtidos_init_done = True

def obtener_grupos_config_sqlite():
    init_resurtidos_sqlite()
    conn = conectar_sqlite()
    cur = conn.cursor()
    cur.execute("SELECT tipo, grupo_id FROM config_resurtidos_grupos")
    excluidos = set()
    sin_filtrar = set()
    for tipo, gid in cur.fetchall():
        if tipo == 'excluido':
            excluidos.add(int(gid))
        elif tipo == 'sin_filtrar':
            sin_filtrar.add(int(gid))
    conn.close()
    return excluidos, sin_filtrar

def guardar_grupos_config_sqlite(excluidos_ids, sin_filtrar_ids):
    init_resurtidos_sqlite()
    conn = conectar_sqlite()
    cur = conn.cursor()
    cur.execute("DELETE FROM config_resurtidos_grupos")
    for gid in set(excluidos_ids or []):
        try:
            cur.execute("INSERT OR REPLACE INTO config_resurtidos_grupos (tipo, grupo_id) VALUES ('excluido', ?)", (int(gid),))
        except Exception:
            pass
    for gid in set(sin_filtrar_ids or []):
        try:
            cur.execute("INSERT OR REPLACE INTO config_resurtidos_grupos (tipo, grupo_id) VALUES ('sin_filtrar', ?)", (int(gid),))
        except Exception:
            pass
    conn.commit()
    conn.close()
    return True

def obtener_catalogo_grupos_lineas():
    init_resurtidos_sqlite()
    excluidos, sin_filtrar = obtener_grupos_config_sqlite()
    conn = conectar_db()
    cur = conn.cursor()
    cur.execute("SELECT GRUPO_LINEA_ID, TRIM(NOMBRE) FROM GRUPOS_LINEAS ORDER BY NOMBRE")
    grupos = []
    for r in cur.fetchall():
        gid = int(r[0])
        grupos.append({
            "grupo_id": gid,
            "nombre": str(r[1] or '').strip(),
            "es_excluido": gid in excluidos,
            "es_sin_filtrar": gid in sin_filtrar
        })
    conn.close()
    return {
        "grupos": grupos,
        "grupos_excluidos": sorted(list(excluidos)),
        "grupos_sin_filtrar": sorted(list(sin_filtrar))
    }

def extraer_multiplo_nombre(nombre):
    """Detecta empaque/múltiplo común dentro del nombre del artículo."""
    if not nombre:
        return 1
    txt = nombre.upper()
    
    m = re.search(r'\bC[/]?(?:AJA)?\s*(\d{1,3})\b', txt)
    if m:
        val = int(m.group(1))
        if 2 <= val <= 500:
            return val
            
    m = re.search(r'\bCC[/]?(\d{1,3})\b', txt)
    if m:
        val = int(m.group(1))
        if 2 <= val <= 500:
            return val

    m = re.search(r'\b(?:PQ|PAQ|PAQUETE)\s*(\d{1,3})\b', txt)
    if m:
        val = int(m.group(1))
        if 2 <= val <= 500:
            return val

    m = re.search(r'\b(?:JGO|JUEGO)\s*(?:DE\s*)?(\d{1,2})\b', txt)
    if m:
        val = int(m.group(1))
        if 2 <= val <= 20:
            return val

    m = re.search(r'\((\d{1,3})\s*(?:PZAS?|PZS?|PZA)?\)', txt)
    if m:
        val = int(m.group(1))
        if 2 <= val <= 500:
            return val

    m = re.search(r'\(MULT\.?\s*(\d{1,3})\)', txt)
    if m:
        val = int(m.group(1))
        if 2 <= val <= 500:
            return val

    return 1

def obtener_catalogos_resurtidos():
    """Devuelve almacenes, columnas de clasificación disponibles y parámetros iniciales."""
    init_resurtidos_sqlite()
    conn = conectar_db()
    cur = conn.cursor()

    # 1. Almacenes activos
    cur.execute("""
        SELECT ALMACEN_ID, TRIM(NOMBRE) 
        FROM ALMACENES 
        WHERE TRIM(NOMBRE) NOT STARTING WITH 'NO UTILIZAR'
        ORDER BY NOMBRE
    """)
    almacenes = []
    for aid, nom in cur.fetchall():
        aid_int = int(aid)
        almacenes.append({
            "almacen_id": aid_int,
            "nombre": nom,
            "clasif_sugerida": ALMACEN_CLASIF_MAP.get(aid_int, "C_EMPRESA_E")
        })

    # 2. Columnas de clasificación existentes en LIBRES_ARTICULOS
    cur.execute("""
        SELECT TRIM(RDB$FIELD_NAME) 
        FROM RDB$RELATION_FIELDS 
        WHERE RDB$RELATION_NAME = 'LIBRES_ARTICULOS'
          AND (RDB$FIELD_NAME STARTING WITH 'C_' OR RDB$FIELD_NAME LIKE '%CLASIF%')
        ORDER BY RDB$FIELD_POSITION
    """)
    cols_clasif = [r[0] for r in cur.fetchall()]
    if "C_EMPRESA_E" not in cols_clasif:
        cols_clasif.insert(0, "C_EMPRESA_E")

    conn.close()

    hoy = datetime.date.today()
    meses_ant = 6
    dias_atras = 1 # Por defecto 1 día atrás (ayer) como corte de venta reciente en el sistema
    fecha_ini = hoy - datetime.timedelta(days=183)
    fecha_dias_antes = hoy - datetime.timedelta(days=dias_atras)

    return {
        "almacenes": almacenes,
        "columnas_clasificacion": cols_clasif,
        "cedis_default_id": 620110,
        "fecha_final": hoy.strftime("%Y-%m-%d"),
        "fecha_inicio": fecha_ini.strftime("%Y-%m-%d"),
        "fecha_dias_antes": fecha_dias_antes.strftime("%Y-%m-%d"),
        "meses_ant": meses_ant,
        "vta_dias_atras": dias_atras,
        "dias_inventario": 15,
        "periodo_resurtido_dias": 4
    }

def obtener_multiplos_sqlite():
    """Obtiene mapa de múltiplos guardados en SQLite."""
    conn = conectar_sqlite()
    cur = conn.cursor()
    cur.execute("SELECT articulo_id, multiplo FROM config_multiplos")
    res = {int(r[0]): int(r[1]) for r in cur.fetchall()}
    conn.close()
    return res

def guardar_multiplo_articulo(articulo_id, clave, multiplo):
    """Guarda múltiplo en SQLite y actualiza LIBRES_ARTICULOS.MULTIPLO en Microsip."""
    init_resurtidos_sqlite()
    aid = int(articulo_id)
    mult = max(1, int(multiplo))
    ahora = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    conn_sq = conectar_sqlite()
    cur_sq = conn_sq.cursor()
    cur_sq.execute("""
        INSERT INTO config_multiplos (articulo_id, clave, multiplo, actualizado_en)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(articulo_id) DO UPDATE SET
            multiplo = excluded.multiplo,
            actualizado_en = excluded.actualizado_en
    """, (aid, clave, mult, ahora))
    conn_sq.commit()
    conn_sq.close()

    try:
        conn_fb = conectar_db()
        cur_fb = conn_fb.cursor()
        cur_fb.execute("UPDATE LIBRES_ARTICULOS SET MULTIPLO = ? WHERE ARTICULO_ID = ?", (mult, aid))
        conn_fb.commit()
        conn_fb.close()
    except Exception as e:
        print(f"Aviso: no se pudo actualizar MULTIPLO en Microsip ({e})")

    return True

def calcular_planeacion_resurtidos(params):
    """
    Motor central de planeación de resurtidos con:
    1. Promedios enteros: round(Vta / meses) y round(P6m / 2.0).
    2. Exclusión de grupos administrativos (Acumuladores usados, Insumos, Publicidad, Cargos).
    3. Líneas maestras sin filtrar (SF) con stock mínimo garantizado.
    4. Tratamiento exacto de grupos de equivalencias (anulación si la sucursal ya tiene stock, 
       y selección de único Artículo Sugerido 'AS' por existencias en CEDIS).
    5. Soporte para modo de clasificación Dinámica (Pareto ABC+D) o Catálogo Microsip.
    6. Múltiplos estrictos de venta / empaque sin abrir paquetes.
    """
    alm_id = int(params.get('almacen_id', 99934))
    clasif_col = str(params.get('clasif_col', 'C_BRAVO_S')).strip()
    cedis_id = int(params.get('cedis_id', 620110))
    clasif_cedis_col = str(params.get('clasif_cedis_col', 'C_CEDIS_S')).strip()
    
    fecha_ini = str(params.get('fecha_inicio', '2026-04-05')).strip()
    fecha_fin = str(params.get('fecha_final', '2026-10-05')).strip()
    fecha_dias_antes = str(params.get('fecha_dias_antes', '2026-10-01')).strip()
    
    dias_inv = max(1, int(params.get('dias_inventario', 15)))
    meses_ant = max(1, int(params.get('meses_ant', 6)))
    reservar_minimo_cedis = bool(params.get('reservar_minimo_cedis', True))
    modo_clasificacion = str(params.get('modo_clasificacion', 'catalogo')).lower().strip() # 'catalogo' por defecto (como sistema anterior) o 'dinamica'
    respetar_multiplos = bool(params.get('respetar_multiplos', True))
    
    raw_clasifs = params.get('clasificaciones_incluir', ['A', 'B'])
    if not isinstance(raw_clasifs, (list, set, tuple)):
        raw_clasifs = ['A', 'B']
    selected_clasifs = {str(c).upper().strip() for c in raw_clasifs if str(c).strip()}

    excluidos_db, sin_filtrar_db = obtener_grupos_config_sqlite()
    if 'grupos_excluidos' in params and isinstance(params['grupos_excluidos'], (list, set, tuple)):
        grupos_excluidos = {int(x) for x in params['grupos_excluidos']}
    else:
        grupos_excluidos = excluidos_db

    if 'grupos_sin_filtrar' in params and isinstance(params['grupos_sin_filtrar'], (list, set, tuple)):
        grupos_sin_filtrar = {int(x) for x in params['grupos_sin_filtrar']}
    else:
        grupos_sin_filtrar = sin_filtrar_db

    conn = conectar_db()
    cur = conn.cursor()

    # 1. Resolver fecha_final exclusiva para incluir hasta el final del último día (según SISBCWEB)
    try:
        fecha_fin_dt = datetime.datetime.strptime(fecha_fin, "%Y-%m-%d").date()
        fecha_fin_exclusiva = (fecha_fin_dt + datetime.timedelta(days=1)).strftime("%Y-%m-%d")
    except Exception:
        fecha_fin_exclusiva = fecha_fin

    # 2. Consultar ventas unificadas en Facturación (DOCTOS_VE) y Punto de Venta (DOCTOS_PV) según SISBCWEB
    sql_ventas = """
        SELECT S.ARTICULO_ID,
               SUM(S.UNIDADES) AS VENTA_PIEZAS,
               COUNT(DISTINCT S.DOCTO_ID) AS EVENTOS,
               SUM(CASE WHEN S.FECHA >= ? THEN S.UNIDADES ELSE 0 END) AS VENTA_DIAS_ANTES
          FROM (
            SELECT DV.DOCTO_VE_ID AS DOCTO_ID, DV.FECHA, DVD.ARTICULO_ID,
                   CASE WHEN DV.TIPO_DOCTO = 'D' THEN DVD.UNIDADES * -1 ELSE DVD.UNIDADES END AS UNIDADES
              FROM DOCTOS_VE DV
              JOIN DOCTOS_VE_DET DVD ON DVD.DOCTO_VE_ID = DV.DOCTO_VE_ID
             WHERE DV.FECHA >= ? AND DV.FECHA < ? AND DV.ALMACEN_ID = ?
               AND DV.TIPO_DOCTO IN ('F', 'D') AND DV.ESTATUS <> 'C' AND DV.APLICADO = 'S'
            UNION ALL
            SELECT DP.DOCTO_PV_ID AS DOCTO_ID, DP.FECHA, DPD.ARTICULO_ID,
                   CASE WHEN DP.TIPO_DOCTO = 'D'
                        THEN (DPD.UNIDADES - COALESCE(DPD.UNIDADES_DEV, 0)) * -1
                        ELSE (DPD.UNIDADES - COALESCE(DPD.UNIDADES_DEV, 0)) END AS UNIDADES
              FROM DOCTOS_PV DP
              JOIN DOCTOS_PV_DET DPD ON DPD.DOCTO_PV_ID = DP.DOCTO_PV_ID
             WHERE DP.FECHA >= ? AND DP.FECHA < ? AND DP.ALMACEN_ID = ?
               AND DP.TIPO_DOCTO IN ('V', 'D') AND DP.ESTATUS <> 'C' AND DP.APLICADO = 'S'
          ) S
         GROUP BY S.ARTICULO_ID
        HAVING SUM(S.UNIDADES) > 0
    """
    sales_map = {}
    try:
        cur.execute(sql_ventas, (
            fecha_dias_antes,
            fecha_ini, fecha_fin_exclusiva, alm_id,
            fecha_ini, fecha_fin_exclusiva, alm_id
        ))
        for r in cur.fetchall():
            aid = int(r[0])
            vta = float(r[1] or 0)
            ev = int(r[2] or 0)
            vta_rec = float(r[3] or 0)
            sales_map[aid] = {
                'venta_piezas': vta,
                'eventos': ev,
                'venta_dias_antes': vta_rec
            }
    except Exception as e_vta:
        print("Aviso al consultar ventas unificadas:", e_vta)

    # 3. Clasificación Dinámica Pareto ABC+D
    # 50% = A, 30% = B, 15% = C, 5% = D (con eventos >= 2, si no E)
    total_piezas_ventas = sum(s['venta_piezas'] for s in sales_map.values())
    articulos_ordenados = sorted(sales_map.items(), key=lambda x: x[1]['venta_piezas'], reverse=True)
    acumulado_piezas = 0.0
    for aid, s in articulos_ordenados:
        acumulado_piezas += s['venta_piezas']
        pct = acumulado_piezas / total_piezas_ventas if total_piezas_ventas > 0 else 0.0
        if pct <= 0.50:
            c = 'A'
        elif pct <= 0.80:
            c = 'B'
        elif pct <= 0.95:
            c = 'C'
        else:
            c = 'D' if s['eventos'] >= 2 else 'E'
        s['clasif_calc'] = c

    # 4. Universo de artículos
    ids_a_evaluar = set(sales_map.keys())

    # Traer también artículos clasificados históricamente en A, B, C (o las seleccionadas)
    ph_clasif = ','.join(f"'{c}'" for c in selected_clasifs)
    if ph_clasif:
        try:
            cur.execute(f"SELECT ARTICULO_ID FROM LIBRES_ARTICULOS WHERE {clasif_col} IN ({ph_clasif})")
            for r in cur.fetchall():
                if r[0]:
                    ids_a_evaluar.add(int(r[0]))
        except Exception as e_cla:
            print("Aviso al consultar artículos por clasificación de catálogo:", e_cla)

    if not ids_a_evaluar:
        conn.close()
        return {
            "articulos": [],
            "totales": {
                "total_encontrados": 0,
                "total_articulos_surtir": 0,
                "total_piezas_surtir": 0,
                "conteo_clasificaciones": {"A": 0, "B": 0, "C": 0, "D": 0, "E": 0, "N": 0}
            }
        }

    ids_lista = list(ids_a_evaluar)
    multiplos_guardados = obtener_multiplos_sqlite()
    CHUNK_SIZE = 1000
    articulos_dict = {}

    for i in range(0, len(ids_lista), CHUNK_SIZE):
        chunk = ids_lista[i:i + CHUNK_SIZE]
        ph = ','.join('?' * len(chunk))
        cur.execute(f"""
            SELECT 
                a.ARTICULO_ID,
                TRIM(ca.CLAVE_ARTICULO),
                TRIM(a.NOMBRE),
                la_art.GRUPO_LINEA_ID,
                COALESCE(la.MULTIPLO, 1),
                COALESCE(TRIM(la.ARTPAR), 'N'),
                COALESCE(TRIM(la.IZQDER), 'N'),
                COALESCE(TRIM(la.{clasif_col}), 'N'),
                COALESCE(TRIM(la.{clasif_cedis_col}), 'N'),
                COALESCE(TRIM(la.EQUIVALENCIA1), '')
            FROM ARTICULOS a
            JOIN CLAVES_ARTICULOS ca ON ca.ARTICULO_ID = a.ARTICULO_ID
            JOIN ROLES_CLAVES_ARTICULOS r ON r.ROL_CLAVE_ART_ID = ca.ROL_CLAVE_ART_ID AND r.ES_PPAL = 'S'
            LEFT JOIN LINEAS_ARTICULOS la_art ON la_art.LINEA_ARTICULO_ID = a.LINEA_ARTICULO_ID
            LEFT JOIN LIBRES_ARTICULOS la ON la.ARTICULO_ID = a.ARTICULO_ID
            WHERE a.ARTICULO_ID IN ({ph})
        """, tuple(chunk))
        for r in cur.fetchall():
            aid = int(r[0])
            nombre = str(r[2] or '')
            mult_db = int(r[4] or 1)

            if aid in multiplos_guardados:
                mult_final = multiplos_guardados[aid]
            elif mult_db > 1:
                mult_final = mult_db
            else:
                mult_final = extraer_multiplo_nombre(nombre)

            articulos_dict[aid] = {
                'articulo_id': aid,
                'clave': str(r[1] or '').strip(),
                'nombre': nombre.strip(),
                'grupo_id': int(r[3] or 0),
                'multiplo': mult_final,
                'es_par': str(r[5] or 'N').strip().upper(),
                'izq_der': str(r[6] or 'N').strip().upper(),
                'clasif_alm_historica': str(r[7] or 'N').strip().upper() or 'N',
                'clasif_cedis': str(r[8] or 'N').strip().upper() or 'N',
                'equivalencia': str(r[9] or '').strip().upper()
            }

    # Traer artículos equivalentes recursivamente para completar grupos de equivalencias (SISBCWEB)
    equivalencias_pendientes = {str(a['equivalencia']).strip().upper() for a in articulos_dict.values() if a.get('equivalencia') and str(a['equivalencia']).strip()}
    equivalencias_procesadas = set()
    eq_chunk_size = 500

    while True:
        lote = [val for val in sorted(equivalencias_pendientes) if val and val not in equivalencias_procesadas][:eq_chunk_size]
        if not lote:
            break
        equivalencias_procesadas.update(lote)
        ph = ','.join('?' * len(lote))
        cur.execute(f"""
            SELECT 
                a.ARTICULO_ID,
                TRIM(ca.CLAVE_ARTICULO),
                TRIM(a.NOMBRE),
                la_art.GRUPO_LINEA_ID,
                COALESCE(la.MULTIPLO, 1),
                COALESCE(TRIM(la.ARTPAR), 'N'),
                COALESCE(TRIM(la.IZQDER), 'N'),
                COALESCE(TRIM(la.{clasif_col}), 'N'),
                COALESCE(TRIM(la.{clasif_cedis_col}), 'N'),
                COALESCE(TRIM(la.EQUIVALENCIA1), '')
            FROM ARTICULOS a
            JOIN CLAVES_ARTICULOS ca ON ca.ARTICULO_ID = a.ARTICULO_ID
            JOIN ROLES_CLAVES_ARTICULOS r ON r.ROL_CLAVE_ART_ID = ca.ROL_CLAVE_ART_ID AND r.ES_PPAL = 'S'
            LEFT JOIN LINEAS_ARTICULOS la_art ON la_art.LINEA_ARTICULO_ID = a.LINEA_ARTICULO_ID
            LEFT JOIN LIBRES_ARTICULOS la ON la.ARTICULO_ID = a.ARTICULO_ID
            WHERE la.EQUIVALENCIA1 IN ({ph})
        """, tuple(lote))
        for r in cur.fetchall():
            aid = int(r[0])
            eq_val = str(r[9] or '').strip().upper()
            if eq_val and eq_val not in equivalencias_procesadas:
                equivalencias_pendientes.add(eq_val)
            if aid not in articulos_dict:
                nombre = str(r[2] or '')
                mult_db = int(r[4] or 1)
                mult_final = multiplos_guardados.get(aid, mult_db if mult_db > 1 else extraer_multiplo_nombre(nombre))
                articulos_dict[aid] = {
                    'articulo_id': aid,
                    'clave': str(r[1] or '').strip(),
                    'nombre': nombre.strip(),
                    'grupo_id': int(r[3] or 0),
                    'multiplo': mult_final,
                    'es_par': str(r[5] or 'N').strip().upper(),
                    'izq_der': str(r[6] or 'N').strip().upper(),
                    'clasif_alm_historica': str(r[7] or 'N').strip().upper() or 'N',
                    'clasif_cedis': str(r[8] or 'N').strip().upper() or 'N',
                    'equivalencia': eq_val
                }

    # 5. Consultar existencias de Inventario (SALDOS_IN)
    all_ids = list(articulos_dict.keys())
    stock_map = {}
    for i in range(0, len(all_ids), CHUNK_SIZE):
        chunk = all_ids[i:i + CHUNK_SIZE]
        ph = ','.join('?' * len(chunk))
        cur.execute(f"""
            SELECT s.ARTICULO_ID, s.ALMACEN_ID, SUM(s.ENTRADAS_UNIDADES - s.SALIDAS_UNIDADES)
            FROM SALDOS_IN s
            WHERE s.ARTICULO_ID IN ({ph}) AND s.ALMACEN_ID IN (?, ?)
            GROUP BY s.ARTICULO_ID, s.ALMACEN_ID
        """, (*chunk, alm_id, cedis_id))
        for aid, alm, qty in cur.fetchall():
            stock_map[(int(aid), int(alm))] = max(0.0, float(qty or 0))

    conn.close()

    # 6. Procesar filas base y aplicar fórmulas de inventario objetivo (SISBCWEB)
    filas = []

    for aid, art in articulos_dict.items():
        gid = art['grupo_id']
        # Descartar grupos excluidos configurables
        if gid in grupos_excluidos:
            continue

        s_info = sales_map.get(aid, {})
        vta_piezas = s_info.get('venta_piezas', 0.0)
        vta_dias_antes = s_info.get('venta_dias_antes', 0.0)

        # Origen de la fila
        if aid in sales_map:
            badge_origen = "Venta"
            clasif_dinamica = s_info.get('clasif_calc', 'N')
        elif art.get('equivalencia'):
            badge_origen = "Equiv."
            clasif_dinamica = art['clasif_alm_historica']
        else:
            badge_origen = "Clasif."
            clasif_dinamica = art['clasif_alm_historica']

        # Selección de clasificación activa según parámetro
        if modo_clasificacion == 'catalogo':
            clasif_activa = art['clasif_alm_historica']
        else:
            clasif_activa = clasif_dinamica

        is_sf = gid in grupos_sin_filtrar
        # Si pertenece a un grupo sin filtrar, se ignora la equivalencia para sugerir por clasificación individual
        eq_final = '' if is_sf else art['equivalencia']

        # Promedios enteros exactos según SISBCWEB
        p6m = int(round(vta_piezas / meses_ant))
        p15d = int(round((vta_piezas / meses_ant / 30.4) * dias_inv))

        inv_suc = int(round(stock_map.get((aid, alm_id), 0.0)))
        inv_ced = int(round(stock_map.get((aid, cedis_id), 0.0)))

        faltante = max(0, p15d - inv_suc)
        # Artículos con existencia <= 1 en CEDIS no se sugieren a surtir (deben ser >= 2)
        if inv_ced <= 1:
            disp_cedis = 0
        else:
            disp_cedis = max(0, inv_ced - 1) if reservar_minimo_cedis else inv_ced
        surtir = min(faltante, disp_cedis)

        filas.append({
            'articulo_id': aid,
            'clave': art['clave'],
            'nombre': art['nombre'],
            'grupo_id': gid,
            'is_sf': is_sf,
            'badge_origen': badge_origen,
            'badge_as': False,
            'venta_piezas': int(round(vta_piezas)),
            'venta_dias_antes': int(round(vta_dias_antes)),
            'promedio_meses': p6m,
            'promedio_inv': p15d,
            'reorden': p15d,
            'stock_almacen': inv_suc,
            'stock_cedis': inv_ced,
            'surtir_cedis': surtir,
            'clasif_almacen': clasif_activa,
            'clasif_catalogo': art['clasif_alm_historica'],
            'clasif_cedis': art['clasif_cedis'],
            'equivalencia': eq_final,
            'es_par': art['es_par'],
            'izq_der': art['izq_der'],
            'multiplo': max(1, art['multiplo'])
        })

    # ================= PIPELINE DE REGLAS DE RESURTIDO =================
    # Conteo de equivalencias (grupos sin filtrar no cuentan como equivalencias)
    equiv_counts = defaultdict(int)
    for r in filas:
        if not r['is_sf'] and r['equivalencia']:
            equiv_counts[r['equivalencia']] += 1

    def can_process_equiv(row):
        eq = row['equivalencia']
        return row['is_sf'] or not eq or equiv_counts[eq] == 1

    # Regla 1: Limpiar artículos cuyas clasificaciones no estén seleccionadas para artículos individuales
    for r in filas:
        if can_process_equiv(r) and r['clasif_almacen'] not in selected_clasifs:
            r['surtir_cedis'] = 0

    # Regla 2: Límite por necesidad real (faltante) y reserva CEDIS para artículos individuales
    for r in filas:
        if can_process_equiv(r) and not r['is_sf']:
            faltante = max(0, r['promedio_inv'] - r['stock_almacen'])
            disp = max(0, r['stock_cedis'] - 1) if reservar_minimo_cedis else r['stock_cedis']
            max_surtir = min(faltante, disp)
            if r['surtir_cedis'] > max_surtir:
                r['surtir_cedis'] = max_surtir

    # Regla 3: Grupos de equivalencias (anulación si la sucursal ya tiene stock, y selección de candidato único AS)
    groups = defaultdict(list)
    for r in filas:
        if not r['is_sf'] and r['equivalencia']:
            groups[r['equivalencia']].append(r)

    clasif_order = {'A': 0, 'B': 1, 'C': 2, 'D': 3, 'E': 4, 'N': 5}

    for eq, rows_grp in groups.items():
        if len(rows_grp) <= 1:
            continue
        for r in rows_grp:
            r['surtir_cedis'] = 0
            r['badge_as'] = False

        # Si CUALQUIER artículo del grupo ya tiene inventario en la sucursal destino,
        # NO se surte ninguno del grupo (regla enforceResurtidosEquivalentDestinationInventoryRule)
        if any(r['stock_almacen'] > 0 for r in rows_grp):
            continue

        # Debe haber al menos un artículo del grupo con clasificación seleccionada
        if not any(r['clasif_almacen'] in selected_clasifs for r in rows_grp):
            continue

        # Candidatos en CEDIS (stock >= 2)
        candidates = [r for r in rows_grp if not r['is_sf'] and r['stock_cedis'] >= 2]
        if not candidates:
            continue

        # Ordenar por mayor existencia en CEDIS, luego mejor clasificación
        candidates.sort(key=lambda x: (-x['stock_cedis'], clasif_order.get(x['clasif_almacen'], 99)))
        sel = candidates[0]
        sel['badge_as'] = True

        mult = max(1, sel['multiplo'])
        is_par = sel['es_par'] == 'S'
        pack = mult * 2 if is_par and mult % 2 != 0 else mult
        req = max(pack, sel['promedio_inv'] - sel['stock_almacen'])
        req_final = math.ceil(req / pack) * pack
        avail = max(0, sel['stock_cedis'] - 1 if reservar_minimo_cedis else sel['stock_cedis'])
        sel['surtir_cedis'] = min(req_final, avail)

    # Regla 4: Sugerencia por clasificación para líneas maestras sin filtrar (SF) (solo si CEDIS tiene >= 2)
    for r in filas:
        if not r['is_sf'] or r['clasif_almacen'] not in selected_clasifs:
            continue
        base_nec = 2 if r['es_par'] == 'S' else 1
        dest_gap = max(0, base_nec - r['stock_almacen'])
        if dest_gap > 0 and r['stock_cedis'] >= 2:
            avail = max(1, r['stock_cedis'] - 1 if reservar_minimo_cedis else r['stock_cedis'])
            sug_sf = min(dest_gap, avail)
            if sug_sf > r['surtir_cedis']:
                r['surtir_cedis'] = sug_sf

    # Regla 9: Cálculo simultáneo de Cantidad a Surtir (necesidad real) y Cantidad a Surtir Sugerida (por múltiplos)
    for r in filas:
        # Artículos con existencia <= 1 en CEDIS jamás se sugieren a surtir (solo >= 2)
        if r.get('stock_cedis', 0) <= 1:
            r['surtir_cedis'] = 0
            r['cantidad_surtir'] = 0
            r['cantidad_sugerida'] = 0
            r['badge_as'] = False
            continue

        cant_necesaria = max(0, int(r.get('surtir_cedis', 0)))
        r['cantidad_surtir'] = cant_necesaria

        if cant_necesaria <= 0:
            r['cantidad_sugerida'] = 0
            continue

        mult = max(1, int(r.get('multiplo') or 1))
        pack = mult * 2 if r.get('es_par') == 'S' and mult % 2 != 0 else mult

        if pack <= 1:
            r['cantidad_sugerida'] = cant_necesaria
        else:
            paqs = math.ceil(cant_necesaria / pack)
            sug_teorico = paqs * pack
            disp = max(0, r['stock_cedis'] - 1) if reservar_minimo_cedis else r['stock_cedis']
            paqs_disp = math.floor(disp / pack)

            if paqs_disp >= paqs:
                r['cantidad_sugerida'] = sug_teorico
            elif paqs_disp > 0:
                r['cantidad_sugerida'] = paqs_disp * pack
            elif disp >= pack:
                r['cantidad_sugerida'] = pack
            else:
                r['cantidad_sugerida'] = sug_teorico

        # surtir_cedis refleja la cantidad sugerida por múltiplos si respetar_multiplos está activo
        r['surtir_cedis'] = r['cantidad_sugerida'] if respetar_multiplos else r['cantidad_surtir']

    # ================= REGLA ESTRICTA FINAL: EXISTENCIA CEDIS >= 2 =================
    # Garantía absoluta: ningún artículo con existencia en CEDIS <= 1 puede tener sugerencia a surtir
    for r in filas:
        if r.get('stock_cedis', 0) <= 1:
            r['surtir_cedis'] = 0
            r['cantidad_surtir'] = 0
            r['cantidad_sugerida'] = 0
            r['badge_as'] = False

    # ================= TOTALES Y ORDENAMIENTO =================
    conteo_clasif = {"A": 0, "B": 0, "C": 0, "D": 0, "E": 0, "N": 0}
    total_articulos_surtir = 0
    total_piezas_surtir = 0
    total_piezas_sugeridas = 0

    for r in filas:
        c = r['clasif_almacen']
        conteo_clasif[c] = conteo_clasif.get(c, 0) + 1
        if r['cantidad_surtir'] > 0 or r['cantidad_sugerida'] > 0:
            total_articulos_surtir += 1
            total_piezas_surtir += r['cantidad_surtir']
            total_piezas_sugeridas += r['cantidad_sugerida']

    # Ordenar:
    # 1. Artículos con surtido > 0 al principio
    # 2. Por piezas sugeridas descendente
    # 3. Por piezas a surtir descendente
    # 4. Por venta de piezas descendente
    filas.sort(key=lambda x: (
        (x['cantidad_sugerida'] > 0 or x['cantidad_surtir'] > 0),
        x['cantidad_sugerida'],
        x['cantidad_surtir'],
        x['venta_piezas']
    ), reverse=True)

    return {
        "articulos": filas,
        "totales": {
            "total_encontrados": len(filas),
            "total_articulos_surtir": total_articulos_surtir,
            "total_piezas_surtir": total_piezas_surtir,
            "total_piezas_sugeridas": total_piezas_sugeridas,
            "conteo_clasificaciones": conteo_clasif
        }
    }

def generar_excel_resurtidos(items, solo_surtir=False, nombre_almacen="ALMACEN"):
    """Genera archivo Excel en memoria y devuelve bytes."""
    import openpyxl
    from openpyxl.styles import Font, PatternFill, Alignment, Border, Side

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Planeación Resurtidos"
    ws.views.sheetView[0].showGridLines = True

    if solo_surtir:
        filas = [it for it in items if (it.get('cantidad_sugerida', 0) > 0 or it.get('cantidad_surtir', 0) > 0 or it.get('surtir_cedis', 0) > 0)]
    else:
        filas = items

    header_fill = PatternFill(start_color="1E293B", end_color="1E293B", fill_type="solid")
    header_font = Font(name="Calibri", size=10, bold=True, color="FFFFFF")
    data_font = Font(name="Calibri", size=9)
    bold_font = Font(name="Calibri", size=9, bold=True)
    align_center = Alignment(horizontal="center", vertical="center")
    align_right = Alignment(horizontal="right", vertical="center")
    align_left = Alignment(horizontal="left", vertical="center")
    border_thin = Border(
        left=Side(style='thin', color='E2E8F0'),
        right=Side(style='thin', color='E2E8F0'),
        top=Side(style='thin', color='E2E8F0'),
        bottom=Side(style='thin', color='E2E8F0')
    )

    headers = [
        "Número de parte", "Nombre o descripción", "Venta piezas", "Vta. días atrás",
        "Promedio 6 meses", "Promedio 15d Inv.", f"Inv. {nombre_almacen}", "Inv. CEDIS",
        "Cantidad a Surtir", "Cantidad a Surtir Sugerida", f"Clasif. {nombre_almacen}", "Clasif. CEDIS",
        "Equivalencia", "Es par", "Izq. der.", "Múltiplo", "GRUPO_ID"
    ]

    ws.append(headers)
    for col_idx in range(1, len(headers) + 1):
        cell = ws.cell(row=1, column=col_idx)
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = align_center

    for it in filas:
        parte_txt = str(it.get('clave', '')).strip()
        if it.get('is_sf'):
            parte_txt += " SF"
        elif it.get('badge_as'):
            parte_txt += " AS"

        desc_txt = str(it.get('nombre', '')).strip()
        if it.get('badge_origen'):
            desc_txt += f" {it.get('badge_origen')}"

        cant_surtir = it.get('cantidad_surtir', it.get('surtir_cedis', 0))
        cant_sug = it.get('cantidad_sugerida', it.get('surtir_cedis', 0))

        ws.append([
            parte_txt,
            desc_txt,
            it.get('venta_piezas', 0),
            it.get('venta_dias_antes', 0),
            it.get('promedio_meses', 0),
            it.get('promedio_inv', 0),
            it.get('stock_almacen', 0),
            it.get('stock_cedis', 0),
            cant_surtir,
            cant_sug,
            it.get('clasif_almacen', ''),
            it.get('clasif_cedis', ''),
            it.get('equivalencia', ''),
            it.get('es_par', ''),
            it.get('izq_der', ''),
            it.get('multiplo', 1),
            it.get('grupo_id', '')
        ])

    for row in ws.iter_rows(min_row=2, max_row=len(filas) + 1, min_col=1, max_col=len(headers)):
        for cell in row:
            cell.font = data_font
            cell.border = border_thin
            if cell.column in [3, 4, 5, 6, 7, 8, 9, 10, 16]:
                cell.alignment = align_right
            elif cell.column in [1, 11, 12, 13, 14, 15, 17]:
                cell.alignment = align_center
            else:
                cell.alignment = align_left
            
            # Columna 9: Cantidad a Surtir (Azul claro si > 0)
            if cell.column == 9 and cell.value and cell.value > 0:
                cell.font = bold_font
                cell.fill = PatternFill(start_color="EFF6FF", end_color="EFF6FF", fill_type="solid")

            # Columna 10: Cantidad a Surtir Sugerida (Verde claro si > 0)
            if cell.column == 10 and cell.value and cell.value > 0:
                cell.font = bold_font
                cell.fill = PatternFill(start_color="DCFCE7", end_color="DCFCE7", fill_type="solid")

    for col in ws.columns:
        max_len = max(len(str(cell.value or '')) for cell in col)
        col_letter = openpyxl.utils.get_column_letter(col[0].column)
        ws.column_dimensions[col_letter].width = max(max_len + 3, 10)

    ws.column_dimensions['A'].width = 20
    ws.column_dimensions['B'].width = 45

    import io
    output = io.BytesIO()
    wb.save(output)
    output.seek(0)
    return output.read()
