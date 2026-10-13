import datetime
import pyodbc
from flask import Blueprint, request, jsonify

from app.config import EMPRESAS_DISPONIBLES, get_current_dsn, conn_string_microsip
from app.db import (
    conectar_db,
    resolver_listas_precios,
    detectar_columna_equivalencia,
    obtener_columnas_libres_articulos,
    obtener_siguiente_id
)

almacen_bp = Blueprint('almacen_bp', __name__)

_cache_almacenes = {"time": 0, "data": None, "empresa": None}
_cache_sucursales_metricas = {"time": 0, "data": None, "empresa": None}

def limpiar_cache_almacenes():
    global _cache_almacenes, _cache_sucursales_metricas
    _cache_almacenes = {"time": 0, "data": None, "empresa": None}
    _cache_sucursales_metricas = {"time": 0, "data": None, "empresa": None}

def obtener_metricas_sucursales(sucursal_ids=None, refresh=False):
    global _cache_sucursales_metricas
    now = datetime.datetime.now().timestamp()
    current_dsn = get_current_dsn()
    if not refresh and _cache_sucursales_metricas.get("data") and _cache_sucursales_metricas.get("empresa") == current_dsn:
        if (now - _cache_sucursales_metricas.get("time", 0)) < 120:
            return _cache_sucursales_metricas["data"]

    conn = None
    try:
        conn = conectar_db()
        cur = conn.cursor()

        # 1. Venta de Hoy por Almacen en DOCTOS_PV
        cur.execute("""
            SELECT 
                COALESCE(p.ALMACEN_ID, cj.ALMACEN_ID) AS ALMACEN_ID,
                SUM(CASE WHEN p.TIPO_DOCTO = 'D' THEN -(p.IMPORTE_NETO + COALESCE(p.TOTAL_IMPUESTOS, 0)) ELSE (p.IMPORTE_NETO + COALESCE(p.TOTAL_IMPUESTOS, 0)) END) AS VENTA_HOY
            FROM DOCTOS_PV p
            LEFT JOIN CAJAS cj ON cj.CAJA_ID = p.CAJA_ID
            WHERE p.FECHA = CURRENT_DATE
              AND p.ESTATUS <> 'C'
              AND p.TIPO_DOCTO IN ('V', 'F', 'D')
            GROUP BY COALESCE(p.ALMACEN_ID, cj.ALMACEN_ID)
        """)
        ventas_hoy = {}
        for r in cur.fetchall():
            if r[0] is not None:
                ventas_hoy[int(r[0])] = float(r[1] or 0.0)

        # 2. Venta Promedio Diaria (Últimos 30 días, días con venta activa)
        cur.execute("""
            SELECT 
                COALESCE(p.ALMACEN_ID, cj.ALMACEN_ID) AS ALMACEN_ID,
                COUNT(DISTINCT p.FECHA) AS DIAS_ACTIVOS,
                SUM(CASE WHEN p.TIPO_DOCTO = 'D' THEN -(p.IMPORTE_NETO + COALESCE(p.TOTAL_IMPUESTOS, 0)) ELSE (p.IMPORTE_NETO + COALESCE(p.TOTAL_IMPUESTOS, 0)) END) AS TOTAL_VENTA
            FROM DOCTOS_PV p
            LEFT JOIN CAJAS cj ON cj.CAJA_ID = p.CAJA_ID
            WHERE p.FECHA >= CURRENT_DATE - 30
              AND p.ESTATUS <> 'C'
              AND p.TIPO_DOCTO IN ('V', 'F', 'D')
            GROUP BY COALESCE(p.ALMACEN_ID, cj.ALMACEN_ID)
        """)
        ventas_promedio = {}
        dias_activos = {}
        for r in cur.fetchall():
            if r[0] is not None:
                alm_id = int(r[0])
                dias = int(r[1] or 0)
                tot = float(r[2] or 0.0)
                dias_activos[alm_id] = dias
                ventas_promedio[alm_id] = (tot / dias) if dias > 0 else 0.0

        # 3. Costo de la Existencia: existencia en piezas x costo de compra (último)
        filtro_almacenes = ""
        params_stock = []
        if sucursal_ids:
            placeholders = ",".join(["?"] * len(sucursal_ids))
            filtro_almacenes = f"WHERE s.ALMACEN_ID IN ({placeholders})"
            params_stock = list(sucursal_ids)

        cur.execute(f"""
            WITH COSTOS AS (
                SELECT pc.ARTICULO_ID, 
                       COALESCE(
                           MAX(CASE WHEN pc.ES_PROV_PREDET = TRUE THEN pcd.PRECIO_UVEN END),
                           MAX(pcd.PRECIO_UVEN)
                       ) AS COSTO
                FROM PRECIOS_COMPRA pc
                JOIN PRECIOS_COMPRA_DET pcd ON pcd.PRECIO_COMPRA_ID = pc.PRECIO_COMPRA_ID
                WHERE pcd.PRECIO_UVEN > 0
                GROUP BY pc.ARTICULO_ID
            ),
            STOCK AS (
                SELECT s.ALMACEN_ID, s.ARTICULO_ID, SUM(s.ENTRADAS_UNIDADES - s.SALIDAS_UNIDADES) AS PIEZAS
                FROM SALDOS_IN s
                {filtro_almacenes}
                GROUP BY s.ALMACEN_ID, s.ARTICULO_ID
                HAVING SUM(s.ENTRADAS_UNIDADES - s.SALIDAS_UNIDADES) > 0
            )
            SELECT st.ALMACEN_ID, SUM(st.PIEZAS * COALESCE(c.COSTO, 0)) AS COSTO_TOTAL
            FROM STOCK st
            JOIN COSTOS c ON c.ARTICULO_ID = st.ARTICULO_ID
            GROUP BY st.ALMACEN_ID
        """, params_stock)
        costos_existencia = {}
        for r in cur.fetchall():
            if r[0] is not None:
                costos_existencia[int(r[0])] = float(r[1] or 0.0)

        cur.close()
        conn.close()

        res_data = {
            "ventas_hoy": ventas_hoy,
            "ventas_promedio": ventas_promedio,
            "dias_activos": dias_activos,
            "costos_existencia": costos_existencia
        }
        _cache_sucursales_metricas = {
            "time": now,
            "data": res_data,
            "empresa": current_dsn
        }
        return res_data
    except Exception as e:
        if conn:
            try: conn.close()
            except: pass
        print(f"Error al calcular métricas de sucursales: {e}")
        return {
            "ventas_hoy": {},
            "ventas_promedio": {},
            "dias_activos": {},
            "costos_existencia": {}
        }

