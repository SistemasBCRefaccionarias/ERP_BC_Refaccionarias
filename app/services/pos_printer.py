import os
import socket
import time
import unicodedata
import ctypes
from ctypes import wintypes
import datetime
import threading

class DOC_INFO_1_PRN(ctypes.Structure):
    _fields_ = [
        ("pDocName", wintypes.LPWSTR),
        ("pOutputFile", wintypes.LPWSTR),
        ("pDatatype", wintypes.LPWSTR)
    ]

def quitar_acentos(texto):
    if not texto:
        return ""
    reemplazos = {
        'á': 'a', 'é': 'e', 'í': 'i', 'ó': 'o', 'ú': 'u', 'ü': 'u',
        'Á': 'A', 'É': 'E', 'Í': 'I', 'Ó': 'O', 'Ú': 'U', 'Ü': 'U',
        'ñ': 'n', 'Ñ': 'N',
    }
    t = "".join(reemplazos.get(c, c) for c in str(texto))
    return unicodedata.normalize('NFKD', t).encode('ascii', 'ignore').decode('ascii')

def desglosar_folio(folio):
    import re
    s = str(folio or '').strip().upper()
    m = re.match(r'^([A-Z\-_]*?)(\d+)$', s)
    if m:
        letras = m.group(1)
        num_str = m.group(2)
        return letras, int(num_str), num_str
    return s, None, None

def folio_para_microsip_db(folio):
    letras, num_val, num_str = desglosar_folio(folio)
    if num_str:
        s_val = str(num_val)
        ceros = max(0, 9 - len(letras) - len(s_val))
        return f"{letras}{'0' * ceros}{s_val}"
    return str(folio or '').strip().upper()[:9]

def folio_para_codigo_barras(folio):
    return folio_para_microsip_db(folio)


