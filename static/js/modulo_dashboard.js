/**
 * Módulo Dashboard Ejecutivo ERP BC Refaccionarias
 * Visualización analítica de ventas, sucursales, existencias en almacén y mejores artículos.
 */

let chartVentasSucursales = null;
let chartTendenciaVentas = null;
let chartGruposVentas = null;
let dashboardDataCache = null;
let _dashboardAbortController = null;

function formatearMoneda(val) {
    return new Intl.NumberFormat('es-MX', {
        style: 'currency',
        currency: 'MXN',
        minimumFractionDigits: 2
    }).format(val || 0);
}

function formatearNumero(val) {
    return new Intl.NumberFormat('es-MX').format(Math.round(val || 0));
}

function paletaDeMarca() {
    if (typeof obtenerPaletaTema === 'function') return obtenerPaletaTema();
    return { primary: '#dc2626', hover: '#b91c1c', text: '#b91c1c', light: '#fef2f2', gris: '#94a3b8' };
}

function hexToRgb(hex) {
    hex = (hex || '#dc2626').replace('#', '');
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    const n = parseInt(hex, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mezclarBlanco(hex, t) {
    const [r, g, b] = hexToRgb(hex);
    const c = v => Math.round(v + (255 - v) * t);
    return `rgb(${c(r)}, ${c(g)}, ${c(b)})`;
}

function escalaDeMarca(base, pasos) {
    const n = Math.max(pasos || 8, 1);
    const escala = [];
    for (let i = 0; i < n; i++) {
        const t = n === 1 ? 0 : 0.85 * (i / (n - 1));
        escala.push(mezclarBlanco(base, t));
    }
    return escala;
}

function generarPaletaLineasCorporativa(hexBase) {
    const [r, g, b] = hexToRgb(hexBase);
    // Para el rojo institucional estándar de BC Refaccionarias:
    const esRojoBC = Math.abs(r - 220) < 40 && g < 75 && b < 75;
    if (esRojoBC) {
        return [
            hexBase,    // #1: Rojo BC insignia (Top 1)
            '#991b1b',  // #2: Borgoña oscuro
            '#ef4444',  // #3: Carmín vibrante
            '#7f1d1d',  // #4: Vino tinto profundo
            '#b91c1c',  // #5: Carmesí institucional
            '#f87171',  // #6: Coral claro
            '#450a0a',  // #7: Granate carbón
            '#1e293b',  // #8: Pizarra oscuro
            '#475569',  // #9: Pizarra medio
            '#94a3b8'   // #10: Gris neutro
        ];
    }
    // Para cualquier otro tema activo (tonos de la marca + neutros de alto contraste):
    return [
        hexBase,
        `rgb(${Math.round(r * 0.7)}, ${Math.round(g * 0.7)}, ${Math.round(b * 0.7)})`,
        `rgb(${Math.min(255, Math.round(r + (255 - r) * 0.25))}, ${Math.min(255, Math.round(g + (255 - g) * 0.25))}, ${Math.min(255, Math.round(b + (255 - b) * 0.25))})`,
        `rgb(${Math.round(r * 0.5)}, ${Math.round(g * 0.5)}, ${Math.round(b * 0.5)})`,
        `rgb(${Math.round(r * 0.85)}, ${Math.round(g * 0.85)}, ${Math.round(b * 0.85)})`,
        `rgb(${Math.min(255, Math.round(r + (255 - r) * 0.45))}, ${Math.min(255, Math.round(g + (255 - g) * 0.45))}, ${Math.min(255, Math.round(b + (255 - b) * 0.45))})`,
        `rgb(${Math.round(r * 0.35)}, ${Math.round(g * 0.35)}, ${Math.round(b * 0.35)})`,
        '#1e293b',
        '#475569',
        '#94a3b8'
    ];
}

async function cargarDashboard(periodo = 'mes_actual', esSilencioso = false) {
    const loader = document.getElementById('dashboardLoader');
    const content = document.getElementById('dashboardContent');
    const btnRefrescar = document.getElementById('btnRefrescarDashboard');
    const btnAplicar = document.getElementById('btnAplicarFechasDashboard');

    // Cancelar petición previa si existía para evitar acumulación de consultas en el servidor
    if (_dashboardAbortController) {
        _dashboardAbortController.abort();
    }
    _dashboardAbortController = new AbortController();
    const signal = _dashboardAbortController.signal;

    if (!esSilencioso) {
        if (loader) loader.classList.remove('hidden');
        if (content) content.classList.add('opacity-50');
    }
    if (btnRefrescar) btnRefrescar.classList.add('animate-spin');
    if (btnAplicar) {
        btnAplicar.disabled = true;
        btnAplicar.textContent = '⏳ Cargando...';
    }

    try {
        let url = `/api/dashboard/resumen?periodo=${encodeURIComponent(periodo)}`;
        if (periodo === 'personalizado') {
            const fIni = document.getElementById('dashFechaInicio')?.value || '';
            const fFin = document.getElementById('dashFechaFin')?.value || '';
            url += `&fecha_inicio=${encodeURIComponent(fIni)}&fecha_fin=${encodeURIComponent(fFin)}`;
        }

        const res = await fetch(url, { signal });
        const data = await res.json();

        if (!data.success) {
            throw new Error(data.error || "No se pudo cargar la información del dashboard");
        }

        dashboardDataCache = data;
        renderizarKPIs(data.kpis);
        renderizarGraficoVentas(data.ventas_sucursales);
        renderizarGraficoGrupos(data.ventas_grupos, data.kpis?.total_venta);
        renderizarGraficoTendencia(data.tendencia_ventas);
        renderizarTablaTopVendedores(data.top_vendedores);
        cambiarCriterioTopArticulos(criterioTopArticulosActual);
        renderizarTablaSucursales(data.ventas_sucursales);

        const badgeActualizado = document.getElementById('badgeUltimaActualizacion');
        if (badgeActualizado) {
            const ahora = new Date();
            badgeActualizado.textContent = esSilencioso 
                ? `Actualizado: ${ahora.toLocaleTimeString()} (Auto)` 
                : `Actualizado: ${ahora.toLocaleTimeString()}`;
        }

    } catch (err) {
        if (err.name === 'AbortError') {
            // Petición reemplazada por otra más reciente
            return;
        }
        console.error("Error al cargar dashboard:", err);
        if (!esSilencioso && typeof mostrarAlerta === 'function') {
            mostrarAlerta('danger', `Error al cargar indicadores: ${err.message}`, 4000);
        }
    } finally {
        if (loader) loader.classList.add('hidden');
        if (content) content.classList.remove('opacity-50');
        if (btnRefrescar) btnRefrescar.classList.remove('animate-spin');
        if (btnAplicar) {
            btnAplicar.disabled = false;
            btnAplicar.textContent = 'Aplicar';
        }
    }
}

function renderizarKPIs(kpis) {
    if (!kpis) return;

    // 1. Total Venta
    const elVenta = document.getElementById('kpiTotalVenta');
    const elTickets = document.getElementById('kpiTotalTickets');
    if (elVenta) elVenta.textContent = formatearMoneda(kpis.total_venta);
    if (elTickets) elTickets.textContent = `${formatearNumero(kpis.total_tickets)} tickets (Prom. ${formatearMoneda(kpis.ticket_promedio)})`;

    // 2. Utilidad de Venta (Margen Bruto)
    const elUtil = document.getElementById('kpiUtilidadVenta');
    const elMarg = document.getElementById('kpiMargenUtilidad');
    if (elUtil) elUtil.textContent = formatearMoneda(kpis.utilidad_venta);
    if (elMarg) elMarg.textContent = `Margen bruto: ${kpis.margen_utilidad_pct || 0}%`;

    // 3. Costo Total de Almacén (Valor de Inventario)
    const elCostoInv = document.getElementById('kpiCostoInventario');
    const elStock = document.getElementById('kpiTotalStock');
    if (elCostoInv) elCostoInv.textContent = formatearMoneda(kpis.costo_inventario_total);
    if (elStock) elStock.textContent = `${formatearNumero(kpis.total_stock_piezas)} pzas en stock`;

    // 4. Artículo Estrella
    const est = kpis.articulo_estrella || {};
    const elArtClave = document.getElementById('kpiArticuloClave');
    const elArtNombre = document.getElementById('kpiArticuloNombre');
    const elArtVenta = document.getElementById('kpiArticuloVenta');
    if (elArtClave) elArtClave.textContent = est.clave || "N/D";
    if (elArtNombre) elArtNombre.textContent = est.nombre || "Sin ventas";
    if (elArtVenta) elArtVenta.textContent = `${formatearNumero(est.piezas)} pzas (${formatearMoneda(est.importe)})`;

    // 5. Sucursal Líder
    const lid = kpis.sucursal_lider || {};
    const elSucNombre = document.getElementById('kpiSucursalLiderNombre');
    const elSucMonto = document.getElementById('kpiSucursalLiderMonto');
    if (elSucNombre) elSucNombre.textContent = lid.nombre || "N/D";
    if (elSucMonto) elSucMonto.textContent = formatearMoneda(lid.total);

    // 6. Mejor Cliente
    const cli = kpis.cliente_estrella || {};
    const elCliNombre = document.getElementById('kpiClienteNombre');
    const elCliVenta = document.getElementById('kpiClienteVenta');
    const elCliTickets = document.getElementById('kpiClienteTickets');
    if (elCliNombre) {
        elCliNombre.textContent = cli.nombre || "N/D";
        elCliNombre.title = cli.nombre || "";
    }
    if (elCliVenta) elCliVenta.textContent = formatearMoneda(cli.total);
    if (elCliTickets) elCliTickets.textContent = `${formatearNumero(cli.tickets)} tickets`;
}

function renderizarGraficoVentas(sucursales) {
    const canvas = document.getElementById('chartVentasCanvas');
    if (!canvas || typeof Chart === 'undefined') return;

    if (chartVentasSucursales) {
        chartVentasSucursales.destroy();
    }

    const labels = (sucursales || []).map(s => s.nombre.replace('Sucursal ', ''));
    const datos = (sucursales || []).map(s => s.total_venta);

    const ctx = canvas.getContext('2d');
    const paleta = paletaDeMarca();
    const maxVenta = Math.max(0, ...datos);
    const coloresBarras = datos.map(v => mezclarBlanco(paleta.primary, maxVenta > 0 ? 0.85 * (1 - v / maxVenta) : 0.85));
    chartVentasSucursales = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Ventas Netas ($)',
                data: datos,
                backgroundColor: coloresBarras,
                borderRadius: 8,
                borderSkipped: false
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            indexAxis: 'y', // Horizontal para mejor lectura de nombres de sucursal
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return ' Venta: ' + formatearMoneda(context.parsed.x);
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { color: '#f1f5f9' },
                    ticks: {
                        callback: function(value) {
                            return '$' + (value >= 1000000 ? (value / 1000000).toFixed(1) + 'M' : (value / 1000).toFixed(0) + 'k');
                        },
                        font: { size: 10, weight: 'bold' }
                    }
                },
                y: {
                    grid: { display: false },
                    ticks: { font: { size: 11, weight: '600' }, color: '#334155' }
                }
            }
        }
    });
}