def obtener_datos_almacenes(refresh=False):
    global _cache_almacenes
    now = datetime.datetime.now().timestamp()
    current_dsn = get_current_dsn()
    if not refresh and _cache_almacenes.get("data") and _cache_almacenes.get("empresa") == current_dsn:
        if (now - _cache_almacenes.get("time", 0)) < 60:
            return _cache_almacenes["data"]

    conn = None
    try:
        conn = conectar_db()
        cur = conn.cursor()
        cur.execute("""
            SELECT 
                a.ALMACEN_ID,
                TRIM(a.NOMBRE) AS NOMBRE,
                COALESCE(SUM(s.ENTRADAS_UNIDADES - s.SALIDAS_UNIDADES), 0) AS TOTAL_PIEZAS,
                COUNT(DISTINCT CASE WHEN (s.ENTRADAS_UNIDADES - s.SALIDAS_UNIDADES) > 0 THEN s.ARTICULO_ID END) AS TOTAL_ITEMS
            FROM ALMACENES a
            LEFT JOIN SALDOS_IN s ON s.ALMACEN_ID = a.ALMACEN_ID
            WHERE a.NOMBRE NOT LIKE 'NO UTILIZAR%'
            GROUP BY a.ALMACEN_ID, a.NOMBRE
            ORDER BY 
                CASE WHEN UPPER(a.NOMBRE) LIKE '%CEDIS%' THEN 0 ELSE 1 END,
                TOTAL_PIEZAS DESC
        """)
        rows = cur.fetchall()
        almacenes = []
        piezas_cedis = 0
        piezas_red = 0

        for r in rows:
            alm_id = int(r[0])
            nombre = str(r[1]).strip()
            total_pz = max(0.0, float(r[2])) if r[2] is not None else 0.0
            total_items = int(r[3]) if r[3] is not None else 0

            es_cedis = "CEDIS" in nombre.upper()
            es_transito = "TRANSITO" in nombre.upper() or "TRÁNSITO" in nombre.upper()
            es_dev = "DEVOLUCION" in nombre.upper() or "DEV" in nombre.upper()
            es_usado = "USADO" in nombre.upper()

            es_sucursal = ("SUCURSAL" in nombre.upper() or alm_id in [19, 151934, 102553, 163112, 2168433]) and not es_cedis and not es_transito and not es_dev and not es_usado

            tipo = "CEDIS" if es_cedis else ("Sucursal" if es_sucursal else "Auxiliar")
            if es_dev:
                tipo = "Devoluciones"
            elif es_transito:
                tipo = "Tránsito"
            elif es_usado:
                tipo = "Usados"

            if es_cedis:
                piezas_cedis += total_pz
            piezas_red += total_pz

            almacenes.append({
                "id": alm_id,
                "nombre": nombre,
                "piezas": round(total_pz, 2),
                "articulos": total_items,
                "es_cedis": es_cedis,
                "es_sucursal": es_sucursal,
                "tipo": tipo
            })

        cur.close()
        conn.close()

        resp_data = {
            "success": True,
            "almacenes": almacenes,
            "kpis": {
                "total_almacenes": len(almacenes),
                "piezas_cedis": round(piezas_cedis, 2),
                "piezas_red": round(piezas_red, 2),
                "almacenes_con_stock": sum(1 for a in almacenes if a["piezas"] > 0)
            }
        }
        _cache_almacenes = {
            "time": now,
            "data": resp_data,
            "empresa": current_dsn
        }
        return resp_data
    except Exception as e:
        if conn:
            try: conn.close()
            except: pass
        return {"success": False, "error": str(e), "almacenes": [], "kpis": {}}

from app.services.cache_service import (
    obtener_resumen_sucursales,
    obtener_resumen_almacenes,
    actualizar_tablas_intermedias
)

@almacen_bp.route('/api/almacenes/resumen', methods=['GET'])
def get_almacenes_resumen():
    refresh = request.args.get('refresh', '0') == '1'
    data = obtener_resumen_almacenes(force_refresh=refresh)
    return jsonify(data)

@almacen_bp.route('/api/sucursales/resumen', methods=['GET'])
def get_sucursales_resumen():
    refresh = request.args.get('refresh', '0') == '1'
    data = obtener_resumen_sucursales(force_refresh=refresh)
    return jsonify(data)

@almacen_bp.route('/api/compras/resumen', methods=['GET'])
def get_compras_resumen():
    conn = None
    try:
        conn = conectar_db()
        cur = conn.cursor()

        total_prov = 0
        try:
            cur.execute("SELECT COUNT(*) FROM PROVEEDORES")
            r = cur.fetchone()
            if r and r[0]: total_prov = int(r[0])
        except:
            pass

        total_lineas = 0
        try:
            cur.execute("SELECT COUNT(*) FROM LINEAS_ARTICULOS")
            r = cur.fetchone()
            if r and r[0]: total_lineas = int(r[0])
        except:
            pass

        total_articulos = 0
        try:
            cur.execute("SELECT COUNT(*) FROM ARTICULOS")
            r = cur.fetchone()
            if r and r[0]: total_articulos = int(r[0])
        except:
            pass

        traspasos_mes = 0
        try:
            cur.execute("""
                SELECT COUNT(*) 
                FROM DOCTOS_IN 
                WHERE EXTRACT(YEAR FROM FECHA) = EXTRACT(YEAR FROM CURRENT_DATE)
                  AND EXTRACT(MONTH FROM FECHA) = EXTRACT(MONTH FROM CURRENT_DATE)
            """)
            r = cur.fetchone()
            if r and r[0]: traspasos_mes = int(r[0])
        except:
            pass

        ultimos_prov = []
        try:
            cur.execute("SELECT FIRST 5 PROVEEDOR_ID, TRIM(NOMBRE), COALESCE(TRIM(RFC_CURP), '') FROM PROVEEDORES ORDER BY PROVEEDOR_ID DESC")
            for pr in cur.fetchall():
                ultimos_prov.append({"id": int(pr[0]), "nombre": str(pr[1]).strip(), "rfc": str(pr[2]).strip()})
        except:
            pass

        cur.close()
        conn.close()

        return jsonify({
            "success": True,
            "kpis": {
                "total_proveedores": total_prov,
                "total_lineas": total_lineas,
                "total_articulos": total_articulos,
                "traspasos_mes": traspasos_mes
            },
            "ultimos_proveedores": ultimos_prov
        })
    except Exception as e:
        if conn:
            try: conn.close()
            except: pass
        return jsonify({"success": False, "error": str(e)}), 500