def generar_ticket_traspaso_bytes(empresa_nombre, folio, now_dt, nombre_origen, nombre_destino, concepto_nombre, descripcion, partidas):
    esc = b'\x1b'
    gs = b'\x1d'

    empresa_nombre = quitar_acentos(empresa_nombre)
    nombre_origen = quitar_acentos(nombre_origen)
    nombre_destino = quitar_acentos(nombre_destino)
    concepto_nombre = quitar_acentos(concepto_nombre)
    descripcion = quitar_acentos(descripcion)

    b = esc + b'@'

    # 1. Almacen Destino (Centrado, Grande y Negrita)
    b += esc + b'a\x01'
    b += esc + b'!\x38'
    b += f"{nombre_destino}\n".encode('ascii', 'replace')
    b += esc + b'!\x00'

    # 2. Razon Social Empresa
    b += esc + b'E\x01'
    b += f"{empresa_nombre}\n".encode('ascii', 'replace')
    b += esc + b'E\x00'

    # 3. Datos de Concepto y Almacenes
    b += esc + b'a\x00'
    con_txt = concepto_nombre if concepto_nombre else "Traspaso (Salida)"
    b += f"Concepto: {con_txt}\n".encode('ascii', 'replace')
    b += f"Del almacen: {nombre_origen}\n".encode('ascii', 'replace')
    b += f"Al Almacen: {nombre_destino}\n".encode('ascii', 'replace')
    if descripcion:
        b += f"Notas: {descripcion[:38]}\n".encode('ascii', 'replace')

    # 4. Caja Fecha | Hora | Folio
    folio_display = quitar_acentos(folio_para_microsip_db(folio))
    meses = ["ene.", "feb.", "mar.", "abr.", "may.", "jun.", "jul.", "ago.", "sep.", "oct.", "nov.", "dic."]
    fecha_fmt = f"{now_dt.day:02d}/{meses[now_dt.month-1]}/{now_dt.year}"
    hora_fmt = now_dt.strftime("%H:%M")

    b += b"+--------------------+-------+-----------------+\n"
    b += b"| Fecha              | Hora  | Folio           |\n"
    b += f"| {fecha_fmt:<18} | {hora_fmt:<5} | {folio_display:<15} |\n".encode('ascii', 'replace')
    b += b"+--------------------+-------+-----------------+\n"

    # 5. Tabla de Partidas
    b += b"+------------+----------------------------+----+\n"
    b += b"| CLAVE      | ARTICULO                   | U. |\n"
    b += b"+------------+----------------------------+----+\n"

    for p in partidas:
        cant = float(p.get('cantidad', 0))
        clave = quitar_acentos(p.get('clave', '')).strip()
        nombre = quitar_acentos(p.get('nombre', '')).strip()
        loc = quitar_acentos(p.get('localizacion', '')).strip()

        words_desc = nombre.split(' ')
        lines_desc = []
        cur_d = ""
        for wd in words_desc:
            if not cur_d:
                cur_d = wd
            elif len(cur_d) + 1 + len(wd) <= 26:
                cur_d += " " + wd
            else:
                lines_desc.append(cur_d)
                cur_d = wd
        if cur_d:
            lines_desc.append(cur_d)

        if loc:
            lines_desc.append(f">> UBIC: {loc.upper()}"[:26])
        else:
            lines_desc.append(">> UBIC: (SIN ASIGNAR)"[:26])

        words_c = clave.split(' ')
        lines_clave = []
        cur_c = ""
        for wc in words_c:
            if not cur_c:
                cur_c = wc
            elif len(cur_c) + 1 + len(wc) <= 10:
                cur_c += " " + wc
            else:
                lines_clave.append(cur_c)
                cur_c = wc
        if cur_c:
            lines_clave.append(cur_c)

        cant_str = f"{int(cant)}" if cant.is_integer() else f"{cant:.1f}"
        max_rows = max(len(lines_desc), len(lines_clave), 1)

        for i in range(max_rows):
            c_text = lines_clave[i] if i < len(lines_clave) else ""
            d_text = lines_desc[i] if i < len(lines_desc) else ""
            u_text = cant_str if i == 0 else ""
            line_str = f"| {c_text:<10} | {d_text:<26} | {u_text:>2} |\n"
            b += line_str.encode('ascii', 'replace')

        b += b"+------------+----------------------------+----+\n"

    # 6. Cuadro de Firmas
    b += esc + b'a\x01'
    b += b"\n\n"
    b += b"         ______________________________         \n"
    b += b"             Nombre y Firma Entrega             \n"
    b += b"\n\n"
    b += b"         ______________________________         \n"
    b += b"             Nombre y Firma Recibe              \n"
    b += b"\n"

    # 7. Fecha de Impresion
    fecha_impr = now_dt.strftime("%d/%m/%Y %I:%M %p").replace("AM", "a. m.").replace("PM", "p. m.")
    b += f"Fecha de Impresion: {fecha_impr}\n\n".encode('ascii', 'replace')

    # 8. Codigo de Barras 1D del Folio
    folio_clean = "".join(ch for ch in folio_display if ch.isalnum() or ch in "-_").upper()
    if folio_clean:
        b += esc + b'a\x01'
        b += gs + b'h\x46'
        b += gs + b'w\x02'
        b += gs + b'H\x02'
        b += gs + b'f\x00'
        code128_data = b'{B' + folio_clean.encode('ascii', 'replace')
        b += gs + b'k\x49' + bytes([len(code128_data)]) + code128_data

    # 9. Avance de papel y Corte automatico
    b += b"\n\n\n\n\n"
    b += gs + b'V\x00'
    return b