function renderizarGraficoGrupos(grupos, totalVenta) {
    const canvas = document.getElementById('chartGruposCanvas');
    const tbody = document.getElementById('tbodyVentasGrupos');
    if (!canvas || typeof Chart === 'undefined') return;

    if (chartGruposVentas) {
        chartGruposVentas.destroy();
        chartGruposVentas = null;
    }

    const items = grupos || [];
    const total = items.reduce((acc, g) => acc + (g.total_venta || 0), 0);

    // Mapeo de colores coherente con las políticas de comisión
    const COLOR_MAP = {
        'MOSTRADORES': '#dc2626', // Rojo institucional
        'MAYOREO': '#2563eb',     // Azul
        'GONHER GO': '#f59e0b',   // Ámbar
        'SIN POLÍTICA': '#64748b' // Slate
    };
    const PALETA_FALLBACK = ['#dc2626', '#2563eb', '#f59e0b', '#10b981', '#8b5cf6', '#64748b'];

    const labels = items.map(g => g.grupo);
    const datos = items.map(g => g.total_venta);
    const colores = items.map((g, idx) => {
        const key = (g.grupo || '').trim().toUpperCase();
        return COLOR_MAP[key] || PALETA_FALLBACK[idx % PALETA_FALLBACK.length];
    });

    const ctx = canvas.getContext('2d');
    chartGruposVentas = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: datos,
                backgroundColor: colores,
                borderWidth: 2,
                borderColor: '#ffffff',
                hoverOffset: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '68%',
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        boxWidth: 10,
                        boxHeight: 10,
                        usePointStyle: true,
                        font: { size: 10, weight: '700' },
                        color: '#475569',
                        padding: 10
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(15, 23, 42, 0.92)',
                    titleFont: { size: 11, weight: 'bold' },
                    bodyFont: { size: 11 },
                    padding: 8,
                    cornerRadius: 8,
                    callbacks: {
                        label: function(context) {
                            const val = context.parsed;
                            const pct = total > 0 ? ((val / total) * 100).toFixed(1) : '0.0';
                            return ` ${context.label}: ${formatearMoneda(val)} (${pct}%)`;
                        }
                    }
                }
            }
        }
    });

    // Renderizar tabla resumida
    if (tbody) {
        if (items.length === 0) {
            tbody.innerHTML = `<tr><td colspan="3" class="py-4 text-center text-slate-400 font-medium">No hay ventas registradas</td></tr>`;
            return;
        }

        let html = items.map((g, idx) => {
            const color = colores[idx];
            return `
                <tr class="hover:bg-slate-50 transition-colors">
                    <td class="py-1.5 px-2 font-bold text-slate-800 flex items-center gap-1.5">
                        <span class="w-2.5 h-2.5 rounded-full shrink-0" style="background-color: ${color};"></span>
                        <span class="truncate">${g.grupo}</span>
                    </td>
                    <td class="py-1.5 px-2 text-right font-black text-slate-900 whitespace-nowrap">
                        ${formatearMoneda(g.total_venta)}
                    </td>
                    <td class="py-1.5 px-2 text-right font-bold text-slate-600 whitespace-nowrap">
                        ${g.porcentaje}%
                    </td>
                </tr>
            `;
        }).join('');

        // Fila Total
        html += `
            <tr class="bg-slate-50/80 font-black text-slate-900 border-t border-slate-200">
                <td class="py-1.5 px-2 uppercase text-[10px] text-slate-500">Total</td>
                <td class="py-1.5 px-2 text-right whitespace-nowrap">${formatearMoneda(total)}</td>
                <td class="py-1.5 px-2 text-right whitespace-nowrap">100.0%</td>
            </tr>
        `;
        tbody.innerHTML = html;
    }
}

