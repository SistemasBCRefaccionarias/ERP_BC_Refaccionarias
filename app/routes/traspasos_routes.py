import time
import datetime
from flask import Blueprint, request, jsonify, session

from app.config import EMPRESAS_DISPONIBLES, get_current_dsn
from app.db import conectar_db, obtener_siguiente_id, detectar_columna_equivalencia
from app.services.pos_printer import (
    desglosar_folio,
    folio_para_microsip_db,
    folio_para_codigo_barras,
    generar_ticket_traspaso_bytes,
    imprimir_ticket_pos80
)
from app.services.traspasos_service import (
    calcular_siguiente_folio_traspaso,
    obtener_localizaciones_articulos,
    ESTATUS_TRASPASOS_MAP,
    formatear_estatus_traspaso
)

traspasos_bp = Blueprint('traspasos_bp', __name__)

# ================= MÓDULO 3: TRASPASOS ENTRE SUCURSALES =================

@traspasos_bp.route('/api/traspasos/catalogos', methods=['GET'])
def get_traspasos_catalogos():
    conn = None
    try:
        conn = conectar_db()
        cur = conn.cursor()

        cur.execute("""
            SELECT TRIM(RDB$FIELD_NAME) 
            FROM RDB$RELATION_FIELDS 
            WHERE RDB$RELATION_NAME = 'ALMACENES'
        """)
        cols_alm = [r[0].upper() for r in cur.fetchall() if r[0]]
        col_id = next((c for c in ['ALMACEN_ID', 'ID'] if c in cols_alm), 'ALMACEN_ID')
        col_nom = next((c for c in ['NOMBRE', 'NOMBRE_ALMACEN'] if c in cols_alm), 'NOMBRE')

        where_alm = ""
        if 'ESTATUS' in cols_alm:
            where_alm = "WHERE ESTATUS = 'A'"
        elif 'ES_BAJA' in cols_alm:
            where_alm = "WHERE ES_BAJA = 'N'"
        elif 'INACTIVO' in cols_alm:
            where_alm = "WHERE INACTIVO = 'N'"

        cur.execute(f"SELECT {col_id}, TRIM({col_nom}) FROM ALMACENES {where_alm} ORDER BY {col_nom}")
        almacenes = [{"id": int(r[0]), "nombre": str(r[1]).strip()} for r in cur.fetchall() if r[0] is not None]

        concepto_fijo = {"id": 1, "nombre": "Traspaso (salida)"}
        try:
            cur.execute("""
                SELECT CONCEPTO_IN_ID, TRIM(NOMBRE) 
                FROM CONCEPTOS_IN 
                WHERE UPPER(NOMBRE) LIKE '%TRASPASO%SALIDA%' 
                   OR UPPER(NOMBRE) LIKE '%TRASPASO (SALIDA)%'
                ORDER BY CONCEPTO_IN_ID
            """)
            r_con = cur.fetchone()
            if r_con:
                concepto_fijo = {"id": int(r_con[0]), "nombre": str(r_con[1]).strip()}
            else:
                cur.execute("SELECT FIRST 1 CONCEPTO_IN_ID, TRIM(NOMBRE) FROM CONCEPTOS_IN WHERE TIPO_MOVTO IN ('T','S') AND UPPER(NOMBRE) LIKE '%TRASPASO%'")
                r_con2 = cur.fetchone()
                if r_con2:
                    concepto_fijo = {"id": int(r_con2[0]), "nombre": str(r_con2[1]).strip()}
        except Exception as e:
            print("Aviso al buscar concepto traspaso:", e)

        cur.close()
        conn.close()
        return jsonify({
            "almacenes": almacenes,
            "concepto_fijo": concepto_fijo
        })

    except Exception as e:
        if conn:
            try:
                conn.close()
            except:
                pass
        return jsonify({"error": str(e), "almacenes": [], "concepto_fijo": {"id": 1, "nombre": "Traspaso (salida)"}}), 500

@traspasos_bp.route('/api/traspasos/siguiente-folio', methods=['GET'])
def get_siguiente_folio():
    origen_id = request.args.get('origen_id', '')
    origen_nombre = request.args.get('origen_nombre', '').strip().upper()
    destino_id = request.args.get('destino_id', '')
    destino_nombre = request.args.get('destino_nombre', '').strip().upper()

    conn = None
    try:
        conn = conectar_db()
        cur = conn.cursor()
        
        folio_sugerido, ultimo_folio = calcular_siguiente_folio_traspaso(
            cur, origen_id, destino_id, destino_nombre
        )

        cur.close()
        conn.close()
        resp = jsonify({
            "folio": folio_sugerido,
            "folio_scanner": folio_sugerido,
            "ultimo_folio_registrado": ultimo_folio or "Ninguno"
        })
        resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        resp.headers["Pragma"] = "no-cache"
        resp.headers["Expires"] = "0"
        return resp

    except Exception as e:
        if conn:
            conn.close()
        print("Error en get_siguiente_folio:", e)
        return jsonify({"folio": "TBR000001", "error": str(e)})