def _enviar_raw_a_spooler(ticket_bytes, printer_name, doc_title="Ticket Traspaso CEDIS"):
    try:
        winspool = ctypes.WinDLL('winspool.drv')
        winspool.OpenPrinterW.argtypes = [wintypes.LPWSTR, ctypes.POINTER(wintypes.HANDLE), ctypes.c_void_p]
        winspool.OpenPrinterW.restype = wintypes.BOOL
        winspool.StartDocPrinterW.argtypes = [wintypes.HANDLE, wintypes.DWORD, ctypes.POINTER(DOC_INFO_1_PRN)]
        winspool.StartDocPrinterW.restype = wintypes.DWORD
        winspool.StartPagePrinter.argtypes = [wintypes.HANDLE]
        winspool.StartPagePrinter.restype = wintypes.BOOL
        winspool.WritePrinter.argtypes = [wintypes.HANDLE, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(wintypes.DWORD)]
        winspool.WritePrinter.restype = wintypes.BOOL
        winspool.EndPagePrinter.argtypes = [wintypes.HANDLE]
        winspool.EndPagePrinter.restype = wintypes.BOOL
        winspool.EndDocPrinter.argtypes = [wintypes.HANDLE]
        winspool.EndDocPrinter.restype = wintypes.BOOL
        winspool.ClosePrinter.argtypes = [wintypes.HANDLE]
        winspool.ClosePrinter.restype = wintypes.BOOL

        hPrinter = wintypes.HANDLE()
        if winspool.OpenPrinterW(printer_name, ctypes.byref(hPrinter), None):
            try:
                doc_info = DOC_INFO_1_PRN()
                doc_info.pDocName = doc_title
                doc_info.pOutputFile = None
                doc_info.pDatatype = "RAW"
                job_id = winspool.StartDocPrinterW(hPrinter, 1, ctypes.byref(doc_info))
                if job_id > 0:
                    winspool.StartPagePrinter(hPrinter)
                    bytes_written = wintypes.DWORD()
                    winspool.WritePrinter(hPrinter, ticket_bytes, len(ticket_bytes), ctypes.byref(bytes_written))
                    winspool.EndPagePrinter(hPrinter)
                    winspool.EndDocPrinter(hPrinter)
                    return True, f"Trabajo #{job_id}"
                else:
                    return False, "Spooler StartDocPrinterW retorno 0"
            finally:
                winspool.ClosePrinter(hPrinter)
        else:
            return False, f"No se pudo abrir la impresora '{printer_name}' en Windows"
    except Exception as e_spool:
        return False, f"Spooler error: {e_spool}"

_HISTORIAL_IMPRESIONES_FOLIO = {}
_HISTORIAL_LOCK = threading.Lock()
DEDUP_WINDOW_SECONDS = 15

def imprimir_ticket_pos80(ticket_bytes, printer_name="POS-80C", copias=2, folio=None, forzar=False):
    """
    Envía la impresión del ticket a la impresora térmica POS-80C (192.168.1.225:9100).
    Por defecto imprime 2 tickets (Original y Copia).
    Incluye protección de deduplicación automática si se solicita reimpresión
    del mismo folio en menos de 15 segundos sin confirmación explícita (forzar=True).
    """
    if folio:
        folio_norm = str(folio).strip().upper()
        now_ts = time.time()
        with _HISTORIAL_LOCK:
            ultimo_ts = _HISTORIAL_IMPRESIONES_FOLIO.get(folio_norm, 0)
            delta = now_ts - ultimo_ts
            if not forzar and delta < DEDUP_WINDOW_SECONDS:
                msg_dedup = f"Ticket de folio {folio_norm} ya enviado a POS-80C recientemente ({int(delta)}s atrás). Se evitó duplicado accidental."
                print(f"[{datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] [POS-80C] Deduplicación: {msg_dedup}")
                return True, msg_dedup
            _HISTORIAL_IMPRESIONES_FOLIO[folio_norm] = now_ts

    errores = []
    num_copias = max(1, int(copias or 2))
    folio_txt = f" (Folio: {folio})" if folio else ""
    print(f"[{datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] [POS-80C] Procesando impresión térmica{folio_txt} - {num_copias} ticket(s)...")

    # 1. Intento vía Windows Spooler nativo
    try:
        trabajos_ok = []
        for c in range(1, num_copias + 1):
            doc_title = "Ticket Traspaso CEDIS" if num_copias == 1 else f"Ticket Traspaso CEDIS (Copia {c}/{num_copias})"
            ok_spool, msg_spool = _enviar_raw_a_spooler(ticket_bytes, printer_name, doc_title)
            if ok_spool:
                trabajos_ok.append(msg_spool)
            else:
                errores.append(f"Copia {c}: {msg_spool}")
            if c < num_copias:
                time.sleep(0.6)
        
        if len(trabajos_ok) == num_copias:
            copias_txt = "2 tickets (Original y Copia)" if num_copias == 2 else (f"1 ticket" if num_copias == 1 else f"{num_copias} tickets")
            msg_ok = f"Ticket impreso correctamente ({copias_txt}) en '{printer_name}' ({', '.join(trabajos_ok)})"
            print(f"[{datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] [POS-80C] Spooler OK: {msg_ok}")
            return True, msg_ok
        elif len(trabajos_ok) > 0:
            msg_part = f"Ticket impreso parcialmente ({len(trabajos_ok)}/{num_copias} tickets) en '{printer_name}'"
            print(f"[{datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] [POS-80C] Spooler parcial: {msg_part}")
            return True, msg_part
    except Exception as e_spool:
        errores.append(f"Spooler error general: {e_spool}")

    # 2. Intento de respaldo vía Socket directo a IP 192.168.1.225:9100
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(3.0)
        s.connect(('192.168.1.225', 9100))
        for c in range(1, num_copias + 1):
            s.sendall(ticket_bytes)
            if c < num_copias:
                time.sleep(0.6)
        s.close()
        copias_txt = "2 tickets (Original y Copia)" if num_copias == 2 else (f"1 ticket" if num_copias == 1 else f"{num_copias} tickets")
        msg_sock = f"Ticket impreso correctamente ({copias_txt}) vía IP directa 192.168.1.225:9100 (POS-80C)"
        print(f"[{datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] [POS-80C] Socket IP OK: {msg_sock}")
        return True, msg_sock
    except Exception as e_sock:
        errores.append(f"Socket IP error: {e_sock}")
        print(f"[{datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] [POS-80C] Error en socket directo 192.168.1.225: {e_sock}")

    return False, " / ".join(errores)

