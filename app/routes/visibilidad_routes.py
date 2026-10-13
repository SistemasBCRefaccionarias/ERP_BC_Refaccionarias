import datetime
from flask import Blueprint, request, jsonify, session
from app.db import conectar_db, conectar_sqlite, obtener_visibilidad_dict, guardar_visibilidad_item
from app.config import get_current_dsn
from app.routes.dashboard_routes import limpiar_cache_dashboard

visibilidad_bp = Blueprint('visibilidad_bp', __name__)

@visibilidad_bp.route('/api/config/visibilidad/sucursales', methods=['GET'])
def get_visibilidad_sucursales():
    """
    Lista todos los almacenes y sucursales existentes en Microsip,
    sus ventas del año en curso, y su estado de visibilidad en el sistema.
    """
    current_dsn = get_current_dsn()
    empresa_alias = 'RT' if ('RT' in str(current_dsn).upper() or 'TOMMY' in str(current_dsn).upper()) else 'BC'
    visibles_cfg = obtener_visibilidad_dict('SUCURSAL', empresa=empresa_alias)

    conn = None
    try:
        conn = conectar_db()
        cur = conn.cursor()

        # 1. Todos los almacenes del catálogo
        cur.execute("""
            SELECT ALMACEN_ID, TRIM(NOMBRE), OCULTO
            FROM ALMACENES
            ORDER BY NOMBRE ASC
        """)
        almacenes_raw = cur.fetchall()

        # 2. Resumen de ventas 2026 por almacén (incluyendo facturas asociadas por CAJA_ID)
        hoy_anio = datetime.date.today().year
        cur.execute(f"""
            SELECT 
                COALESCE(p.ALMACEN_ID, cj.ALMACEN_ID) AS ALM_ID,
                COUNT(p.DOCTO_PV_ID) AS TICKETS,
                SUM(p.IMPORTE_NETO + COALESCE(p.TOTAL_IMPUESTOS, 0)) AS TOTAL_VENTA,
                MAX(p.FECHA) AS ULTIMA_VENTA
            FROM DOCTOS_PV p
            LEFT JOIN CAJAS cj ON cj.CAJA_ID = p.CAJA_ID
            WHERE p.FECHA >= '{hoy_anio}-01-01'
              AND p.ESTATUS <> 'C'
              AND p.TIPO_DOCTO IN ('V', 'F')
            GROUP BY 1
        """)
        ventas_map = {}
        for r_v in cur.fetchall():
            if r_v[0] is not None:
                ventas_map[int(r_v[0])] = {
                    "tickets": int(r_v[1] or 0),
                    "total_venta": round(float(r_v[2] or 0), 2),
                    "ultima_venta": str(r_v[3]) if r_v[3] else ""
                }

        resultado = []
        for r in almacenes_raw:
            alm_id = int(r[0])
            nombre = r[1] or f"Almacén {alm_id}"
            oculto_ms = (str(r[2] or '').upper() == 'S')
            nombre_upper = nombre.upper()

            # Descartar por defecto si es obvio que no es sucursal comercial
            es_descarte_obvio = any(x in nombre_upper for x in ['NO UTILIZAR', 'NO USAR', 'TRANSITO', 'DEVOLUCION'])
            es_comercial = ('SUCURSAL' in nombre_upper or 'CEDIS' in nombre_upper) and not es_descarte_obvio

            stats = ventas_map.get(alm_id, {"tickets": 0, "total_venta": 0.0, "ultima_venta": ""})

            # Si ya se configuró explícitamente en SQLite, respetar esa opción
            if alm_id in visibles_cfg:
                visible = visibles_cfg[alm_id]
            else:
                # Predeterminado: visible si tiene ventas este año o es sucursal comercial activa
                visible = (stats["tickets"] > 0 or es_comercial) and not es_descarte_obvio

            resultado.append({
                "almacen_id": alm_id,
                "nombre": nombre,
                "oculto_microsip": oculto_ms,
                "es_comercial": es_comercial,
                "tickets_2026": stats["tickets"],
                "total_venta_2026": stats["total_venta"],
                "ultima_venta": stats["ultima_venta"],
                "visible": visible
            })

        # Ordenar: primero los visibles por mayor venta, luego los demás
        resultado.sort(key=lambda x: (not x["visible"], -x["total_venta_2026"], x["nombre"]))

        return jsonify({"success": True, "sucursales": resultado, "empresa": empresa_alias})

    except Exception as e:
        print("Error en get_visibilidad_sucursales:", e)
        return jsonify({"success": False, "error": str(e)}), 500
    finally:
        if conn:
            try:
                conn.close()
            except:
                pass


@visibilidad_bp.route('/api/config/visibilidad/sucursales', methods=['POST'])
def save_visibilidad_sucursales():
    """
    Guarda la visibilidad configurada para una o más sucursales.
    """
    data = request.get_json() or {}
    items = data.get('sucursales') or []
    current_dsn = get_current_dsn()
    empresa_alias = 'RT' if ('RT' in str(current_dsn).upper() or 'TOMMY' in str(current_dsn).upper()) else 'BC'

    if not items:
        return jsonify({"success": False, "error": "No se enviaron sucursales para actualizar"}), 400

    try:
        for item in items:
            alm_id = item.get('almacen_id')
            visible = bool(item.get('visible'))
            nombre = str(item.get('nombre') or '').strip()
            if alm_id:
                guardar_visibilidad_item('SUCURSAL', alm_id, visible, nombre=nombre, empresa=empresa_alias)

        limpiar_cache_dashboard()
        return jsonify({"success": True, "mensaje": f"{len(items)} sucursales actualizadas exitosamente."})
    except Exception as e:
        print("Error al guardar visibilidad sucursales:", e)
        return jsonify({"success": False, "error": str(e)}), 500