@traspasos_bp.route('/api/traspasos/buscar-articulo', methods=['GET'])
def buscar_articulo_existencia():
    t0 = time.time()
    termino_original = request.args.get('clave', '').strip()
    almacen_id_raw = request.args.get('almacen_id', '').strip()

    if not termino_original or not almacen_id_raw:
        return jsonify({"error": "Se requiere término de búsqueda y almacén origen", "coincidencias": []}), 400

    t_upper = termino_original.upper()
    t_clean = t_upper.replace('-', '').replace(' ', '').replace('.', '').replace('/', '')

    conn = None
    try:
        conn = conectar_db()
        cur = conn.cursor()

        col_equiv = detectar_columna_equivalencia(cur)
        join_equiv = f"LEFT JOIN LIBRES_ARTICULOS la ON la.ARTICULO_ID = a.ARTICULO_ID" if col_equiv else ""
        col_equiv_select = f"COALESCE(TRIM(la.{col_equiv}), '')" if col_equiv else "''"

        articulos_dict = {}

        # 1. BÚSQUEDA ULTRA RÁPIDA POR ÍNDICE EXACTO (CLAVE)
        cur.execute(f"""
            SELECT FIRST 10
                a.ARTICULO_ID,
                COALESCE(TRIM(ca.CLAVE_ARTICULO), ''),
                TRIM(a.NOMBRE),
                {col_equiv_select} AS EQUIV,
                COALESCE(TRIM(a.UNIDAD_VENTA), 'PZA')
            FROM CLAVES_ARTICULOS ca
            JOIN ARTICULOS a ON a.ARTICULO_ID = ca.ARTICULO_ID
            {join_equiv}
            WHERE ca.CLAVE_ARTICULO = ?
        """, (t_upper,))
        for r in cur.fetchall():
            articulos_dict[r[0]] = {
                "articulo_id": int(r[0]),
                "clave": str(r[1]).strip() if r[1] else termino_original,
                "nombre": str(r[2]).strip(),
                "equivalencia": str(r[3]).strip() if r[3] else "",
                "unidad": str(r[4]).strip() if r[4] else "PZA",
                "score": 1
            }

        # 1b. Si no se encontró y t_clean es diferente, buscar exacta limpia
        if not articulos_dict and t_clean != t_upper:
            cur.execute(f"""
                SELECT FIRST 10
                    a.ARTICULO_ID,
                    COALESCE(TRIM(ca.CLAVE_ARTICULO), ''),
                    TRIM(a.NOMBRE),
                    {col_equiv_select} AS EQUIV,
                    COALESCE(TRIM(a.UNIDAD_VENTA), 'PZA')
                FROM CLAVES_ARTICULOS ca
                JOIN ARTICULOS a ON a.ARTICULO_ID = ca.ARTICULO_ID
                {join_equiv}
                WHERE ca.CLAVE_ARTICULO = ?
            """, (t_clean,))
            for r in cur.fetchall():
                articulos_dict[r[0]] = {
                    "articulo_id": int(r[0]),
                    "clave": str(r[1]).strip() if r[1] else termino_original,
                    "nombre": str(r[2]).strip(),
                    "equivalencia": str(r[3]).strip() if r[3] else "",
                    "unidad": str(r[4]).strip() if r[4] else "PZA",
                    "score": 1
                }

        # 1c. Búsqueda exacta por EQUIVALENCIA si existe columna
        if not articulos_dict and col_equiv:
            cur.execute(f"""
                SELECT FIRST 10
                    a.ARTICULO_ID,
                    COALESCE(TRIM(ca.CLAVE_ARTICULO), ''),
                    TRIM(a.NOMBRE),
                    COALESCE(TRIM(la.{col_equiv}), '') AS EQUIV,
                    COALESCE(TRIM(a.UNIDAD_VENTA), 'PZA')
                FROM LIBRES_ARTICULOS la
                JOIN ARTICULOS a ON a.ARTICULO_ID = la.ARTICULO_ID
                LEFT JOIN CLAVES_ARTICULOS ca ON ca.ARTICULO_ID = a.ARTICULO_ID
                WHERE la.{col_equiv} = ? OR la.{col_equiv} = ?
            """, (t_upper, t_clean))
            for r in cur.fetchall():
                articulos_dict[r[0]] = {
                    "articulo_id": int(r[0]),
                    "clave": str(r[1]).strip() if r[1] else termino_original,
                    "nombre": str(r[2]).strip(),
                    "equivalencia": str(r[3]).strip() if r[3] else "",
                    "unidad": str(r[4]).strip() if r[4] else "PZA",
                    "score": 2
                }

        # 2. BÚSQUEDA POR PREFIJO DE CLAVE (STARTING WITH)
        if not articulos_dict:
            cur.execute(f"""
                SELECT FIRST 15
                    a.ARTICULO_ID,
                    COALESCE(TRIM(ca.CLAVE_ARTICULO), ''),
                    TRIM(a.NOMBRE),
                    {col_equiv_select} AS EQUIV,
                    COALESCE(TRIM(a.UNIDAD_VENTA), 'PZA')
                FROM CLAVES_ARTICULOS ca
                JOIN ARTICULOS a ON a.ARTICULO_ID = ca.ARTICULO_ID
                {join_equiv}
                WHERE ca.CLAVE_ARTICULO STARTING WITH ?
            """, (t_upper,))
            for r in cur.fetchall():
                if r[0] not in articulos_dict:
                    articulos_dict[r[0]] = {
                        "articulo_id": int(r[0]),
                        "clave": str(r[1]).strip() if r[1] else termino_original,
                        "nombre": str(r[2]).strip(),
                        "equivalencia": str(r[3]).strip() if r[3] else "",
                        "unidad": str(r[4]).strip() if r[4] else "PZA",
                        "score": 3
                    }

        # 3. BÚSQUEDA POR PREFIJO DE NOMBRE (STARTING WITH)
        if not articulos_dict:
            cur.execute(f"""
                SELECT FIRST 15
                    a.ARTICULO_ID,
                    COALESCE(TRIM(ca.CLAVE_ARTICULO), ''),
                    TRIM(a.NOMBRE),
                    {col_equiv_select} AS EQUIV,
                    COALESCE(TRIM(a.UNIDAD_VENTA), 'PZA')
                FROM ARTICULOS a
                LEFT JOIN CLAVES_ARTICULOS ca ON ca.ARTICULO_ID = a.ARTICULO_ID
                {join_equiv}
                WHERE a.NOMBRE STARTING WITH ?
            """, (t_upper,))
            for r in cur.fetchall():
                if r[0] not in articulos_dict:
                    articulos_dict[r[0]] = {
                        "articulo_id": int(r[0]),
                        "clave": str(r[1]).strip() if r[1] else termino_original,
                        "nombre": str(r[2]).strip(),
                        "equivalencia": str(r[3]).strip() if r[3] else "",
                        "unidad": str(r[4]).strip() if r[4] else "PZA",
                        "score": 4
                    }

        # 4. PATRÓN CON SEPARADORES OMITIDOS
        if not articulos_dict and len(t_clean) >= 4:
            pattern = '%'.join(list(t_clean)) + '%'
            cur.execute(f"""
                SELECT FIRST 15
                    a.ARTICULO_ID,
                    COALESCE(TRIM(ca.CLAVE_ARTICULO), ''),
                    TRIM(a.NOMBRE),
                    {col_equiv_select} AS EQUIV,
                    COALESCE(TRIM(a.UNIDAD_VENTA), 'PZA')
                FROM CLAVES_ARTICULOS ca
                JOIN ARTICULOS a ON a.ARTICULO_ID = ca.ARTICULO_ID
                {join_equiv}
                WHERE ca.CLAVE_ARTICULO LIKE ?
            """, (pattern,))
            for r in cur.fetchall():
                if r[0] not in articulos_dict:
                    articulos_dict[r[0]] = {
                        "articulo_id": int(r[0]),
                        "clave": str(r[1]).strip() if r[1] else termino_original,
                        "nombre": str(r[2]).strip(),
                        "equivalencia": str(r[3]).strip() if r[3] else "",
                        "unidad": str(r[4]).strip() if r[4] else "PZA",
                        "score": 5
                    }

        # 5. BÚSQUEDA CONTENIDA (FALLBACK)
        if not articulos_dict:
            cur.execute(f"""
                SELECT FIRST 15
                    a.ARTICULO_ID,
                    COALESCE(TRIM(ca.CLAVE_ARTICULO), ''),
                    TRIM(a.NOMBRE),
                    {col_equiv_select} AS EQUIV,
                    COALESCE(TRIM(a.UNIDAD_VENTA), 'PZA')
                FROM CLAVES_ARTICULOS ca
                JOIN ARTICULOS a ON a.ARTICULO_ID = ca.ARTICULO_ID
                {join_equiv}
                WHERE a.NOMBRE CONTAINING ? OR ca.CLAVE_ARTICULO CONTAINING ?
            """, (t_upper, t_upper))
            for r in cur.fetchall():
                if r[0] not in articulos_dict:
                    articulos_dict[r[0]] = {
                        "articulo_id": int(r[0]),
                        "clave": str(r[1]).strip() if r[1] else termino_original,
                        "nombre": str(r[2]).strip(),
                        "equivalencia": str(r[3]).strip() if r[3] else "",
                        "unidad": str(r[4]).strip() if r[4] else "PZA",
                        "score": 6
                    }

        if not articulos_dict:
            cur.close()
            conn.close()
            return jsonify({
                "coincidencias": [],
                "total": 0,
                "tiempo_ms": round((time.time() - t0) * 1000, 1),
                "mensaje": f"No se encontró ningún artículo para '{termino_original}'."
            })

        # CÁLCULO DE EXISTENCIA Y LOCALIZACIÓN EN UN SOLO DISPARO
        target_alm_id = int(almacen_id_raw)
        art_ids = list(articulos_dict.keys())
        placeholders = ','.join('?' * len(art_ids))

        stock_map = {}
        try:
            cur.execute(f"""
                SELECT s.ARTICULO_ID, SUM(s.ENTRADAS_UNIDADES - s.SALIDAS_UNIDADES)
                FROM SALDOS_IN s
                WHERE s.ARTICULO_ID IN ({placeholders}) AND s.ALMACEN_ID = ?
                GROUP BY s.ARTICULO_ID
            """, (*art_ids, target_alm_id))
            for s_row in cur.fetchall():
                if s_row[0] is not None and s_row[1] is not None:
                    stock_map[int(s_row[0])] = max(0.0, float(s_row[1]))
        except Exception as e_stock:
            print("Aviso al consultar saldo batch:", e_stock)

        loc_map = obtener_localizaciones_articulos(cur, art_ids, target_alm_id)

        # Ordenar coincidencias por relevancia (score)
        coincidencias = []
        for art_id, item in sorted(articulos_dict.items(), key=lambda x: x[1]['score']):
            item['existencia'] = stock_map.get(art_id, 0.0)
            item['localizacion'] = loc_map.get(art_id, '')
            del item['score']
            coincidencias.append(item)

        cur.close()
        conn.close()

        tiempo_total_ms = round((time.time() - t0) * 1000, 1)

        return jsonify({
            "coincidencias": coincidencias,
            "total": len(coincidencias),
            "seleccion_rapida": coincidencias[0] if coincidencias else None,
            "tiempo_ms": tiempo_total_ms
        })

    except Exception as e:
        if conn:
            try:
                conn.close()
            except:
                pass
        return jsonify({"error": str(e), "coincidencias": []}), 500