def logo_a_tspl_bitmap(logo_path, max_width=270, max_height=95, x=245, y=28):
    """
    Convierte una imagen de logo PNG/JPG a un comando BITMAP monocromático de TSPL.
    """
    if not os.path.exists(logo_path):
        return b''
    try:
        from PIL import Image
        im = Image.open(logo_path)
        if im.mode in ('RGBA', 'LA') or (im.mode == 'P' and 'transparency' in im.info):
            bg = Image.new('RGB', im.size, (255, 255, 255))
            if im.mode == 'RGBA':
                bg.paste(im, mask=im.split()[3])
            else:
                bg.paste(im)
            im = bg
        else:
            im = im.convert('RGB')
        im.thumbnail((max_width, max_height), Image.Resampling.LANCZOS)
        w, h = im.size
        w_bytes = (w + 7) // 8
        w_pad = w_bytes * 8
        if w_pad != w:
            padded = Image.new('RGB', (w_pad, h), (255, 255, 255))
            padded.paste(im, ((w_pad - w) // 2, 0))
            im = padded
            w = w_pad
        # 0 = punto negro térmico quemado, 1 = punto blanco
        im_bw = im.convert('L').point(lambda p: 0 if p < 170 else 1, mode='1')
        raw_data = im_bw.tobytes()
        return f"BITMAP {x}, {y}, {w_bytes}, {h}, 0, ".encode('ascii') + raw_data + b"\r\n"
    except Exception as e:
        print("Aviso al procesar logo para TSPL:", e)
        return b''

def generar_etiqueta_tspl_bytes(etiqueta_data):
    """
    Genera el stream de comandos TSPL para la impresora térmica Label TD-401.
    Ajustado específicamente al ancho de rollo de 75-76mm (560 dots de ancho útil)
    para evitar recortes en bordes, con inclusión de LOGO gráfico y separación limpia de Folio y Fecha.
    """
    from app.config import BASE_DIR
    siglas = quitar_acentos(etiqueta_data.get('sucursal_siglas', 'AE')).strip().upper()[:4]
    destino = quitar_acentos(etiqueta_data.get('destino', 'SUCURSAL DESTINO')).strip().upper()[:24]
    empresa = quitar_acentos(etiqueta_data.get('nombre_empresa', 'BATTERY CENTER')).strip().upper()[:24]
    folio = quitar_acentos(etiqueta_data.get('folio_caja', '10001-1')).strip().upper()[:16]
    fecha = str(etiqueta_data.get('fecha_empaque', '') or etiqueta_data.get('fecha_hora', '') or '')[:10]
    articulos = etiqueta_data.get('detalles', []) or etiqueta_data.get('resumen_articulos', [])
    num_caja = etiqueta_data.get('numero_caja', 1)
    tot_cajas = etiqueta_data.get('total_cajas', 1)
    logo_tag = str(etiqueta_data.get('logo_tag', '')).lower()
    es_rt = 'RT' in empresa.upper() or 'rt' in logo_tag

    # 1. Configuración de rollo 75mm x 120mm
    tspl = "SIZE 75 mm, 120 mm\r\n"
    tspl += "GAP 3 mm, 0 mm\r\n"
    tspl += "DIRECTION 1\r\n"
    tspl += "CLS\r\n"

    # Marco exterior: ancho útil 544 dots (de X=16 a X=560)
    tspl += "BOX 16, 16, 560, 960, 4\r\n"

    # División horizontal superior (Y = 280)
    tspl += "BAR 16, 280, 544, 4\r\n"

    # División vertical superior (X = 230, de Y = 16 a Y = 280)
    tspl += "BAR 230, 16, 4, 264\r\n"

    # --- CUADRANTE SUPERIOR IZQUIERDO: SIGLAS DESTINO ---
    # Siglas gigantes (Font 5 escala 3x3)
    tspl += f'TEXT 35, 35, "5", 0, 3, 3, "{siglas}"\r\n'
    tspl += 'TEXT 25, 180, "1", 0, 1, 1, "DESTINO SUCURSAL:"\r\n'
    tspl += f'TEXT 25, 205, "2", 0, 1, 1, "{destino[:16]}"\r\n'
    tspl += f'TEXT 25, 238, "2", 0, 1, 1, "CAJA {num_caja} DE {tot_cajas}"\r\n'

    # --- CUADRANTE SUPERIOR DERECHO: LOGO + DATOS FISCALES ---
    # División interna entre logo y datos empresa (Y = 135)
    tspl += "BAR 230, 135, 330, 3\r\n"

    # Procesar archivo de logo oficial
    logo_filename = "logo rt.png" if es_rt else "logo bc.png"
    logo_path = os.path.join(BASE_DIR, logo_filename)
    logo_bytes = logo_a_tspl_bitmap(logo_path, max_width=270, max_height=95, x=245, y=28)

    # Si no se pudo cargar el archivo gráfico, poner texto de respaldo
    if not logo_bytes:
        tspl += f'TEXT 250, 45, "3", 0, 1, 1, "{empresa[:18]}"\r\n'
        tspl += 'TEXT 250, 85, "2", 0, 1, 1, "REFACCIONARIAS"\r\n'

    # Datos fiscales
    empresa_sub = "RT REFACCIONES" if es_rt else "BATTERY CENTER REFACC."
    tspl += f'TEXT 245, 148, "2", 0, 1, 1, "{empresa_sub[:24]}"\r\n'
    tspl += 'TEXT 245, 178, "2", 0, 1, 1, "CEDIS Matriz Torreon, Coah."\r\n'
    tspl += 'TEXT 245, 208, "2", 0, 1, 1, "RFC: BCR210815AAA"\r\n'
    tspl += f'TEXT 245, 238, "1", 0, 1, 1, "EMPAQUE: {fecha}"\r\n'

    # --- SECCIÓN MEDIA: ARTÍCULOS SIN CANTIDAD ---
    tspl += 'TEXT 25, 296, "2", 0, 1, 1, "ARTICULOS - CODIGOS Y DESCRIPCION"\r\n'
    tspl += 'TEXT 425, 300, "1", 0, 1, 1, "(SIN CANTID.)"\r\n'
    tspl += "BAR 25, 322, 520, 2\r\n"

    # Listado de artículos ajustados a 2 columnas con espacio holgado
    y_art = 336
    for art in articulos[:10]:
        c_clave = quitar_acentos(art.get('clave', ''))[:11]
        c_nom = quitar_acentos(art.get('nombre', ''))[:28]
        tspl += f'TEXT 25, {y_art}, "2", 0, 1, 1, "{c_clave:<11} {c_nom}"\r\n'
        y_art += 26

    # --- RECUADRO DE FOLIO Y FECHA (SIN ENCIMARSE) ---
    tspl += "BOX 25, 620, 551, 710, 2\r\n"
    tspl += f'TEXT 35, 634, "3", 0, 1, 1, "FOLIO: {folio}"\r\n'
    tspl += f'TEXT 335, 638, "2", 0, 1, 1, "FECHA: {fecha}"\r\n'
    tspl += f'TEXT 35, 676, "2", 0, 1, 1, "CEDIS -> {siglas} ({destino[:22]})"\r\n'

    # --- SECCIÓN DE CÓDIGO DE BARRAS ---
    tspl += "BAR 16, 720, 544, 4\r\n"
    tspl += f'BARCODE 140, 742, "128", 110, 1, 0, 2, 4, "{folio}"\r\n'
    tspl += 'TEXT 170, 895, "2", 0, 1, 1, "CODIGO DE BARRAS DE CAJA"\r\n'

    tspl += "PRINT 1, 1\r\n"

    # Ensamblar bytes inyectando el bitmap si existe
    if logo_bytes:
        parts = tspl.split("BAR 230, 135, 330, 3\r\n")
        res = parts[0].encode('latin1', 'replace') + b"BAR 230, 135, 330, 3\r\n" + logo_bytes + parts[1].encode('latin1', 'replace')
        return res
    else:
        return tspl.encode('latin1', 'replace')

def logo_a_zpl_gf(image_path, max_w=280, max_h=75):
    """
    Convierte una imagen (PNG/JPG) a comando ^GF (Graphic Field) en formato ASCII Hexadecimal para ZPL.
    En ZPL: bit 1 = punto negro quemado, 0 = blanco.
    """
    if not image_path or not os.path.exists(image_path):
        return ''
    try:
        from PIL import Image
        im = Image.open(image_path)
        if im.mode in ('RGBA', 'LA') or (im.mode == 'P' and 'transparency' in im.info):
            bg = Image.new('RGB', im.size, (255, 255, 255))
            if im.mode == 'RGBA':
                bg.paste(im, mask=im.split()[3])
            else:
                bg.paste(im)
            im = bg
        else:
            im = im.convert('RGB')
        im.thumbnail((max_w, max_h), Image.Resampling.LANCZOS)
        w, h = im.size
        bytes_per_row = (w + 7) // 8
        w_pad = bytes_per_row * 8
        if w_pad != w:
            padded = Image.new('RGB', (w_pad, h), (255, 255, 255))
            padded.paste(im, ((w_pad - w) // 2, 0))
            im = padded
            w = w_pad
        # 1 = negro, 0 = blanco
        im_bw = im.convert('L').point(lambda p: 1 if p < 170 else 0, mode='1')
        raw_bytes = im_bw.tobytes()
        hex_str = raw_bytes.hex().upper()
        total_bytes = len(raw_bytes)
        return f"^GFA,{total_bytes},{total_bytes},{bytes_per_row},{hex_str}"
    except Exception as e:
        print("Aviso al procesar logo para ZPL:", e)
        return ''

def generar_etiqueta_zpl_text(etiqueta_data):
    """
    Genera el formato ZPL para rollo completo de 10 cm x 15 cm (4" x 6", 800x1200 dots a 203 DPI).
    - Aprovecha el ancho (800 dots) y largo (1200 dots) completo del rollo térmico.
    - Siglas de sucursal gigantes, en negrita y perfectamente centradas.
    - Logo oficial de gran tamaño y datos fiscales con margen seguro antes del borde.
    - Listado de artículos en dos columnas amplias (clave y descripción completa sin cortes).
    - Recuadro de Folio y Fecha amplio, con fecha completa en su propia línea.
    - Código de barras grande (160 dots) y centrado, con folio visible debajo.
    """
    from app.config import BASE_DIR
    siglas = quitar_acentos(etiqueta_data.get('sucursal_siglas', 'AE')).strip().upper()[:4]
    destino = quitar_acentos(etiqueta_data.get('destino', 'SUCURSAL DESTINO')).strip().upper()[:28]
    empresa = quitar_acentos(etiqueta_data.get('nombre_empresa', 'BATTERY CENTER')).strip().upper()[:28]
    folio = quitar_acentos(etiqueta_data.get('folio_caja', '10001-1')).strip().upper()[:16]
    fecha = str(etiqueta_data.get('fecha_empaque', '') or etiqueta_data.get('fecha_hora', '') or '')[:10]
    articulos = etiqueta_data.get('detalles', []) or etiqueta_data.get('resumen_articulos', [])
    logo_tag = str(etiqueta_data.get('logo_tag', '')).lower()
    es_rt = 'RT' in empresa.upper() or 'rt' in logo_tag
    empresa_sub = "RT REFACCIONES" if es_rt else "BATTERY CENTER"

    # Logo oficial a tamaño completo para 10x15cm (hasta 380x110 dots)
    logo_filename = "logo rt.png" if es_rt else "logo bc.png"
    logo_path = os.path.join(BASE_DIR, logo_filename)
    logo_gf = logo_a_zpl_gf(logo_path, max_w=380, max_h=110)

    zpl = f"""^XA
^PW800
^LL1200
^FO25,25^GB750,1140,6^FS
^FO25,320^GB750,6,6^FS
^FO330,25^GB6,295,6^FS
^FO30,95^FB295,1,0,C^A0N,150,130^FD{siglas}^FS
"""

    if logo_gf:
        zpl += f"^FO365,35{logo_gf}^FS\n"
    else:
        zpl += f"^FO365,55^A0N,32,26^FD{empresa[:22]}^FS\n"

    dest_limpio = destino.replace("SUCURSAL", "").strip()
    ruta_txt = f"CEDIS -> {siglas} ({dest_limpio})".strip()[:30]

    zpl += f"""^FO330,160^GB445,4,4^FS
^FO360,175^A0N,26,20^FD{empresa_sub[:20]}^FS
^FO360,210^A0N,22,17^FDCEDIS Matriz Torreon^FS
^FO360,245^A0N,22,17^FDRFC: BCR210815AAA^FS
^FO360,280^A0N,22,17^FDEMPAQUE: {fecha}^FS
^FO40,338^A0N,28,24^FDARTICULOS^FS
^FO25,375^GB750,4,4^FS
"""

    y = 395
    for art in articulos[:10]:
        clv = quitar_acentos(art.get('clave', ''))[:12]
        nom = quitar_acentos(art.get('nombre', ''))[:28]
        zpl += f"^FO40,{y}^A0N,24,18^FD{clv}^FS\n"
        zpl += f"^FO260,{y}^A0N,24,17^FD{nom}^FS\n"
        y += 34

    zpl += f"""^FO40,750^GB720,125,4^FS
^FO60,765^A0N,36,28^FDFOLIO: {folio}^FS
^FO60,808^A0N,26,20^FDFECHA DE EMPAQUE: {fecha}^FS
^FO60,842^A0N,24,18^FD{ruta_txt}^FS
^FO25,895^GB750,6,6^FS
^FO150,930^BY3,3,160^BCN,160,Y,N,N^FD{folio}^FS
^XZ"""
    return zpl


def imprimir_etiqueta_td401(etiqueta_data, printer_name="Label TD-401", modo='ZPL'):
    """
    Envía la etiqueta directamente a la impresora térmica USB 'Label TD-401'.
    Soporta emulación nativa ZPL (por defecto) y TSPL a través del spooler RAW de Windows.
    """
    try:
        if str(modo).upper() == 'TSPL':
            raw_bytes = generar_etiqueta_tspl_bytes(etiqueta_data)
        else:
            raw_bytes = generar_etiqueta_zpl_text(etiqueta_data).encode('latin1', 'replace')
        doc_title = f"Etiqueta Caja {etiqueta_data.get('folio_caja', '')}"
        ok, msg = _enviar_raw_a_spooler(raw_bytes, printer_name, doc_title)
        return ok, msg
    except Exception as e:
        return False, f"Error al enviar a impresora '{printer_name}': {str(e)}"