@almacen_bp.route('/api/articulos/sugerencias-busqueda', methods=['GET'])
def sugerencias_busqueda_articulos():
    q = request.args.get('q', '').strip().upper()
    if len(q) < 2:
        return jsonify([])

    conn = None
    try:
        conn = conectar_db()
        cur = conn.cursor()
        col_equiv = detectar_columna_equivalencia(cur)
        join_equiv = f"LEFT JOIN LIBRES_ARTICULOS la ON la.ARTICULO_ID = a.ARTICULO_ID" if col_equiv else ""
        col_equiv_select = f"COALESCE(TRIM(la.{col_equiv}), '')" if col_equiv else "''"

        filtro_equiv = f"OR UPPER(la.{col_equiv}) LIKE ?" if col_equiv else ""
        params = [f"%{q}%", f"%{q}%"]
        if col_equiv:
            params.append(f"%{q}%")
        params.extend([q, f"{q}%", f"{q}%"])

        cur.execute(f"""
            SELECT FIRST 15 
                ca.CLAVE_ARTICULO, 
                a.NOMBRE, 
                {col_equiv_select} AS EQUIV,
                a.ARTICULO_ID
            FROM CLAVES_ARTICULOS ca
            JOIN ARTICULOS a ON a.ARTICULO_ID = ca.ARTICULO_ID
            JOIN ROLES_CLAVES_ARTICULOS r ON r.ROL_CLAVE_ART_ID = ca.ROL_CLAVE_ART_ID AND r.ES_PPAL = 'S'
            {join_equiv}
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
        """, params)

        res = []
        for r in cur.fetchall():
            res.append({
                "clave": str(r[0]).strip(),
                "nombre": str(r[1]).strip(),
                "equivalencia": str(r[2]).strip() if r[2] else "",
                "articulo_id": int(r[3])
            })
        cur.close()
        conn.close()
        return jsonify(res)
    except Exception as e:
        if conn:
            conn.close()
        return jsonify([])