@traspasos_bp.route('/api/traspasos/guardar', methods=['POST'])
def guardar_traspaso():
    data = request.get_json() or {}
    almacen_origen_id = data.get('almacen_origen_id')
    almacen_destino_id = data.get('almacen_destino_id')
    concepto_id = data.get('concepto_id')
    folio = str(data.get('folio', '')).strip().upper()
    descripcion = str(data.get('descripcion', '')).strip()
    partidas = data.get('partidas', [])

    if not almacen_origen_id or not almacen_destino_id or not folio or not partidas:
        return jsonify({"error": "Faltan datos requeridos para completar el traspaso"}), 400

    conn = None
    try:
        conn = conectar_db()
        cur = conn.cursor()

        # Obtener nombres oficiales de almacenes de origen y destino
        cur.execute("SELECT ALMACEN_ID, NOMBRE FROM ALMACENES WHERE ALMACEN_ID IN (?, ?)", (int(almacen_origen_id), int(almacen_destino_id)))
        alms_map = {int(r[0]): str(r[1]).strip() for r in cur.fetchall()}
        nom_origen = alms_map.get(int(almacen_origen_id), str(data.get('almacen_origen_nombre', 'ALMACEN ORIGEN')))
        nom_destino = alms_map.get(int(almacen_destino_id), str(data.get('almacen_destino_nombre', 'ALMACEN DESTINO')))

        # Obtener nombre del concepto (ej. 'Traspaso (Salida)')
        nom_concepto = "Traspaso (Salida)"
        if concepto_id:
            try:
                cur.execute("SELECT FIRST 1 NOMBRE FROM CONCEPTOS_IN WHERE CONCEPTO_IN_ID = ?", (int(concepto_id),))
                c_row = cur.fetchone()
                if c_row and c_row[0]:
                    nom_concepto = str(c_row[0]).strip()
            except:
                pass

        # Obtener localizaciones en el almacén de origen para cada artículo
        art_ids = [int(p['articulo_id']) for p in partidas if p.get('articulo_id')]
        loc_map = obtener_localizaciones_articulos(cur, art_ids, int(almacen_origen_id))
        for p in partidas:
            art_id = int(p.get('articulo_id', 0))
            if art_id in loc_map:
                p['localizacion'] = loc_map[art_id]

        # Obtener sucursal de matriz para DOCTOS_IN
        sucursal_id = None
        try:
            cur.execute("SELECT FIRST 1 SUCURSAL_ID FROM SUCURSALES WHERE ES_MATRIZ = TRUE")
            s_row = cur.fetchone()
            if s_row:
                sucursal_id = int(s_row[0])
        except Exception:
            pass
        if not sucursal_id:
            sucursal_id = 1236917

        # Resolver conceptos de salida y entrada para traspaso
        concepto_salida_id = int(concepto_id) if concepto_id else None
        if not concepto_salida_id:
            try:
                cur.execute("SELECT FIRST 1 CONCEPTO_IN_ID FROM CONCEPTOS_IN WHERE ID_INTERNO = 't'")
                cs_row = cur.fetchone()
                if cs_row:
                    concepto_salida_id = int(cs_row[0])
            except Exception:
                pass
        if not concepto_salida_id:
            concepto_salida_id = 36

        concepto_entrada_id = None
        try:
            cur.execute("SELECT FIRST 1 CONCEPTO_IN_ID FROM CONCEPTOS_IN WHERE ID_INTERNO = 'T'")
            ce_row = cur.fetchone()
            if ce_row:
                concepto_entrada_id = int(ce_row[0])
        except Exception:
            pass
        if not concepto_entrada_id:
            concepto_entrada_id = 25

        usuario_actual = str(session.get('usuario', 'SYSDBA')).strip().upper()[:31]
        if not usuario_actual:
            usuario_actual = 'SYSDBA'

        folio_db = folio_para_microsip_db(folio)
        folio_imprimir = folio_para_codigo_barras(folio)

        docto_in_id = obtener_siguiente_id(cur, "ID_DOCTOS", "DOCTOS_IN", "DOCTO_IN_ID")

        cur.execute("""
            INSERT INTO DOCTOS_IN (
                DOCTO_IN_ID, ALMACEN_ID, ALMACEN_DESTINO_ID, CONCEPTO_IN_ID, SUCURSAL_ID,
                FOLIO, NATURALEZA_CONCEPTO, FECHA, CANCELADO, APLICADO,
                DESCRIPCION, FORMA_EMITIDA, CONTABILIZADO, SISTEMA_ORIGEN,
                USUARIO_CREADOR, FECHA_HORA_CREACION, USUARIO_ULT_MODIF, FECHA_HORA_ULT_MODIF
            ) VALUES (
                ?, ?, ?, ?, ?,
                ?, 'S', CURRENT_DATE, 'N', 'N',
                ?, 'N', 'N', 'IN',
                ?, CURRENT_TIMESTAMP, ?, CURRENT_TIMESTAMP
            )
        """, (docto_in_id, int(almacen_origen_id), int(almacen_destino_id), concepto_salida_id, sucursal_id,
              folio_db, descripcion if descripcion else None, usuario_actual, usuario_actual))

        for p in partidas:
            art_id = int(p['articulo_id'])
            cant_surtir = float(p['cantidad'])
            art_clave = str(p.get('clave', '')).strip().upper()
            if not art_clave:
                try:
                    cur.execute("""
                        SELECT FIRST 1 ca.CLAVE_ARTICULO 
                        FROM CLAVES_ARTICULOS ca
                        JOIN ROLES_CLAVES_ARTICULOS r ON r.ROL_CLAVE_ART_ID = ca.ROL_CLAVE_ART_ID AND r.ES_PPAL = 'S'
                        WHERE ca.ARTICULO_ID = ?
                    """, (art_id,))
                    c_row = cur.fetchone()
                    if c_row and c_row[0]:
                        art_clave = str(c_row[0]).strip().upper()
                except Exception:
                    pass
            if not art_clave:
                art_clave = f"ART{art_id}"

            costo_unit = 0.0
            try:
                cur.execute("""
                    SELECT FIRST 1 COSTO_UNITARIO 
                    FROM DOCTOS_IN_DET 
                    WHERE ARTICULO_ID = ? AND COSTO_UNITARIO > 0 
                    ORDER BY DOCTO_IN_DET_ID DESC
                """, (art_id,))
                c_cost = cur.fetchone()
                if c_cost and c_cost[0]:
                    costo_unit = float(c_cost[0])
            except Exception:
                pass
            costo_tot = round(costo_unit * cant_surtir, 2)

            # Renglón Salida del Almacén Origen (ROL = 'S')
            det_sal_id = obtener_siguiente_id(cur, "ID_DOCTOS", "DOCTOS_IN_DET", "DOCTO_IN_DET_ID")
            cur.execute("""
                INSERT INTO DOCTOS_IN_DET (
                    DOCTO_IN_DET_ID, DOCTO_IN_ID, ALMACEN_ID, CONCEPTO_IN_ID,
                    CLAVE_ARTICULO, ARTICULO_ID, TIPO_MOVTO, UNIDADES,
                    COSTO_UNITARIO, COSTO_TOTAL, METODO_COSTEO, CANCELADO,
                    APLICADO, COSTEO_PEND, PEDIMENTO_PEND, ROL, FECHA
                ) VALUES (
                    ?, ?, ?, ?,
                    ?, ?, 'S', ?,
                    ?, ?, 'C', 'N',
                    'N', 'N', 'N', 'S', CURRENT_DATE
                )
            """, (det_sal_id, docto_in_id, int(almacen_origen_id), concepto_salida_id,
                  art_clave, art_id, cant_surtir, costo_unit, costo_tot))

            # Renglón Entrada en el Almacén Destino (ROL = 'E')
            det_ent_id = obtener_siguiente_id(cur, "ID_DOCTOS", "DOCTOS_IN_DET", "DOCTO_IN_DET_ID")
            cur.execute("""
                INSERT INTO DOCTOS_IN_DET (
                    DOCTO_IN_DET_ID, DOCTO_IN_ID, ALMACEN_ID, CONCEPTO_IN_ID,
                    CLAVE_ARTICULO, ARTICULO_ID, TIPO_MOVTO, UNIDADES,
                    COSTO_UNITARIO, COSTO_TOTAL, METODO_COSTEO, CANCELADO,
                    APLICADO, COSTEO_PEND, PEDIMENTO_PEND, ROL, FECHA
                ) VALUES (
                    ?, ?, ?, ?,
                    ?, ?, 'E', ?,
                    ?, ?, 'C', 'N',
                    'N', 'N', 'N', 'E', CURRENT_DATE
                )
            """, (det_ent_id, docto_in_id, int(almacen_destino_id), concepto_entrada_id,
                  art_clave, art_id, cant_surtir, costo_unit, costo_tot))

            cur.execute("""
                INSERT INTO SUB_MOVTOS_IN (DOCTO_IN_DET_ID, SUB_MOVTO_ID)
                VALUES (?, ?)
            """, (det_sal_id, det_ent_id))

        # Aplicar el documento
        cur.execute("""
            UPDATE DOCTOS_IN
            SET APLICADO = 'S'
            WHERE DOCTO_IN_ID = ?
        """, (docto_in_id,))

        # Registrar estatus en LIBRES_SALIDAS_IN
        es_origen_cedis = "CEDIS" in nom_origen.upper()
        es_destino_cedis = "CEDIS" in nom_destino.upper()
        status_inicial = 8 if (es_origen_cedis and not es_destino_cedis) else 0

        try:
            cur.execute("""
                UPDATE OR INSERT INTO LIBRES_SALIDAS_IN (DOCTO_IN_ID, STATUS, ENTREGADO, CONDICION, TIPO)
                VALUES (?, ?, 0, 0, 'N')
                MATCHING (DOCTO_IN_ID)
            """, (docto_in_id, status_inicial))
        except Exception as e_lsi:
            print(f"Aviso al registrar LIBRES_SALIDAS_IN: {e_lsi}")

        conn.commit()
        cur.close()
        conn.close()

        # REGLA DE IMPRESIÓN DE TICKET EN POS-80C (2 copias automáticas)
        debe_imprimir = es_origen_cedis and not es_destino_cedis

        impresion_info = {
            "aplica": debe_imprimir,
            "ejecutada": False,
            "impresora": "POS-80C",
            "origen": nom_origen,
            "destino": nom_destino,
            "mensaje": ""
        }

        now_dt = datetime.datetime.now()

        if debe_imprimir:
            empresa_info = next((e for e in EMPRESAS_DISPONIBLES if e['id'] == get_current_dsn()), {"nombre": "BC REFACCIONARIAS"})
            emp_nombre = empresa_info.get("nombre", "BC REFACCIONARIAS")

            try:
                ticket_bytes = generar_ticket_traspaso_bytes(
                    emp_nombre,
                    folio_imprimir,
                    now_dt,
                    nom_origen,
                    nom_destino,
                    nom_concepto,
                    descripcion,
                    partidas
                )
                ok_print, msg_print = imprimir_ticket_pos80(ticket_bytes, printer_name="POS-80C", copias=1, folio=folio_imprimir, forzar=False)
                impresion_info["ejecutada"] = ok_print
                impresion_info["mensaje"] = msg_print
            except Exception as e_pr:
                impresion_info["ejecutada"] = False
                impresion_info["mensaje"] = f"Error al generar/imprimir ticket: {str(e_pr)}"
        else:
            if not es_origen_cedis:
                impresion_info["mensaje"] = "No se imprime ticket: El traspaso no se origina en CEDIS."
            elif es_destino_cedis:
                impresion_info["mensaje"] = "No se imprime ticket: El destino es CEDIS."

        meses = ["ene.", "feb.", "mar.", "abr.", "may.", "jun.", "jul.", "ago.", "sep.", "oct.", "nov.", "dic."]
        fecha_caja = f"{now_dt.day:02d}/{meses[now_dt.month-1]}/{now_dt.year}"
        hora_caja = now_dt.strftime("%H:%M")
        fecha_impresion_str = now_dt.strftime("%d/%m/%Y %I:%M %p").replace("AM", "a. m.").replace("PM", "p. m.")

        # Calcular inmediatamente el siguiente folio disponible garantizado sin colisión
        siguiente_folio_sugerido = None
        try:
            conn_sig = conectar_db()
            cur_sig = conn_sig.cursor()
            siguiente_folio_sugerido, _ = calcular_siguiente_folio_traspaso(
                cur_sig, almacen_origen_id, almacen_destino_id, nom_destino
            )
            cur_sig.close()
            conn_sig.close()
        except Exception as e_sig:
            print("Aviso al calcular siguiente folio tras guardar traspaso:", e_sig)

        return jsonify({
            "success": True,
            "docto_in_id": docto_in_id,
            "folio": folio_imprimir,
            "folio_db": folio_db,
            "siguiente_folio": siguiente_folio_sugerido,
            "total_partidas": len(partidas),
            "almacen_origen": nom_origen,
            "almacen_destino": nom_destino,
            "concepto": nom_concepto,
            "fecha_caja": fecha_caja,
            "hora_caja": hora_caja,
            "fecha_impresion": fecha_impresion_str,
            "partidas": partidas,
            "impresion": impresion_info
        })
    except Exception as e:
        if conn:
            try:
                conn.rollback()
            except:
                pass
            conn.close()
        err_msg = str(e)
        if "-803" in err_msg or "violation of PRIMARY or UNIQUE KEY" in err_msg or "DOCTOS_IN_AK1" in err_msg:
            err_msg = f"El folio '{folio}' ya fue utilizado previamente en otro traspaso. Por favor usa el folio sugerido siguiente o escribe uno diferente."
        return jsonify({"error": err_msg, "success": False}), 500