@visibilidad_bp.route('/api/config/visibilidad/vendedores', methods=['GET'])
def get_visibilidad_vendedores():
    """
    Lista todos los vendedores registrados en Microsip,
    sus ventas del año en curso, y su estado de visibilidad en el sistema.
    """
    current_dsn = get_current_dsn()
    empresa_alias = 'RT' if ('RT' in str(current_dsn).upper() or 'TOMMY' in str(current_dsn).upper()) else 'BC'
    visibles_cfg = obtener_visibilidad_dict('VENDEDOR', empresa=empresa_alias)

    conn = None
    try:
        conn = conectar_db()
        cur = conn.cursor()

        # 1. Catálogo completo de vendedores en Microsip
        cur.execute("""
            SELECT VENDEDOR_ID, TRIM(NOMBRE), OCULTO
            FROM VENDEDORES
            ORDER BY NOMBRE ASC
        """)
        vendedores_raw = cur.fetchall()

        # 2. Ventas del año en curso de cada vendedor
        hoy_anio = datetime.date.today().year
        cur.execute(f"""
            SELECT 
                p.VENDEDOR_ID,
                COUNT(p.DOCTO_PV_ID) AS TICKETS,
                SUM(p.IMPORTE_NETO + COALESCE(p.TOTAL_IMPUESTOS, 0)) AS TOTAL_VENTA,
                MAX(p.FECHA) AS ULTIMA_VENTA
            FROM DOCTOS_PV p
            WHERE p.FECHA >= '{hoy_anio}-01-01'
              AND p.ESTATUS <> 'C'
              AND p.TIPO_DOCTO IN ('V', 'F')
              AND p.VENDEDOR_ID IS NOT NULL
            GROUP BY p.VENDEDOR_ID
        """)
        ventas_map = {}
        for r_v in cur.fetchall():
            if r_v[0] is not None:
                ventas_map[int(r_v[0])] = {
                    "tickets": int(r_v[1] or 0),
                    "total_venta": round(float(r_v[2] or 0), 2),
                    "ultima_venta": str(r_v[3]) if r_v[3] else ""
                }

        resultado = []
        for r in vendedores_raw:
            v_id = int(r[0])
            nombre = r[1] or f"Vendedor {v_id}"
            oculto_ms = (str(r[2] or '').upper() == 'S')
            nombre_upper = nombre.upper()

            es_descarte = any(x in nombre_upper for x in ['NO USAR', 'NO UTILIZAR', 'CANCELADO', 'INACTIVO'])
            stats = ventas_map.get(v_id, {"tickets": 0, "total_venta": 0.0, "ultima_venta": ""})

            if v_id in visibles_cfg:
                visible = visibles_cfg[v_id]
            else:
                # Visible por defecto si tiene ventas en el año o no está marcado como oculto/descarte
                visible = (stats["tickets"] > 0 or not oculto_ms) and not es_descarte

            resultado.append({
                "vendedor_id": v_id,
                "nombre": nombre,
                "oculto_microsip": oculto_ms,
                "tickets_2026": stats["tickets"],
                "total_venta_2026": stats["total_venta"],
                "ultima_venta": stats["ultima_venta"],
                "visible": visible
            })

        resultado.sort(key=lambda x: (not x["visible"], -x["total_venta_2026"], x["nombre"]))

        return jsonify({"success": True, "vendedores": resultado, "empresa": empresa_alias})

    except Exception as e:
        print("Error en get_visibilidad_vendedores:", e)
        return jsonify({"success": False, "error": str(e)}), 500
    finally:
        if conn:
            try:
                conn.close()
            except:
                pass


@visibilidad_bp.route('/api/config/visibilidad/vendedores', methods=['POST'])
def save_visibilidad_vendedores():
    """
    Guarda la visibilidad configurada para uno o más vendedores.
    """
    data = request.get_json() or {}
    items = data.get('vendedores') or []
    current_dsn = get_current_dsn()
    empresa_alias = 'RT' if ('RT' in str(current_dsn).upper() or 'TOMMY' in str(current_dsn).upper()) else 'BC'

    if not items:
        return jsonify({"success": False, "error": "No se enviaron vendedores para actualizar"}), 400

    try:
        for item in items:
            v_id = item.get('vendedor_id')
            visible = bool(item.get('visible'))
            nombre = str(item.get('nombre') or '').strip()
            if v_id:
                guardar_visibilidad_item('VENDEDOR', v_id, visible, nombre=nombre, empresa=empresa_alias)

        limpiar_cache_dashboard()
        return jsonify({"success": True, "mensaje": f"{len(items)} vendedores actualizados exitosamente."})
    except Exception as e:
        print("Error al guardar visibilidad vendedores:", e)
        return jsonify({"success": False, "error": str(e)}), 500