@almacen_bp.route('/api/articulos/consultar-completo', methods=['GET'])
def consultar_articulo_completo():
    clave_param = request.args.get('clave', '').strip()
    if not clave_param:
        return jsonify({"error": "Debe proporcionar una clave o código a consultar.", "success": False}), 400

    conn = None
    try:
        conn = conectar_db()
        cur = conn.cursor()
        cols_la = obtener_columnas_libres_articulos(cur)
        col_equiv = None
        for c in ["EQUIVALENCIA1", "EQUIVALENCIA_1", "EQUIV1", "EQUIV_1"]:
            if c in cols_la:
                col_equiv = c
                break
        if not col_equiv:
            for c in cols_la:
                if "EQUIV" in c:
                    col_equiv = c
                    break

        col_empresa_e = "C_EMPRESA_E" if "C_EMPRESA_E" in cols_la else ("CLASIFICACION_ABC" if "CLASIFICACION_ABC" in cols_la else None)
        col_empresa_i = "C_EMPRESA_I" if "C_EMPRESA_I" in cols_la else None

        join_equiv = f"LEFT JOIN LIBRES_ARTICULOS la ON la.ARTICULO_ID = a.ARTICULO_ID" if (col_equiv or col_empresa_e or col_empresa_i) else ""
        col_equiv_select = f"COALESCE(TRIM(la.{col_equiv}), '')" if col_equiv else "''"
        col_empresa_e_select = f"COALESCE(TRIM(la.{col_empresa_e}), '')" if col_empresa_e else "''"
        col_empresa_i_select = f"COALESCE(TRIM(la.{col_empresa_i}), '')" if col_empresa_i else "''"

        cur.execute(f"""
            SELECT FIRST 1 
                a.ARTICULO_ID, 
                ca.CLAVE_ARTICULO, 
                a.NOMBRE,
                {col_equiv_select} AS EQUIV,
                {col_empresa_e_select} AS EMPRESA_E,
                {col_empresa_i_select} AS EMPRESA_I,
                COALESCE(TRIM(li.NOMBRE), ''),
                a.UNIDAD_VENTA
            FROM ARTICULOS a
            JOIN CLAVES_ARTICULOS ca ON ca.ARTICULO_ID = a.ARTICULO_ID
            JOIN ROLES_CLAVES_ARTICULOS r ON r.ROL_CLAVE_ART_ID = ca.ROL_CLAVE_ART_ID AND r.ES_PPAL = 'S'
            {join_equiv}
            LEFT JOIN LINEAS_ARTICULOS li ON li.LINEA_ARTICULO_ID = a.LINEA_ARTICULO_ID
            WHERE UPPER(TRIM(ca.CLAVE_ARTICULO)) = UPPER(?)
               {f"OR UPPER(TRIM(la.{col_equiv})) = UPPER(?)" if col_equiv else ""}
            ORDER BY 
                CASE WHEN UPPER(TRIM(ca.CLAVE_ARTICULO)) = UPPER(?) THEN 0 ELSE 1 END
        """, ([clave_param, clave_param, clave_param] if col_equiv else [clave_param, clave_param]))

        art_row = cur.fetchone()
        if not art_row:
            cur.close()
            conn.close()
            return jsonify({"error": f"No se encontró el artículo '{clave_param}'.", "success": False}), 404

        art_id, clave_art, nombre_art, equiv1, clas_empresa, clas_interna, linea_nombre, unidad_venta = art_row
        art_id = int(art_id)
        clave_art = str(clave_art).strip()
        nombre_art = str(nombre_art).strip()
        equiv1 = str(equiv1).strip()
        clas_empresa = str(clas_empresa).strip()
        clas_interna = str(clas_interna).strip()

        # Localizaciones en NIVELES_ARTICULOS
        localizaciones_map = {}
        try:
            cur.execute("""
                SELECT ALMACEN_ID, TRIM(LOCALIZACION)
                FROM NIVELES_ARTICULOS
                WHERE ARTICULO_ID = ? AND LOCALIZACION IS NOT NULL AND TRIM(LOCALIZACION) <> ''
            """, (art_id,))
            for r in cur.fetchall():
                if r[0] and r[1]:
                    localizaciones_map[int(r[0])] = str(r[1]).strip()
        except Exception as e_loc:
            print("Aviso al consultar localizaciones:", e_loc)

        # Clasificaciones por almacén en LIBRES_ARTICULOS
        la_dict = {}
        try:
            cur.execute("SELECT * FROM LIBRES_ARTICULOS WHERE ARTICULO_ID = ?", (art_id,))
            la_data = cur.fetchone()
            if la_data:
                la_cols = [d[0].upper() for d in cur.description]
                la_dict = {col: str(val).strip() for col, val in zip(la_cols, la_data) if val is not None}
        except Exception as e_la:
            print("Aviso al consultar libres articulos:", e_la)

        mapa_clasif_almacenes = {
            # Battery Center (basesmp)
            620110: 'C_CEDIS_S',
            166719: 'C_SAULO_S',
            1423447: 'C_AEROPUERTO_S',
            1147933: 'C_ARTESG_S',
            99934: 'C_BRAVO_S',
            1629323: 'C_CARDENAS_S',
            412880: 'C_DIVISION_S',
            1473736: 'C_FCOIMADERO_S',
            1800730: 'C_GHIDALGO_S',
            1820837: 'C_MATAMOROS_S',
            1254317: 'C_NAZAS_S',
            158254: 'C_REVOLUCION_S',
            202797: 'C_TAJITO_S',
            2168433: 'C_ALMGOGPE_S',
            486662: 'C_SALTILLO_S',
            # RT (basesRTT)
            19: 'C_TORREON_S',
            151934: 'C_GOMEZ_S',
            102553: 'C_DURANGO_S',
            # RENOHER (basesrenoher)
            163112: 'C_RENOHER_S'
        }

        # Existencias en la empresa activa por almacén
        cur.execute("""
            SELECT a.ALMACEN_ID, a.NOMBRE, COALESCE(s.EXISTENCIA, 0)
            FROM ALMACENES a
            LEFT JOIN (
                SELECT ALMACEN_ID, SUM(ENTRADAS_UNIDADES - SALIDAS_UNIDADES) AS EXISTENCIA
                FROM SALDOS_IN
                WHERE ARTICULO_ID = ?
                GROUP BY ALMACEN_ID
            ) s ON s.ALMACEN_ID = a.ALMACEN_ID
            WHERE a.NOMBRE NOT LIKE 'NO UTILIZAR%'
            ORDER BY s.EXISTENCIA DESC, a.NOMBRE
        """, (art_id,))

        almacenes_activa = []
        total_existencia = 0
        for alm_id, alm_nom, stock in cur.fetchall():
            alm_id_int = int(alm_id)
            stock_num = max(0, int(float(stock)))
            total_existencia += stock_num
            col_clas = mapa_clasif_almacenes.get(alm_id_int)
            clas_val = la_dict.get(col_clas, '') if col_clas else ''
            loc_val = localizaciones_map.get(alm_id_int, '')
            almacenes_activa.append({
                "almacen_id": alm_id_int,
                "nombre": str(alm_nom).strip(),
                "existencia": stock_num,
                "clas": clas_val,
                "localizacion": loc_val
            })

        # Artículos equivalentes
        equiv_code = equiv1 if equiv1 else clave_art
        equivalencias_resultado = []
        if col_equiv and equiv_code:
            cur.execute(f"""
                SELECT DISTINCT 
                    a.ARTICULO_ID, 
                    ca.CLAVE_ARTICULO, 
                    a.NOMBRE,
                    {col_equiv_select},
                    {col_empresa_i_select},
                    {col_empresa_e_select}
                FROM ARTICULOS a
                JOIN CLAVES_ARTICULOS ca ON ca.ARTICULO_ID = a.ARTICULO_ID
                JOIN ROLES_CLAVES_ARTICULOS r ON r.ROL_CLAVE_ART_ID = ca.ROL_CLAVE_ART_ID AND r.ES_PPAL = 'S'
                {join_equiv}
                WHERE UPPER(TRIM(la.{col_equiv})) = UPPER(?)
                   OR UPPER(TRIM(ca.CLAVE_ARTICULO)) = UPPER(?)
                ORDER BY ca.CLAVE_ARTICULO
            """, (equiv_code, equiv_code))

            equiv_rows = cur.fetchall()
            art_ids_equiv = [int(r[0]) for r in equiv_rows]

            if art_ids_equiv:
                listas_map = resolver_listas_precios(conn)
                id_lista = listas_map.get("publico", 42)
                id_talleres = listas_map.get("talleres", 67032)
                id_mayoreo = listas_map.get("mayoreo", 67031)

                placeholders = ','.join('?' * len(art_ids_equiv))
                cur.execute(f"""
                    SELECT pa.ARTICULO_ID, pa.PRECIO_EMPRESA_ID, pa.PRECIO
                    FROM PRECIOS_ARTICULOS pa
                    WHERE pa.ARTICULO_ID IN ({placeholders})
                """, art_ids_equiv)
                precios_map = {}
                for a_id, p_id, pr in cur.fetchall():
                    a_id = int(a_id)
                    p_id = int(p_id)
                    if a_id not in precios_map:
                        precios_map[a_id] = {}
                    precios_map[a_id][p_id] = float(pr)

                cur.execute(f"""
                    SELECT ARTICULO_ID, SUM(ENTRADAS_UNIDADES - SALIDAS_UNIDADES)
                    FROM SALDOS_IN
                    WHERE ARTICULO_ID IN ({placeholders})
                    GROUP BY ARTICULO_ID
                """, art_ids_equiv)
                stock_equiv_map = {int(r[0]): max(0, int(float(r[1]))) for r in cur.fetchall() if r[0] is not None and r[1] is not None}

                hay_alguno_prioridad = any(str(r[4]).strip().upper() == 'A' or str(r[5]).strip().upper() == 'A' for r in equiv_rows)

                for e_id, e_clave, e_nom, e_eq, e_clas_i, e_clas_e in equiv_rows:
                    e_id_int = int(e_id)
                    p_dict = precios_map.get(e_id_int, {})
                    p_lista = p_dict.get(id_lista, 0.0)
                    p_talleres = p_dict.get(id_talleres, 0.0)
                    p_mayoreo = p_dict.get(id_mayoreo, 0.0)
                    stk = stock_equiv_map.get(e_id_int, 0)

                    e_clas_prior = (str(e_clas_i).strip() or str(e_clas_e).strip()).upper()
                    prioridad = (e_clas_prior == 'A') if hay_alguno_prioridad else (str(e_clave).strip().upper() == equiv_code.upper())

                    equivalencias_resultado.append({
                        "articulo_id": e_id_int,
                        "clave": str(e_clave).strip(),
                        "nombre": str(e_nom).strip(),
                        "precio_lista": p_lista,
                        "precio_talleres": p_talleres,
                        "precio_mayoreo": p_mayoreo,
                        "existencia": stk,
                        "prioridad": prioridad,
                        "es_actual": (e_id_int == art_id)
                    })

        cur.close()
        conn.close()

        # Consultar sucursales de RENOHER
        almacenes_renoher = []
        try:
            conn_rh = pyodbc.connect(conn_string_microsip(dsn="basesrenoher"), timeout=4)
            cur_rh = conn_rh.cursor()

            candidatos = [clave_art]
            if equiv_code and equiv_code not in candidatos:
                candidatos.append(equiv_code)
            if clave_art.endswith('-P') and clave_art[:-2] not in candidatos:
                candidatos.append(clave_art[:-2])
            elif not clave_art.endswith('-P') and f"{clave_art}-P" not in candidatos:
                candidatos.append(f"{clave_art}-P")

            ph = ','.join(['?'] * len(candidatos))
            cur_rh.execute(f"""
                SELECT FIRST 1 a.ARTICULO_ID, la.C_RENOHER_S
                FROM ARTICULOS a
                JOIN CLAVES_ARTICULOS ca ON ca.ARTICULO_ID = a.ARTICULO_ID
                LEFT JOIN LIBRES_ARTICULOS la ON la.ARTICULO_ID = a.ARTICULO_ID
                WHERE UPPER(TRIM(ca.CLAVE_ARTICULO)) IN ({ph})
                   OR UPPER(TRIM(la.EQUIVALENCIA1)) IN ({ph})
                ORDER BY CASE WHEN UPPER(TRIM(ca.CLAVE_ARTICULO)) = UPPER(?) THEN 0 ELSE 1 END
            """, candidatos + candidatos + [clave_art])

            rh_row = cur_rh.fetchone()
            if rh_row:
                rh_id, rh_clas = rh_row
                cur_rh.execute("""
                    SELECT a.NOMBRE, COALESCE(SUM(s.ENTRADAS_UNIDADES - s.SALIDAS_UNIDADES), 0)
                    FROM ALMACENES a
                    LEFT JOIN SALDOS_IN s ON s.ALMACEN_ID = a.ALMACEN_ID AND s.ARTICULO_ID = ?
                    WHERE a.ALMACEN_ID = 163112 OR UPPER(a.NOMBRE) LIKE '%GOMEZ%' OR UPPER(a.NOMBRE) LIKE '%GÓMEZ%'
                    GROUP BY a.NOMBRE
                """, (rh_id,))
                for alm_nom, stk in cur_rh.fetchall():
                    almacenes_renoher.append({
                        "nombre": str(alm_nom).strip(),
                        "existencia": max(0, int(float(stk))),
                        "clas": str(rh_clas or '').strip()
                    })
            cur_rh.close()
            conn_rh.close()
        except Exception as e_rh:
            print("Aviso al consultar RENOHER:", e_rh)

        current_dsn = get_current_dsn()
        empresa_actual_info = next((e for e in EMPRESAS_DISPONIBLES if e['id'] == current_dsn), {"id": current_dsn, "nombre": current_dsn})
        nombre_empresa_activa = empresa_actual_info.get("nombre", "EMPRESA")

        return jsonify({
            "success": True,
            "empresa_activa": {
                "id": current_dsn,
                "nombre": nombre_empresa_activa
            },
            "articulo": {
                "articulo_id": art_id,
                "clave": clave_art,
                "nombre": nombre_art,
                "clasificacion": clas_empresa or clas_interna,
                "clasificacion_interna": clas_interna,
                "equivalencia": equiv1,
                "linea": linea_nombre,
                "unidad": unidad_venta,
                "total_existencia_bc": total_existencia
            },
            "almacenes_bc": almacenes_activa,
            "equivalencias": equivalencias_resultado,
            "almacenes_renoher": almacenes_renoher
        })
    except Exception as e:
        if conn:
            conn.close()
        return jsonify({"error": str(e), "success": False}), 500

