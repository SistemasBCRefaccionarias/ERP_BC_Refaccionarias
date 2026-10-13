import datetime
from decimal import Decimal
from flask import Blueprint, jsonify, request
from app.db import conectar_db, obtener_visibilidad_dict

from app.config import get_current_dsn

dashboard_bp = Blueprint('dashboard', __name__)

# Cache simple en memoria (120 segundos) para no saturar Firebird
_cache_dashboard = {}
_cache_ttl = 120 # segundos

_cache_stock_global = {}
_cache_stock_ttl = 300 # 5 minutos para stock general

def limpiar_cache_dashboard():
    global _cache_dashboard, _cache_stock_global
    _cache_dashboard.clear()
    _cache_stock_global.clear()

def get_cached(key, periodo=None):
    if key in _cache_dashboard:
        data, ts = _cache_dashboard[key]
        ttl = 600 if periodo in ('anio', '6meses', '90dias') else _cache_ttl
        if (datetime.datetime.now() - ts).total_seconds() < ttl:
            return data
    return None

def set_cached(key, data):
    _cache_dashboard[key] = (data, datetime.datetime.now())

def resolver_rango_fechas(periodo, fecha_ini_custom=None, fecha_fin_custom=None):
    hoy = datetime.date.today()
    if periodo == 'personalizado' and fecha_ini_custom and fecha_fin_custom:
        try:
            d_ini = datetime.datetime.strptime(fecha_ini_custom, '%Y-%m-%d').date()
            d_fin = datetime.datetime.strptime(fecha_fin_custom, '%Y-%m-%d').date()
            if d_ini > d_fin:
                d_ini, d_fin = d_fin, d_ini
            return d_ini.strftime("%Y-%m-%d"), d_fin.strftime("%Y-%m-%d")
        except Exception:
            pass
    if periodo == 'hoy':
        return hoy.strftime("%Y-%m-%d"), hoy.strftime("%Y-%m-%d")
    elif periodo == 'semana':
        ini = hoy - datetime.timedelta(days=hoy.weekday())
        return ini.strftime("%Y-%m-%d"), hoy.strftime("%Y-%m-%d")
    elif periodo == '30dias':
        ini = hoy - datetime.timedelta(days=30)
        return ini.strftime("%Y-%m-%d"), hoy.strftime("%Y-%m-%d")
    elif periodo == '90dias':
        ini = hoy - datetime.timedelta(days=90)
        return ini.strftime("%Y-%m-%d"), hoy.strftime("%Y-%m-%d")
    elif periodo == '6meses':
        ini = hoy - datetime.timedelta(days=183)
        return ini.strftime("%Y-%m-%d"), hoy.strftime("%Y-%m-%d")
    elif periodo == 'anio':
        ini = datetime.date(hoy.year, 1, 1)
        return ini.strftime("%Y-%m-%d"), hoy.strftime("%Y-%m-%d")
    else:
        ini = hoy.replace(day=1)
        return ini.strftime("%Y-%m-%d"), hoy.strftime("%Y-%m-%d")

