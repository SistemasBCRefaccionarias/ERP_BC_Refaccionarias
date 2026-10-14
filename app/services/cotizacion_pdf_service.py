import os
import html
import datetime
from reportlab.lib.pagesizes import letter
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib import colors

def generar_pdf_cotizacion(data, output_path):
    """
    Genera un documento PDF formal y profesional para cotizaciones de Punto de Venta.
    """
    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    doc = SimpleDocTemplate(
        output_path,
        pagesize=letter,
        rightMargin=36,
        leftMargin=36,
        topMargin=36,
        bottomMargin=36
    )

    styles = getSampleStyleSheet()

    # Estilos tipográficos
    bold_label = ParagraphStyle(
        'BoldLabel', parent=styles['Normal'],
        fontName='Helvetica-Bold', fontSize=8.5, leading=11, textColor=colors.HexColor('#1E293B')
    )
    cell_style = ParagraphStyle(
        'Cell', parent=styles['Normal'],
        fontName='Helvetica', fontSize=8, leading=10.5, textColor=colors.HexColor('#1E293B')
    )
    cell_bold = ParagraphStyle(
        'CellBold', parent=styles['Normal'],
        fontName='Helvetica-Bold', fontSize=8, leading=10.5, textColor=colors.HexColor('#0F172A')
    )
    cell_right = ParagraphStyle(
        'CellRight', parent=styles['Normal'],
        fontName='Helvetica', fontSize=8, leading=10.5, alignment=2, textColor=colors.HexColor('#1E293B')
    )
    cell_right_bold = ParagraphStyle(
        'CellRightBold', parent=styles['Normal'],
        fontName='Helvetica-Bold', fontSize=8.5, leading=11, alignment=2, textColor=colors.HexColor('#0F172A')
    )
    header_cell = ParagraphStyle(
        'HCell', parent=styles['Normal'],
        fontName='Helvetica-Bold', fontSize=8, leading=10, textColor=colors.white
    )
    header_cell_right = ParagraphStyle(
        'HCellR', parent=styles['Normal'],
        fontName='Helvetica-Bold', fontSize=8, leading=10, alignment=2, textColor=colors.white
    )

    story = []

    # Datos generales con sanitizado HTML
    folio = html.escape(str(data.get('folio') or f"COT-{datetime.datetime.now().strftime('%Y%m%d-%H%M%S')}"))
    fecha_str = html.escape(str(data.get('fecha') or datetime.datetime.now().strftime('%Y-%m-%d %H:%M')))
    cliente_nom = html.escape(str(data.get('cliente_nombre') or 'PÚBLICO EN GENERAL').upper())
    tipo_cliente = html.escape(str(data.get('tipo_cliente') or 'Público General'))
    telefono = html.escape(str(data.get('telefono') or '-'))
    sucursal = html.escape(str(data.get('sucursal_nombre') or 'CEDIS Matriz'))
    vendedor = html.escape(str(data.get('vendedor_nombre') or 'Vendedor Mostrador'))
    entrega = html.escape(str(data.get('tipo_entrega') or 'Entrega en Tienda'))
    direccion_envio = html.escape(str(data.get('direccion_envio') or '').strip())
    observaciones = html.escape(str(data.get('observaciones') or '').strip())

    # Encabezado corporativo
    header_data = [
        [
            Paragraph("<b><font size=14 color='#0F172A'>BC REFACCIONARIAS</font></b><br/><font size=8 color='#64748B'>Baterías y Componentes de La Laguna S.A. de C.V.<br/>Especialistas en Baterías, Suspensión y Refacciones Automotrices</font>", styles['Normal']),
            Paragraph(f"<font size=12 color='#0284C7'><b>COTIZACIÓN FORMAL</b></font><br/><b>Folio:</b> {folio}<br/><b>Fecha:</b> {fecha_str}<br/><b>Vigencia:</b> 5 días hábiles", ParagraphStyle('R', parent=styles['Normal'], alignment=2, fontSize=8, leading=11))
        ]
    ]
    h_tab = Table(header_data, colWidths=[330, 210])
    h_tab.setStyle(TableStyle([
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('BOTTOMPADDING', (0,0), (-1,-1), 6),
    ]))
    story.append(h_tab)
    story.append(Spacer(1, 6))

    # Tarjeta de Datos Cliente y Sucursal
    datos_cliente_html = f"<b>Cliente:</b> {cliente_nom}<br/><b>Tipo:</b> {tipo_cliente}<br/><b>Teléfono:</b> {telefono}<br/><b>Modalidad:</b> {entrega}"
    if direccion_envio:
        datos_cliente_html += f"<br/><b>Dirección Envío:</b> {direccion_envio}"

    meta_data = [
        [
            Paragraph("<b>DATOS DEL CLIENTE</b>", bold_label),
            Paragraph("<b>DATOS DE VENTA Y SUCURSAL</b>", bold_label)
        ],
        [
            Paragraph(datos_cliente_html, cell_style),
            Paragraph(f"<b>Sucursal:</b> {sucursal}<br/><b>Atendido por:</b> {vendedor}<br/><b>Lista de Precios:</b> {tipo_cliente}", cell_style)
        ]
    ]
    meta_tab = Table(meta_data, colWidths=[270, 270])
    meta_tab.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#F1F5F9')),
        ('BACKGROUND', (0,1), (-1,1), colors.HexColor('#F8FAFC')),
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('BOX', (0,0), (-1,-1), 1, colors.HexColor('#CBD5E1')),
        ('INNERGRID', (0,0), (-1,-1), 0.5, colors.HexColor('#E2E8F0')),
        ('TOPPADDING', (0,0), (-1,-1), 4),
        ('BOTTOMPADDING', (0,0), (-1,-1), 4),
        ('LEFTPADDING', (0,0), (-1,-1), 6),
        ('RIGHTPADDING', (0,0), (-1,-1), 6),
    ]))
    story.append(meta_tab)
    story.append(Spacer(1, 10))

    # Partidas
    items_header = [
        Paragraph("#", header_cell),
        Paragraph("Clave", header_cell),
        Paragraph("Descripción", header_cell),
        Paragraph("Clasif", header_cell),
        Paragraph("Cant", header_cell_right),
        Paragraph("P. Unitario", header_cell_right),
        Paragraph("Desc", header_cell_right),
        Paragraph("Importe", header_cell_right)
    ]
    items_rows = [items_header]

    partidas = data.get('partidas', [])
    subtotal_bruto = 0.0
    descuento_total = 0.0

    for idx, it in enumerate(partidas, 1):
        cant = float(it.get('cantidad', 1) or 1)
        prec = float(it.get('precio', 0) or 0)
        desc_pct = float(it.get('descuento_pct', 0) or 0)
        clasif = html.escape(str(it.get('clasificacion', '') or '-').strip())
        clv = html.escape(str(it.get('clave', '')).strip())
        nom = html.escape(str(it.get('nombre', '')).strip())

        imp_bruto = cant * prec
        imp_desc = imp_bruto * (desc_pct / 100.0)
        imp_neto = imp_bruto - imp_desc

        subtotal_bruto += imp_bruto
        descuento_total += imp_desc

        items_rows.append([
            Paragraph(str(idx), cell_style),
            Paragraph(clv, cell_bold),
            Paragraph(nom, cell_style),
            Paragraph(clasif, cell_style),
            Paragraph(f"{cant:.0f}" if cant.is_integer() else f"{cant:.2f}", cell_right),
            Paragraph(f"${prec:,.2f}", cell_right),
            Paragraph(f"{desc_pct:.0f}%" if desc_pct > 0 else "-", cell_right),
            Paragraph(f"${imp_neto:,.2f}", cell_right_bold)
        ])

    items_tab = Table(items_rows, colWidths=[20, 65, 205, 30, 35, 60, 45, 80])
    items_tab.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#1E293B')),
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
        ('GRID', (0,0), (-1,-1), 0.5, colors.HexColor('#E2E8F0')),
        ('TOPPADDING', (0,0), (-1,-1), 4),
        ('BOTTOMPADDING', (0,0), (-1,-1), 4),
        ('LEFTPADDING', (0,0), (-1,-1), 4),
        ('RIGHTPADDING', (0,0), (-1,-1), 4),
        ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.white, colors.HexColor('#F8FAFC')])
    ]))
    story.append(items_tab)
    story.append(Spacer(1, 8))

    # Totales y Condiciones
    total_neto = max(0.0, subtotal_bruto - descuento_total)
    iva_val = total_neto - (total_neto / 1.16)
    sub_sin_iva = total_neto - iva_val

    obs_html = f"<br/><b>Notas:</b> {observaciones}" if observaciones else ""

    terms_p = Paragraph(f"""
        <b>Términos y Condiciones:</b><br/>
        • Precios expresados en Moneda Nacional (MXN) con IVA (16%) incluido.<br/>
        • Cotización válida por 5 días hábiles a partir de su emisión sujeta a existencias físicas.<br/>
        • No representa apartado de mercancía ni orden de compra hasta su confirmación o pago.<br/>
        • Para compras por WhatsApp o traslados entre sucursales, contáctanos indicando este folio.{obs_html}
    """, ParagraphStyle('Cond', parent=styles['Normal'], fontSize=7.5, leading=10, textColor=colors.HexColor('#475569')))

    totals_table_data = [
        [Paragraph("Subtotal sin IVA:", cell_style), Paragraph(f"${sub_sin_iva:,.2f}", cell_right)],
    ]
    if descuento_total > 0:
        totals_table_data.append([Paragraph("Ahorro / Descuento:", cell_style), Paragraph(f"-${descuento_total:,.2f}", cell_right)])
    totals_table_data.extend([
        [Paragraph("IVA (16%):", cell_style), Paragraph(f"${iva_val:,.2f}", cell_right)],
        [Paragraph("<b>TOTAL A PAGAR:</b>", ParagraphStyle('TotL', parent=cell_bold, fontSize=10, textColor=colors.HexColor('#047857'))), 
         Paragraph(f"<b>${total_neto:,.2f}</b>", ParagraphStyle('TotR', parent=cell_right_bold, fontSize=10.5, textColor=colors.HexColor('#047857')))]
    ])

    tot_sub_tab = Table(totals_table_data, colWidths=[110, 85])
    tot_sub_tab.setStyle(TableStyle([
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
        ('TOPPADDING', (0,0), (-1,-1), 2),
        ('BOTTOMPADDING', (0,0), (-1,-1), 2),
    ]))

    totals_tab = Table([[terms_p, tot_sub_tab]], colWidths=[345, 195])
    totals_tab.setStyle(TableStyle([
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
    ]))
    story.append(totals_tab)

    doc.build(story)
    return total_neto