@almacen_bp.route('/api/articulos/establecer-prioridad', methods=['POST'])
def establecer_prioridad_articulo():
    data = request.json or {}
    art_id = data.get('articulo_id')
    prioridad_activa = bool(data.get('prioridad', True))
    equivalencia = (data.get('equivalencia') or '').strip().upper()

    if not art_id:
        return jsonify({"error": "Falta articulo_id", "success": False}), 400

    conn = None
    try:
        conn = conectar_db()
        cur = conn.cursor()
        cols_la = obtener_columnas_libres_articulos(cur)
        col_equiv = detectar_columna_equivalencia(cur)
        col_prioridad = "C_EMPRESA_I" if "C_EMPRESA_I" in cols_la else ("C_EMPRESA_E" if "C_EMPRESA_E" in cols_la else None)

        if col_prioridad:
            if prioridad_activa:
                if col_equiv and equivalencia:
                    cur.execute(f"""
                        UPDATE LIBRES_ARTICULOS 
                        SET {col_prioridad} = 'E' 
                        WHERE UPPER(TRIM({col_equiv})) = ?
                    """, (equivalencia,))

                cur.execute(f"""
                    UPDATE LIBRES_ARTICULOS 
                    SET {col_prioridad} = 'A' 
                    WHERE ARTICULO_ID = ?
                """, (art_id,))
            else:
                cur.execute(f"""
                    UPDATE LIBRES_ARTICULOS 
                    SET {col_prioridad} = 'E' 
                    WHERE ARTICULO_ID = ?
                """, (art_id,))
            conn.commit()

        cur.close()
        conn.close()
        return jsonify({"success": True})
    except Exception as e:
        if conn:
            try: conn.rollback()
            except: pass
            conn.close()
        return jsonify({"error": str(e), "success": False}), 500


# =========================================================================
# SUBMÓDULO: RECEPCIÓN DE ÓRDENES DE COMPRA (OC)
# =========================================================================

def _obtener_siguiente_folio_recepcion(cur, sucursal_id=None):
    """Consulta o calcula el siguiente folio para recepciones de compra (TIPO_DOCTO = 'R')."""
    try:
        cur.execute("""
            SELECT FIRST 1 FOLIO_COMPRAS_ID, TRIM(SERIE), CONSECUTIVO 
            FROM FOLIOS_COMPRAS 
            WHERE TIPO_DOCTO = 'R' AND TRIM(SERIE) = 'BR'
        """)
        row = cur.fetchone()
        if not row:
            cur.execute("""
                SELECT FIRST 1 FOLIO_COMPRAS_ID, TRIM(SERIE), CONSECUTIVO 
                FROM FOLIOS_COMPRAS 
                WHERE TIPO_DOCTO = 'R'
                ORDER BY FOLIO_COMPRAS_ID DESC
            """)
            row = cur.fetchone()

        if row:
            folio_id, serie, consecutivo = row[0], row[1] or 'BR', int(row[2] or 1)
            sig_num = consecutivo + 1
            return folio_id, f"{serie}{str(sig_num).zfill(7)}"
    except Exception as e:
        print("Aviso al consultar folio de recepción:", e)
    return None, f"BR{str(int(datetime.datetime.now().timestamp()) % 10000000).zfill(7)}"