MESES_ABR = ['', 'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

def obtener_tendencia_ventas(periodo, cur, fecha_ini=None, fecha_fin=None):
    hoy = datetime.date.today()
    
    delta_dias = None
    d_ini = None
    d_fin = None
    if periodo == 'personalizado' and fecha_ini and fecha_fin:
        try:
            d_ini = datetime.datetime.strptime(fecha_ini, '%Y-%m-%d').date()
            d_fin = datetime.datetime.strptime(fecha_fin, '%Y-%m-%d').date()
            if d_ini > d_fin:
                d_ini, d_fin = d_fin, d_ini
                fecha_ini, fecha_fin = d_ini.strftime("%Y-%m-%d"), d_fin.strftime("%Y-%m-%d")
            delta_dias = (d_fin - d_ini).days
        except Exception:
            delta_dias = 0
            d_ini, d_fin = hoy, hoy

    if periodo == 'hoy' or (periodo == 'personalizado' and delta_dias == 0):
        target_fecha = fecha_ini if (periodo == 'personalizado' and fecha_ini) else hoy.strftime("%Y-%m-%d")
        hora_max = max(20, datetime.datetime.now().hour) if target_fecha == hoy.strftime("%Y-%m-%d") else 20
        horas = list(range(8, hora_max + 1))
        etiquetas = [f"{h:02d}:00" for h in horas]
        
        cur.execute("""
            SELECT 
                HORA,
                ALMACEN_ID,
                SUCURSAL,
                SUM(TOTAL) AS TOTAL
            FROM (
                SELECT 
                    EXTRACT(HOUR FROM p.HORA) AS HORA,
                    COALESCE(p.ALMACEN_ID, cj.ALMACEN_ID) AS ALMACEN_ID,
                    TRIM(a.NOMBRE) AS SUCURSAL,
                    CASE WHEN p.TIPO_DOCTO = 'D' THEN -(p.IMPORTE_NETO + COALESCE(p.TOTAL_IMPUESTOS, 0)) ELSE (p.IMPORTE_NETO + COALESCE(p.TOTAL_IMPUESTOS, 0)) END AS TOTAL
                FROM DOCTOS_PV p
                LEFT JOIN CAJAS cj ON cj.CAJA_ID = p.CAJA_ID
                JOIN ALMACENES a ON a.ALMACEN_ID = COALESCE(p.ALMACEN_ID, cj.ALMACEN_ID)
                WHERE p.FECHA = ?
                  AND p.ESTATUS <> 'C'
                  AND p.TIPO_DOCTO IN ('V', 'D')

                UNION ALL

                SELECT 
                    EXTRACT(HOUR FROM v.HORA) AS HORA,
                    v.ALMACEN_ID AS ALMACEN_ID,
                    TRIM(a.NOMBRE) AS SUCURSAL,
                    CASE WHEN v.TIPO_DOCTO = 'D' THEN -(v.IMPORTE_NETO + COALESCE(v.TOTAL_IMPUESTOS, 0)) ELSE (v.IMPORTE_NETO + COALESCE(v.TOTAL_IMPUESTOS, 0)) END AS TOTAL
                FROM DOCTOS_VE v
                JOIN ALMACENES a ON a.ALMACEN_ID = v.ALMACEN_ID
                WHERE v.FECHA = ?
                  AND v.ESTATUS <> 'C'
                  AND v.APLICADO = 'S'
                  AND v.TIPO_DOCTO IN ('F', 'D')
            )
            GROUP BY HORA, ALMACEN_ID, SUCURSAL
        """, (target_fecha, target_fecha))
        filas = cur.fetchall()
        
        suc_map = {}
        for r in filas:
            h = int(r[0] or 0)
            alm_id = int(r[1])
            nom = r[2].replace('Sucursal ', '')
            tot = float(r[3] or 0)
            if alm_id not in suc_map:
                suc_map[alm_id] = {'nombre': nom, 'ventas_por_slot': {}, 'total': 0.0}
            suc_map[alm_id]['ventas_por_slot'][h] = suc_map[alm_id]['ventas_por_slot'].get(h, 0.0) + tot
            suc_map[alm_id]['total'] += tot
            
        datasets = []
        for alm_id, s in sorted(suc_map.items(), key=lambda x: x[1]['total'], reverse=True)[:10]:
            valores = [round(s['ventas_por_slot'].get(h, 0.0), 2) for h in horas]
            datasets.append({
                'almacen_id': alm_id,
                'nombre': s['nombre'],
                'valores': valores,
                'total': round(s['total'], 2)
            })
            
        subtitulo = f"Ventas por hora del día {target_fecha}" if periodo == 'personalizado' else "Ventas por hora durante el día de hoy"
        return {
            'tipo': 'horas',
            'subtitulo': subtitulo,
            'badge': 'Por Hora',
            'etiquetas': etiquetas,
            'sucursales': datasets
        }

    elif periodo == 'mes_actual' or (periodo == 'personalizado' and delta_dias is not None and delta_dias <= 31):
        if periodo == 'personalizado':
            f_ini_str, f_fin_str = fecha_ini, fecha_fin
            cur_d = d_ini
            dias_list = []
            while cur_d <= d_fin:
                dias_list.append(cur_d)
                cur_d += datetime.timedelta(days=1)
            etiquetas = [f"{d.day:02d} {MESES_ABR[d.month]}" for d in dias_list]
            subtitulo = f"Ventas diarias del {d_ini.strftime('%d/%m/%Y')} al {d_fin.strftime('%d/%m/%Y')}"
            sql_where_pv = "p.FECHA >= ? AND p.FECHA <= ?"
            sql_where_ve = "v.FECHA >= ? AND v.FECHA <= ?"
            params_sql = (f_ini_str, f_fin_str, f_ini_str, f_fin_str)
        else:
            f_ini_str, _ = resolver_rango_fechas(periodo)
            f_fin_str = hoy.strftime("%Y-%m-%d")
            dias_list = [datetime.date(hoy.year, hoy.month, d) for d in range(1, hoy.day + 1)]
            etiquetas = [f"{d.day:02d} {MESES_ABR[hoy.month]}" for d in dias_list]
            subtitulo = f"Ventas diarias de {MESES_ABR[hoy.month]} (Día 1 al {hoy.day})"
            sql_where_pv = "p.FECHA >= ? AND p.FECHA <= CURRENT_DATE"
            sql_where_ve = "v.FECHA >= ? AND v.FECHA <= CURRENT_DATE"
            params_sql = (f_ini_str, f_ini_str)

        cur.execute(f"""
            SELECT 
                FECHA,
                ALMACEN_ID,
                SUCURSAL,
                SUM(TOTAL) AS TOTAL
            FROM (
                SELECT 
                    p.FECHA AS FECHA,
                    COALESCE(p.ALMACEN_ID, cj.ALMACEN_ID) AS ALMACEN_ID,
                    TRIM(a.NOMBRE) AS SUCURSAL,
                    CASE WHEN p.TIPO_DOCTO = 'D' THEN -(p.IMPORTE_NETO + COALESCE(p.TOTAL_IMPUESTOS, 0)) ELSE (p.IMPORTE_NETO + COALESCE(p.TOTAL_IMPUESTOS, 0)) END AS TOTAL
                FROM DOCTOS_PV p
                LEFT JOIN CAJAS cj ON cj.CAJA_ID = p.CAJA_ID
                JOIN ALMACENES a ON a.ALMACEN_ID = COALESCE(p.ALMACEN_ID, cj.ALMACEN_ID)
                WHERE {sql_where_pv}
                  AND p.ESTATUS <> 'C'
                  AND p.TIPO_DOCTO IN ('V', 'D')

                UNION ALL

                SELECT 
                    v.FECHA AS FECHA,
                    v.ALMACEN_ID AS ALMACEN_ID,
                    TRIM(a.NOMBRE) AS SUCURSAL,
                    CASE WHEN v.TIPO_DOCTO = 'D' THEN -(v.IMPORTE_NETO + COALESCE(v.TOTAL_IMPUESTOS, 0)) ELSE (v.IMPORTE_NETO + COALESCE(v.TOTAL_IMPUESTOS, 0)) END AS TOTAL
                FROM DOCTOS_VE v
                JOIN ALMACENES a ON a.ALMACEN_ID = v.ALMACEN_ID
                WHERE {sql_where_ve}
                  AND v.ESTATUS <> 'C'
                  AND v.APLICADO = 'S'
                  AND v.TIPO_DOCTO IN ('F', 'D')
            )
            GROUP BY FECHA, ALMACEN_ID, SUCURSAL
        """, params_sql)
        filas = cur.fetchall()

        suc_map = {}
        for r in filas:
            fec = r[0]
            alm_id = int(r[1])
            nom = r[2].replace('Sucursal ', '')
            tot = float(r[3] or 0)
            if alm_id not in suc_map:
                suc_map[alm_id] = {'nombre': nom, 'ventas_por_fecha': {}, 'total': 0.0}
            suc_map[alm_id]['ventas_por_fecha'][fec] = suc_map[alm_id]['ventas_por_fecha'].get(fec, 0.0) + tot
            suc_map[alm_id]['total'] += tot

        datasets = []
        for alm_id, s in sorted(suc_map.items(), key=lambda x: x[1]['total'], reverse=True)[:10]:
            valores = [round(s['ventas_por_fecha'].get(d, 0.0), 2) for d in dias_list]
            datasets.append({
                'almacen_id': alm_id,
                'nombre': s['nombre'],
                'valores': valores,
                'total': round(s['total'], 2)
            })

        return {
            'tipo': 'dias',
            'subtitulo': subtitulo,
            'badge': 'Por Día',
            'etiquetas': etiquetas,
            'sucursales': datasets
        }

    elif periodo in ('anio', '6meses') or (periodo == 'personalizado' and delta_dias is not None and delta_dias > 120):
        if periodo == 'personalizado':
            f_ini_str, f_fin_str = fecha_ini, fecha_fin
            meses_list = []
            curr = d_ini.replace(day=1)
            while curr <= d_fin:
                meses_list.append((curr.year, curr.month))
                if curr.month == 12:
                    curr = curr.replace(year=curr.year + 1, month=1)
                else:
                    curr = curr.replace(month=curr.month + 1)
            etiquetas = [f"{MESES_ABR[m]} '{str(y)[-2:]}" if len({y_ for y_, _ in meses_list}) > 1 else MESES_ABR[m] for y, m in meses_list]
            subtitulo = f"Ventas mensuales del {d_ini.strftime('%d/%m/%Y')} al {d_fin.strftime('%d/%m/%Y')}"
            sql_where_pv = "p.FECHA >= ? AND p.FECHA <= ?"
            sql_where_ve = "v.FECHA >= ? AND v.FECHA <= ?"
            params_sql = (f_ini_str, f_fin_str, f_ini_str, f_fin_str)
        elif periodo == 'anio':
            ini_anio = hoy.year
            mes_ini = 1
            mes_fin = hoy.month
            meses_list = [(ini_anio, m) for m in range(mes_ini, mes_fin + 1)]
            etiquetas = [MESES_ABR[m] for _, m in meses_list]
            f_ini_str = f"{ini_anio}-01-01"
            subtitulo = f"Ventas mensuales de {ini_anio} (Ene - {MESES_ABR[hoy.month]})"
            sql_where_pv = "p.FECHA >= ? AND p.FECHA <= CURRENT_DATE"
            sql_where_ve = "v.FECHA >= ? AND v.FECHA <= CURRENT_DATE"
            params_sql = (f_ini_str, f_ini_str)
        else:
            meses_list = []
            f_ini = hoy - datetime.timedelta(days=183)
            f_ini_str = f_ini.strftime("%Y-%m-%d")
            curr = f_ini.replace(day=1)
            while curr <= hoy:
                meses_list.append((curr.year, curr.month))
                if curr.month == 12:
                    curr = curr.replace(year=curr.year + 1, month=1)
                else:
                    curr = curr.replace(month=curr.month + 1)
            etiquetas = [f"{MESES_ABR[m]}" if y == hoy.year else f"{MESES_ABR[m]} '{str(y)[-2:]}" for y, m in meses_list]
            subtitulo = "Ventas mensuales de los últimos 6 meses"
            sql_where_pv = "p.FECHA >= ? AND p.FECHA <= CURRENT_DATE"
            sql_where_ve = "v.FECHA >= ? AND v.FECHA <= CURRENT_DATE"
            params_sql = (f_ini_str, f_ini_str)
            
        cur.execute(f"""
            SELECT 
                ANIO,
                MES,
                ALMACEN_ID,
                SUCURSAL,
                SUM(TOTAL) AS TOTAL
            FROM (
                SELECT 
                    EXTRACT(YEAR FROM p.FECHA) AS ANIO,
                    EXTRACT(MONTH FROM p.FECHA) AS MES,
                    COALESCE(p.ALMACEN_ID, cj.ALMACEN_ID) AS ALMACEN_ID,
                    TRIM(a.NOMBRE) AS SUCURSAL,
                    CASE WHEN p.TIPO_DOCTO = 'D' THEN -(p.IMPORTE_NETO + COALESCE(p.TOTAL_IMPUESTOS, 0)) ELSE (p.IMPORTE_NETO + COALESCE(p.TOTAL_IMPUESTOS, 0)) END AS TOTAL
                FROM DOCTOS_PV p
                LEFT JOIN CAJAS cj ON cj.CAJA_ID = p.CAJA_ID
                JOIN ALMACENES a ON a.ALMACEN_ID = COALESCE(p.ALMACEN_ID, cj.ALMACEN_ID)
                WHERE {sql_where_pv}
                  AND p.ESTATUS <> 'C'
                  AND p.TIPO_DOCTO IN ('V', 'D')

                UNION ALL

                SELECT 
                    EXTRACT(YEAR FROM v.FECHA) AS ANIO,
                    EXTRACT(MONTH FROM v.FECHA) AS MES,
                    v.ALMACEN_ID AS ALMACEN_ID,
                    TRIM(a.NOMBRE) AS SUCURSAL,
                    CASE WHEN v.TIPO_DOCTO = 'D' THEN -(v.IMPORTE_NETO + COALESCE(v.TOTAL_IMPUESTOS, 0)) ELSE (v.IMPORTE_NETO + COALESCE(v.TOTAL_IMPUESTOS, 0)) END AS TOTAL
                FROM DOCTOS_VE v
                JOIN ALMACENES a ON a.ALMACEN_ID = v.ALMACEN_ID
                WHERE {sql_where_ve}
                  AND v.ESTATUS <> 'C'
                  AND v.APLICADO = 'S'
                  AND v.TIPO_DOCTO IN ('F', 'D')
            )
            GROUP BY ANIO, MES, ALMACEN_ID, SUCURSAL
        """, params_sql)
        filas = cur.fetchall()
        
        suc_map = {}
        for r in filas:
            y = int(r[0] or 0)
            m = int(r[1] or 0)
            alm_id = int(r[2])
            nom = r[3].replace('Sucursal ', '')
            tot = float(r[4] or 0)
            if alm_id not in suc_map:
                suc_map[alm_id] = {'nombre': nom, 'ventas_por_slot': {}, 'total': 0.0}
            suc_map[alm_id]['ventas_por_slot'][(y, m)] = suc_map[alm_id]['ventas_por_slot'].get((y, m), 0.0) + tot
            suc_map[alm_id]['total'] += tot
            
        datasets = []
        for alm_id, s in sorted(suc_map.items(), key=lambda x: x[1]['total'], reverse=True)[:10]:
            valores = [round(s['ventas_por_slot'].get((y, m), 0.0), 2) for y, m in meses_list]
            datasets.append({
                'almacen_id': alm_id,
                'nombre': s['nombre'],
                'valores': valores,
                'total': round(s['total'], 2)
            })
            
        return {
            'tipo': 'meses',
            'subtitulo': subtitulo,
            'badge': 'Por Mes',
            'etiquetas': etiquetas,
            'sucursales': datasets
        }

    else:
        # Semanas para cualquier periodo de rango de días (30dias, 90dias, semana, personalizado de 31 a 120 días)
        if periodo == 'personalizado':
            f_ini_str, f_fin_str = fecha_ini, fecha_fin
            f_ini = d_ini
            f_fin = d_fin
            desc_periodo = f"del {f_ini.strftime('%d/%m/%Y')} al {f_fin.strftime('%d/%m/%Y')}"
        else:
            f_ini_str, f_fin_str = resolver_rango_fechas(periodo)
            f_ini = datetime.datetime.strptime(f_ini_str, '%Y-%m-%d').date()
            f_fin = datetime.datetime.strptime(f_fin_str, '%Y-%m-%d').date()
            desc_periodo = f"de los últimos {periodo.replace('dias', ' días')}" if 'dias' in periodo else "de la semana"
        
        intervalos = []
        curr = f_ini
        semana_num = 1
        while curr <= f_fin:
            next_curr = min(curr + datetime.timedelta(days=6), f_fin)
            if curr.month == next_curr.month:
                lbl = f"Sem {semana_num} ({curr.day:02d}-{next_curr.day:02d} {MESES_ABR[curr.month]})"
            else:
                lbl = f"Sem {semana_num} ({curr.day:02d} {MESES_ABR[curr.month]} - {next_curr.day:02d} {MESES_ABR[next_curr.month]})"
            intervalos.append({
                'label': lbl,
                'inicio': curr,
                'fin': next_curr
            })
            curr = next_curr + datetime.timedelta(days=1)
            semana_num += 1
            
        etiquetas = [i['label'] for i in intervalos]
        
        cur.execute("""
            SELECT 
                FECHA,
                ALMACEN_ID,
                SUCURSAL,
                SUM(TOTAL) AS TOTAL
            FROM (
                SELECT 
                    p.FECHA,
                    COALESCE(p.ALMACEN_ID, cj.ALMACEN_ID) AS ALMACEN_ID,
                    TRIM(a.NOMBRE) AS SUCURSAL,
                    CASE WHEN p.TIPO_DOCTO = 'D' THEN -(p.IMPORTE_NETO + COALESCE(p.TOTAL_IMPUESTOS, 0)) ELSE (p.IMPORTE_NETO + COALESCE(p.TOTAL_IMPUESTOS, 0)) END AS TOTAL
                FROM DOCTOS_PV p
                LEFT JOIN CAJAS cj ON cj.CAJA_ID = p.CAJA_ID
                JOIN ALMACENES a ON a.ALMACEN_ID = COALESCE(p.ALMACEN_ID, cj.ALMACEN_ID)
                WHERE p.FECHA >= ? AND p.FECHA <= ?
                  AND p.ESTATUS <> 'C'
                  AND p.TIPO_DOCTO IN ('V', 'D')

                UNION ALL

                SELECT 
                    v.FECHA,
                    v.ALMACEN_ID AS ALMACEN_ID,
                    TRIM(a.NOMBRE) AS SUCURSAL,
                    CASE WHEN v.TIPO_DOCTO = 'D' THEN -(v.IMPORTE_NETO + COALESCE(v.TOTAL_IMPUESTOS, 0)) ELSE (v.IMPORTE_NETO + COALESCE(v.TOTAL_IMPUESTOS, 0)) END AS TOTAL
                FROM DOCTOS_VE v
                JOIN ALMACENES a ON a.ALMACEN_ID = v.ALMACEN_ID
                WHERE v.FECHA >= ? AND v.FECHA <= ?
                  AND v.ESTATUS <> 'C'
                  AND v.APLICADO = 'S'
                  AND v.TIPO_DOCTO IN ('F', 'D')
            )
            GROUP BY FECHA, ALMACEN_ID, SUCURSAL
        """, (f_ini_str, f_fin_str, f_ini_str, f_fin_str))
        filas = cur.fetchall()
        
        suc_map = {}
        for r in filas:
            fec = r[0]
            alm_id = int(r[1])
            nom = r[2].replace('Sucursal ', '')
            tot = float(r[3] or 0)
            if alm_id not in suc_map:
                suc_map[alm_id] = {'nombre': nom, 'ventas_por_fecha': {}, 'total': 0.0}
            suc_map[alm_id]['ventas_por_fecha'][fec] = suc_map[alm_id]['ventas_por_fecha'].get(fec, 0.0) + tot
            suc_map[alm_id]['total'] += tot
            
        datasets = []
        for alm_id, s in sorted(suc_map.items(), key=lambda x: x[1]['total'], reverse=True)[:10]:
            valores = []
            for inter in intervalos:
                v_inter = sum(s['ventas_por_fecha'].get(d, 0.0) for d in s['ventas_por_fecha'] if inter['inicio'] <= d <= inter['fin'])
                valores.append(round(v_inter, 2))
            datasets.append({
                'almacen_id': alm_id,
                'nombre': s['nombre'],
                'valores': valores,
                'total': round(s['total'], 2)
            })
            
        return {
            'tipo': 'semanas',
            'subtitulo': f"Ventas semanales {desc_periodo}",
            'badge': 'Por Semana',
            'etiquetas': etiquetas,
            'sucursales': datasets
        }

@dashboard_bp.route('/api/dashboard/resumen', methods=['GET'])
def get_dashboard_resumen():
    periodo = request.args.get('periodo', 'mes_actual')
    fecha_inicio = request.args.get('fecha_inicio')
    fecha_fin = request.args.get('fecha_fin')
    current_dsn = get_current_dsn()
    if periodo == 'personalizado' and fecha_inicio and fecha_fin:
        cache_key = f"{current_dsn}_resumen_custom_{fecha_inicio}_{fecha_fin}"
    else:
        cache_key = f"{current_dsn}_resumen_{periodo}"
    cached = get_cached(cache_key, periodo=periodo)
    if cached:
        return jsonify(cached)

    fecha_ini, fecha_fin = resolver_rango_fechas(periodo, fecha_inicio, fecha_fin)

    conn = None
    try:
        conn = conectar_db()
        cur = conn.cursor()

        # 1. Ventas por sucursal (unificando con CAJAS para asociar facturas con ALMACEN_ID nulo)
        visibles_suc_cfg = obtener_visibilidad_dict('SUCURSAL', empresa=current_dsn)

        cur.execute("""
            SELECT 
                ALMACEN_ID,
                NOMBRE,
                SUM(TICKETS) AS TICKETS,
                SUM(TOTAL_VENTA) AS TOTAL_VENTA
            FROM (
                SELECT 
                    COALESCE(p.ALMACEN_ID, cj.ALMACEN_ID) AS ALMACEN_ID,
                    TRIM(a.NOMBRE) AS NOMBRE,
                    COUNT(CASE WHEN p.TIPO_DOCTO = 'V' THEN p.DOCTO_PV_ID END) AS TICKETS,
                    SUM(CASE WHEN p.TIPO_DOCTO = 'D' THEN -(p.IMPORTE_NETO + COALESCE(p.TOTAL_IMPUESTOS, 0)) ELSE (p.IMPORTE_NETO + COALESCE(p.TOTAL_IMPUESTOS, 0)) END) AS TOTAL_VENTA
                FROM DOCTOS_PV p
                LEFT JOIN CAJAS cj ON cj.CAJA_ID = p.CAJA_ID
                JOIN ALMACENES a ON a.ALMACEN_ID = COALESCE(p.ALMACEN_ID, cj.ALMACEN_ID)
                WHERE p.FECHA >= ? AND p.FECHA <= ?
                  AND p.ESTATUS <> 'C'
                  AND p.TIPO_DOCTO IN ('V', 'D')
                GROUP BY COALESCE(p.ALMACEN_ID, cj.ALMACEN_ID), a.NOMBRE

                UNION ALL

                SELECT 
                    v.ALMACEN_ID AS ALMACEN_ID,
                    TRIM(a.NOMBRE) AS NOMBRE,
                    COUNT(CASE WHEN v.TIPO_DOCTO = 'F' THEN v.DOCTO_VE_ID END) AS TICKETS,
                    SUM(CASE WHEN v.TIPO_DOCTO = 'D' THEN -(v.IMPORTE_NETO + COALESCE(v.TOTAL_IMPUESTOS, 0)) ELSE (v.IMPORTE_NETO + COALESCE(v.TOTAL_IMPUESTOS, 0)) END) AS TOTAL_VENTA
                FROM DOCTOS_VE v
                JOIN ALMACENES a ON a.ALMACEN_ID = v.ALMACEN_ID
                WHERE v.FECHA >= ? AND v.FECHA <= ?
                  AND v.ESTATUS <> 'C'
                  AND v.APLICADO = 'S'
                  AND v.TIPO_DOCTO IN ('F', 'D')
                GROUP BY v.ALMACEN_ID, a.NOMBRE
            )
            GROUP BY ALMACEN_ID, NOMBRE
            ORDER BY TOTAL_VENTA DESC
        """, (fecha_ini, fecha_fin, fecha_ini, fecha_fin))

        sucursales_ventas = []
        total_venta_grupo = 0.0
        total_tickets_grupo = 0
        sucursal_lider = {"nombre": "Sin datos", "total": 0.0}

        for r in cur.fetchall():
            if r[0] is None:
                continue
            alm_id = int(r[0])
            nom = r[1] or f"Almacén {alm_id}"
            nom_upper = nom.upper()
            tot = float(r[3] or 0)
            tcks = int(r[2] or 0)

            # Verificar si la sucursal está visible según configuración o regla por defecto
            if alm_id in visibles_suc_cfg:
                visible = visibles_suc_cfg[alm_id]
            else:
                visible = not any(x in nom_upper for x in ['NO UTILIZAR', 'NO USAR', 'TRANSITO', 'DEVOLUCION'])

            if not visible:
                continue

            total_venta_grupo += tot
            total_tickets_grupo += tcks
            sucursales_ventas.append({
                "almacen_id": alm_id,
                "nombre": nom,
                "tickets": tcks,
                "total_venta": tot
            })

        if sucursales_ventas:
            sucursal_lider = {
                "nombre": sucursales_ventas[0]["nombre"],
                "total": sucursales_ventas[0]["total_venta"]
            }

        # Calcular porcentaje para cada sucursal
        for s in sucursales_ventas:
            s["porcentaje"] = round((s["total_venta"] / total_venta_grupo * 100), 1) if total_venta_grupo > 0 else 0.0

        # 2. Utilidad de Venta (Margen Bruto) y Top Artículos en una sola pasada de alto rendimiento
        # Separando la consulta de costos en CAPAS_COSTOS y agrupando por ALMACEN_ID y ARTICULO_ID,
        # obtenemos margen por sucursal, margen por artículo y totales del grupo en ~1 segundo.
        utilidad_venta = 0.0
        costo_venta = 0.0
        margen_utilidad_pct = 0.0
        top_articulos_piezas = []
        top_articulos_importe = []
        top_articulos_margen = []

        try:
            # 2a. Costo promedio actual por artículo desde CAPAS_COSTOS
            cur.execute("""
                SELECT 
                    ARTICULO_ID,
                    CAST(SUM(VALOR_TOTAL) AS DOUBLE PRECISION) / NULLIF(CAST(SUM(EXISTENCIA) AS DOUBLE PRECISION), 0)
                FROM CAPAS_COSTOS
                WHERE CAPA_AGOTADA = 'N' AND EXISTENCIA > 0
                GROUP BY ARTICULO_ID
            """)
            costos_map = {int(r[0]): float(r[1] or 0.0) for r in cur.fetchall() if r[0] is not None}

            # 2b. Agrupación rápida de ventas del período por ALMACEN_ID y ARTICULO_ID
            cur.execute("""
                SELECT 
                    ALMACEN_ID,
                    ARTICULO_ID,
                    SUM(PIEZAS) AS PIEZAS,
                    SUM(VENTA_NETA) AS VENTA_NETA
                FROM (
                    SELECT 
                        COALESCE(p.ALMACEN_ID, cj.ALMACEN_ID) AS ALMACEN_ID,
                        d.ARTICULO_ID,
                        SUM(CASE WHEN p.TIPO_DOCTO = 'D' THEN -(CAST(d.UNIDADES AS DOUBLE PRECISION)) ELSE CAST(d.UNIDADES - COALESCE(d.UNIDADES_DEV, 0) AS DOUBLE PRECISION) END) AS PIEZAS,
                        SUM(CASE WHEN p.TIPO_DOCTO = 'D' THEN -(CAST(d.PRECIO_TOTAL_NETO AS DOUBLE PRECISION)) ELSE CAST(d.PRECIO_TOTAL_NETO AS DOUBLE PRECISION) END) AS VENTA_NETA
                    FROM DOCTOS_PV p
                    LEFT JOIN CAJAS cj ON cj.CAJA_ID = p.CAJA_ID
                    JOIN DOCTOS_PV_DET d ON d.DOCTO_PV_ID = p.DOCTO_PV_ID
                    WHERE p.FECHA >= ? AND p.FECHA <= ?
                      AND p.ESTATUS <> 'C'
                      AND p.TIPO_DOCTO IN ('V', 'D')
                    GROUP BY COALESCE(p.ALMACEN_ID, cj.ALMACEN_ID), d.ARTICULO_ID

                    UNION ALL

                    SELECT 
                        v.ALMACEN_ID AS ALMACEN_ID,
                        d.ARTICULO_ID,
                        SUM(CASE WHEN v.TIPO_DOCTO = 'D' THEN -(CAST(d.UNIDADES AS DOUBLE PRECISION)) ELSE CAST(d.UNIDADES AS DOUBLE PRECISION) END) AS PIEZAS,
                        SUM(CASE WHEN v.TIPO_DOCTO = 'D' THEN -(CAST(d.PRECIO_TOTAL_NETO AS DOUBLE PRECISION)) ELSE CAST(d.PRECIO_TOTAL_NETO AS DOUBLE PRECISION) END) AS VENTA_NETA
                    FROM DOCTOS_VE v
                    JOIN DOCTOS_VE_DET d ON d.DOCTO_VE_ID = v.DOCTO_VE_ID
                    WHERE v.FECHA >= ? AND v.FECHA <= ?
                      AND v.ESTATUS <> 'C'
                      AND v.APLICADO = 'S'
                      AND v.TIPO_DOCTO IN ('F', 'D')
                    GROUP BY v.ALMACEN_ID, d.ARTICULO_ID
                )
                GROUP BY ALMACEN_ID, ARTICULO_ID
            """, (fecha_ini, fecha_fin, fecha_ini, fecha_fin))

            ventas_por_art_dict = {}
            utilidades_por_sucursal = {}
            v_neta_total = 0.0

            for r in cur.fetchall():
                alm_id = int(r[0]) if r[0] is not None else None
                art_id = int(r[1]) if r[1] is not None else None
                if not art_id:
                    continue
                piezas = float(r[2] or 0.0)
                importe = float(r[3] or 0.0)
                costo_unit = costos_map.get(art_id, 0.0)
                costo_tot = piezas * costo_unit
                costo_venta += costo_tot
                v_neta_total += importe

                # Acumular por artículo
                if art_id not in ventas_por_art_dict:
                    ventas_por_art_dict[art_id] = {
                        "articulo_id": art_id,
                        "piezas": 0.0,
                        "importe": 0.0,
                        "costo": 0.0
                    }
                ventas_por_art_dict[art_id]["piezas"] += piezas
                ventas_por_art_dict[art_id]["importe"] += importe
                ventas_por_art_dict[art_id]["costo"] += costo_tot

                # Acumular por sucursal
                if alm_id is not None:
                    if alm_id not in utilidades_por_sucursal:
                        utilidades_por_sucursal[alm_id] = {"venta": 0.0, "costo": 0.0}
                    utilidades_por_sucursal[alm_id]["venta"] += importe
                    utilidades_por_sucursal[alm_id]["costo"] += costo_tot

            if v_neta_total > 0:
                utilidad_venta = v_neta_total - costo_venta
                margen_utilidad_pct = round((utilidad_venta / v_neta_total * 100), 1)

            # Inyectar utilidad y margen a cada sucursal en sucursales_ventas
            for s in sucursales_ventas:
                alm_id = s.get("almacen_id")
                suc_data = utilidades_por_sucursal.get(alm_id, {"venta": 0.0, "costo": 0.0})
                vta_suc = suc_data["venta"]
                cst_suc = suc_data["costo"]
                ut_suc = vta_suc - cst_suc
                margen_suc = round((ut_suc / vta_suc * 100), 1) if vta_suc > 0 else 0.0
                s["utilidad"] = round(ut_suc, 2)
                s["margen_utilidad_pct"] = margen_suc

            # Convertir ventas_por_art_dict a lista calculando margen y utilidad
            ventas_por_art = []
            for art_id, art_data in ventas_por_art_dict.items():
                imp = art_data["importe"]
                cst = art_data["costo"]
                ut = imp - cst
                mrg = round((ut / imp * 100), 1) if imp > 0 else 0.0
                ventas_por_art.append({
                    "articulo_id": art_id,
                    "piezas": art_data["piezas"],
                    "importe": imp,
                    "costo": cst,
                    "utilidad": round(ut, 2),
                    "margen_utilidad_pct": mrg
                })

            # 2c. Top por piezas, importe y margen
            top_piezas_raw = sorted(ventas_por_art, key=lambda x: x["piezas"], reverse=True)[:100]
            top_importe_raw = sorted(ventas_por_art, key=lambda x: x["importe"], reverse=True)[:100]
            top_margen_raw = sorted([x for x in ventas_por_art if x["importe"] >= 50.0], key=lambda x: (x["margen_utilidad_pct"], x["importe"]), reverse=True)[:100]

            art_ids_necesarios = list({x["articulo_id"] for x in (top_piezas_raw + top_importe_raw + top_margen_raw)})
            info_articulos = {}

            if art_ids_necesarios:
                chunk_size = 300
                for i in range(0, len(art_ids_necesarios), chunk_size):
                    chunk = art_ids_necesarios[i:i + chunk_size]
                    placeholders = ','.join(['?'] * len(chunk))
                    cur.execute(f"""
                        SELECT 
                            ar.ARTICULO_ID,
                            COALESCE(TRIM(ca.CLAVE_ARTICULO), 'S/C') AS CLAVE,
                            TRIM(ar.NOMBRE) AS NOMBRE
                        FROM ARTICULOS ar
                        LEFT JOIN CLAVES_ARTICULOS ca ON ca.ARTICULO_ID = ar.ARTICULO_ID AND ca.ROL_CLAVE_ART_ID = 17
                        WHERE ar.ARTICULO_ID IN ({placeholders})
                    """, chunk)
                    for r_info in cur.fetchall():
                        info_articulos[int(r_info[0])] = {
                            "clave": r_info[1] or "S/C",
                            "nombre": r_info[2] or "Sin nombre"
                        }

            for x in top_piezas_raw:
                meta = info_articulos.get(x["articulo_id"], {"clave": "S/C", "nombre": f"Art {x['articulo_id']}"})
                top_articulos_piezas.append({
                    "clave": meta["clave"],
                    "nombre": meta["nombre"],
                    "piezas": x["piezas"],
                    "importe": x["importe"],
                    "utilidad": x["utilidad"],
                    "margen_utilidad_pct": x["margen_utilidad_pct"]
                })

            for x in top_importe_raw:
                meta = info_articulos.get(x["articulo_id"], {"clave": "S/C", "nombre": f"Art {x['articulo_id']}"})
                top_articulos_importe.append({
                    "clave": meta["clave"],
                    "nombre": meta["nombre"],
                    "piezas": x["piezas"],
                    "importe": x["importe"],
                    "utilidad": x["utilidad"],
                    "margen_utilidad_pct": x["margen_utilidad_pct"]
                })

            for x in top_margen_raw:
                meta = info_articulos.get(x["articulo_id"], {"clave": "S/C", "nombre": f"Art {x['articulo_id']}"})
                top_articulos_margen.append({
                    "clave": meta["clave"],
                    "nombre": meta["nombre"],
                    "piezas": x["piezas"],
                    "importe": x["importe"],
                    "utilidad": x["utilidad"],
                    "margen_utilidad_pct": x["margen_utilidad_pct"]
                })

        except Exception as e_util:
            print("Aviso al calcular utilidad de venta y top articulos:", e_util)

        articulo_estrella = top_articulos_piezas[0] if top_articulos_piezas else {"clave": "N/D", "nombre": "Sin ventas", "piezas": 0, "importe": 0.0}

        # 3. Costo Total de Almacén (Valor de Inventario Existencia x Costo)
        costo_inventario_total = 0.0
        costos_por_almacen = {}
        try:
            cur.execute("""
                SELECT 
                    c.ALMACEN_ID,
                    SUM(c.VALOR_TOTAL) AS COSTO_TOTAL
                FROM CAPAS_COSTOS c
                WHERE c.CAPA_AGOTADA = 'N'
                GROUP BY c.ALMACEN_ID
            """)
            for r_c in cur.fetchall():
                alm_id = int(r_c[0])
                c_tot = float(r_c[1] or 0)
                costos_por_almacen[alm_id] = c_tot
                costo_inventario_total += c_tot
        except Exception as e_cost:
            print("Aviso al calcular costo de inventario:", e_cost)

        # 4. SKUs / Ítems Activos en Catálogo
        skus_activos = 0
        try:
            cur.execute("SELECT COUNT(*) FROM ARTICULOS WHERE ESTATUS = 'A'")
            r_sku = cur.fetchone()
            if r_sku:
                skus_activos = int(r_sku[0] or 0)
        except Exception as e_sku:
            print("Aviso al contar SKUs activos:", e_sku)

        # 5. Inventario total en piezas por almacén (usando tabla intermedia de alto rendimiento)
        from app.services.cache_service import obtener_resumen_almacenes
        res_alms = obtener_resumen_almacenes(empresa=current_dsn)
        almacenes_stock = []
        total_stock_piezas = 0
        for a in res_alms.get("almacenes", []):
            cant = int(a.get("piezas", 0))
            alm_id = a["id"]
            if cant > 0:
                total_stock_piezas += cant
                almacenes_stock.append({
                    "almacen_id": alm_id,
                    "nombre": a["nombre"],
                    "existencia": cant,
                    "costo_total": round(costos_por_almacen.get(alm_id, 0.0), 2)
                })
        for a in almacenes_stock:
            a["porcentaje"] = round((a["existencia"] / total_stock_piezas * 100), 1) if total_stock_piezas > 0 else 0.0

        # 4. Mejor Cliente del período (excluye clientes genéricos de mostrador)
        cur.execute("""
            SELECT FIRST 1
                TRIM(NOMBRE) AS NOMBRE,
                SUM(TICKETS) AS TICKETS,
                SUM(TOTAL) AS TOTAL
            FROM (
                SELECT 
                    c.NOMBRE AS NOMBRE,
                    COUNT(CASE WHEN p.TIPO_DOCTO = 'V' THEN p.DOCTO_PV_ID END) AS TICKETS,
                    SUM(CASE WHEN p.TIPO_DOCTO = 'D' THEN -(p.IMPORTE_NETO + COALESCE(p.TOTAL_IMPUESTOS, 0)) ELSE (p.IMPORTE_NETO + COALESCE(p.TOTAL_IMPUESTOS, 0)) END) AS TOTAL
                FROM DOCTOS_PV p
                JOIN CLIENTES c ON c.CLIENTE_ID = p.CLIENTE_ID
                WHERE p.FECHA >= ? AND p.FECHA <= ?
                  AND p.ESTATUS <> 'C'
                  AND p.TIPO_DOCTO IN ('V', 'D')
                  AND UPPER(c.NOMBRE) NOT LIKE '%MOSTRADOR%'
                  AND UPPER(c.NOMBRE) NOT LIKE '%PUBLICO EN GENERAL%'
                  AND UPPER(c.NOMBRE) NOT LIKE '%VENTA PUBLICO MAYOREO%'
                  AND UPPER(c.NOMBRE) NOT LIKE '%CLIENTES EN GENERAL%'
                  AND UPPER(c.NOMBRE) NOT LIKE '%CLIENTES EN GRAL%'
                GROUP BY c.NOMBRE

                UNION ALL

                SELECT 
                    c.NOMBRE AS NOMBRE,
                    COUNT(CASE WHEN v.TIPO_DOCTO = 'F' THEN v.DOCTO_VE_ID END) AS TICKETS,
                    SUM(CASE WHEN v.TIPO_DOCTO = 'D' THEN -(v.IMPORTE_NETO + COALESCE(v.TOTAL_IMPUESTOS, 0)) ELSE (v.IMPORTE_NETO + COALESCE(v.TOTAL_IMPUESTOS, 0)) END) AS TOTAL
                FROM DOCTOS_VE v
                JOIN CLIENTES c ON c.CLIENTE_ID = v.CLIENTE_ID
                WHERE v.FECHA >= ? AND v.FECHA <= ?
                  AND v.ESTATUS <> 'C'
                  AND v.APLICADO = 'S'
                  AND v.TIPO_DOCTO IN ('F', 'D')
                  AND UPPER(c.NOMBRE) NOT LIKE '%MOSTRADOR%'
                  AND UPPER(c.NOMBRE) NOT LIKE '%PUBLICO EN GENERAL%'
                  AND UPPER(c.NOMBRE) NOT LIKE '%VENTA PUBLICO MAYOREO%'
                  AND UPPER(c.NOMBRE) NOT LIKE '%CLIENTES EN GENERAL%'
                  AND UPPER(c.NOMBRE) NOT LIKE '%CLIENTES EN GRAL%'
                GROUP BY c.NOMBRE
            )
            GROUP BY NOMBRE
            ORDER BY TOTAL DESC
        """, (fecha_ini, fecha_fin, fecha_ini, fecha_fin))

        row_cl = cur.fetchone()
        if row_cl:
            cliente_estrella = {
                "nombre": row_cl[0],
                "tickets": int(row_cl[1] or 0),
                "total": float(row_cl[2] or 0)
            }
        else:
            cliente_estrella = {"nombre": "Sin datos", "tickets": 0, "total": 0.0}

        tendencia_ventas = obtener_tendencia_ventas(periodo, cur, fecha_ini=fecha_ini, fecha_fin=fecha_fin)

        # 5. Ventas por Grupo de Vendedores y Top Vendedores del período
        ventas_grupos = []
        top_vendedores = []
        try:
            cur.execute("""
                SELECT 
                    v.VENDEDOR_ID,
                    TRIM(v.NOMBRE) AS NOMBRE,
                    COALESCE(TRIM(p.NOMBRE), 'SIN POLÍTICA') AS GRUPO,
                    SUM(sub.TICKETS) AS TICKETS,
                    SUM(sub.TOTAL_VENTA) AS TOTAL_VENTA
                FROM (
                    SELECT 
                        pv.VENDEDOR_ID,
                        COUNT(CASE WHEN pv.TIPO_DOCTO = 'V' THEN pv.DOCTO_PV_ID END) AS TICKETS,
                        SUM(CASE WHEN pv.TIPO_DOCTO = 'D' THEN -(pv.IMPORTE_NETO + COALESCE(pv.TOTAL_IMPUESTOS, 0)) ELSE (pv.IMPORTE_NETO + COALESCE(pv.TOTAL_IMPUESTOS, 0)) END) AS TOTAL_VENTA
                    FROM DOCTOS_PV pv
                    WHERE pv.FECHA >= ? AND pv.FECHA <= ?
                      AND pv.ESTATUS <> 'C'
                      AND pv.TIPO_DOCTO IN ('V', 'D')
                    GROUP BY pv.VENDEDOR_ID

                    UNION ALL

                    SELECT 
                        ve.VENDEDOR_ID,
                        COUNT(CASE WHEN ve.TIPO_DOCTO = 'F' THEN ve.DOCTO_VE_ID END) AS TICKETS,
                        SUM(CASE WHEN ve.TIPO_DOCTO = 'D' THEN -(ve.IMPORTE_NETO + COALESCE(ve.TOTAL_IMPUESTOS, 0)) ELSE (ve.IMPORTE_NETO + COALESCE(ve.TOTAL_IMPUESTOS, 0)) END) AS TOTAL_VENTA
                    FROM DOCTOS_VE ve
                    WHERE ve.FECHA >= ? AND ve.FECHA <= ?
                      AND ve.ESTATUS <> 'C'
                      AND ve.APLICADO = 'S'
                      AND ve.TIPO_DOCTO IN ('F', 'D')
                    GROUP BY ve.VENDEDOR_ID
                ) sub
                JOIN VENDEDORES v ON sub.VENDEDOR_ID = v.VENDEDOR_ID
                LEFT JOIN POLITICAS_COMISIONES_VENDEDORES p ON v.POLITICA_COMIS_VEN_ID = p.POLITICA_COMIS_VEN_ID
                GROUP BY v.VENDEDOR_ID, v.NOMBRE, p.NOMBRE
                ORDER BY TOTAL_VENTA DESC
            """, (fecha_ini, fecha_fin, fecha_ini, fecha_fin))

            grupos_dict = {}
            tot_venta_vendedores = 0.0

            vendedores_rows = cur.fetchall()
            for r_v in vendedores_rows:
                v_id = int(r_v[0])
                v_nom = r_v[1] or f"Vendedor {v_id}"
                v_grp = (r_v[2] or "SIN POLÍTICA").strip().upper()
                grp_label = ' '.join(w.capitalize() for w in v_grp.split())
                tcks = int(r_v[3] or 0)
                tot = float(r_v[4] or 0.0)

                tot_venta_vendedores += tot

                if grp_label not in grupos_dict:
                    grupos_dict[grp_label] = {"grupo": grp_label, "total_venta": 0.0, "tickets": 0}
                grupos_dict[grp_label]["total_venta"] += tot
                grupos_dict[grp_label]["tickets"] += tcks

                top_vendedores.append({
                    "vendedor_id": v_id,
                    "nombre": v_nom,
                    "grupo": grp_label,
                    "tickets": tcks,
                    "total_venta": round(tot, 2)
                })

            ventas_grupos = list(grupos_dict.values())
            ventas_grupos.sort(key=lambda x: x["total_venta"], reverse=True)
            for g in ventas_grupos:
                g["total_venta"] = round(g["total_venta"], 2)
                g["porcentaje"] = round((g["total_venta"] / tot_venta_vendedores * 100), 1) if tot_venta_vendedores > 0 else 0.0

            for v in top_vendedores:
                v["porcentaje"] = round((v["total_venta"] / tot_venta_vendedores * 100), 1) if tot_venta_vendedores > 0 else 0.0

            top_vendedores = top_vendedores[:15]
        except Exception as e_grp:
            print("Aviso al calcular ventas por grupo y vendedores:", e_grp)

        resultado = {
            "success": True,
            "periodo": periodo,
            "fecha_inicio": fecha_ini,
            "fecha_final": fecha_fin,
            "kpis": {
                "total_venta": total_venta_grupo,
                "total_tickets": total_tickets_grupo,
                "ticket_promedio": round(total_venta_grupo / total_tickets_grupo, 2) if total_tickets_grupo > 0 else 0.0,
                "utilidad_venta": round(utilidad_venta, 2),
                "costo_venta": round(costo_venta, 2),
                "margen_utilidad_pct": margen_utilidad_pct,
                "costo_inventario_total": round(costo_inventario_total, 2),
                "total_stock_piezas": total_stock_piezas,
                "skus_activos": skus_activos,
                "sucursales_activas": len(sucursales_ventas),
                "sucursal_lider": sucursal_lider,
                "articulo_estrella": articulo_estrella,
                "cliente_estrella": cliente_estrella
            },
            "ventas_sucursales": sucursales_ventas,
            "almacenes_stock": almacenes_stock,
            "tendencia_ventas": tendencia_ventas,
            "top_articulos": top_articulos_piezas,
            "top_articulos_piezas": top_articulos_piezas,
            "top_articulos_importe": top_articulos_importe,
            "top_articulos_margen": top_articulos_margen,
            "ventas_grupos": ventas_grupos,
            "top_vendedores": top_vendedores
        }

        set_cached(cache_key, resultado)
        return jsonify(resultado)

    except Exception as e:
        print("Error en get_dashboard_resumen:", e)
        return jsonify({"success": False, "error": str(e)}), 500
    finally:
        if conn:
            try:
                conn.close()
            except:
                pass

@dashboard_bp.route('/api/dashboard/top-articulos', methods=['GET'])
def get_top_articulos():
    periodo = request.args.get('periodo', 'mes_actual')
    fecha_inicio = request.args.get('fecha_inicio')
    fecha_fin = request.args.get('fecha_fin')
    limit = min(100, max(5, int(request.args.get('limit', 20))))
    current_dsn = get_current_dsn()
    if periodo == 'personalizado' and fecha_inicio and fecha_fin:
        cache_key = f"{current_dsn}_top_articulos_custom_{fecha_inicio}_{fecha_fin}_{limit}"
    else:
        cache_key = f"{current_dsn}_top_articulos_{periodo}_{limit}"
    cached = get_cached(cache_key, periodo=periodo)
    if cached:
        return jsonify(cached)

    fecha_ini, fecha_fin = resolver_rango_fechas(periodo, fecha_inicio, fecha_fin)

    conn = None
    try:
        conn = conectar_db()
        cur = conn.cursor()
        cur.execute(f"""
            SELECT FIRST {limit}
                COALESCE(TRIM(ca.CLAVE_ARTICULO), 'S/C') AS CLAVE,
                TRIM(ar.NOMBRE) AS NOMBRE,
                SUM(t.PIEZAS_VENDIDAS) AS PIEZAS_VENDIDAS,
                SUM(t.IMPORTE_TOTAL) AS IMPORTE_TOTAL,
                COUNT(DISTINCT t.ALMACEN_ID) AS SUCURSALES_VENDIENDO,
                ar.ARTICULO_ID
            FROM (
                SELECT 
                    d.ARTICULO_ID,
                    COALESCE(p.ALMACEN_ID, cj.ALMACEN_ID) AS ALMACEN_ID,
                    SUM(CASE WHEN p.TIPO_DOCTO = 'D' THEN -(d.UNIDADES) ELSE (d.UNIDADES - COALESCE(d.UNIDADES_DEV, 0)) END) AS PIEZAS_VENDIDAS,
                    SUM(CASE WHEN p.TIPO_DOCTO = 'D' THEN -(d.PRECIO_TOTAL_NETO) ELSE d.PRECIO_TOTAL_NETO END) AS IMPORTE_TOTAL
                FROM DOCTOS_PV p
                LEFT JOIN CAJAS cj ON cj.CAJA_ID = p.CAJA_ID
                JOIN DOCTOS_PV_DET d ON d.DOCTO_PV_ID = p.DOCTO_PV_ID
                WHERE p.FECHA >= ? AND p.FECHA <= ?
                  AND p.ESTATUS <> 'C'
                  AND p.TIPO_DOCTO IN ('V', 'D')
                GROUP BY d.ARTICULO_ID, COALESCE(p.ALMACEN_ID, cj.ALMACEN_ID)

                UNION ALL

                SELECT 
                    d.ARTICULO_ID,
                    v.ALMACEN_ID AS ALMACEN_ID,
                    SUM(CASE WHEN v.TIPO_DOCTO = 'D' THEN -(d.UNIDADES) ELSE d.UNIDADES END) AS PIEZAS_VENDIDAS,
                    SUM(CASE WHEN v.TIPO_DOCTO = 'D' THEN -(d.PRECIO_TOTAL_NETO) ELSE d.PRECIO_TOTAL_NETO END) AS IMPORTE_TOTAL
                FROM DOCTOS_VE v
                JOIN DOCTOS_VE_DET d ON d.DOCTO_VE_ID = v.DOCTO_VE_ID
                WHERE v.FECHA >= ? AND v.FECHA <= ?
                  AND v.ESTATUS <> 'C'
                  AND v.APLICADO = 'S'
                  AND v.TIPO_DOCTO IN ('F', 'D')
                GROUP BY d.ARTICULO_ID, v.ALMACEN_ID
            ) t
            JOIN ARTICULOS ar ON ar.ARTICULO_ID = t.ARTICULO_ID
            LEFT JOIN CLAVES_ARTICULOS ca ON ca.ARTICULO_ID = ar.ARTICULO_ID AND ca.ROL_CLAVE_ART_ID = 17
            GROUP BY ca.CLAVE_ARTICULO, ar.NOMBRE, ar.ARTICULO_ID
            ORDER BY PIEZAS_VENDIDAS DESC
        """, (fecha_ini, fecha_fin, fecha_ini, fecha_fin))

        rows_top = cur.fetchall()

        # Obtener costos de capas para los artículos del top
        art_ids_top = [int(r[5]) for r in rows_top if r[5] is not None]
        costos_top = {}
        if art_ids_top:
            placeholders = ','.join(['?'] * len(art_ids_top))
            cur.execute(f"""
                SELECT 
                    ARTICULO_ID,
                    CAST(SUM(VALOR_TOTAL) AS DOUBLE PRECISION) / NULLIF(CAST(SUM(EXISTENCIA) AS DOUBLE PRECISION), 0)
                FROM CAPAS_COSTOS
                WHERE CAPA_AGOTADA = 'N' AND EXISTENCIA > 0 AND ARTICULO_ID IN ({placeholders})
                GROUP BY ARTICULO_ID
            """, art_ids_top)
            costos_top = {int(rc[0]): float(rc[1] or 0.0) for rc in cur.fetchall() if rc[0] is not None}

        items = []
        for r in rows_top:
            pzas = float(r[2] or 0)
            imp = float(r[3] or 0)
            art_id = int(r[5]) if r[5] is not None else 0
            c_u = costos_top.get(art_id, 0.0)
            ut = imp - (pzas * c_u)
            mrg = round((ut / imp * 100), 1) if imp > 0 else 0.0
            items.append({
                "clave": r[0],
                "nombre": r[1],
                "piezas": pzas,
                "importe": imp,
                "sucursales_activas": int(r[4] or 0),
                "utilidad": round(ut, 2),
                "margen_utilidad_pct": mrg
            })
        data = {"success": True, "items": items, "periodo": periodo}
        set_cached(cache_key, data)
        return jsonify(data)
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500
    finally:
        if conn:
            try:
                conn.close()
            except:
                pass