function renderizarTablaTopVendedores(vendedores) {
    const tbody = document.getElementById('tbodyTopVendedores');
    if (!tbody) return;

    const items = vendedores || [];
    if (items.length === 0) {
        tbody.innerHTML = `<tr><td colspan="3" class="py-6 text-center text-slate-400 font-medium">Sin datos de vendedores</td></tr>`;
        return;
    }

    const BADGE_COLORS = {
        'MOSTRADORES': 'bg-rose-50 text-rose-700 border-rose-200',
        'MAYOREO': 'bg-blue-50 text-blue-700 border-blue-200',
        'GONHER GO': 'bg-amber-50 text-amber-800 border-amber-200'
    };

    tbody.innerHTML = items.map((v, idx) => {
        const key = (v.grupo || '').trim().toUpperCase();
        const badgeClass = BADGE_COLORS[key] || 'bg-slate-100 text-slate-700 border-slate-200';
        const cleanName = (v.nombre || '').replace(/^SUC\s+/i, '');

        return `
            <tr class="hover:bg-slate-50 transition-colors">
                <td class="py-2 px-2">
                    <div class="font-bold text-slate-900 text-xs truncate max-w-[150px]" title="${v.nombre}">
                        ${idx + 1}. ${cleanName}
                    </div>
                    <span class="inline-block px-1.5 py-0.2 text-[9px] font-black uppercase rounded border ${badgeClass}">
                        ${v.grupo}
                    </span>
                </td>
                <td class="py-2 px-2 text-right font-black text-slate-900 whitespace-nowrap">
                    ${formatearMoneda(v.total_venta)}
                </td>
                <td class="py-2 px-2 text-right text-xs font-semibold text-slate-500 whitespace-nowrap">
                    ${formatearNumero(v.tickets)}
                </td>
            </tr>
        `;
    }).join('');
}

