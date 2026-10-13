import datetime
from flask import Blueprint, jsonify, request
from app.db import conectar_db
from app.config import get_current_dsn

ventas_bp = Blueprint('ventas', __name__)

# Cache en memoria para el catálogo de sucursales (no cambia seguido)
_cache_sucursales_ventas = {}
_cache_sucursales_ttl = 120  # segundos

def _limpiar_texto(txt):
    if not txt:
        return ""
    txt = str(txt).strip()
    txt = txt.replace("Grficas", "Gráficas").replace("Grficas", "Gráficas")
    txt = txt.replace("Revolucin", "Revolución").replace("Revolucin", "Revolución")
    txt = txt.replace("Gmez", "Gómez").replace("Gmez", "Gómez")
    return txt

@ventas_bp.route('/api/ventas/sucursales', methods=['GET'])
@ventas_bp.route('/api/almacenes', methods=['GET'])
def get_sucursales_ventas():
    current_dsn = get_current_dsn()
    cache_key = f"{current_dsn}_sucursales"
    cached = _cache_sucursales_ventas.get(cache_key)
    if cached:
        datos, ts = cached
        if (datetime.datetime.now() - ts).total_seconds() < _cache_sucursales_ttl:
            return jsonify(datos)

    conn = None
    try:
        conn = conectar_db()
        cur = conn.cursor()
        cur.execute("""
            SELECT a.ALMACEN_ID, TRIM(a.NOMBRE)
            FROM ALMACENES a
            WHERE UPPER(a.NOMBRE) NOT LIKE 'NO UTILIZAR%'
              AND UPPER(a.NOMBRE) NOT LIKE '%TRANSITO%'
              AND UPPER(a.NOMBRE) NOT LIKE '%DEVOLUCION%'
              AND UPPER(a.NOMBRE) NOT LIKE '%USADOS%'
              AND (
                  a.ES_PPAL = 'S' 
                  OR UPPER(a.NOMBRE) LIKE 'SUCURSAL%' 
                  OR UPPER(a.NOMBRE) LIKE 'CEDIS%' 
                  OR UPPER(a.NOMBRE) = 'MATRIZ'
                  OR EXISTS (SELECT 1 FROM DOCTOS_PV pv WHERE pv.ALMACEN_ID = a.ALMACEN_ID)
              )
            ORDER BY 
                CASE WHEN UPPER(a.NOMBRE) LIKE '%CEDIS%' THEN 0 ELSE 1 END,
                a.NOMBRE
        """)
        sucursales = []
        for r in cur.fetchall():
            if r[0] is not None:
                nom = _limpiar_texto(r[1])
                sucursales.append({
                    "id": int(r[0]),
                    "nombre": nom
                })
        datos = {
            "success": True,
            "sucursales": sucursales,
            "almacenes": sucursales
        }
        _cache_sucursales_ventas[cache_key] = (datos, datetime.datetime.now())
        return jsonify(datos)
    except Exception as e:
        return jsonify({"success": False, "error": str(e), "sucursales": [], "almacenes": []}), 500
    finally:
        if conn:
            try:
                conn.close()
            except:
                pass

