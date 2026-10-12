/**
 * Módulo Ventas ERP BC Refaccionarias
 * Consulta detallada de ventas, tickets de punto de venta y partidas vendidas por sucursal.
 */

let ventasDataCache = null;
let ventasSucursalesCache = null;
let ventasSucursalesCacheTs = 0;
const VENTAS_SUCURSALES_TTL = 300000; // 5 minutos

// Helpers seguros para formateo de números y moneda
function formatearMoneda(val) {
    if (val === null || val === undefined || isNaN(val)) return '$0.00';
    return '$' + Number(val).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatearNumero(val) {
    if (val === null || val === undefined || isNaN(val)) return '0';
    return Number(val).toLocaleString('es-MX');
}

async function cargarModuloVentas() {
    // 1. Inicializar fechas por defecto a HOY si están vacías
    const hoy = new Date().toISOString().split('T')[0];
    const fIni = document.getElementById('fechaIniVentas');
    const fFin = document.getElementById('fechaFinVentas');
    if (fIni && !fIni.value) fIni.value = hoy;
    if (fFin && !fFin.value) fFin.value = hoy;

    // 2. Cargar listado de sucursales en el selector
    await cargarSelectAlmacenesVentas();

    // 3. Ejecutar consultas con los filtros seleccionados (en paralelo)
    await Promise.allSettled([
        cargarIndicadoresVentasHoy(),
        consultarResumenVentas(), 
        buscarTicketsVentas()
    ]);
}

async function cargarIndicadoresVentasHoy() {
    const selAlm = document.getElementById('selectSucursalVentas');
    const almId = selAlm ? selAlm.value : '';
    try {
        const query = almId ? `?almacen_id=${encodeURIComponent(almId)}` : '';
        const res = await fetch(`/api/ventas/indicadores-hoy${query}`);
        const data = await res.json();
        if (data.success && data.indicadores) {
            const ind = data.indicadores;
            const elHoy = document.getElementById('kpiVentasHoyTotal');
            const elTcks = document.getElementById('kpiVentasHoyTickets');
            const elProm = document.getElementById('kpiVentasHoyPromedio');
            const elDif = document.getElementById('kpiVentasHoyDif');
            const elAyer = document.getElementById('kpiVentasAyerTotal');
            const elAyerTcks = document.getElementById('kpiVentasAyerTickets');

            if (elHoy) elHoy.textContent = formatearMoneda(ind.total_hoy);
            if (elTcks) elTcks.textContent = formatearNumero(ind.tickets_hoy);
            if (elProm) elProm.textContent = formatearMoneda(ind.ticket_promedio);
            if (elAyer) elAyer.textContent = formatearMoneda(ind.total_ayer);
            if (elAyerTcks) elAyerTcks.textContent = `${formatearNumero(ind.tickets_ayer)} tickets cerrados`;

            if (elDif) {
                const varPct = ind.variacion_pct || 0;
                if (varPct >= 0) {
                    elDif.className = "text-[10px] font-bold text-emerald-600 mt-0.5";
                    elDif.textContent = `vs ayer: +${varPct}%`;
                } else {
                    elDif.className = "text-[10px] font-bold text-rose-600 mt-0.5";
                    elDif.textContent = `vs ayer: ${varPct}%`;
                }
            }
        }
    } catch (e) {
        console.error("Error al cargar indicadores de ventas de hoy:", e);
    }
}

async function cargarSelectAlmacenesVentas() {
    const sel = document.getElementById('selectSucursalVentas');
    if (!sel) return;

    try {
        let sucursales = null;
        const ahora = Date.now();
        if (ventasSucursalesCache && (ahora - ventasSucursalesCacheTs) < VENTAS_SUCURSALES_TTL) {
            sucursales = ventasSucursalesCache;
        } else {
            // Intentar primero desde el endpoint de sucursales de ventas
            try {
                const res = await fetch('/api/ventas/sucursales');
                if (res.ok) {
                    const data = await res.json();
                    if (data.success && (data.sucursales || data.almacenes)) {
                        sucursales = data.sucursales || data.almacenes;
                    }
                }
            } catch (e1) {
                console.warn("Aviso: /api/ventas/sucursales falló, reintentando catálogo:", e1);
            }

            // Si no obtuvo resultados, fallback a /api/catalogos/sucursales-vendedores
            if (!sucursales || sucursales.length === 0) {
                try {
                    const resCat = await fetch('/api/catalogos/sucursales-vendedores');
                    if (resCat.ok) {
                        const dataCat = await resCat.json();
                        if (dataCat.success && dataCat.sucursales) {
                            sucursales = dataCat.sucursales;
                        }
                    }
                } catch (e2) {
                    console.warn("Aviso: /api/catalogos/sucursales-vendedores falló:", e2);
                }
            }

            if (sucursales && sucursales.length > 0) {
                ventasSucursalesCache = sucursales;
                ventasSucursalesCacheTs = Date.now();
            }
        }

        const valorActual = sel.value;
        const u = (typeof currentUser !== 'undefined') ? currentUser : null;
        const esAdmin = u && (u.rol === 'ADMIN' || (Array.isArray(u.permisos) && u.permisos.includes('*')));

        let html = '<option value="">-- Todas las Sucursales (Consolidado) --</option>';
        if (sucursales && sucursales.length > 0) {
            sucursales.forEach(s => {
                html += `<option value="${s.id}">${s.nombre}</option>`;
            });
        }
        sel.innerHTML = html;

        // Mantener selección previa o aplicar la sucursal del usuario si no es admin
        if (valorActual) {
            sel.value = valorActual;
        } else if (u && u.sucursal_id && !esAdmin) {
            sel.value = String(u.sucursal_id);
        }
    } catch (e) {
        console.error("Error al cargar sucursales para ventas:", e);
        sel.innerHTML = '<option value="">-- Todas las Sucursales (Consolidado) --</option>';
    }
}

async function consultarResumenVentas() {
    const selAlm = document.getElementById('selectSucursalVentas');
    const fIni = document.getElementById('fechaIniVentas');
    const fFin = document.getElementById('fechaFinVentas');

    const almId = selAlm ? selAlm.value : '';
    const fechaIni = fIni ? fIni.value : '';
    const fechaFin = fFin ? fFin.value : '';

    try {
        const query = new URLSearchParams();
        if (almId) query.append('almacen_id', almId);
        if (fechaIni) query.append('fecha_inicio', fechaIni);
        if (fechaFin) query.append('fecha_final', fechaFin);

        const res = await fetch(`/api/ventas/resumen-sucursal?${query.toString()}`);
        const data = await res.json();

        if (data.success) {
            const r = data.resumen || {};
            const elTot = document.getElementById('ventasResumenTotal');
            const elTcks = document.getElementById('ventasResumenTickets');
            const elProm = document.getElementById('ventasResumenPromedio');

            if (elTot) elTot.textContent = formatearMoneda(r.total_venta || 0);
            if (elTcks) elTcks.textContent = formatearNumero(r.tickets || 0);
            if (elProm) elProm.textContent = formatearMoneda(r.ticket_promedio || 0);

            renderizarTopArticulosVentas(data.top_articulos);
        }
    } catch (e) {
        console.error("Error al consultar resumen ventas:", e);
    }
}

function renderizarTopArticulosVentas(items) {
    const tbody = document.getElementById('tbodyTopVentasSucursal');
    if (!tbody) return;

    if (!items || items.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" class="py-6 text-center text-slate-400">Sin ventas en el período.</td></tr>`;
        return;
    }

    tbody.innerHTML = items.map((it) => `
        <tr class="hover:bg-slate-50 transition border-b border-slate-100 last:border-0 text-xs">
            <td class="py-2.5 px-3 font-mono font-bold text-slate-700">${it.clave}</td>
            <td class="py-2.5 px-3 font-semibold text-slate-800 truncate max-w-xs" title="${it.nombre}">${it.nombre}</td>
            <td class="py-2.5 px-3 text-right font-black text-emerald-700">${formatearNumero(it.piezas)} pzas</td>
            <td class="py-2.5 px-3 text-right font-black text-slate-900">${formatearMoneda(it.importe)}</td>
        </tr>
    `).join('');
}

let ticketsVentasCache = [];
let ticketsFiltradosVentas = [];
let ordenActualVentas = 'monto_desc';

async function buscarTicketsVentas() {
    const selAlm = document.getElementById('selectSucursalVentas');
    const fIni = document.getElementById('fechaIniVentas');
    const fFin = document.getElementById('fechaFinVentas');
    const txtFolio = document.getElementById('buscarFolioTicket');
    const selTipo = document.getElementById('selectTipoDocVentas');
    const selEstatus = document.getElementById('selectEstatusVentas');
    const txtMontoMin = document.getElementById('filtroMontoMinVentas');
    const txtMontoMax = document.getElementById('filtroMontoMaxVentas');
    const selLimite = document.getElementById('selectLimiteTickets');

    const almId = selAlm ? selAlm.value : '';
    const fechaIni = fIni ? fIni.value : '';
    const fechaFin = fFin ? fFin.value : '';
    const busqueda = txtFolio ? txtFolio.value.trim() : '';
    const tipo = selTipo ? selTipo.value : 'TODOS';
    const estatus = selEstatus ? selEstatus.value : 'VIGENTES';
    const montoMin = txtMontoMin ? txtMontoMin.value.trim() : '';
    const montoMax = txtMontoMax ? txtMontoMax.value.trim() : '';
    const limite = selLimite ? selLimite.value : '200';

    const query = new URLSearchParams();
    if (almId) query.append('almacen_id', almId);
    if (fechaIni) query.append('fecha_inicio', fechaIni);
    if (fechaFin) query.append('fecha_final', fechaFin);
    if (busqueda) query.append('busqueda', busqueda);
    if (tipo && tipo !== 'TODOS') query.append('tipo', tipo);
    if (estatus && estatus !== 'TODOS') query.append('estatus', estatus);
    if (montoMin) query.append('monto_min', montoMin);
    if (montoMax) query.append('monto_max', montoMax);
    if (limite) query.append('limite', limite);
    query.append('orden', ordenActualVentas);

    const tbody = document.getElementById('tbodyTicketsVenta');
    const subtitulo = document.getElementById('subtituloTicketsContador');
    if (tbody) {
        tbody.innerHTML = `<tr><td colspan="8" class="py-12 text-center text-slate-400 font-medium"><div class="inline-flex items-center gap-2"><svg class="w-4 h-4 animate-spin text-emerald-600" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path></svg> Cargando tickets desde base de datos...</div></td></tr>`;
    }
    if (subtitulo) subtitulo.textContent = 'Consultando registros...';

    try {
        const res = await fetch(`/api/ventas/tickets?${query.toString()}`);
        const data = await res.json();

        if (!data.success) {
            throw new Error(data.error || 'Error al obtener tickets');
        }

        ticketsVentasCache = data.tickets || [];
        ticketsFiltradosVentas = [...ticketsVentasCache];

        // Actualizar KPIs de la cabecera
        if (data.resumen) {
            const r = data.resumen;
            const elTot = document.getElementById('ventasResumenTotal');
            const elTcks = document.getElementById('ventasResumenTickets');
            const elProm = document.getElementById('ventasResumenPromedio');
            const elMax = document.getElementById('ventasResumenTicketMax');

            if (elTot) elTot.textContent = formatearMoneda(r.suma_total);
            if (elTcks) elTcks.textContent = `${formatearNumero(r.total_tickets)} (${r.tickets_vigentes} vigentes)`;
            if (elProm) elProm.textContent = formatearMoneda(r.promedio);
            if (elMax) elMax.textContent = formatearMoneda(r.max_ticket);
        }

        actualizarEstiloBotonesOrden();
        renderizarTablaTickets(ticketsFiltradosVentas);

    } catch (e) {
        console.error("Error al buscar tickets:", e);
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="8" class="py-8 text-center text-rose-500 font-bold">Error al cargar tickets: ${e.message}</td></tr>`;
        }
        if (subtitulo) subtitulo.textContent = 'Error en la consulta.';
    }
}

function cambiarOrdenTickets(nuevoOrden) {
    ordenActualVentas = nuevoOrden;
    actualizarEstiloBotonesOrden();

    if (ticketsVentasCache && ticketsVentasCache.length > 0) {
        // Ordenar instantáneamente en memoria
        ordenarListaTickets(ticketsFiltradosVentas, nuevoOrden);
        renderizarTablaTickets(ticketsFiltradosVentas);
    } else {
        buscarTicketsVentas();
    }
}

function ordenarListaTickets(lista, orden) {
    if (!Array.isArray(lista)) return;
    if (orden === 'monto_desc') {
        lista.sort((a, b) => (b.total || 0) - (a.total || 0));
    } else if (orden === 'monto_asc') {
        lista.sort((a, b) => (a.total || 0) - (b.total || 0));
    } else if (orden === 'reciente') {
        lista.sort((a, b) => {
            const d1 = `${a.fecha || ''} ${a.hora || ''}`;
            const d2 = `${b.fecha || ''} ${b.hora || ''}`;
            return d2.localeCompare(d1);
        });
    } else if (orden === 'antiguo') {
        lista.sort((a, b) => {
            const d1 = `${a.fecha || ''} ${a.hora || ''}`;
            const d2 = `${b.fecha || ''} ${b.hora || ''}`;
            return d1.localeCompare(d2);
        });
    } else if (orden === 'folio') {
        lista.sort((a, b) => (a.folio || '').localeCompare(b.folio || ''));
    }
}

function actualizarEstiloBotonesOrden() {
    const mapa = {
        'monto_desc': 'btnOrdenMontoDesc',
        'reciente': 'btnOrdenReciente',
        'monto_asc': 'btnOrdenMontoAsc',
        'antiguo': 'btnOrdenAntiguo'
    };

    Object.keys(mapa).forEach(k => {
        const btn = document.getElementById(mapa[k]);
        if (!btn) return;
        if (k === ordenActualVentas) {
            btn.className = 'btn-orden-ticket inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-black transition cursor-pointer border border-emerald-400 bg-emerald-50 text-emerald-800 shadow-xs ring-2 ring-emerald-200';
        } else {
            btn.className = 'btn-orden-ticket inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer border border-slate-200 bg-white text-slate-600 hover:bg-slate-50';
        }
    });
}

function filtrarTicketsLocalmente() {
    const txt = document.getElementById('buscarFolioTicket');
    const term = txt ? txt.value.trim().toLowerCase() : '';

    if (!term) {
        ticketsFiltradosVentas = [...ticketsVentasCache];
    } else {
        ticketsFiltradosVentas = ticketsVentasCache.filter(t => {
            const folio = (t.folio || '').toLowerCase();
            const cliente = (t.cliente || '').toLowerCase();
            const vendedor = (t.vendedor || '').toLowerCase();
            const sucursal = (t.sucursal || '').toLowerCase();
            return folio.includes(term) || cliente.includes(term) || vendedor.includes(term) || sucursal.includes(term);
        });
    }

    ordenarListaTickets(ticketsFiltradosVentas, ordenActualVentas);
    renderizarTablaTickets(ticketsFiltradosVentas);
}

function aplicarChipMonto(minimo) {
    const txtMin = document.getElementById('filtroMontoMinVentas');
    if (txtMin) {
        txtMin.value = minimo > 0 ? minimo : '';
    }

    // Estilizar chips
    document.querySelectorAll('.chip-monto-btn').forEach(btn => {
        const txt = btn.textContent.trim();
        const coincide = (minimo === 0 && txt === 'Todos') || (minimo > 0 && txt.includes(minimo.toLocaleString('es-MX')));
        if (coincide) {
            btn.className = 'chip-monto-btn px-2.5 py-1 text-[11px] font-black rounded-lg border border-emerald-300 bg-emerald-100 text-emerald-800 shadow-xs';
        } else {
            btn.className = 'chip-monto-btn px-2.5 py-1 text-[11px] font-bold rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 transition cursor-pointer';
        }
    });

    buscarTicketsVentas();
}

function limpiarFiltrosTickets() {
    const hoy = new Date().toISOString().split('T')[0];
    const fIni = document.getElementById('fechaIniVentas');
    const fFin = document.getElementById('fechaFinVentas');
    const txtFolio = document.getElementById('buscarFolioTicket');
    const selTipo = document.getElementById('selectTipoDocVentas');
    const selEstatus = document.getElementById('selectEstatusVentas');
    const txtMontoMin = document.getElementById('filtroMontoMinVentas');
    const txtMontoMax = document.getElementById('filtroMontoMaxVentas');
    const selLimite = document.getElementById('selectLimiteTickets');

    if (fIni) fIni.value = hoy;
    if (fFin) fFin.value = hoy;
    if (txtFolio) txtFolio.value = '';
    if (selTipo) selTipo.value = 'TODOS';
    if (selEstatus) selEstatus.value = 'VIGENTES';
    if (txtMontoMin) txtMontoMin.value = '';
    if (txtMontoMax) txtMontoMax.value = '';
    if (selLimite) selLimite.value = '200';

    ordenActualVentas = 'monto_desc';
    aplicarChipMonto(0);
}

function renderizarTablaTickets(tickets) {
    const tbody = document.getElementById('tbodyTicketsVenta');
    const subtitulo = document.getElementById('subtituloTicketsContador');
    if (!tbody) return;

    if (!tickets || tickets.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="py-12 text-center text-slate-400 font-medium">No se encontraron tickets con los filtros actuales.<br><span class="text-xs text-slate-400">Intente ampliar el rango de fechas o limpiar los filtros.</span></td></tr>`;
        if (subtitulo) subtitulo.textContent = '0 tickets encontrados';
        return;
    }

    const sumaVisibles = tickets.filter(t => !t.cancelado).reduce((acc, t) => acc + (t.total || 0), 0);
    const vigentesCount = tickets.filter(t => !t.cancelado).length;
    if (subtitulo) {
        subtitulo.innerHTML = `Mostrando <strong class="text-slate-800">${tickets.length} tickets</strong> (${vigentesCount} vigentes) — Suma: <strong class="text-emerald-700">${formatearMoneda(sumaVisibles)}</strong>`;
    }

    const medallas = ['🥇', '🥈', '🥉'];
    const esOrdenMontoDesc = (ordenActualVentas === 'monto_desc');

    tbody.innerHTML = tickets.map((t, idx) => {
        const esCancelado = t.cancelado || t.estatus === 'C';
        const badgeTipo = esCancelado 
            ? '<span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-black bg-rose-100 text-rose-700">Cancelado</span>'
            : (t.tipo === 'Factura'
                ? '<span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-black bg-purple-100 text-purple-700">Factura</span>'
                : '<span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-black bg-emerald-100 text-emerald-700">Ticket</span>');

        // Medalla / Ranking
        let rankHtml = '';
        if (esOrdenMontoDesc && !esCancelado && idx < 3) {
            rankHtml = `<span class="text-base" title="Top ${idx + 1} Ticket Más Alto">${medallas[idx]}</span>`;
        } else {
            rankHtml = `<span class="text-xs font-bold text-slate-400">#${idx + 1}</span>`;
        }

        // Resaltado de Total
        const esTopTicket = esOrdenMontoDesc && !esCancelado && idx === 0;
        const totalClase = esCancelado 
            ? 'line-through text-slate-400' 
            : (esTopTicket ? 'text-emerald-700 font-black text-sm bg-emerald-50 px-2 py-0.5 rounded-lg border border-emerald-200' : 'text-slate-900 font-black text-xs');

        const vendedorSub = t.vendedor ? `<div class="text-[10px] text-slate-400 font-medium truncate max-w-xs">Vend: ${t.vendedor}</div>` : '';

        return `
        <tr class="hover:bg-slate-50/80 transition border-b border-slate-100 text-xs ${esCancelado ? 'opacity-60 bg-rose-50/20' : ''}">
            <td class="py-3 px-3 text-center">
                ${rankHtml}
            </td>
            <td class="py-3 px-3 font-mono font-black text-red-600 whitespace-nowrap">
                ${t.folio}
            </td>
            <td class="py-3 px-3 text-slate-600 whitespace-nowrap">
                <div class="font-bold text-slate-700">${t.fecha}</div>
                <div class="text-[10px] text-slate-400">${t.hora}</div>
            </td>
            <td class="py-3 px-3 font-semibold text-slate-800 whitespace-nowrap">
                ${t.sucursal}
            </td>
            <td class="py-3 px-3">
                <div class="font-bold text-slate-800 truncate max-w-xs md:max-w-sm" title="${t.cliente || 'Público General'}">
                    ${t.cliente || 'Público General'}
                </div>
                ${vendedorSub}
            </td>
            <td class="py-3 px-3 text-center whitespace-nowrap">
                ${badgeTipo}
            </td>
            <td class="py-3 px-3 text-right whitespace-nowrap">
                <span class="${totalClase}">
                    ${formatearMoneda(t.total)}
                </span>
            </td>
            <td class="py-3 px-3 text-center whitespace-nowrap">
                <button type="button" onclick="verDetalleTicket(${t.id}, '${t.folio}')" class="px-2.5 py-1 text-[11px] font-bold text-blue-600 hover:text-white hover:bg-blue-600 rounded-lg border border-blue-200 transition cursor-pointer">
                    Ver Partidas
                </button>
            </td>
        </tr>
    `}).join('');
}

function exportarTicketsCSV() {
    const lista = ticketsFiltradosVentas || ticketsVentasCache;
    if (!lista || lista.length === 0) {
        alert("No hay tickets en la lista para exportar.");
        return;
    }

    const headers = ["Folio", "Fecha", "Hora", "Sucursal", "Cliente", "Vendedor", "Tipo", "Estatus", "Total"];
    const rows = lista.map(t => [
        `"${(t.folio || '').replace(/"/g, '""')}"`,
        `"${t.fecha || ''}"`,
        `"${t.hora || ''}"`,
        `"${(t.sucursal || '').replace(/"/g, '""')}"`,
        `"${(t.cliente || '').replace(/"/g, '""')}"`,
        `"${(t.vendedor || '').replace(/"/g, '""')}"`,
        `"${t.tipo || ''}"`,
        `"${t.cancelado ? 'Cancelado' : 'Vigente'}"`,
        (t.total || 0).toFixed(2)
    ]);

    const csvContent = "\uFEFF" + [headers.join(","), ...rows.map(e => e.join(","))].join("\r\n");
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const fechaStr = new Date().toISOString().split('T')[0];
    a.setAttribute("href", url);
    a.setAttribute("download", `reporte_historial_tickets_${fechaStr}.csv`);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

async function verDetalleTicket(doctoId, folio) {
    const modal = document.getElementById('modalDetalleTicket');
    const titulo = document.getElementById('modalDetalleTicketTitulo');
    const tbody = document.getElementById('tbodyPartidasTicket');

    if (titulo) titulo.textContent = `Detalle del Ticket / Factura: ${folio}`;
    if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="py-6 text-center text-slate-400">Cargando partidas...</td></tr>`;
    if (modal) modal.classList.remove('hidden');

    try {
        const res = await fetch(`/api/ventas/detalle-ticket/${doctoId}`);
        const data = await res.json();

        if (data.success && tbody) {
            let totalAcum = 0;
            tbody.innerHTML = data.partidas.map((p, idx) => {
                totalAcum += p.total;
                return `
                    <tr class="hover:bg-slate-50 border-b border-slate-100 text-xs">
                        <td class="py-2.5 px-3 text-slate-400 text-center font-bold">#${idx + 1}</td>
                        <td class="py-2.5 px-3 font-mono font-bold text-slate-800">${p.clave}</td>
                        <td class="py-2.5 px-3 font-semibold text-slate-800">${p.articulo}</td>
                        <td class="py-2.5 px-3 text-right font-bold text-slate-700">${p.unidades}</td>
                        <td class="py-2.5 px-3 text-right font-semibold text-slate-600">${formatearMoneda(p.precio_unitario)}</td>
                        <td class="py-2.5 px-3 text-right font-black text-slate-900">${formatearMoneda(p.total)}</td>
                    </tr>
                `;
            }).join('');

            const elTotal = document.getElementById('modalDetalleTicketTotal');
            if (elTotal) elTotal.textContent = formatearMoneda(totalAcum);
        }
    } catch (e) {
        console.error("Error al ver detalle ticket:", e);
    }
}

function cerrarModalDetalleTicket() {
    const modal = document.getElementById('modalDetalleTicket');
    if (modal) modal.classList.add('hidden');
}