@almacen_bp.route('/api/almacen/ordenes-compra-pendientes', methods=['GET'])
def get_ordenes_compra_pendientes():
    periodo = (request.args.get('periodo') or 'anio_actual').strip().lower()
    almacen_id = request.args.get('almacen_id')
    busqueda = (request.args.get('busqueda') or '').strip().upper()

    filtro_fecha = ""
    params_fecha = []

    if periodo == 'hoy':
        filtro_fecha = "AND cm.FECHA = CURRENT_DATE"
    elif periodo == 'ayer':
        filtro_fecha = "AND cm.FECHA = CURRENT_DATE - 1"
    elif periodo == 'esta_semana':
        filtro_fecha = "AND cm.FECHA >= CURRENT_DATE - 7"
    elif periodo == 'este_mes':
        filtro_fecha = "AND cm.FECHA >= CURRENT_DATE - 30"
    elif periodo == 'mes_anterior':
        filtro_fecha = "AND cm.FECHA >= CURRENT_DATE - 60 AND cm.FECHA < CURRENT_DATE - 30"
    elif periodo == 'todas':
        filtro_fecha = ""
    else:  # 'anio_actual'
        filtro_fecha = "AND EXTRACT(YEAR FROM cm.FECHA) = EXTRACT(YEAR FROM CURRENT_DATE)"

    filtro_almacen = ""
    params_almacen = []
    if almacen_id and str(almacen_id).isdigit():
        filtro_almacen = "AND cm.ALMACEN_ID = ?"
        params_almacen = [int(almacen_id)]

    filtro_busqueda = ""
    params_busq = []
    if busqueda:
        filtro_busqueda = "AND (UPPER(cm.FOLIO) LIKE ? OR UPPER(p.NOMBRE) LIKE ? OR UPPER(cm.CLAVE_PROV) LIKE ?)"
        busq_p = f"%{busqueda}%"
        params_busq = [busq_p, busq_p, busq_p]

    conn = None
    try:
        conn = conectar_db()
        cur = conn.cursor()

        # 1. Catálogo de almacenes para filtro
        cur.execute("SELECT ALMACEN_ID, TRIM(NOMBRE) FROM ALMACENES WHERE OCULTO = 'N' OR OCULTO IS NULL ORDER BY NOMBRE")
        almacenes_list = [{"id": r[0], "nombre": r[1]} for r in cur.fetchall()]

        # 2. Consulta de Órdenes de Compra Pendientes
        query = f"""
            SELECT 
                cm.DOCTO_CM_ID,
                TRIM(cm.FOLIO) AS FOLIO,
                cm.FECHA,
                cm.FECHA_ENTREGA,
                cm.PROVEEDOR_ID,
                TRIM(p.NOMBRE) AS PROVEEDOR_NOMBRE,
                TRIM(COALESCE(cm.CLAVE_PROV, '')) AS PROVEEDOR_CLAVE,
                cm.ALMACEN_ID,
                TRIM(alm.NOMBRE) AS ALMACEN_NOMBRE,
                cm.IMPORTE_NETO,
                cm.TOTAL_IMPUESTOS,
                (cm.IMPORTE_NETO + COALESCE(cm.TOTAL_IMPUESTOS, 0)) AS TOTAL,
                TRIM(cm.ESTATUS) AS ESTATUS,
                COUNT(d.DOCTO_CM_DET_ID) AS TOTAL_PARTIDAS,
                SUM(d.UNIDADES) AS PIEZAS_SOLICITADAS,
                SUM(COALESCE(d.UNIDADES_REC_DEV, 0)) AS PIEZAS_RECIBIDAS,
                SUM(d.UNIDADES - COALESCE(d.UNIDADES_REC_DEV, 0)) AS PIEZAS_PENDIENTES
            FROM DOCTOS_CM cm
            JOIN PROVEEDORES p ON cm.PROVEEDOR_ID = p.PROVEEDOR_ID
            JOIN ALMACENES alm ON cm.ALMACEN_ID = alm.ALMACEN_ID
            JOIN DOCTOS_CM_DET d ON cm.DOCTO_CM_ID = d.DOCTO_CM_ID
            WHERE cm.TIPO_DOCTO = 'O'
              AND cm.ESTATUS = 'P'
              {filtro_fecha}
              {filtro_almacen}
              {filtro_busqueda}
            GROUP BY 
                cm.DOCTO_CM_ID, cm.FOLIO, cm.FECHA, cm.FECHA_ENTREGA,
                cm.PROVEEDOR_ID, p.NOMBRE, cm.CLAVE_PROV, cm.ALMACEN_ID, alm.NOMBRE,
                cm.IMPORTE_NETO, cm.TOTAL_IMPUESTOS, cm.ESTATUS
            HAVING SUM(d.UNIDADES - COALESCE(d.UNIDADES_REC_DEV, 0)) > 0
            ORDER BY cm.FECHA DESC, cm.DOCTO_CM_ID DESC
        """
        all_params = params_fecha + params_almacen + params_busq
        cur.execute(query, all_params)
        rows = cur.fetchall()

        ordenes = []
        total_piezas_pendientes = 0.0
        total_importe = 0.0
        alms_set = set()

        for r in rows:
            tot = float(r[11] or 0.0)
            pzas_pend = float(r[16] or 0.0)
            alms_set.add(r[7])
            total_piezas_pendientes += pzas_pend
            total_importe += tot

            ordenes.append({
                "docto_cm_id": int(r[0]),
                "folio": r[1],
                "fecha": r[2].strftime('%d/%m/%Y') if r[2] else '',
                "fecha_entrega": r[3].strftime('%d/%m/%Y') if r[3] else '',
                "proveedor_id": int(r[4]),
                "proveedor_nombre": r[5],
                "proveedor_clave": r[6],
                "almacen_id": int(r[7]),
                "almacen_nombre": r[8],
                "importe_neto": float(r[9] or 0.0),
                "total_impuestos": float(r[10] or 0.0),
                "total": tot,
                "estatus": r[12],
                "total_partidas": int(r[13]),
                "piezas_solicitadas": float(r[14] or 0.0),
                "piezas_recibidas": float(r[15] or 0.0),
                "piezas_pendientes": pzas_pend
            })

        cur.close()
        conn.close()

        kpis = {
            "total_ordenes": len(ordenes),
            "total_piezas_pendientes": round(total_piezas_pendientes, 2),
            "total_importe": round(total_importe, 2),
            "almacenes_involucrados": len(alms_set)
        }

        return jsonify({
            "success": True,
            "total": len(ordenes),
            "ordenes": ordenes,
            "almacenes": almacenes_list,
            "kpis": kpis
        })
    except Exception as e:
        if conn:
            try: conn.close()
            except: pass
        return jsonify({"success": False, "error": str(e)}), 500


@almacen_bp.route('/api/almacen/orden-compra/<int:docto_cm_id>', methods=['GET'])
def get_detalle_orden_compra(docto_cm_id):
    conn = None
    try:
        conn = conectar_db()
        cur = conn.cursor()

        cur.execute("""
            SELECT 
                cm.DOCTO_CM_ID,
                TRIM(cm.FOLIO) AS FOLIO,
                cm.FECHA,
                cm.PROVEEDOR_ID,
                TRIM(p.NOMBRE) AS PROVEEDOR_NOMBRE,
                cm.ALMACEN_ID,
                TRIM(alm.NOMBRE) AS ALMACEN_NOMBRE,
                (cm.IMPORTE_NETO + COALESCE(cm.TOTAL_IMPUESTOS, 0)) AS TOTAL
            FROM DOCTOS_CM cm
            JOIN PROVEEDORES p ON cm.PROVEEDOR_ID = p.PROVEEDOR_ID
            JOIN ALMACENES alm ON cm.ALMACEN_ID = alm.ALMACEN_ID
            WHERE cm.DOCTO_CM_ID = ?
        """, (docto_cm_id,))
        r = cur.fetchone()
        if not r:
            cur.close()
            conn.close()
            return jsonify({"success": False, "error": "Orden de compra no encontrada"}), 404

        orden_info = {
            "docto_cm_id": int(r[0]),
            "folio": r[1],
            "fecha": r[2].strftime('%d/%m/%Y') if r[2] else '',
            "proveedor_id": int(r[3]),
            "proveedor_nombre": r[4],
            "almacen_id": int(r[5]),
            "almacen_nombre": r[6],
            "total": float(r[7] or 0.0)
        }

        cur.execute("""
            SELECT 
                d.DOCTO_CM_DET_ID,
                d.POSICION,
                TRIM(d.CLAVE_ARTICULO) AS CLAVE,
                TRIM(a.NOMBRE) AS NOMBRE,
                d.UNIDADES,
                COALESCE(d.UNIDADES_REC_DEV, 0) AS UNIDADES_REC,
                (d.UNIDADES - COALESCE(d.UNIDADES_REC_DEV, 0)) AS PENDIENTES,
                d.PRECIO_UNITARIO
            FROM DOCTOS_CM_DET d
            JOIN ARTICULOS a ON d.ARTICULO_ID = a.ARTICULO_ID
            WHERE d.DOCTO_CM_ID = ?
            ORDER BY d.POSICION
        """, (docto_cm_id,))

        partidas = []
        for p in cur.fetchall():
            solic = float(p[4] or 0.0)
            recib = float(p[5] or 0.0)
            pend = float(p[6] or 0.0)
            if pend > 0:
                partidas.append({
                    "docto_cm_det_id": int(p[0]),
                    "posicion": int(p[1]),
                    "clave": p[2],
                    "nombre": p[3],
                    "unidades_solicitadas": solic,
                    "unidades_recibidas": recib,
                    "unidades_pendientes": pend,
                    "precio_unitario": float(p[7] or 0.0)
                })

        _, sig_folio = _obtener_siguiente_folio_recepcion(cur)

        cur.close()
        conn.close()

        return jsonify({
            "success": True,
            "orden": orden_info,
            "partidas": partidas,
            "siguiente_folio_recepcion": sig_folio
        })
    except Exception as e:
        if conn:
            try: conn.close()
            except: pass
        return jsonify({"success": False, "error": str(e)}), 500