@traspasos_bp.route('/api/traspasos/reimprimir-ticket', methods=['POST'])
def reimprimir_ticket_traspaso():
    try:
        data = request.get_json() or {}
        folio = str(data.get('folio', '')).strip().upper()
        folio_clean = folio_para_microsip_db(folio)
        nom_origen = str(data.get('origen', 'CEDIS')).strip()
        nom_destino = str(data.get('destino', 'SUCURSAL')).strip()
        descripcion = str(data.get('descripcion', '')).strip()
        partidas = data.get('partidas', [])

        art_ids_sin_loc = [int(p['articulo_id']) for p in partidas if p.get('articulo_id') and not str(p.get('localizacion', '')).strip()]
        if art_ids_sin_loc:
            conn_loc = None
            try:
                conn_loc = conectar_db()
                cur_loc = conn_loc.cursor()
                loc_map = obtener_localizaciones_articulos(cur_loc, art_ids_sin_loc, 620110)
                for p in partidas:
                    aid = int(p.get('articulo_id', 0))
                    if not str(p.get('localizacion', '')).strip() and aid in loc_map:
                        p['localizacion'] = loc_map[aid]
                cur_loc.close()
                conn_loc.close()
            except Exception as e_loc_fill:
                if conn_loc:
                    try: conn_loc.close()
                    except: pass
                print("Aviso al rellenar localizaciones en reimpresión:", e_loc_fill)

        now_dt = datetime.datetime.now()
        nom_concepto = str(data.get('concepto', 'Traspaso (Salida)')).strip()

        empresa_info = next((e for e in EMPRESAS_DISPONIBLES if e['id'] == get_current_dsn()), {"nombre": "BC REFACCIONARIAS"})
        emp_nombre = data.get('empresa') or empresa_info.get("nombre", "BC REFACCIONARIAS")

        ticket_bytes = generar_ticket_traspaso_bytes(
            emp_nombre,
            folio_clean,
            now_dt,
            nom_origen,
            nom_destino,
            nom_concepto,
            descripcion,
            partidas
        )
        forzar = bool(data.get('forzar', False))
        ok_print, msg_print = imprimir_ticket_pos80(ticket_bytes, printer_name="POS-80C", copias=1, folio=folio_clean, forzar=forzar)
        return jsonify({"success": ok_print, "mensaje": msg_print, "folio": folio_clean})
    except Exception as e_reimp:
        return jsonify({"success": False, "mensaje": f"Error al reimprimir: {str(e_reimp)}"}), 500