@ventas_bp.route('/api/ventas/resumen-sucursal', methods=['GET'])
def get_ventas_sucursal():
    almacen_id = request.args.get('almacen_id', '').strip()
    fecha_ini = request.args.get('fecha_inicio', '').strip()
    fecha_fin = request.args.get('fecha_final', '').strip()
    fecha = request.args.get('fecha', '').strip()

    hoy = datetime.date.today().strftime("%Y-%m-%d")
    if not fecha_ini and not fecha_fin:
        if fecha:
            fecha_ini = fecha
            fecha_fin = fecha
        else:
            fecha_ini = hoy
            fecha_fin = hoy
    elif not fecha_ini:
        fecha_ini = fecha_fin
    elif not fecha_fin:
        fecha_fin = fecha_ini

    conn = None
    try:
        conn = conectar_db()
        cur = conn.cursor()

        filtro_pv_alm = ""
        filtro_ve_alm = ""
        if almacen_id and almacen_id.isdigit():
            filtro_pv_alm = "AND COALESCE(p.ALMACEN_ID, cj.ALMACEN_ID) = ?"
            filtro_ve_alm = "AND v.ALMACEN_ID = ?"
            params_pv = [fecha_ini, fecha_fin, int(almacen_id)]
            params_ve = [fecha_ini, fecha_fin, int(almacen_id)]
        else:
            params_pv = [fecha_ini, fecha_fin]
            params_ve = [fecha_ini, fecha_fin]
        params_union = tuple(params_pv + params_ve)

        # Resumen general (solo ventas vigentes)
        cur.execute(f"""
            SELECT 
                COUNT(DOCTO_ID) AS TICKETS,
                SUM(TOTAL_VENTA) AS TOTAL_VENTA,
                AVG(CASE WHEN TOTAL_VENTA > 0 THEN TOTAL_VENTA END) AS TICKET_PROMEDIO
            FROM (
                SELECT 
                    p.DOCTO_PV_ID AS DOCTO_ID,
                    CASE WHEN p.TIPO_DOCTO = 'D' THEN -(p.IMPORTE_NETO + COALESCE(p.TOTAL_IMPUESTOS, 0)) ELSE (p.IMPORTE_NETO + COALESCE(p.TOTAL_IMPUESTOS, 0)) END AS TOTAL_VENTA
                FROM DOCTOS_PV p
                LEFT JOIN CAJAS cj ON cj.CAJA_ID = p.CAJA_ID
                WHERE p.FECHA >= ? AND p.FECHA <= ?
                  AND p.ESTATUS <> 'C'
                  AND p.TIPO_DOCTO IN ('V', 'D')
                  {filtro_pv_alm}

                UNION ALL

                SELECT 
                    v.DOCTO_VE_ID AS DOCTO_ID,
                    CASE WHEN v.TIPO_DOCTO = 'D' THEN -(v.IMPORTE_NETO + COALESCE(v.TOTAL_IMPUESTOS, 0)) ELSE (v.IMPORTE_NETO + COALESCE(v.TOTAL_IMPUESTOS, 0)) END AS TOTAL_VENTA
                FROM DOCTOS_VE v
                WHERE v.FECHA >= ? AND v.FECHA <= ?
                  AND v.ESTATUS <> 'C'
                  AND v.APLICADO = 'S'
                  AND v.TIPO_DOCTO IN ('F', 'D')
                  {filtro_ve_alm}
            )
        """, params_union)
        r = cur.fetchone()
        resumen = {
            "tickets": int(r[0] or 0),
            "total_venta": float(r[1] or 0),
            "ticket_promedio": float(r[2] or 0)
        }

        # Desglose diario
        cur.execute(f"""
            SELECT 
                FECHA,
                COUNT(DOCTO_ID) AS TICKETS,
                SUM(TOTAL_VENTA) AS TOTAL_VENTA
            FROM (
                SELECT 
                    p.FECHA,
                    p.DOCTO_PV_ID AS DOCTO_ID,
                    CASE WHEN p.TIPO_DOCTO = 'D' THEN -(p.IMPORTE_NETO + COALESCE(p.TOTAL_IMPUESTOS, 0)) ELSE (p.IMPORTE_NETO + COALESCE(p.TOTAL_IMPUESTOS, 0)) END AS TOTAL_VENTA
                FROM DOCTOS_PV p
                LEFT JOIN CAJAS cj ON cj.CAJA_ID = p.CAJA_ID
                WHERE p.FECHA >= ? AND p.FECHA <= ?
                  AND p.ESTATUS <> 'C'
                  AND p.TIPO_DOCTO IN ('V', 'D')
                  {filtro_pv_alm}

                UNION ALL

                SELECT 
                    v.FECHA,
                    v.DOCTO_VE_ID AS DOCTO_ID,
                    CASE WHEN v.TIPO_DOCTO = 'D' THEN -(v.IMPORTE_NETO + COALESCE(v.TOTAL_IMPUESTOS, 0)) ELSE (v.IMPORTE_NETO + COALESCE(v.TOTAL_IMPUESTOS, 0)) END AS TOTAL_VENTA
                FROM DOCTOS_VE v
                WHERE v.FECHA >= ? AND v.FECHA <= ?
                  AND v.ESTATUS <> 'C'
                  AND v.APLICADO = 'S'
                  AND v.TIPO_DOCTO IN ('F', 'D')
                  {filtro_ve_alm}
            )
            GROUP BY FECHA
            ORDER BY FECHA ASC
        """, params_union)
        dias = []
        for d in cur.fetchall():
            dias.append({
                "fecha": str(d[0]),
                "tickets": int(d[1] or 0),
                "total": float(d[2] or 0)
            })

        # Top 10 artículos de esta sucursal o grupo
        cur.execute(f"""
            SELECT FIRST 10
                COALESCE(TRIM(ca.CLAVE_ARTICULO), 'S/C') AS CLAVE,
                TRIM(ar.NOMBRE) AS NOMBRE,
                SUM(d.UNIDADES - COALESCE(d.UNIDADES_DEV, 0)) AS PIEZAS,
                SUM(d.PRECIO_TOTAL_NETO + (COALESCE(d.IMPUESTO_POR_UNIDAD, 0) * d.UNIDADES)) AS IMPORTE
            FROM DOCTOS_PV p
            JOIN DOCTOS_PV_DET d ON d.DOCTO_PV_ID = p.DOCTO_PV_ID
            JOIN ARTICULOS ar ON ar.ARTICULO_ID = d.ARTICULO_ID
            LEFT JOIN CLAVES_ARTICULOS ca ON ca.ARTICULO_ID = ar.ARTICULO_ID AND ca.ROL_CLAVE_ART_ID = 17
            WHERE p.FECHA >= ? AND p.FECHA <= ?
              AND p.ESTATUS <> 'C'
              AND p.TIPO_DOCTO IN ('V', 'F')
              {filtro_alm}
            GROUP BY ca.CLAVE_ARTICULO, ar.NOMBRE
            ORDER BY PIEZAS DESC
        """, tuple(params))
        top = []
        for t in cur.fetchall():
            top.append({
                "clave": t[0],
                "nombre": _limpiar_texto(t[1]),
                "piezas": float(t[2] or 0),
                "importe": float(t[3] or 0)
            })

        return jsonify({
            "success": True,
            "resumen": resumen,
            "ventas_por_dia": dias,
            "top_articulos": top
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500
    finally:
        if conn:
            try:
                conn.close()
            except:
                pass

@ventas_bp.route('/api/ventas/tickets', methods=['GET'])
def get_tickets():
    almacen_id = request.args.get('almacen_id', '').strip()
    fecha_ini = request.args.get('fecha_inicio', '').strip()
    fecha_fin = request.args.get('fecha_final', '').strip()
    fecha = request.args.get('fecha', '').strip()
    folio = request.args.get('folio', '').strip()
    busqueda = request.args.get('busqueda', '').strip()
    tipo = request.args.get('tipo', '').strip().upper()
    estatus = request.args.get('estatus', '').strip().upper()
    orden = request.args.get('orden', 'reciente').strip().lower()
    monto_min = request.args.get('monto_min', '').strip()
    monto_max = request.args.get('monto_max', '').strip()
    limite = request.args.get('limite', '150').strip()

    try:
        limit_num = max(10, min(500, int(limite)))
    except:
        limit_num = 150

    hoy = datetime.date.today().strftime("%Y-%m-%d")
    if not fecha_ini and not fecha_fin:
        if fecha:
            fecha_ini = fecha
            fecha_fin = fecha
        else:
            fecha_ini = hoy
            fecha_fin = hoy
    elif not fecha_ini:
        fecha_ini = fecha_fin
    elif not fecha_fin:
        fecha_fin = fecha_ini

    conn = None
    try:
        conn = conectar_db()
        cur = conn.cursor()

        filtros = []
        params = []

        # Tipo de documento
        if tipo == 'V':
            filtros.append("p.TIPO_DOCTO = 'V'")
        elif tipo == 'F':
            filtros.append("p.TIPO_DOCTO = 'F'")
        else:
            filtros.append("p.TIPO_DOCTO IN ('V', 'F')")

        # Estatus
        if estatus == 'VIGENTES':
            filtros.append("p.ESTATUS <> 'C'")
        elif estatus == 'CANCELADOS':
            filtros.append("p.ESTATUS = 'C'")

        # Fechas o Folio directo
        if folio:
            filtros.append("p.FOLIO LIKE ?")
            params.append(f"%{folio}%")
        else:
            if fecha_ini == fecha_fin:
                filtros.append("p.FECHA = ?")
                params.append(fecha_ini)
            else:
                filtros.append("p.FECHA >= ? AND p.FECHA <= ?")
                params.extend([fecha_ini, fecha_fin])

        # Búsqueda libre (Folio, Cliente o Vendedor)
        if busqueda:
            filtros.append("(UPPER(p.FOLIO) LIKE ? OR UPPER(c.NOMBRE) LIKE ? OR UPPER(v.NOMBRE) LIKE ?)")
            param_b = f"%{busqueda.upper()}%"
            params.extend([param_b, param_b, param_b])

        # Sucursal / Almacén
        if almacen_id and almacen_id.isdigit():
            filtros.append("COALESCE(p.ALMACEN_ID, cj.ALMACEN_ID) = ?")
            params.append(int(almacen_id))

        # Filtro de monto mínimo y máximo
        if monto_min:
            try:
                val_min = float(monto_min)
                filtros.append("(p.IMPORTE_NETO + COALESCE(p.TOTAL_IMPUESTOS, 0)) >= ?")
                params.append(val_min)
            except:
                pass

        if monto_max:
            try:
                val_max = float(monto_max)
                filtros.append("(p.IMPORTE_NETO + COALESCE(p.TOTAL_IMPUESTOS, 0)) <= ?")
                params.append(val_max)
            except:
                pass

        where_clause = " AND ".join(filtros)

        # Regla de Ordenación
        if orden == 'monto_desc':
            order_by = "(p.IMPORTE_NETO + COALESCE(p.TOTAL_IMPUESTOS, 0)) DESC, p.FECHA DESC"
        elif orden == 'monto_asc':
            order_by = "(p.IMPORTE_NETO + COALESCE(p.TOTAL_IMPUESTOS, 0)) ASC, p.FECHA DESC"
        elif orden == 'antiguo':
            order_by = "p.FECHA ASC, p.DOCTO_PV_ID ASC"
        elif orden == 'folio':
            order_by = "p.FOLIO ASC"
        else: # 'reciente'
            order_by = "p.FECHA DESC, p.DOCTO_PV_ID DESC"

        cur.execute(f"""
            SELECT FIRST {limit_num}
                p.DOCTO_PV_ID,
                TRIM(p.FOLIO) AS FOLIO,
                p.FECHA,
                p.HORA,
                TRIM(a.NOMBRE) AS SUCURSAL,
                p.IMPORTE_NETO + COALESCE(p.TOTAL_IMPUESTOS, 0) AS TOTAL,
                p.TIPO_DOCTO,
                p.ESTATUS,
                TRIM(c.NOMBRE) AS CLIENTE,
                TRIM(v.NOMBRE) AS VENDEDOR
            FROM DOCTOS_PV p
            LEFT JOIN CAJAS cj ON cj.CAJA_ID = p.CAJA_ID
            JOIN ALMACENES a ON a.ALMACEN_ID = COALESCE(p.ALMACEN_ID, cj.ALMACEN_ID)
            LEFT JOIN CLIENTES c ON c.CLIENTE_ID = p.CLIENTE_ID
            LEFT JOIN VENDEDORES v ON v.VENDEDOR_ID = p.VENDEDOR_ID
            WHERE {where_clause}
            ORDER BY {order_by}
        """, tuple(params))

        tickets = []
        suma_total = 0.0
        max_ticket = 0.0

        for r in cur.fetchall():
            nom_suc = _limpiar_texto(r[4])
            estatus_row = str(r[7]).strip() if r[7] else 'N'
            tipo_desc = "Factura" if r[6] == 'F' else "Ticket"
            tot = float(r[5] or 0)
            nom_cli = _limpiar_texto(r[8]) if r[8] else "Público General"
            nom_ven = _limpiar_texto(r[9]) if r[9] else ""
            es_cancelado = estatus_row == 'C'

            if not es_cancelado:
                suma_total += tot
                if tot > max_ticket:
                    max_ticket = tot

            tickets.append({
                "id": int(r[0]),
                "folio": r[1],
                "fecha": str(r[2]),
                "hora": str(r[3])[:8] if r[3] else "",
                "sucursal": nom_suc,
                "total": tot,
                "tipo": tipo_desc,
                "estatus": estatus_row,
                "cancelado": es_cancelado,
                "cliente": nom_cli,
                "vendedor": nom_ven
            })

        conn.close()

        conteo_vigentes = sum(1 for t in tickets if not t["cancelado"])
        promedio = (suma_total / conteo_vigentes) if conteo_vigentes > 0 else 0.0

        resumen = {
            "total_tickets": len(tickets),
            "tickets_vigentes": conteo_vigentes,
            "suma_total": suma_total,
            "promedio": promedio,
            "max_ticket": max_ticket
        }

        return jsonify({
            "success": True,
            "tickets": tickets,
            "resumen": resumen,
            "orden": orden
        })
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500
    finally:
        if conn:
            try:
                conn.close()
            except:
                pass

@ventas_bp.route('/api/ventas/detalle-ticket/<int:docto_id>', methods=['GET'])
def get_detalle_ticket(docto_id):
    conn = None
    try:
        conn = conectar_db()
        cur = conn.cursor()
        cur.execute("""
            SELECT 
                d.DOCTO_PV_DET_ID,
                COALESCE(TRIM(ca.CLAVE_ARTICULO), 'S/C') AS CLAVE,
                TRIM(ar.NOMBRE) AS ARTICULO,
                d.UNIDADES - COALESCE(d.UNIDADES_DEV, 0) AS UNIDADES,
                COALESCE(d.PRECIO_UNITARIO_IMPTO, d.PRECIO_UNITARIO) AS PRECIO_UNITARIO,
                (d.UNIDADES - COALESCE(d.UNIDADES_DEV, 0)) * COALESCE(d.PRECIO_UNITARIO_IMPTO, d.PRECIO_UNITARIO) AS TOTAL_RENGLON
            FROM DOCTOS_PV_DET d
            JOIN ARTICULOS ar ON ar.ARTICULO_ID = d.ARTICULO_ID
            LEFT JOIN CLAVES_ARTICULOS ca ON ca.ARTICULO_ID = ar.ARTICULO_ID AND ca.ROL_CLAVE_ART_ID = 17
            WHERE d.DOCTO_PV_ID = ?
            ORDER BY d.DOCTO_PV_DET_ID ASC
        """, (docto_id,))

        partidas = []
        for r in cur.fetchall():
            partidas.append({
                "id": int(r[0]),
                "clave": r[1],
                "articulo": _limpiar_texto(r[2]),
                "unidades": float(r[3] or 0),
                "precio_unitario": float(r[4] or 0),
                "total": float(r[5] or 0)
            })

        conn.close()
        return jsonify({"success": True, "partidas": partidas})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500
    finally:
        if conn:
            try:
                conn.close()
            except:
                pass

# ================= INDICADORES DE VENTAS DEL DÍA =================

@ventas_bp.route('/api/ventas/indicadores-hoy', methods=['GET'])
def get_indicadores_hoy():
    almacen_id = request.args.get('almacen_id', '').strip()
    conn = None
    try:
        conn = conectar_db()
        cur = conn.cursor()

        filtro_pv_alm = ""
        filtro_ve_alm = ""
        params_hoy = []
        params_ayer = []

        if almacen_id and almacen_id.isdigit():
            filtro_pv_alm = "AND COALESCE(p.ALMACEN_ID, cj.ALMACEN_ID) = ?"
            filtro_ve_alm = "AND v.ALMACEN_ID = ?"
            params_hoy = [int(almacen_id), int(almacen_id)]
            params_ayer = [int(almacen_id), int(almacen_id)]

        # 1. Ventas de Hoy
        cur.execute(f"""
            SELECT 
                COUNT(DOCTO_ID) AS TICKETS,
                SUM(TOTAL_VENTA) AS TOTAL_VENTA
            FROM (
                SELECT 
                    p.DOCTO_PV_ID AS DOCTO_ID,
                    CASE WHEN p.TIPO_DOCTO = 'D' THEN -(p.IMPORTE_NETO + COALESCE(p.TOTAL_IMPUESTOS, 0)) ELSE (p.IMPORTE_NETO + COALESCE(p.TOTAL_IMPUESTOS, 0)) END AS TOTAL_VENTA
                FROM DOCTOS_PV p
                LEFT JOIN CAJAS cj ON cj.CAJA_ID = p.CAJA_ID
                WHERE p.FECHA = CURRENT_DATE
                  AND p.ESTATUS <> 'C'
                  AND p.TIPO_DOCTO IN ('V', 'D')
                  {filtro_pv_alm}

                UNION ALL

                SELECT 
                    v.DOCTO_VE_ID AS DOCTO_ID,
                    CASE WHEN v.TIPO_DOCTO = 'D' THEN -(v.IMPORTE_NETO + COALESCE(v.TOTAL_IMPUESTOS, 0)) ELSE (v.IMPORTE_NETO + COALESCE(v.TOTAL_IMPUESTOS, 0)) END AS TOTAL_VENTA
                FROM DOCTOS_VE v
                WHERE v.FECHA = CURRENT_DATE
                  AND v.ESTATUS <> 'C'
                  AND v.APLICADO = 'S'
                  AND v.TIPO_DOCTO IN ('F', 'D')
                  {filtro_ve_alm}
            )
        """, tuple(params_hoy))
        r_hoy = cur.fetchone()
        tickets_hoy = int(r_hoy[0] or 0)
        total_hoy = float(r_hoy[1] or 0)
        promedio_hoy = round(total_hoy / tickets_hoy, 2) if tickets_hoy > 0 else 0.0

        # 2. Ventas de Ayer (para comparativa)
        cur.execute(f"""
            SELECT 
                COUNT(DOCTO_ID) AS TICKETS,
                SUM(TOTAL_VENTA) AS TOTAL_VENTA
            FROM (
                SELECT 
                    p.DOCTO_PV_ID AS DOCTO_ID,
                    CASE WHEN p.TIPO_DOCTO = 'D' THEN -(p.IMPORTE_NETO + COALESCE(p.TOTAL_IMPUESTOS, 0)) ELSE (p.IMPORTE_NETO + COALESCE(p.TOTAL_IMPUESTOS, 0)) END AS TOTAL_VENTA
                FROM DOCTOS_PV p
                LEFT JOIN CAJAS cj ON cj.CAJA_ID = p.CAJA_ID
                WHERE p.FECHA = CURRENT_DATE - 1
                  AND p.ESTATUS <> 'C'
                  AND p.TIPO_DOCTO IN ('V', 'D')
                  {filtro_pv_alm}

                UNION ALL

                SELECT 
                    v.DOCTO_VE_ID AS DOCTO_ID,
                    CASE WHEN v.TIPO_DOCTO = 'D' THEN -(v.IMPORTE_NETO + COALESCE(v.TOTAL_IMPUESTOS, 0)) ELSE (v.IMPORTE_NETO + COALESCE(v.TOTAL_IMPUESTOS, 0)) END AS TOTAL_VENTA
                FROM DOCTOS_VE v
                WHERE v.FECHA = CURRENT_DATE - 1
                  AND v.ESTATUS <> 'C'
                  AND v.APLICADO = 'S'
                  AND v.TIPO_DOCTO IN ('F', 'D')
                  {filtro_ve_alm}
            )
        """, tuple(params_ayer))
        r_ayer = cur.fetchone()
        total_ayer = float(r_ayer[1] or 0)
        tickets_ayer = int(r_ayer[0] or 0)

        dif_pct = round(((total_hoy - total_ayer) / total_ayer * 100), 1) if total_ayer > 0 else 0.0

        conn.close()

        return jsonify({
            "success": True,
            "indicadores": {
                "total_hoy": total_hoy,
                "tickets_hoy": tickets_hoy,
                "ticket_promedio": promedio_hoy,
                "total_ayer": total_ayer,
                "tickets_ayer": tickets_ayer,
                "variacion_pct": dif_pct
            }
        })
    except Exception as e:
        if conn:
            try: conn.close()
            except: pass
        return jsonify({"success": False, "error": str(e)}), 500

# ================= VENTAS PERDIDAS (DEMANDA NO SATISFECHA PARA COMPRAS) =================

@ventas_bp.route('/api/ventas/venta-perdida', methods=['POST'])
def registrar_venta_perdida():
    data = request.get_json() or {}
    clave = str(data.get('clave_articulo', '')).strip().upper()
    nombre_art = str(data.get('articulo_nombre', '')).strip()
    motivo = str(data.get('motivo', 'Sin existencia física')).strip()
    cant = float(data.get('cantidad', 1) or 1)
    precio_est = float(data.get('precio_estimado', 0) or 0)
    cliente = str(data.get('cliente_nombre', '')).strip()
    suc_id = data.get('sucursal_id')
    suc_nom = str(data.get('sucursal_nombre', '')).strip()
    ven_id = data.get('vendedor_id')
    ven_nom = str(data.get('vendedor_nombre', '')).strip()
    notas = str(data.get('notas', '')).strip()

    if not clave:
        return jsonify({"success": False, "error": "La clave o descripción del artículo es obligatoria"}), 400

    from app.db import conectar_sqlite
    import datetime
    conn = None
    try:
        conn = conectar_sqlite()
        cur = conn.cursor()
        fec_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        cur.execute("""
            INSERT INTO ventas_perdidas (
                fecha, sucursal_id, sucursal_nombre, vendedor_id, vendedor_nombre,
                cliente_nombre, clave_articulo, articulo_nombre, cantidad, precio_estimado,
                motivo, notas, estatus_compras
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDIENTE')
        """, (fec_str, suc_id, suc_nom, ven_id, ven_nom, cliente, clave, nombre_art, cant, precio_est, motivo, notas))
        
        conn.commit()
        nuevo_id = cur.lastrowid
        conn.close()

        return jsonify({
            "success": True, 
            "id": nuevo_id,
            "mensaje": "Venta perdida registrada exitosamente para el departamento de Compras"
        })
    except Exception as e:
        if conn:
            try: conn.close()
            except: pass
        return jsonify({"success": False, "error": str(e)}), 500

@ventas_bp.route('/api/compras/ventas-perdidas', methods=['GET'])
def get_reporte_ventas_perdidas():
    dias = int(request.args.get('dias', 30))
    motivo = request.args.get('motivo', '').strip()
    from app.db import conectar_sqlite
    conn = None
    try:
        conn = conectar_sqlite()
        cur = conn.cursor()

        filtros = ["datetime(fecha) >= datetime('now', '-' || ? || ' days')"]
        params = [dias]

        if motivo:
            filtros.append("motivo = ?")
            params.append(motivo)

        where_sql = "WHERE " + " AND ".join(filtros)

        cur.execute(f"""
            SELECT 
                id, fecha, sucursal_nombre, vendedor_nombre, cliente_nombre,
                clave_articulo, articulo_nombre, cantidad, precio_estimado,
                motivo, notas, estatus_compras
            FROM ventas_perdidas
            {where_sql}
            ORDER BY id DESC
        """, tuple(params))

        items = []
        total_pzas = 0.0
        total_importe = 0.0

        for r in cur.fetchall():
            cant = float(r[7] or 0)
            prec = float(r[8] or 0)
            imp = cant * prec
            total_pzas += cant
            total_importe += imp
            items.append({
                "id": r[0],
                "fecha": r[1],
                "sucursal": r[2] or "Mostrador",
                "vendedor": r[3] or "-",
                "cliente": r[4] or "Público General",
                "clave": r[5],
                "articulo": r[6],
                "cantidad": cant,
                "precio": prec,
                "importe_estimado": imp,
                "motivo": r[9],
                "notas": r[10] or "",
                "estatus": r[11] or "PENDIENTE"
            })

        # Resumen por motivo
        cur.execute(f"""
            SELECT motivo, COUNT(*), SUM(cantidad)
            FROM ventas_perdidas
            {where_sql}
            GROUP BY motivo
            ORDER BY COUNT(*) DESC
        """, tuple(params))
        resumen_motivos = [{"motivo": r[0], "conteo": r[1], "piezas": float(r[2] or 0)} for r in cur.fetchall()]

        conn.close()

        return jsonify({
            "success": True,
            "total_registros": len(items),
            "total_piezas": total_pzas,
            "total_importe_estimado": total_importe,
            "resumen_motivos": resumen_motivos,
            "registros": items
        })
    except Exception as e:
        if conn:
            try: conn.close()
            except: pass
        return jsonify({"success": False, "error": str(e)}), 500