@almacen_bp.route('/api/almacen/siguiente-folio-recepcion', methods=['GET'])
def get_siguiente_folio_recepcion():
    conn = None
    try:
        conn = conectar_db()
        cur = conn.cursor()
        _, sig_folio = _obtener_siguiente_folio_recepcion(cur)
        cur.close()
        conn.close()
        return jsonify({"success": True, "siguiente_folio": sig_folio})
    except Exception as e:
        if conn:
            try: conn.close()
            except: pass
        return jsonify({"success": False, "siguiente_folio": "BR0003599"}), 500


@almacen_bp.route('/api/almacen/recibir-orden-compra', methods=['POST'])
def post_recibir_orden_compra():
    data = request.get_json() or {}
    orden_id = data.get('orden_id')
    modo = data.get('modo', 'completo')
    notas = (data.get('notas') or '').strip()
    partidas_recibir = data.get('partidas', [])

    if not orden_id:
        return jsonify({"success": False, "error": "Falta orden_id"}), 400

    conn = None
    try:
        conn = conectar_db()
        cur = conn.cursor()

        cur.execute("""
            SELECT 
                cm.DOCTO_CM_ID, cm.FOLIO, cm.SUCURSAL_ID, cm.ALMACEN_ID, 
                cm.PROVEEDOR_ID, cm.CLAVE_PROV, cm.MONEDA_ID, cm.TIPO_CAMBIO, 
                cm.COND_PAGO_ID, alm.NOMBRE
            FROM DOCTOS_CM cm
            JOIN ALMACENES alm ON cm.ALMACEN_ID = alm.ALMACEN_ID
            WHERE cm.DOCTO_CM_ID = ? AND cm.TIPO_DOCTO = 'O'
        """, (orden_id,))
        oc_row = cur.fetchone()
        if not oc_row:
            cur.close()
            conn.close()
            return jsonify({"success": False, "error": "Orden de compra no encontrada"}), 404

        oc_id, oc_folio, suc_id, alm_id, prov_id, clave_prov, mon_id, tipo_cambio, cond_pago_id, alm_nom = oc_row

        cur.execute("""
            SELECT DOCTO_CM_DET_ID, ARTICULO_ID, CLAVE_ARTICULO, UNIDADES, 
                   COALESCE(UNIDADES_REC_DEV, 0), PRECIO_UNITARIO
            FROM DOCTOS_CM_DET
            WHERE DOCTO_CM_ID = ?
            ORDER BY POSICION
        """, (orden_id,))
        oc_detalles = cur.fetchall()

        mapa_cantidades = {}
        if modo == 'parcial':
            for p in partidas_recibir:
                det_id = int(p.get('docto_cm_det_id') or 0)
                cant = float(p.get('unidades_recibir') or 0.0)
                if det_id and cant > 0:
                    mapa_cantidades[det_id] = cant
        else:
            for det in oc_detalles:
                pend = float(det[3]) - float(det[4])
                if pend > 0:
                    mapa_cantidades[det[0]] = pend

        if not mapa_cantidades:
            cur.close()
            conn.close()
            return jsonify({"success": False, "error": "No hay piezas pendientes para recibir en esta orden."}), 400

        folio_compras_id, sig_folio = _obtener_siguiente_folio_recepcion(cur, suc_id)
        if folio_compras_id:
            try:
                cur.execute("UPDATE FOLIOS_COMPRAS SET CONSECUTIVO = CONSECUTIVO + 1 WHERE FOLIO_COMPRAS_ID = ?", (folio_compras_id,))
            except Exception as ef:
                print("Aviso al incrementar consecutivo de compras:", ef)

        nuevo_rec_id = obtener_siguiente_id(cur, "ID_DOCTOS", "DOCTOS_CM", "DOCTO_CM_ID")
        desc_texto = f"OC: {oc_folio}" + (f" - {notas}" if notas else "")

        cur.execute("""
            INSERT INTO DOCTOS_CM (
                DOCTO_CM_ID, TIPO_DOCTO, SUBTIPO_DOCTO, SUCURSAL_ID, FOLIO,
                FECHA, CLAVE_PROV, PROVEEDOR_ID, ALMACEN_ID, MONEDA_ID,
                TIPO_CAMBIO, TIPO_DSCTO, DSCTO_PCTJE, DSCTO_IMPORTE, ESTATUS,
                APLICADO, FORMA_EMITIDA, CONTABILIZADO, ACREDITAR_CXP, CARGAR_SUN,
                SISTEMA_ORIGEN, COND_PAGO_ID, DESCRIPCION, IMPORTE_NETO, TOTAL_IMPUESTOS,
                USUARIO_CREADOR, FECHA_HORA_CREACION, USUARIO_ULT_MODIF, FECHA_HORA_ULT_MODIF
            ) VALUES (
                ?, 'R', 'N', ?, ?,
                CURRENT_DATE, ?, ?, ?, ?,
                ?, 'P', 0, 0, 'P',
                'S', 'N', 'N', 'N', 'S',
                'CM', ?, ?, 0, 0,
                'ALMACEN', CURRENT_TIMESTAMP, 'ALMACEN', CURRENT_TIMESTAMP
            )
        """, (
            nuevo_rec_id, suc_id, sig_folio,
            clave_prov, prov_id, alm_id, mon_id,
            tipo_cambio or 1.0, cond_pago_id, desc_texto[:200]
        ))

        liga_id = obtener_siguiente_id(cur, "ID_DOCTOS", "DOCTOS_CM_LIGAS", "DOCTO_CM_LIGA_ID")
        cur.execute("""
            INSERT INTO DOCTOS_CM_LIGAS (DOCTO_CM_LIGA_ID, DOCTO_CM_FTE_ID, DOCTO_CM_DEST_ID)
            VALUES (?, ?, ?)
        """, (liga_id, orden_id, nuevo_rec_id))

        total_neto_recepcion = 0.0
        pos_idx = 1

        for det in oc_detalles:
            det_id, art_id, art_clave, unid_solic, unid_ya_rec, precio_u = det
            cant_recibir = mapa_cantidades.get(det_id, 0.0)
            if cant_recibir <= 0:
                continue

            subtot_partida = round(cant_recibir * float(precio_u), 2)
            total_neto_recepcion += subtot_partida

            nuevo_det_id = obtener_siguiente_id(cur, "ID_DOCTOS", "DOCTOS_CM_DET", "DOCTO_CM_DET_ID")

            cur.execute("""
                INSERT INTO DOCTOS_CM_DET (
                    DOCTO_CM_DET_ID, DOCTO_CM_ID, ARTICULO_ID, CLAVE_ARTICULO, POSICION,
                    UNIDADES, UNIDADES_REC_DEV, PRECIO_UNITARIO, PRECIO_TOTAL_NETO
                ) VALUES (
                    ?, ?, ?, ?, ?,
                    ?, 0, ?, ?
                )
            """, (nuevo_det_id, nuevo_rec_id, art_id, art_clave, pos_idx, cant_recibir, precio_u, subtot_partida))

            cur.execute("""
                INSERT INTO DOCTOS_CM_LIGAS_DET (DOCTO_CM_LIGA_ID, DOCTO_CM_DET_FTE_ID, DOCTO_CM_DET_DEST_ID)
                VALUES (?, ?, ?)
            """, (liga_id, det_id, nuevo_det_id))

            cur.execute("""
                UPDATE DOCTOS_CM_DET 
                SET UNIDADES_REC_DEV = COALESCE(UNIDADES_REC_DEV, 0) + ?
                WHERE DOCTO_CM_DET_ID = ?
            """, (cant_recibir, det_id))

            pos_idx += 1

        total_imptos_recepcion = round(total_neto_recepcion * 0.16, 2)
        cur.execute("""
            UPDATE DOCTOS_CM 
            SET IMPORTE_NETO = ?, TOTAL_IMPUESTOS = ? 
            WHERE DOCTO_CM_ID = ?
        """, (total_neto_recepcion, total_imptos_recepcion, nuevo_rec_id))

        cur.execute("""
            SELECT SUM(UNIDADES - COALESCE(UNIDADES_REC_DEV, 0))
            FROM DOCTOS_CM_DET
            WHERE DOCTO_CM_ID = ?
        """, (orden_id,))
        pend_row = cur.fetchone()
        pend_total = float(pend_row[0] or 0.0) if pend_row else 0.0

        if pend_total <= 0:
            cur.execute("UPDATE DOCTOS_CM SET ESTATUS = 'R' WHERE DOCTO_CM_ID = ?", (orden_id,))
            estatus_texto = "Recibida Totalmente"
        else:
            cur.execute("UPDATE DOCTOS_CM SET ESTATUS = 'P' WHERE DOCTO_CM_ID = ?", (orden_id,))
            estatus_texto = "Recibida Parcialmente"

        try:
            docto_in_id = obtener_siguiente_id(cur, "ID_DOCTOS", "DOCTOS_IN", "DOCTO_IN_ID")
            cur.execute("""
                INSERT INTO DOCTOS_IN (
                    DOCTO_IN_ID, ALMACEN_ID, CONCEPTO_IN_ID, SUCURSAL_ID,
                    FOLIO, NATURALEZA_CONCEPTO, FECHA, CANCELADO, APLICADO,
                    DESCRIPCION, FORMA_EMITIDA, CONTABILIZADO, SISTEMA_ORIGEN,
                    USUARIO_CREADOR, FECHA_HORA_CREACION, USUARIO_ULT_MODIF, FECHA_HORA_ULT_MODIF
                ) VALUES (
                    ?, ?, 21, ?,
                    ?, 'E', CURRENT_DATE, 'N', 'S',
                    ?, 'N', 'N', 'CM',
                    'ALMACEN', CURRENT_TIMESTAMP, 'ALMACEN', CURRENT_TIMESTAMP
                )
            """, (docto_in_id, alm_id, suc_id, sig_folio, f"Entrada por Recepción {sig_folio} (OC {oc_folio})"))

            pos_in = 1
            for det in oc_detalles:
                det_id, art_id, art_clave, _, _, precio_u = det
                cant_recibir = mapa_cantidades.get(det_id, 0.0)
                if cant_recibir <= 0:
                    continue

                det_in_id = obtener_siguiente_id(cur, "ID_DOCTOS", "DOCTOS_IN_DET", "DOCTO_IN_DET_ID")
                costo_tot = round(cant_recibir * float(precio_u), 2)

                cur.execute("""
                    INSERT INTO DOCTOS_IN_DET (
                        DOCTO_IN_DET_ID, DOCTO_IN_ID, ALMACEN_ID, ARTICULO_ID,
                        CLAVE_ARTICULO, POSICION, UNIDADES, COSTO_UNITARIO, COSTO_TOTAL
                    ) VALUES (
                        ?, ?, ?, ?,
                        ?, ?, ?, ?, ?
                    )
                """, (det_in_id, docto_in_id, alm_id, art_id, art_clave, pos_in, cant_recibir, precio_u, costo_tot))

                cur.execute("""
                    UPDATE SALDOS_IN 
                    SET ENTRADAS_UNIDADES = COALESCE(ENTRADAS_UNIDADES, 0) + ?
                    WHERE ALMACEN_ID = ? AND ARTICULO_ID = ?
                """, (cant_recibir, alm_id, art_id))
                if cur.rowcount == 0:
                    cur.execute("""
                        INSERT INTO SALDOS_IN (ALMACEN_ID, ARTICULO_ID, ENTRADAS_UNIDADES, SALIDAS_UNIDADES)
                        VALUES (?, ?, ?, 0)
                    """, (alm_id, art_id, cant_recibir))

                pos_in += 1
        except Exception as e_in:
            print("Aviso al registrar entrada de inventario:", e_in)

        conn.commit()
        cur.close()
        conn.close()

        limpiar_cache_almacenes()

        return jsonify({
            "success": True,
            "folio_recepcion": sig_folio,
            "almacen_nombre": alm_nom,
            "estatus_texto": estatus_texto
        })
    except Exception as e:
        if conn:
            try: conn.rollback()
            except: pass
            conn.close()
        return jsonify({"success": False, "error": f"Error al procesar recepción: {str(e)}"}), 500