@traspasos_bp.route('/api/traspasos/buscar-folios', methods=['GET'])
def buscar_folios_traspasos():
    q = request.args.get('q', '').strip().upper()
    origen_id = request.args.get('origen_id', '').strip()
    destino_id = request.args.get('destino_id', '').strip()
    fecha_desde = request.args.get('fecha_desde', '').strip()
    fecha_hasta = request.args.get('fecha_hasta', '').strip()
    limite = int(request.args.get('limite', 50))
    limite = max(1, min(limite, 100))

    conn = None
    try:
        conn = conectar_db()
        cur = conn.cursor()

        where_clauses = ["doc.ALMACEN_DESTINO_ID IS NOT NULL"]
        params = []

        if q:
            letras, num_val, num_str = desglosar_folio(q)
            patterns = [f"%{q}%"]
            if num_str:
                patterns.append(folio_para_microsip_db(q))
                patterns.append(f"%{num_val}%")
                if letras:
                    patterns.append(f"{letras}%{num_val}")
            patterns = list(dict.fromkeys(patterns))
            or_folio = " OR ".join(["UPPER(doc.FOLIO) LIKE ?"] * len(patterns))
            where_clauses.append(f"({or_folio} OR UPPER(doc.DESCRIPCION) LIKE ?)")
            for p in patterns:
                params.append(p.upper())
            params.append(f"%{q}%")

        if origen_id:
            where_clauses.append("doc.ALMACEN_ID = ?")
            params.append(int(origen_id))

        if destino_id:
            where_clauses.append("doc.ALMACEN_DESTINO_ID = ?")
            params.append(int(destino_id))

        if fecha_desde:
            where_clauses.append("doc.FECHA >= ?")
            params.append(fecha_desde)

        if fecha_hasta:
            where_clauses.append("doc.FECHA <= ?")
            params.append(fecha_hasta)

        status_filtro = request.args.get('status')
        if status_filtro is not None and str(status_filtro).strip() != '':
            where_clauses.append("COALESCE(lsi.STATUS, 8) = ?")
            params.append(int(status_filtro))

        where_sql = " AND ".join(where_clauses)

        sql = f"""
            SELECT FIRST {limite}
                doc.DOCTO_IN_ID,
                TRIM(doc.FOLIO),
                doc.FECHA,
                doc.ALMACEN_ID,
                COALESCE(TRIM(ao.NOMBRE), 'ALMACEN ORIGEN'),
                doc.ALMACEN_DESTINO_ID,
                COALESCE(TRIM(ad.NOMBRE), 'ALMACEN DESTINO'),
                doc.CONCEPTO_IN_ID,
                COALESCE(TRIM(c.NOMBRE), 'Traspaso (Salida)'),
                COALESCE(TRIM(doc.DESCRIPCION), ''),
                doc.CANCELADO,
                COALESCE(TRIM(doc.USUARIO_CREADOR), ''),
                doc.FECHA_HORA_CREACION,
                (SELECT COUNT(*) FROM DOCTOS_IN_DET det WHERE det.DOCTO_IN_ID = doc.DOCTO_IN_ID AND det.ROL = 'S') AS TOT_PARTIDAS,
                (SELECT SUM(det.UNIDADES) FROM DOCTOS_IN_DET det WHERE det.DOCTO_IN_ID = doc.DOCTO_IN_ID AND det.ROL = 'S') AS TOT_PIEZAS,
                lsi.STATUS,
                lsi.ENTREGADO,
                lsi.CONDICION,
                lsi.TIPO
            FROM DOCTOS_IN doc
            LEFT JOIN ALMACENES ao ON ao.ALMACEN_ID = doc.ALMACEN_ID
            LEFT JOIN ALMACENES ad ON ad.ALMACEN_ID = doc.ALMACEN_DESTINO_ID
            LEFT JOIN CONCEPTOS_IN c ON c.CONCEPTO_IN_ID = doc.CONCEPTO_IN_ID
            LEFT JOIN LIBRES_SALIDAS_IN lsi ON lsi.DOCTO_IN_ID = doc.DOCTO_IN_ID
            WHERE {where_sql}
            ORDER BY doc.FECHA DESC, doc.DOCTO_IN_ID DESC
        """

        cur.execute(sql, tuple(params))
        meses = ["ene.", "feb.", "mar.", "abr.", "may.", "jun.", "jul.", "ago.", "sep.", "oct.", "nov.", "dic."]
        
        resultados = []
        for r in cur.fetchall():
            doc_id = int(r[0])
            folio_db = str(r[1] or '').strip()
            folio_clean = folio_para_codigo_barras(folio_db)
            fecha_val = r[2]
            fecha_str = fecha_val.strftime("%d/%m/%Y") if fecha_val else ""
            fecha_caja = f"{fecha_val.day:02d}/{meses[fecha_val.month-1]}/{fecha_val.year}" if fecha_val else ""
            
            fh_creacion = r[12]
            hora_str = fh_creacion.strftime("%H:%M") if fh_creacion else "12:00"
            fecha_impr = fh_creacion.strftime("%d/%m/%Y %I:%M %p").replace("AM", "a. m.").replace("PM", "p. m.") if fh_creacion else fecha_str

            tot_partidas = int(r[13] or 0)
            tot_pzas = float(r[14] or 0)
            tot_pzas_str = f"{int(tot_pzas)}" if tot_pzas.is_integer() else f"{tot_pzas:.1f}"

            st_info = formatear_estatus_traspaso(r[15], r[16], r[17], r[18])

            resultados.append({
                "docto_in_id": doc_id,
                "folio": folio_clean,
                "folio_db": folio_db,
                "fecha": fecha_str,
                "fecha_iso": str(fecha_val) if fecha_val else "",
                "fecha_caja": fecha_caja,
                "hora_caja": hora_str,
                "fecha_impresion": fecha_impr,
                "almacen_origen_id": int(r[3]) if r[3] else None,
                "almacen_origen": str(r[4]).strip(),
                "almacen_destino_id": int(r[5]) if r[5] else None,
                "almacen_destino": str(r[6]).strip(),
                "concepto_id": int(r[7]) if r[7] else None,
                "concepto": str(r[8]).strip(),
                "descripcion": str(r[9]).strip(),
                "cancelado": str(r[10]).strip() == 'S',
                "usuario": str(r[11]).strip(),
                "total_partidas": tot_partidas,
                "total_piezas": tot_pzas_str,
                **st_info
            })

        cur.close()
        conn.close()
        return jsonify({"success": True, "traspasos": resultados, "total": len(resultados)})
    except Exception as e:
        if conn:
            try: conn.close()
            except: pass
        return jsonify({"success": False, "error": str(e), "traspasos": []}), 500