function renderizarGraficoTendencia(tendencia) {
    const canvas = document.getElementById('chartTendenciaCanvas');
    if (!canvas || typeof Chart === 'undefined') return;

    if (chartTendenciaVentas) {
        chartTendenciaVentas.destroy();
        chartTendenciaVentas = null;
    }

    if (!tendencia) return;

    // Actualizar subtítulo y badge según la granularidad del período
    const elSubtitulo = document.getElementById('subtituloTendenciaVentas');
    if (elSubtitulo && tendencia.subtitulo) {
        elSubtitulo.textContent = tendencia.subtitulo;
    }
    const elBadge = document.getElementById('badgeGranularidadTendencia');
    if (elBadge && tendencia.badge) {
        elBadge.textContent = tendencia.badge;
    }

    // Paleta corporativa sobria monocromática empatada a las demás gráficas y tarjetas
    const paleta = paletaDeMarca();
    const COLORES_LINEAS = typeof generarPaletaLineasCorporativa === 'function'
        ? generarPaletaLineasCorporativa(paleta.primary)
        : [
            paleta.primary,      // #1: Primario de marca (Rojo oficial BC)
            '#991b1b',          // #2: Borgoña profundo
            '#ef4444',          // #3: Carmín vibrante
            '#7f1d1d',          // #4: Vino tinto intenso
            '#b91c1c',          // #5: Carmesí institucional
            '#f87171',          // #6: Coral claro
            '#450a0a',          // #7: Granate carbón
            '#1e293b',          // #8: Pizarra carbón neutro
            '#475569',          // #9: Pizarra medio
            '#94a3b8'           // #10: Gris neutro
        ];

    const sucursales = (tendencia.sucursales || []).slice(0, 10);
    const datasets = sucursales.map((suc, idx) => {
        const color = COLORES_LINEAS[idx % COLORES_LINEAS.length];
        const isDashed = idx >= 7;
        const cleanName = (suc.nombre || '').replace(/^Sucursal\s+/i, '');
        return {
            label: cleanName || suc.nombre,
            data: suc.valores || [],
            borderColor: color,
            backgroundColor: color,
            borderWidth: idx === 0 ? 3 : (idx < 5 ? 2.2 : 1.8),
            borderDash: isDashed ? [5, 4] : undefined,
            tension: 0.35,
            pointRadius: idx === 0 ? 4 : (idx < 5 ? 3 : 2.5),
            pointHoverRadius: 6,
            fill: false,
            // Todos los primeros 10 activos para que los nombres no se tachen ni se encimen
            hidden: false
        };
    });

    const ctx = canvas.getContext('2d');
    chartTendenciaVentas = new Chart(ctx, {
        type: 'line',
        data: {
            labels: tendencia.etiquetas || [],
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false
            },
            plugins: {
                legend: {
                    position: 'top',
                    align: 'center',
                    labels: {
                        boxWidth: 8,
                        boxHeight: 8,
                        usePointStyle: true,
                        pointStyle: 'circle',
                        font: { size: 10, weight: '700' },
                        color: '#475569',
                        padding: 10
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(15, 23, 42, 0.92)',
                    titleFont: { size: 12, weight: 'bold' },
                    bodyFont: { size: 11 },
                    padding: 10,
                    cornerRadius: 8,
                    callbacks: {
                        label: function(context) {
                            return ` ${context.dataset.label}: ${formatearMoneda(context.parsed.y)}`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { color: '#f1f5f9' },
                    ticks: {
                        font: { size: 10, weight: '600' },
                        color: '#64748b',
                        maxRotation: 45,
                        minRotation: 0
                    }
                },
                y: {
                    grid: { color: '#f1f5f9' },
                    ticks: {
                        callback: function(value) {
                            return '$' + (value >= 1000000 ? (value / 1000000).toFixed(1) + 'M' : (value >= 1000 ? (value / 1000).toFixed(0) + 'k' : value));
                        },
                        font: { size: 10, weight: 'bold' },
                        color: '#64748b'
                    }
                }
            }
        }
    });
}

let criterioTopArticulosActual = 'piezas';
let limiteTopArticulosActual = 15;

function cambiarLimiteTopArticulos(limite) {
    limiteTopArticulosActual = parseInt(limite, 10) || 15;
    const tit = document.getElementById('tituloTopArticulos');
    if (tit) {
        tit.innerHTML = `<span>🥇</span> Top ${limiteTopArticulosActual} Artículos Más Vendidos`;
    }
    cambiarCriterioTopArticulos(criterioTopArticulosActual);
}

function cambiarCriterioTopArticulos(criterio) {
    criterioTopArticulosActual = (criterio === 'importe') ? 'importe' : 'piezas';
    const btnPiezas = document.getElementById('btnTopCriterioPiezas');
    const btnImporte = document.getElementById('btnTopCriterioImporte');
    const thPiezas = document.getElementById('thTopPiezas');
    const thImporte = document.getElementById('thTopImporte');
    const subtitulo = document.getElementById('subtituloTopArticulos');

    // Botones de toggle
    const btnInactivo = 'px-3 py-1 rounded-lg text-xs font-black transition cursor-pointer text-slate-600 hover:text-slate-900';
    const btnActivo = 'px-3 py-1 rounded-lg text-xs font-black transition cursor-pointer btn-theme-primary text-white shadow-xs';
    if (btnPiezas) btnPiezas.className = (criterioTopArticulosActual === 'piezas') ? btnActivo : btnInactivo;
    if (btnImporte) btnImporte.className = (criterioTopArticulosActual === 'importe') ? btnActivo : btnInactivo;

    // Encabezados de tabla
    const thInactivo = 'text-slate-500 font-semibold';
    const thActivo = 'text-slate-900 font-black underline decoration-theme-primary decoration-2 underline-offset-4';
    if (thPiezas) thPiezas.className = (criterioTopArticulosActual === 'piezas') ? thActivo : thInactivo;
    if (thImporte) thImporte.className = (criterioTopArticulosActual === 'importe') ? thActivo : thInactivo;

    if (subtitulo) {
        if (criterioTopArticulosActual === 'importe') {
            subtitulo.innerHTML = `Productos con mayor facturación e importe neto en el período <span class="text-slate-400">· Margen prom: <strong id="badgeMargenTopArticulos" class="text-emerald-700 font-black">--%</strong></span>`;
        } else {
            subtitulo.innerHTML = `Productos con mayor rotación y piezas vendidas en el período <span class="text-slate-400">· Margen prom: <strong id="badgeMargenTopArticulos" class="text-emerald-700 font-black">--%</strong></span>`;
        }
    }

    if (dashboardDataCache) {
        let lista = [];
        if (criterio === 'importe') {
            if (dashboardDataCache.top_articulos_importe && dashboardDataCache.top_articulos_importe.length > 0) {
                lista = dashboardDataCache.top_articulos_importe;
            } else {
                lista = [...(dashboardDataCache.top_articulos || [])].sort((a, b) => (b.importe || 0) - (a.importe || 0));
            }
        } else if (criterio === 'margen') {
            if (dashboardDataCache.top_articulos_margen && dashboardDataCache.top_articulos_margen.length > 0) {
                lista = dashboardDataCache.top_articulos_margen;
            } else {
                lista = [...(dashboardDataCache.top_articulos || [])].sort((a, b) => ((b.margen_utilidad_pct || 0) - (a.margen_utilidad_pct || 0)));
            }
        } else {
            if (dashboardDataCache.top_articulos_piezas && dashboardDataCache.top_articulos_piezas.length > 0) {
                lista = dashboardDataCache.top_articulos_piezas;
            } else {
                lista = [...(dashboardDataCache.top_articulos || [])].sort((a, b) => (b.piezas || 0) - (a.piezas || 0));
            }
        }
        renderizarTablaTopArticulos(lista.slice(0, limiteTopArticulosActual));
    }
}

function renderizarTablaTopArticulos(articulos) {
    const tbody = document.getElementById('tbodyTopArticulos');
    if (!tbody) return;

    if (!articulos || articulos.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="py-8 text-center text-slate-400 font-medium">No hay datos de venta en este período.</td></tr>`;
        return;
    }

    // Calcular margen promedio ponderado de los artículos mostrados
    let totVta = 0;
    let totUt = 0;
    articulos.forEach(it => {
        totVta += (it.importe || 0);
        totUt += (it.utilidad || 0);
    });
    const promMargen = totVta > 0 ? (totUt / totVta * 100) : 0;
    const badgeMargenTop = document.getElementById('badgeMargenTopArticulos');
    if (badgeMargenTop) {
        badgeMargenTop.textContent = `${promMargen.toFixed(1)}%`;
    }

    const medallas = ['🥇', '🥈', '🥉'];
    const esPorImporte = (criterioTopArticulosActual === 'importe');
    const esPorMargen = (criterioTopArticulosActual === 'margen');

    tbody.innerHTML = articulos.map((item, idx) => {
        const medalla = idx < 3 ? `<span class="text-base">${medallas[idx]}</span>` : `<span class="text-xs font-bold text-slate-400 w-5 text-center">#${idx + 1}</span>`;
        
        const piezasHtml = (criterioTopArticulosActual === 'piezas')
            ? `<span class="inline-flex items-center gap-1 font-black text-xs text-theme-deep bg-theme-light px-2.5 py-0.5 rounded-full border border-theme-soft">${formatearNumero(item.piezas)} pzas</span>`
            : `<span class="font-bold text-xs text-slate-600">${formatearNumero(item.piezas)} pzas</span>`;

        const importeHtml = esPorImporte
            ? `<span class="inline-flex items-center gap-1 font-black text-xs text-theme-deep bg-theme-light px-2.5 py-0.5 rounded-full border border-theme-soft">${formatearMoneda(item.importe)}</span>`
            : `<span class="font-black text-slate-900 text-xs">${formatearMoneda(item.importe)}</span>`;

        const margen = typeof item.margen_utilidad_pct === 'number' ? item.margen_utilidad_pct : 0;
        const colorMargenClass = margen >= 35 
            ? 'text-emerald-700 bg-emerald-50 border-emerald-200' 
            : (margen >= 20 ? 'text-blue-700 bg-blue-50 border-blue-200' : (margen >= 10 ? 'text-amber-700 bg-amber-50 border-amber-200' : 'text-rose-700 bg-rose-50 border-rose-200'));

        const margenBadgeHtml = esPorMargen
            ? `<span class="inline-flex items-center gap-1 font-black text-xs text-theme-deep bg-theme-light px-2.5 py-0.5 rounded-full border border-theme-soft">${margen.toFixed(1)}%</span>`
            : `<span class="inline-flex items-center gap-1 font-black text-xs px-2 py-0.5 rounded-full border ${colorMargenClass}">${margen.toFixed(1)}%</span>`;

        return `
            <tr class="hover:bg-slate-50/80 transition-colors border-b border-slate-100 last:border-0">
                <td class="py-3 px-3 text-center">
                    ${medalla}
                </td>
                <td class="py-3 px-3">
                    <span class="font-mono font-black text-slate-800 text-xs bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                        ${item.clave}
                    </span>
                </td>
                <td class="py-3 px-3">
                    <div class="font-bold text-slate-800 text-xs truncate max-w-xs md:max-w-md" title="${item.nombre}">
                        ${item.nombre}
                    </div>
                </td>
                <td class="py-3 px-3 text-right whitespace-nowrap">
                    ${piezasHtml}
                </td>
                <td class="py-3 px-3 text-right whitespace-nowrap">
                    ${importeHtml}
                </td>
                <td class="py-3 px-3 text-right whitespace-nowrap">
                    <div class="flex flex-col items-end">
                        ${margenBadgeHtml}
                        ${item.utilidad ? `<span class="text-[10px] text-slate-400 font-semibold mt-0.5" title="Utilidad Bruta estimada">${formatearMoneda(item.utilidad)}</span>` : ''}
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

function renderizarTablaSucursales(sucursales) {
    const tbody = document.getElementById('tbodyResumenSucursales');
    if (!tbody) return;

    try {
        const lista = Array.isArray(sucursales) ? sucursales.filter(Boolean) : [];

        const badgeSuc = document.getElementById('badgeTotalSucursalesResumen');
        if (badgeSuc) {
            badgeSuc.textContent = `${lista.length} Sucursales`;
        }

        if (lista.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" class="py-8 text-center text-slate-400 font-medium">No se encontraron sucursales activas en este período.</td></tr>`;
            const badgeProm = document.getElementById('badgeMargenPromedioSucursales');
            if (badgeProm) badgeProm.textContent = 'Margen Prom: 0.0%';
            return;
        }

        // Calcular margen promedio ponderado global de las sucursales
        let totalVta = 0;
        let totalUt = 0;
        lista.forEach(s => {
            totalVta += Number(s?.total_venta || 0);
            totalUt += Number(s?.utilidad || 0);
        });

        const promMargenSuc = totalVta > 0 ? ((totalUt / totalVta) * 100) : 0;
        const badgePromMargen = document.getElementById('badgeMargenPromedioSucursales');
        if (badgePromMargen) {
            badgePromMargen.textContent = `Margen Prom: ${promMargenSuc.toFixed(1)}%`;
        }

        tbody.innerHTML = lista.map((suc, idx) => {
            const vta = Number(suc?.total_venta || 0);
            const ut = Number(suc?.utilidad || 0);
            const tcks = Number(suc?.tickets || 0);
            const pctVta = Number(suc?.porcentaje || 0);
            const margen = typeof suc?.margen_utilidad_pct === 'number' 
                ? suc.margen_utilidad_pct 
                : (vta > 0 ? Number(((ut / vta) * 100).toFixed(1)) : 0);

            const colorMargenClass = margen >= 35 
                ? 'text-emerald-700 bg-emerald-50 border-emerald-200' 
                : (margen >= 25 ? 'text-blue-700 bg-blue-50 border-blue-200' : (margen >= 15 ? 'text-amber-700 bg-amber-50 border-amber-200' : 'text-rose-700 bg-rose-50 border-rose-200'));

            const widthBarra = Math.min(100, Math.max(0, pctVta * 3));
            const nombreClean = suc?.nombre || 'Sucursal';

            return `
                <tr class="hover:bg-slate-50 transition border-b border-slate-100 last:border-0">
                    <td class="py-2.5 px-3 font-bold text-xs text-slate-800 flex items-center gap-2">
                        <span class="w-2 h-2 rounded-full ${idx === 0 ? 'bg-theme-primary ring-theme-soft' : 'bg-slate-300'}"></span>
                        <span class="truncate max-w-[170px]" title="${nombreClean}">${nombreClean}</span>
                    </td>
                    <td class="py-2.5 px-3 text-right text-xs font-semibold text-slate-600 whitespace-nowrap">
                        ${formatearNumero(tcks)}
                    </td>
                    <td class="py-2.5 px-3 text-right text-xs font-black text-slate-900 whitespace-nowrap">
                        ${formatearMoneda(vta)}
                    </td>
                    <td class="py-2.5 px-3 text-right text-xs font-bold text-slate-500 whitespace-nowrap">
                        ${pctVta.toFixed(1)}%
                    </td>
                    <td class="py-2.5 px-3 text-right whitespace-nowrap">
                        <div class="flex flex-col items-end">
                            <span class="inline-flex items-center gap-1 font-black text-xs px-2 py-0.5 rounded-full border ${colorMargenClass}">
                                ${margen.toFixed(1)}%
                            </span>
                            ${ut !== 0 ? `<span class="text-[10px] text-slate-400 font-semibold mt-0.5" title="Utilidad bruta">${formatearMoneda(ut)}</span>` : ''}
                        </div>
                    </td>
                    <td class="py-2.5 px-3">
                        <div class="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                            <div class="h-2 rounded-full ${idx === 0 ? 'bg-theme-primary' : 'bg-slate-400'}" style="width: ${widthBarra}%"></div>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    } catch (err) {
        console.error("Error al renderizar tabla de sucursales:", err);
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="6" class="py-6 text-center text-rose-500 font-bold text-xs">Error al mostrar sucursales: ${err.message}</td></tr>`;
        }
    }
}

// Auto-refresco automático configurable para la Pantalla de Inicio / Dashboard
let timerAutoRefrescoDashboard = null;

function iniciarAutoRefrescoDashboard() {
    const selAuto = document.getElementById('selectAutoRefrescoDashboard');
    if (!selAuto) return;

    // Recuperar preferencia previa guardada o usar 3 minutos por defecto
    const guardado = localStorage.getItem('erp_dashboard_autorefresh_mins');
    if (guardado !== null) {
        selAuto.value = guardado;
    }

    function configurarTimer() {
        if (timerAutoRefrescoDashboard) {
            clearInterval(timerAutoRefrescoDashboard);
            timerAutoRefrescoDashboard = null;
        }

        const mins = parseInt(selAuto.value, 10);
        localStorage.setItem('erp_dashboard_autorefresh_mins', mins);

        if (mins > 0) {
            const ms = mins * 60 * 1000;
            timerAutoRefrescoDashboard = setInterval(() => {
                const dashContent = document.getElementById('moduloDashboardContent');
                // Solo refrescar si el módulo de inicio está visible en pantalla
                if (dashContent && !dashContent.classList.contains('hidden')) {
                    const selPeriodo = document.getElementById('selectPeriodoDashboard');
                    const periodo = selPeriodo ? selPeriodo.value : 'mes_actual';
                    cargarDashboard(periodo, true);
                }
            }, ms);
        }
    }

    selAuto.addEventListener('change', configurarTimer);
    configurarTimer();
}

// Inicialización de eventos al cargar documento
document.addEventListener('DOMContentLoaded', () => {
    const selPeriodo = document.getElementById('selectPeriodoDashboard');
    const boxCustom = document.getElementById('boxFechasPersonalizadasDashboard');
    const inputIni = document.getElementById('dashFechaInicio');
    const inputFin = document.getElementById('dashFechaFin');
    const btnAplicar = document.getElementById('btnAplicarFechasDashboard');

    // Inicializar inputs de fecha con inicio de mes y hoy
    const hoy = new Date();
    const hoyStr = hoy.toISOString().split('T')[0];
    const primerDia = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
    // Ajuste de zona horaria local para formato YYYY-MM-DD
    const pad = n => String(n).padStart(2, '0');
    const localHoyStr = `${hoy.getFullYear()}-${pad(hoy.getMonth() + 1)}-${pad(hoy.getDate())}`;
    const localIniStr = `${primerDia.getFullYear()}-${pad(primerDia.getMonth() + 1)}-01`;

    if (inputIni && !inputIni.value) inputIni.value = localIniStr;
    if (inputFin && !inputFin.value) inputFin.value = localHoyStr;

    if (selPeriodo) {
        selPeriodo.addEventListener('change', (e) => {
            const val = e.target.value;
            if (val === 'personalizado') {
                if (boxCustom) boxCustom.classList.remove('hidden');
                // No se llama automáticamente: el usuario introduce las fechas deseadas y presiona "Aplicar"
            } else {
                if (boxCustom) boxCustom.classList.add('hidden');
                cargarDashboard(val);
            }
        });
    }

    if (btnAplicar) {
        btnAplicar.addEventListener('click', () => {
            if (selPeriodo) selPeriodo.value = 'personalizado';
            cargarDashboard('personalizado');
        });
    }

    // Permitir aplicar con la tecla Enter dentro de cualquiera de los inputs de fecha
    const aplicarConEnter = (e) => {
        if (e.key === 'Enter') {
            if (selPeriodo) selPeriodo.value = 'personalizado';
            cargarDashboard('personalizado');
        }
    };
    if (inputIni) inputIni.addEventListener('keydown', aplicarConEnter);
    if (inputFin) inputFin.addEventListener('keydown', aplicarConEnter);

    const btnRefrescar = document.getElementById('btnRefrescarDashboard');
    if (btnRefrescar) {
        btnRefrescar.addEventListener('click', () => {
            const p = selPeriodo ? selPeriodo.value : 'mes_actual';
            cargarDashboard(p);
        });
    }

    iniciarAutoRefrescoDashboard();
});
