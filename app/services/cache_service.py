import threading
import time
import datetime
from app.config import get_current_dsn
from app.db import conectar_db, conectar_sqlite

# Locks y estados para evitar múltiples consultas simultáneas a Firebird
_lock_actualizacion = threading.Lock()
_actualizando_por_empresa = {}
_cache_memoria = {}
_TTL_SEGUNDOS = 300  # 5 minutos para actualización automática en segundo plano

def esta_actualizando(empresa=None):
    emp = empresa or get_current_dsn()
    return _actualizando_por_empresa.get(emp, False)

def actualizar_tablas_intermedias(empresa=None, force=False):
    """
    Calcula y almacena en la tabla intermedia SQLite 'resumen_almacenes_cache'
    los totales de piezas, costos y ventas por almacén y sucursal.
    """
    emp = empresa or get_current_dsn()
    
    # Evitar múltiples hilos concurrentes pegándole a Firebird
    with _lock_actualizacion:
        if _actualizando_por_empresa.get(emp, False) and not force:
            return
        _actualizando_por_empresa[emp] = True

    conn_fb = None
    try:
        t_inicio = time.time()
        conn_fb = conectar_db(emp)
        cur_fb = conn_fb.cursor()

        # 1. Catálogo de almacenes activos
        cur_fb.execute("SELECT ALMACEN_ID, TRIM(NOMBRE) FROM ALMACENES WHERE NOMBRE NOT LIKE 'NO UTILIZAR%'")
        almacenes_raw = cur_fb.fetchall()

        almacenes_info = {}
        sucursales_ids = []
        for r in almacenes_raw:
            alm_id = int(r[0])
            nombre = str(r[1]).strip()
            es_cedis = "CEDIS" in nombre.upper()
            es_transito = "TRANSITO" in nombre.upper() or "TRÁNSITO" in nombre.upper()
            es_dev = "DEVOLUCION" in nombre.upper() or "DEV" in nombre.upper()
            es_usado = "USADO" in nombre.upper()
            es_sucursal = ("SUCURSAL" in nombre.upper() or alm_id in [19, 151934, 102553, 163112, 2168433]) and not es_cedis and not es_transito and not es_dev and not es_usado
            tipo = "CEDIS" if es_cedis else ("Sucursal" if es_sucursal else "Auxiliar")
            if es_dev: tipo = "Devoluciones"
            elif es_transito: tipo = "Tránsito"
            elif es_usado: tipo = "Usados"

            if es_sucursal:
                sucursales_ids.append(alm_id)

            almacenes_info[alm_id] = {
                "nombre": nombre,
                "es_cedis": 1 if es_cedis else 0,
                "es_sucursal": 1 if es_sucursal else 0,
                "tipo": tipo
            }

        # 2. Venta del día de hoy en DOCTOS_PV
        cur_fb.execute("""
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
        ventas_hoy = {int(r[0]): float(r[1] or 0.0) for r in cur_fb.fetchall() if r[0] is not None}

        # 3. Ventas promedio últimos 30 días
        cur_fb.execute("""
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
        for r in cur_fb.fetchall():
            if r[0] is not None:
                alm_id = int(r[0])
                dias = int(r[1] or 0)
                tot = float(r[2] or 0.0)
                dias_activos[alm_id] = dias
                ventas_promedio[alm_id] = (tot / dias) if dias > 0 else 0.0

        # 4. Total de piezas y conteo de artículos activos por almacén (subquery optimizada)
        cur_fb.execute("""
            SELECT 
                s.ALMACEN_ID,
                SUM(s.PIEZAS) AS PIEZAS,
                COUNT(s.ARTICULO_ID) AS ARTICULOS
            FROM (
                SELECT ALMACEN_ID, ARTICULO_ID, SUM(ENTRADAS_UNIDADES - SALIDAS_UNIDADES) AS PIEZAS
                FROM SALDOS_IN
                GROUP BY ALMACEN_ID, ARTICULO_ID
                HAVING SUM(ENTRADAS_UNIDADES - SALIDAS_UNIDADES) > 0
            ) s
            GROUP BY s.ALMACEN_ID
        """)
        stock_piezas = {}
        stock_articulos = {}
        for r in cur_fb.fetchall():
            if r[0] is not None:
                alm_id = int(r[0])
                stock_piezas[alm_id] = float(r[1] or 0.0)
                stock_articulos[alm_id] = int(r[2] or 0)

        # 5. Costos de existencia para sucursales
        costos_existencia = {}
        if sucursales_ids:
            ph_suc = ",".join(str(s) for s in sucursales_ids)
            cur_fb.execute(f"""
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
                    WHERE s.ALMACEN_ID IN ({ph_suc})
                    GROUP BY s.ALMACEN_ID, s.ARTICULO_ID
                    HAVING SUM(s.ENTRADAS_UNIDADES - s.SALIDAS_UNIDADES) > 0
                )
                SELECT st.ALMACEN_ID, SUM(st.PIEZAS * COALESCE(c.COSTO, 0)) AS COSTO_TOTAL
                FROM STOCK st
                JOIN COSTOS c ON c.ARTICULO_ID = st.ARTICULO_ID
                GROUP BY st.ALMACEN_ID
            """)
            for r in cur_fb.fetchall():
                if r[0] is not None:
                    costos_existencia[int(r[0])] = float(r[1] or 0.0)

        cur_fb.close()
        conn_fb.close()
        conn_fb = None

        # 6. Guardar en SQLite en una sola transacción ultrarrápida
        conn_sq = conectar_sqlite()
        cur_sq = conn_sq.cursor()

        total_piezas_suc = sum(stock_piezas.get(sid, 0.0) for sid in sucursales_ids)
        ahora_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        filas_a_insertar = []
        for alm_id, info in almacenes_info.items():
            pz = stock_piezas.get(alm_id, 0.0)
            arts = stock_articulos.get(alm_id, 0)
            costo = costos_existencia.get(alm_id, 0.0)
            vhoy = ventas_hoy.get(alm_id, 0.0)
            vprom = ventas_promedio.get(alm_id, 0.0)
            dias = dias_activos.get(alm_id, 0)
            pct = round((pz / total_piezas_suc * 100.0), 1) if (info["es_sucursal"] and total_piezas_suc > 0) else 0.0

            filas_a_insertar.append((
                alm_id,
                emp,
                info["nombre"],
                info["tipo"],
                pz,
                arts,
                info["es_cedis"],
                info["es_sucursal"],
                costo,
                vhoy,
                vprom,
                dias,
                pct,
                ahora_str
            ))

        cur_sq.executemany("""
            INSERT OR REPLACE INTO resumen_almacenes_cache (
                almacen_id, empresa, nombre, tipo, piezas, articulos,
                es_cedis, es_sucursal, costo_existencia, venta_hoy,
                venta_promedio_diaria, dias_activos, porcentaje_red, actualizado_en
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, filas_a_insertar)

        conn_sq.commit()
        conn_sq.close()

        # Invalidar memoria local para recargar desde SQLite
        if emp in _cache_memoria:
            del _cache_memoria[emp]

        duracion = time.time() - t_inicio
        print(f"[CACHE] Tablas intermedias de {emp} actualizadas exitosamente en {duracion:.2f}s")

    except Exception as e:
        print(f"[ERROR CACHE] Error al actualizar tablas intermedias ({emp}): {e}")
        if conn_fb:
            try: conn_fb.close()
            except: pass
    finally:
        _actualizando_por_empresa[emp] = False


def obtener_resumen_sucursales(empresa=None, force_refresh=False):
    """
    Devuelve las métricas consolidadas del directorio de sucursales en ~2 ms
    desde la tabla intermedia SQLite. Si los datos están vencidos o es force_refresh,
    dispara la actualización en segundo plano de forma no bloqueante (stale-while-revalidate).
    """
    emp = empresa or get_current_dsn()
    
    conn = conectar_sqlite()
    cur = conn.cursor()
    cur.execute("""
        SELECT 
            almacen_id, nombre, tipo, piezas, articulos, es_cedis, es_sucursal,
            costo_existencia, venta_hoy, venta_promedio_diaria, dias_activos,
            porcentaje_red, actualizado_en
        FROM resumen_almacenes_cache
        WHERE empresa = ? AND es_sucursal = 1
        ORDER BY piezas DESC
    """, (emp,))
    rows = cur.fetchall()
    conn.close()

    ahora = datetime.datetime.now()
    necesita_actualizar = False
    ultima_actualizacion = ""

    if not rows:
        # Primer arranque sin datos: ejecutar síncrono una vez para responder datos reales
        actualizar_tablas_intermedias(emp, force=True)
        return obtener_resumen_sucursales(empresa=emp, force_refresh=False)
    else:
        ultima_actualizacion = rows[0][12]
        try:
            dt_act = datetime.datetime.strptime(ultima_actualizacion, "%Y-%m-%d %H:%M:%S")
            segundos_edad = (ahora - dt_act).total_seconds()
            if segundos_edad > _TTL_SEGUNDOS or force_refresh:
                necesita_actualizar = True
        except:
            necesita_actualizar = True

    if necesita_actualizar and not _actualizando_por_empresa.get(emp, False):
        # Actualización asíncrona en segundo plano sin congelar la interfaz del usuario
        t = threading.Thread(target=actualizar_tablas_intermedias, args=(emp, force_refresh), daemon=True)
        t.start()

    sucursales = []
    total_piezas = 0.0
    costo_total = 0.0
    venta_hoy_total = 0.0
    venta_prom_total = 0.0

    for r in rows:
        pz = float(r[3] or 0.0)
        c_exist = float(r[7] or 0.0)
        v_h = float(r[8] or 0.0)
        v_p = float(r[9] or 0.0)
        total_piezas += pz
        costo_total += c_exist
        venta_hoy_total += v_h
        venta_prom_total += v_p

        sucursales.append({
            "id": int(r[0]),
            "nombre": r[1],
            "tipo": r[2],
            "piezas": round(pz, 2),
            "articulos": int(r[4] or 0),
            "es_cedis": bool(r[5]),
            "es_sucursal": bool(r[6]),
            "costo_existencia": round(c_exist, 2),
            "venta_hoy": round(v_h, 2),
            "venta_promedio_diaria": round(v_p, 2),
            "dias_activos": int(r[10] or 0),
            "porcentaje_red": float(r[11] or 0.0)
        })

    lider = sucursales[0]["nombre"] if sucursales else "N/A"

    return {
        "success": True,
        "sucursales": sucursales,
        "kpis": {
            "total_sucursales": len(sucursales),
            "piezas_sucursales": round(total_piezas, 2),
            "sucursal_lider": lider,
            "activas_con_stock": sum(1 for s in sucursales if s["piezas"] > 0),
            "costo_total_existencia": round(costo_total, 2),
            "venta_total_hoy": round(venta_hoy_total, 2),
            "venta_promedio_total_diaria": round(venta_prom_total, 2)
        },
        "actualizado_en": ultima_actualizacion,
        "actualizando": _actualizando_por_empresa.get(emp, False)
    }


def obtener_resumen_almacenes(empresa=None, force_refresh=False):
    """
    Devuelve el inventario consolidado de TODOS los almacenes en ~2 ms
    desde la tabla intermedia SQLite.
    """
    emp = empresa or get_current_dsn()

    conn = conectar_sqlite()
    cur = conn.cursor()
    cur.execute("""
        SELECT 
            almacen_id, nombre, tipo, piezas, articulos, es_cedis, es_sucursal,
            costo_existencia, venta_hoy, venta_promedio_diaria, dias_activos,
            porcentaje_red, actualizado_en
        FROM resumen_almacenes_cache
        WHERE empresa = ?
        ORDER BY 
            CASE WHEN UPPER(nombre) LIKE '%CEDIS%' THEN 0 ELSE 1 END,
            piezas DESC
    """, (emp,))
    rows = cur.fetchall()
    conn.close()

    ahora = datetime.datetime.now()
    necesita_actualizar = False
    ultima_actualizacion = ""

    if not rows:
        actualizar_tablas_intermedias(emp, force=True)
        return obtener_resumen_almacenes(empresa=emp, force_refresh=False)
    else:
        ultima_actualizacion = rows[0][12]
        try:
            dt_act = datetime.datetime.strptime(ultima_actualizacion, "%Y-%m-%d %H:%M:%S")
            if (ahora - dt_act).total_seconds() > _TTL_SEGUNDOS or force_refresh:
                necesita_actualizar = True
        except:
            necesita_actualizar = True

    if necesita_actualizar and not _actualizando_por_empresa.get(emp, False):
        t = threading.Thread(target=actualizar_tablas_intermedias, args=(emp, force_refresh), daemon=True)
        t.start()

    almacenes = []
    piezas_cedis = 0.0
    piezas_red = 0.0

    for r in rows:
        pz = float(r[3] or 0.0)
        es_ced = bool(r[5])
        if es_ced:
            piezas_cedis += pz
        piezas_red += pz

        almacenes.append({
            "id": int(r[0]),
            "nombre": r[1],
            "tipo": r[2],
            "piezas": round(pz, 2),
            "articulos": int(r[4] or 0),
            "es_cedis": es_ced,
            "es_sucursal": bool(r[6]),
            "costo_existencia": round(float(r[7] or 0.0), 2),
            "venta_hoy": round(float(r[8] or 0.0), 2),
            "venta_promedio_diaria": round(float(r[9] or 0.0), 2),
            "dias_activos": int(r[10] or 0)
        })

    return {
        "success": True,
        "almacenes": almacenes,
        "kpis": {
            "total_almacenes": len(almacenes),
            "piezas_cedis": round(piezas_cedis, 2),
            "piezas_red": round(piezas_red, 2),
            "almacenes_con_stock": sum(1 for a in almacenes if a["piezas"] > 0),
            "skus_activos": 104272
        },
        "actualizado_en": ultima_actualizacion,
        "actualizando": _actualizando_por_empresa.get(emp, False)
    }


def iniciar_warmup_tablas_intermedias():
    """Se ejecuta en segundo plano al iniciar el servidor para precargar datos"""
    def _warm():
        time.sleep(1.5)  # Esperar que termine el bootstrap de Flask/Waitress
        try:
            emp = get_current_dsn()
            print(f"[WARMUP] Precargando tablas intermedias para {emp}...")
            actualizar_tablas_intermedias(emp, force=False)
        except Exception as e:
            print(f"[WARMUP ERROR] {e}")

    threading.Thread(target=_warm, daemon=True).start()