@traspasos_bp.route('/api/traspasos/detalle/<int:docto_id>', methods=['GET'])
def detalle_traspaso(docto_id):
    conn = None
    try:
        conn = conectar_db()
        cur = conn.cursor()

        cur.execute("""
            SELECT
                doc.DOCTO_IN_ID,
                TRIM(doc.FOLIO),
                doc.FECHA,
                doc.ALMACEN_ID,
                COALESCE(TRIM(ao.NOMBRE), 'ALMACEN ORIGEN'),
                doc.ALMACEN_DESTINO_ID,
                COALESCE(TRIM(ad.NOMBRE), 'ALMACEN DESTINO'),
                doc.CONCEPTO_IN_ID,
                COALESCE(TRIM(c.NOMBRE), 'Traspaso (Salida)'),
                COALESCE(TRIM(doc.DESCRIPCION), ''),
                doc.CANCELADO,
                COALESCE(TRIM(doc.USUARIO_CREADOR), ''),
                doc.FECHA_HORA_CREACION,
                lsi.STATUS,
                lsi.ENTREGADO,
                lsi.CONDICION,
                lsi.TIPO
            FROM DOCTOS_IN doc
            LEFT JOIN ALMACENES ao ON ao.ALMACEN_ID = doc.ALMACEN_ID
            LEFT JOIN ALMACENES ad ON ad.ALMACEN_ID = doc.ALMACEN_DESTINO_ID
            LEFT JOIN CONCEPTOS_IN c ON c.CONCEPTO_IN_ID = doc.CONCEPTO_IN_ID
            LEFT JOIN LIBRES_SALIDAS_IN lsi ON lsi.DOCTO_IN_ID = doc.DOCTO_IN_ID
            WHERE doc.DOCTO_IN_ID = ?
        """, (docto_id,))
        r = cur.fetchone()
        if not r:
            cur.close()
            conn.close()
            return jsonify({"success": False, "error": "Traspaso no encontrado"}), 404

        folio_db = str(r[1] or '').strip()
        folio_clean = folio_para_codigo_barras(folio_db)
        fecha_val = r[2]
        meses = ["ene.", "feb.", "mar.", "abr.", "may.", "jun.", "jul.", "ago.", "sep.", "oct.", "nov.", "dic."]
        fecha_str = fecha_val.strftime("%d/%m/%Y") if fecha_val else ""
        fecha_caja = f"{fecha_val.day:02d}/{meses[fecha_val.month-1]}/{fecha_val.year}" if fecha_val else ""
        
        fh_creacion = r[12]
        hora_str = fh_creacion.strftime("%H:%M") if fh_creacion else "12:00"
        fecha_impr = fh_creacion.strftime("%d/%m/%Y %I:%M %p").replace("AM", "a. m.").replace("PM", "p. m.") if fh_creacion else fecha_str

        alm_origen_id = int(r[3]) if r[3] else None
        nom_origen = str(r[4]).strip()
        nom_destino = str(r[6]).strip()
        nom_concepto = str(r[8]).strip()
        descripcion = str(r[9]).strip()

        st_info = formatear_estatus_traspaso(r[13], r[14], r[15], r[16])

        cur.execute("""
            SELECT 
                det.DOCTO_IN_DET_ID,
                det.ARTICULO_ID,
                TRIM(det.CLAVE_ARTICULO),
                TRIM(a.NOMBRE),
                COALESCE(TRIM(a.UNIDAD_VENTA), 'PZA'),
                det.UNIDADES,
                COALESCE(TRIM(na.LOCALIZACION), '')
            FROM DOCTOS_IN_DET det
            JOIN ARTICULOS a ON a.ARTICULO_ID = det.ARTICULO_ID
            LEFT JOIN NIVELES_ARTICULOS na ON na.ARTICULO_ID = det.ARTICULO_ID AND na.ALMACEN_ID = det.ALMACEN_ID
            WHERE det.DOCTO_IN_ID = ? AND det.ROL = 'S'
            ORDER BY det.DOCTO_IN_DET_ID
        """, (docto_id,))

        partidas = []
        tot_unidades = 0.0
        arts_sin_loc = []
        for p_row in cur.fetchall():
            u_cant = float(p_row[5] or 0)
            tot_unidades += u_cant
            aid = int(p_row[1])
            loc_val = str(p_row[6] or '').strip()
            partida_obj = {
                "docto_in_det_id": int(p_row[0]),
                "articulo_id": aid,
                "clave": str(p_row[2]).strip(),
                "nombre": str(p_row[3]).strip(),
                "unidad": str(p_row[4]).strip(),
                "cantidad": int(u_cant) if u_cant.is_integer() else u_cant,
                "localizacion": loc_val
            }
            if not loc_val:
                arts_sin_loc.append(aid)
            partidas.append(partida_obj)

        if arts_sin_loc:
            loc_map_fb = obtener_localizaciones_articulos(cur, arts_sin_loc, alm_origen_id or 620110)
            for p in partidas:
                if not p['localizacion'] and p['articulo_id'] in loc_map_fb:
                    p['localizacion'] = loc_map_fb[p['articulo_id']]

        cur.close()
        conn.close()

        empresa_info = next((e for e in EMPRESAS_DISPONIBLES if e['id'] == get_current_dsn()), {"nombre": "BC REFACCIONARIAS"})
        emp_nombre = empresa_info.get("nombre", "BC REFACCIONARIAS")

        return jsonify({
            "success": True,
            "traspaso": {
                "docto_in_id": docto_id,
                "folio": folio_clean,
                "folio_db": folio_db,
                "fecha": fecha_str,
                "fecha_caja": fecha_caja,
                "hora_caja": hora_str,
                "fecha_impresion": fecha_impr,
                "almacen_origen_id": alm_origen_id,
                "almacen_origen": nom_origen,
                "almacen_destino_id": int(r[5]) if r[5] else None,
                "almacen_destino": nom_destino,
                "concepto": nom_concepto,
                "descripcion": descripcion,
                "empresa": emp_nombre,
                "cancelado": str(r[10]).strip() == 'S',
                "usuario": str(r[11]).strip(),
                "total_partidas": len(partidas),
                "total_piezas": int(tot_unidades) if tot_unidades.is_integer() else tot_unidades,
                "partidas": partidas,
                **st_info
            }
        })
    except Exception as e:
        if conn:
            try: conn.close()
            except: pass
        return jsonify({"success": False, "error": str(e)}), 500

@traspasos_bp.route('/api/traspasos/reimprimir-id/<int:docto_id>', methods=['POST'])
def reimprimir_traspaso_por_id(docto_id):
    conn = None
    try:
        conn = conectar_db()
        cur = conn.cursor()

        cur.execute("""
            SELECT
                doc.DOCTO_IN_ID,
                TRIM(doc.FOLIO),
                doc.FECHA,
                doc.ALMACEN_ID,
                COALESCE(TRIM(ao.NOMBRE), 'ALMACEN ORIGEN'),
                doc.ALMACEN_DESTINO_ID,
                COALESCE(TRIM(ad.NOMBRE), 'ALMACEN DESTINO'),
                doc.CONCEPTO_IN_ID,
                COALESCE(TRIM(c.NOMBRE), 'Traspaso (Salida)'),
                COALESCE(TRIM(doc.DESCRIPCION), ''),
                doc.FECHA_HORA_CREACION
            FROM DOCTOS_IN doc
            LEFT JOIN ALMACENES ao ON ao.ALMACEN_ID = doc.ALMACEN_ID
            LEFT JOIN ALMACENES ad ON ad.ALMACEN_ID = doc.ALMACEN_DESTINO_ID
            LEFT JOIN CONCEPTOS_IN c ON c.CONCEPTO_IN_ID = doc.CONCEPTO_IN_ID
            WHERE doc.DOCTO_IN_ID = ?
        """, (docto_id,))
        r = cur.fetchone()
        if not r:
            cur.close()
            conn.close()
            return jsonify({"success": False, "mensaje": "Traspaso no encontrado"}), 404

        folio_db = str(r[1] or '').strip()
        folio_clean = folio_para_codigo_barras(folio_db)
        alm_origen_id = int(r[3]) if r[3] else 620110
        nom_origen = str(r[4]).strip()
        nom_destino = str(r[6]).strip()
        nom_concepto = str(r[8]).strip()
        descripcion = str(r[9]).strip()
        fh_creacion = r[10] if r[10] else datetime.datetime.now()

        cur.execute("""
            SELECT 
                det.DOCTO_IN_DET_ID,
                det.ARTICULO_ID,
                TRIM(det.CLAVE_ARTICULO),
                TRIM(a.NOMBRE),
                det.UNIDADES,
                COALESCE(TRIM(na.LOCALIZACION), '')
            FROM DOCTOS_IN_DET det
            JOIN ARTICULOS a ON a.ARTICULO_ID = det.ARTICULO_ID
            LEFT JOIN NIVELES_ARTICULOS na ON na.ARTICULO_ID = det.ARTICULO_ID AND na.ALMACEN_ID = det.ALMACEN_ID
            WHERE det.DOCTO_IN_ID = ? AND det.ROL = 'S'
            ORDER BY det.DOCTO_IN_DET_ID
        """, (docto_id,))

        partidas = []
        arts_sin_loc = []
        for p_row in cur.fetchall():
            u_cant = float(p_row[4] or 0)
            aid = int(p_row[1])
            loc_val = str(p_row[5] or '').strip()
            partida_obj = {
                "articulo_id": aid,
                "clave": str(p_row[2]).strip(),
                "nombre": str(p_row[3]).strip(),
                "cantidad": int(u_cant) if u_cant.is_integer() else u_cant,
                "localizacion": loc_val
            }
            if not loc_val:
                arts_sin_loc.append(aid)
            partidas.append(partida_obj)

        if arts_sin_loc:
            loc_map_fb = obtener_localizaciones_articulos(cur, arts_sin_loc, alm_origen_id)
            for p in partidas:
                if not p['localizacion'] and p['articulo_id'] in loc_map_fb:
                    p['localizacion'] = loc_map_fb[p['articulo_id']]

        cur.close()
        conn.close()

        empresa_info = next((e for e in EMPRESAS_DISPONIBLES if e['id'] == get_current_dsn()), {"nombre": "BC REFACCIONARIAS"})
        emp_nombre = empresa_info.get("nombre", "BC REFACCIONARIAS")

        ticket_bytes = generar_ticket_traspaso_bytes(
            emp_nombre,
            folio_clean,
            fh_creacion,
            nom_origen,
            nom_destino,
            nom_concepto,
            descripcion,
            partidas
        )
        req_json = request.get_json(silent=True) or {}
        forzar = bool(req_json.get('forzar', False))
        ok_print, msg_print = imprimir_ticket_pos80(ticket_bytes, printer_name="POS-80C", copias=1, folio=folio_clean, forzar=forzar)
        return jsonify({"success": ok_print, "mensaje": msg_print, "folio": folio_clean})
    except Exception as e:
        if conn:
            try: conn.close()
            except: pass
        return jsonify({"success": False, "mensaje": f"Error al reimprimir: {str(e)}"}), 500

@traspasos_bp.route('/api/traspasos/catalogo-estatus', methods=['GET'])
def catalogo_estatus_traspasos():
    return jsonify({
        "success": True,
        "estatus": [
            {"codigo": k, **v} for k, v in ESTATUS_TRASPASOS_MAP.items()
        ]
    })

@traspasos_bp.route('/api/traspasos/escanear', methods=['GET'])
def escanear_traspaso():
    codigo = str(request.args.get('codigo') or '').strip()
    if not codigo:
        return jsonify({"success": False, "error": "Debe proporcionar un código o folio"}), 400

    conn = None
    try:
        conn = conectar_db()
        cur = conn.cursor()

        docto_id = None
        if codigo.isdigit() and len(codigo) >= 7:
            cur.execute("SELECT DOCTO_IN_ID FROM DOCTOS_IN WHERE DOCTO_IN_ID = ?", (int(codigo),))
            r_id = cur.fetchone()
            if r_id:
                docto_id = int(r_id[0])

        if not docto_id:
            letras, num_val, num_str = desglosar_folio(codigo)
            p_mic = folio_para_microsip_db(codigo)
            cur.execute("""
                SELECT FIRST 1 DOCTO_IN_ID
                FROM DOCTOS_IN
                WHERE (UPPER(TRIM(FOLIO)) = ? OR UPPER(TRIM(FOLIO)) = ? OR UPPER(TRIM(FOLIO)) = ?)
                  AND ALMACEN_DESTINO_ID IS NOT NULL
                ORDER BY DOCTO_IN_ID DESC
            """, (codigo.upper(), p_mic.upper(), f"{letras}{num_val}".upper()))
            r_doc = cur.fetchone()
            if r_doc:
                docto_id = int(r_doc[0])
            elif num_val and num_val > 0:
                cur.execute("""
                    SELECT FIRST 1 DOCTO_IN_ID
                    FROM DOCTOS_IN
                    WHERE UPPER(TRIM(FOLIO)) LIKE ? AND ALMACEN_DESTINO_ID IS NOT NULL
                    ORDER BY DOCTO_IN_ID DESC
                """, (f"%{num_val}%",))
                r_doc2 = cur.fetchone()
                if r_doc2:
                    docto_id = int(r_doc2[0])

        cur.close()
        conn.close()

        if not docto_id:
            return jsonify({"success": False, "error": f"No se encontró ningún traspaso para el código: '{codigo}'"}), 404

        return detalle_traspaso(docto_id)
    except Exception as e:
        if conn:
            try: conn.close()
            except: pass
        return jsonify({"success": False, "error": str(e)}), 500

@traspasos_bp.route('/api/traspasos/cambiar-estatus', methods=['POST'])
def cambiar_estatus_traspaso():
    data = request.json or {}
    docto_id = data.get('docto_in_id')
    folio_in = str(data.get('folio') or '').strip()
    nuevo_status = data.get('status')
    if nuevo_status is None:
        return jsonify({"success": False, "error": "El campo 'status' es obligatorio"}), 400

    nuevo_status = int(nuevo_status)
    nuevo_entregado = data.get('entregado')
    if nuevo_entregado is None:
        nuevo_entregado = 1 if nuevo_status == 14 else 0
    else:
        nuevo_entregado = int(nuevo_entregado)

    nueva_condicion = int(data.get('condicion', 0))
    nuevo_tipo = str(data.get('tipo', 'N')).strip()[:1] or 'N'
    usuario_mod = str(data.get('usuario') or session.get('usuario', 'ALMACEN')).strip().upper()[:31]

    conn = None
    try:
        conn = conectar_db()
        cur = conn.cursor()

        if not docto_id and folio_in:
            letras, num_val, num_str = desglosar_folio(folio_in)
            p_mic = folio_para_microsip_db(folio_in)
            cur.execute("""
                SELECT FIRST 1 DOCTO_IN_ID
                FROM DOCTOS_IN
                WHERE (UPPER(TRIM(FOLIO)) = ? OR UPPER(TRIM(FOLIO)) = ? OR UPPER(TRIM(FOLIO)) = ?)
                  AND ALMACEN_DESTINO_ID IS NOT NULL
                ORDER BY DOCTO_IN_ID DESC
            """, (folio_in.upper(), p_mic.upper(), f"{letras}{num_val}".upper()))
            r_doc = cur.fetchone()
            if r_doc:
                docto_id = int(r_doc[0])
            elif num_val and num_val > 0:
                cur.execute("""
                    SELECT FIRST 1 DOCTO_IN_ID
                    FROM DOCTOS_IN
                    WHERE UPPER(TRIM(FOLIO)) LIKE ? AND ALMACEN_DESTINO_ID IS NOT NULL
                    ORDER BY DOCTO_IN_ID DESC
                """, (f"%{num_val}%",))
                r_doc2 = cur.fetchone()
                if r_doc2:
                    docto_id = int(r_doc2[0])

        if not docto_id:
            cur.close()
            conn.close()
            return jsonify({"success": False, "error": f"No se encontró el traspaso con folio '{folio_in}'"}), 404

        # Upsert en LIBRES_SALIDAS_IN
        cur.execute("""
            UPDATE OR INSERT INTO LIBRES_SALIDAS_IN (DOCTO_IN_ID, STATUS, ENTREGADO, CONDICION, TIPO)
            VALUES (?, ?, ?, ?, ?)
            MATCHING (DOCTO_IN_ID)
        """, (docto_id, nuevo_status, nuevo_entregado, nueva_condicion, nuevo_tipo))

        # Registrar auditoría en DOCTOS_IN
        cur.execute("""
            UPDATE DOCTOS_IN
            SET USUARIO_ULT_MODIF = ?, FECHA_HORA_ULT_MODIF = CURRENT_TIMESTAMP
            WHERE DOCTO_IN_ID = ?
        """, (usuario_mod or 'ALMACEN', docto_id))

        conn.commit()
        cur.close()
        conn.close()

        st_info = formatear_estatus_traspaso(nuevo_status, nuevo_entregado, nueva_condicion, nuevo_tipo)
        return jsonify({
            "success": True,
            "mensaje": f"Estatus actualizado correctamente a {st_info['status_nombre']}",
            "docto_in_id": docto_id,
            "estatus": st_info
        })
    except Exception as e:
        if conn:
            try: conn.close()
            except: pass
        return jsonify({"success": False, "error": str(e)}), 500
