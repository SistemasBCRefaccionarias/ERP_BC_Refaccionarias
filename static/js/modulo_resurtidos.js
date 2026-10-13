// ================= MÓDULO: RESURTIDOS =================
let catalogoResurtidosCargado = false;
let datosResurtidosActual = [];
let datosResurtidosFiltrados = [];
let paginaActualResurtidos = 1;
const FILAS_POR_PAGINA_RESURTIDO = 100;
let ordenColumnaResurtido = 'surtir_cedis';
let ordenAscendenteResurtido = false;

async function inicializarModuloResurtidos(forzar = false) {
    if (catalogoResurtidosCargado && !forzar) return;
    if (forzar) {
        catalogoResurtidosCargado = false;
        datosResurtidosActual = [];
        datosResurtidosFiltrados = [];
        const tbody = document.getElementById('tbodyResurtidos');
        if (tbody) tbody.innerHTML = `<tr><td colspan="19" class="p-8 text-center text-slate-400 italic">Selecciona los parámetros y presiona Calcular Resurtido.</td></tr>`;
    }
    
    try {
        const res = await fetch('/api/resurtidos/catalogos');
        const data = await res.json();
        if (!data.success) {
            mostrarAlerta('error', 'No se pudieron cargar los catálogos de resurtido.');
            return;
        }

        // 1. Llenar almacén destino
        const selAlm = document.getElementById('resurtidoSelectAlmacen');
        if (selAlm) {
            selAlm.innerHTML = '';
            data.almacenes.forEach(a => {
                const opt = document.createElement('option');
                opt.value = a.almacen_id;
                opt.textContent = a.nombre;
                opt.dataset.clasif = a.clasif_sugerida;
                selAlm.appendChild(opt);
            });
            // Por defecto seleccionar sucursal si existe
            const sucDefault = data.almacenes.find(a => a.almacen_id !== 620110);
            if (sucDefault) selAlm.value = sucDefault.almacen_id;
        }

        // 2. Llenar columnas de clasificación almacén
        const selClasif = document.getElementById('resurtidoSelectClasifAlmacen');
        if (selClasif) {
            selClasif.innerHTML = '';
            data.columnas_clasificacion.forEach(c => {
                const opt = document.createElement('option');
                opt.value = c;
                opt.textContent = c;
                selClasif.appendChild(opt);
            });
            actualizarClasifSugeridaAlmacen();
        }

        // 3. Llenar almacén CEDIS origen
        const selCedis = document.getElementById('resurtidoSelectCedis');
        if (selCedis) {
            selCedis.innerHTML = '';
            data.almacenes.forEach(a => {
                const opt = document.createElement('option');
                opt.value = a.almacen_id;
                opt.textContent = a.nombre;
                if (a.almacen_id === data.cedis_default_id) opt.selected = true;
                selCedis.appendChild(opt);
            });
        }

        // 4. Llenar columnas de clasificación CEDIS
        const selClasifCedis = document.getElementById('resurtidoSelectClasifCedis');
        if (selClasifCedis) {
            selClasifCedis.innerHTML = '';
            data.columnas_clasificacion.forEach(c => {
                const opt = document.createElement('option');
                opt.value = c;
                opt.textContent = c;
                if (c === 'C_CEDIS_S') opt.selected = true;
                selClasifCedis.appendChild(opt);
            });
        }

        // 5. Fechas por defecto
        document.getElementById('resurtidoFechaFinal').value = data.fecha_final;
        document.getElementById('resurtidoMesesAnt').value = data.meses_ant;
        document.getElementById('resurtidoFechaInicio').value = data.fecha_inicio;
        document.getElementById('resurtidoVtaDiasAtras').value = data.vta_dias_atras;
        document.getElementById('resurtidoFechaDiasAntes').value = data.fecha_dias_antes;
        if (data.dias_inventario !== undefined && data.dias_inventario !== null) {
            if (data.dias_inventario !== undefined && data.dias_inventario !== null) {
            document.getElementById('resurtidoDiasInv').value = data.dias_inventario;
        }
        const lblDias = document.getElementById('lblDiasInvHeader');
        if (lblDias) lblDias.textContent = document.getElementById('resurtidoDiasInv')?.value || data.dias_inventario || 15;
        }
        document.getElementById('resurtidoPeriodoDias').value = data.periodo_resurtido_dias;

        catalogoResurtidosCargado = true;
    } catch (e) {
        console.error("Error al inicializar módulo resurtidos:", e);
    }
}

function actualizarClasifSugeridaAlmacen() {
    const selAlm = document.getElementById('resurtidoSelectAlmacen');
    const selClasif = document.getElementById('resurtidoSelectClasifAlmacen');
    if (!selAlm || !selClasif) return;
    const optSel = selAlm.options[selAlm.selectedIndex];
    if (optSel && optSel.dataset.clasif) {
        selClasif.value = optSel.dataset.clasif;
    }
}

function recalcularFechasResurtido() {
    const fFinStr = document.getElementById('resurtidoFechaFinal').value;
    const meses = parseInt(document.getElementById('resurtidoMesesAnt').value) || 6;
    const diasAtras = parseInt(document.getElementById('resurtidoVtaDiasAtras').value) || 1;
    
    if (!fFinStr) return;
    const [y, m, d] = fFinStr.split('-').map(Number);
    const dFin = new Date(y, m - 1, d);

    const formatYMD = (date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };

    // Fecha inicio: restar meses * 30.5 días aproximadamente
    const dIni = new Date(dFin);
    dIni.setDate(dIni.getDate() - Math.round(meses * 30.4375));
    document.getElementById('resurtidoFechaInicio').value = formatYMD(dIni);

    // Fecha días antes (fFin - diasAtras)
    const dAntes = new Date(dFin);
    dAntes.setDate(dAntes.getDate() - diasAtras);
    document.getElementById('resurtidoFechaDiasAntes').value = formatYMD(dAntes);
}

async function ejecutarConsultaResurtidos() {
    ocultarAlerta();
    const almId = document.getElementById('resurtidoSelectAlmacen').value;
    const clasifCol = document.getElementById('resurtidoSelectClasifAlmacen').value;
    const cedisId = document.getElementById('resurtidoSelectCedis').value;
    const clasifCedisCol = document.getElementById('resurtidoSelectClasifCedis').value;
    
    const fFin = document.getElementById('resurtidoFechaFinal').value;
    const fIni = document.getElementById('resurtidoFechaInicio').value;
    const fAntes = document.getElementById('resurtidoFechaDiasAntes').value;
    const diasInvInput = document.getElementById('resurtidoDiasInv');
    const diasInv = parseInt(diasInvInput?.value) || 15;
    if (diasInvInput) diasInvInput.value = diasInv;
    const lblDias = document.getElementById('lblDiasInvHeader');
    if (lblDias) lblDias.textContent = diasInv;
    const mesesAnt = parseInt(document.getElementById('resurtidoMesesAnt').value) || 6;
    const reservarMinimoCedis = document.getElementById('chkResurtidoReservarCedis').checked;

    // Clasificaciones seleccionadas
    const clasifs = [];
    ['A', 'B', 'C', 'D', 'E', 'N'].forEach(c => {
        const chk = document.getElementById(`chkClasif_${c}`);
        if (chk && chk.checked) clasifs.push(c);
    });

    const modoClasif = document.getElementById('resurtidoModoClasif')?.value || 'catalogo';
    const respetarMultiplos = document.getElementById('chkResurtidoRespetarMultiplos') ? document.getElementById('chkResurtidoRespetarMultiplos').checked : true;

    const payload = {
        almacen_id: almId,
        clasif_col: clasifCol,
        cedis_id: cedisId,
        clasif_cedis_col: clasifCedisCol,
        fecha_final: fFin,
        fecha_inicio: fIni,
        fecha_dias_antes: fAntes,
        dias_inventario: diasInv,
        meses_ant: mesesAnt,
        reservar_minimo_cedis: reservarMinimoCedis,
        modo_clasificacion: modoClasif,
        respetar_multiplos: respetarMultiplos,
        clasificaciones_incluir: clasifs
    };

    const btnBuscar = document.getElementById('btnBuscarResurtido');
    const origHtml = btnBuscar ? btnBuscar.innerHTML : '';
    if (btnBuscar) {
        btnBuscar.disabled = true;
        btnBuscar.innerHTML = `
            <svg class="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
            </svg>
            <span>Calculando rotación y múltiplos...</span>
        `;
    }

    actualizarProgreso(30, 'Analizando ventas y existencias en Microsip...', 'Calculando Pareto ABC+D y stock de CEDIS', 'bg-amber-600');
    await renderYield();

    try {
        const res = await fetch('/api/resurtidos/calcular', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        
        if (!res.ok || !data.success) {
            ocultarProgreso();
            mostrarAlerta('error', data.error || 'Error al calcular resurtidos.');
            return;
        }

        actualizarProgreso(85, 'Procesando resultados...', 'Formateando datos para visualización', 'bg-amber-600');
        await renderYield();

        datosResurtidosActual = (data.articulos || []).map(item => {
            const stockCed = Number(item.stock_cedis || 0);
            if (stockCed <= 1) {
                item.cantidad_surtir = 0;
                item.cantidad_sugerida = 0;
                item.surtir_cedis = 0;
                item.badge_as = false;
            }
            return item;
        });
        actualizarIndicadoresResurtido(data.totales);
        filtrarYRenderizarTablaResurtidos();

        actualizarProgreso(100, '¡Consulta completada con éxito!', '', 'bg-emerald-600');
        setTimeout(ocultarProgreso, 500);

        // Actualizar etiqueta del almacén en encabezados de la tabla
        const selAlm = document.getElementById('resurtidoSelectAlmacen');
        const nombreAlm = selAlm ? selAlm.options[selAlm.selectedIndex].text : 'ALMACÉN';
        const thAlm = document.getElementById('thResurtidoInvAlm');
        if (thAlm) thAlm.textContent = `Inv. ${nombreAlm}`;
        const thClasif = document.getElementById('thResurtidoClasifAlm');
        if (thClasif) thClasif.textContent = `Clasif. ${nombreAlm}`;

    } catch (e) {
        ocultarProgreso();
        mostrarAlerta('error', 'Error de comunicación con el servidor al procesar resurtidos.');
    } finally {
        if (btnBuscar) {
            btnBuscar.disabled = false;
            btnBuscar.innerHTML = origHtml;
        }
    }
}

function actualizarIndicadoresResurtido(totales) {
    if (!totales) return;
    const txtTotArt = document.getElementById('resurtidoKpiTotalArticulos');
    if (txtTotArt) txtTotArt.textContent = totales.total_articulos_surtir || 0;

    const txtTotPzas = document.getElementById('resurtidoKpiTotalPiezas');
    if (txtTotPzas) txtTotPzas.textContent = totales.total_piezas_surtir || 0;

    const txtTotPzasSug = document.getElementById('resurtidoKpiTotalPiezasSugeridas');
    if (txtTotPzasSug) txtTotPzasSug.textContent = totales.total_piezas_sugeridas || totales.total_piezas_surtir || 0;

    const c = totales.conteo_clasificaciones || {};
    ['A', 'B', 'C', 'D', 'E', 'N'].forEach(k => {
        const el = document.getElementById(`resurtidoKpi_${k}`);
        if (el) el.textContent = c[k] || 0;
    });

    const lblResumen = document.getElementById('resurtidoInfoTotalRegistros');
    if (lblResumen) {
        lblResumen.textContent = `${totales.total_encontrados || 0} artículo(s) analizado(s) • ${totales.total_articulos_surtir || 0} a surtir (${totales.total_piezas_surtir || 0} pzas netas / ${totales.total_piezas_sugeridas || 0} pzas sugeridas)`;
    }
}

function filtrarYRenderizarTablaResurtidos() {
    const q = (document.getElementById('resurtidoInputBuscarParte')?.value || '').trim().toUpperCase();
    const soloSurtir = document.getElementById('chkResurtidoSoloSurtir')?.checked;

    datosResurtidosFiltrados = datosResurtidosActual.filter(item => {
        const cantSurtir = item.cantidad_surtir ?? item.surtir_cedis ?? 0;
        const cantSugerida = item.cantidad_sugerida ?? item.surtir_cedis ?? 0;
        if (soloSurtir && cantSurtir <= 0 && cantSugerida <= 0) {
            return false;
        }
        if (q) {
            const clave = (item.clave || '').toUpperCase();
            const nom = (item.nombre || '').toUpperCase();
            const eq = (item.equivalencia || '').toUpperCase();
            if (!clave.includes(q) && !nom.includes(q) && !eq.includes(q)) {
                return false;
            }
        }
        return true;
    });

    paginaActualResurtidos = 1;
    renderizarPaginaTablaResurtidos();
}

function renderizarPaginaTablaResurtidos() {
    const tbody = document.getElementById('resurtidosTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (datosResurtidosFiltrados.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="17" class="p-8 text-center text-slate-400 font-medium">
                    <div class="flex flex-col items-center justify-center gap-2">
                        <span class="text-2xl">📦</span>
                        <span>No se encontraron artículos con los filtros aplicados.</span>
                        <span class="text-xs text-slate-400">Prueba ajustando el texto de búsqueda o presiona "Buscar" con otros parámetros.</span>
                    </div>
                </td>
            </tr>
        `;
        actualizarPaginacionResurtidos(0);
        return;
    }

    const inicio = (paginaActualResurtidos - 1) * FILAS_POR_PAGINA_RESURTIDO;
    const fin = inicio + FILAS_POR_PAGINA_RESURTIDO;
    const paginaItems = datosResurtidosFiltrados.slice(inicio, fin);

    paginaItems.forEach(it => {
        const cantSurtir = it.cantidad_surtir ?? it.surtir_cedis ?? 0;
        const cantSugerida = it.cantidad_sugerida ?? it.surtir_cedis ?? 0;

        const tr = document.createElement('tr');
        tr.className = "hover:bg-slate-50/80 transition-colors border-b border-slate-100";
        if (cantSugerida > 0 || cantSurtir > 0) {
            tr.classList.add("bg-emerald-50/20");
        }

        // Badge origen (Venta = Azul, Equiv = Amarillo, Clasif = Verde)
        let badgeOrigenHtml = '';
        if (it.badge_origen === 'Venta') {
            badgeOrigenHtml = `<span class="inline-flex items-center px-1.5 py-0.2 rounded text-[8.5px] font-bold bg-blue-100 text-blue-800 border border-blue-200">Venta</span>`;
        } else if (it.badge_origen === 'Equiv.') {
            badgeOrigenHtml = `<span class="inline-flex items-center px-1.5 py-0.2 rounded text-[8.5px] font-bold bg-amber-100 text-amber-800 border border-amber-200">Equiv.</span>`;
        } else {
            badgeOrigenHtml = `<span class="inline-flex items-center px-1.5 py-0.2 rounded text-[8.5px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">Clasif.</span>`;
        }

        // Color badge clasificación A, B, C, D, E, N
        const clasifColorMap = {
            'A': 'bg-emerald-600 text-white font-black',
            'B': 'bg-blue-600 text-white font-bold',
            'C': 'bg-indigo-600 text-white font-bold',
            'D': 'bg-amber-500 text-white font-bold',
            'E': 'bg-slate-200 text-slate-700 font-semibold',
            'N': 'bg-slate-100 text-slate-400 font-medium'
        };
        const badgeClasifAlm = `<span class="inline-block w-5 h-5 leading-5 text-center rounded-md text-[10px] ${clasifColorMap[it.clasif_almacen] || 'bg-slate-100 text-slate-600'}">${it.clasif_almacen}</span>`;
        const badgeClasifCedis = `<span class="inline-block w-5 h-5 leading-5 text-center rounded-md text-[10px] ${clasifColorMap[it.clasif_cedis] || 'bg-slate-100 text-slate-600'}">${it.clasif_cedis}</span>`;

        // Distintivo SF (Sin Filtrar) o AS (Artículo Sugerido)
        let badgeTipoHtml = '';
        if (it.is_sf) {
            badgeTipoHtml = `<span class="inline-flex items-center px-1.5 py-0.2 rounded text-[8.5px] font-black bg-purple-100 text-purple-800 border border-purple-200" title="Grupo maestro sin filtrar (SF)">SF</span>`;
        } else if (it.badge_as) {
            badgeTipoHtml = `<span class="inline-flex items-center px-1.5 py-0.2 rounded text-[8.5px] font-black bg-amber-100 text-amber-800 border border-amber-300" title="Artículo sugerido a surtir en grupo de equivalencias (AS)">AS</span>`;
        }

        // Columna 1: Cantidad a Surtir (necesidad neta sin redondeo a múltiplos)
        let htmlCantSurtir = '';
        if (cantSurtir > 0) {
            htmlCantSurtir = `<span class="inline-flex items-center px-2 py-0.5 rounded-lg font-bold font-mono text-blue-900 bg-blue-50 border border-blue-200">${cantSurtir}</span>`;
        } else {
            htmlCantSurtir = `<span class="text-slate-400 font-mono">0</span>`;
        }

        // Columna 2: Cantidad a Surtir Sugerida (redondeada al múltiplo de empaque / venta)
        let htmlCantSugerida = '';
        if (cantSugerida > 0) {
            htmlCantSugerida = `<span class="inline-flex items-center px-2 py-0.5 rounded-lg font-black font-mono text-emerald-900 bg-emerald-100 border border-emerald-300 shadow-2xs">${cantSugerida}</span>`;
        } else {
            htmlCantSugerida = `<span class="text-slate-400 font-mono">0</span>`;
        }

        // Celda de Múltiplo editable
        const celdaMultiploHtml = `
            <div class="inline-flex items-center gap-1">
                <span id="txtMult_${it.articulo_id}" class="font-mono font-bold text-slate-800 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">${it.multiplo}</span>
                <button type="button" onclick="editarMultiploPrompt(${it.articulo_id}, '${it.clave}', ${it.multiplo})" title="Modificar empaque / múltiplo de venta" class="text-slate-400 hover:text-red-600 text-[10px] p-0.5 transition cursor-pointer">
                    ✏️
                </button>
            </div>
        `;

        tr.innerHTML = `
            <td class="p-2.5 font-mono font-bold text-slate-900">
                <div class="inline-flex items-center gap-1.5">
                    <span>${it.clave}</span>
                    ${badgeTipoHtml}
                </div>
            </td>
            <td class="p-2.5 text-xs text-slate-800 font-medium wrap-desc">
                <div class="flex items-center gap-1.5 flex-wrap">
                    <span>${it.nombre}</span>
                    ${badgeOrigenHtml}
                </div>
            </td>
            <td class="p-2 text-right font-mono font-bold text-slate-900">${it.venta_piezas}</td>
            <td class="p-2 text-right font-mono text-slate-600">${it.venta_dias_antes}</td>
            <td class="p-2 text-right font-mono text-slate-600">${it.promedio_meses}</td>
            <td class="p-2 text-right font-mono text-blue-700 font-bold">${it.promedio_inv}</td>
            <td class="p-2 text-right font-mono text-slate-700">${it.stock_almacen}</td>
            <td class="p-2 text-right font-mono text-slate-700">${it.stock_cedis}</td>
            <td class="p-2 text-right font-mono">${htmlCantSurtir}</td>
            <td class="p-2 text-right font-mono">${htmlCantSugerida}</td>
            <td class="p-2 text-center">${badgeClasifAlm}</td>
            <td class="p-2 text-center">${badgeClasifCedis}</td>
            <td class="p-2 text-center font-mono text-xs text-indigo-700 font-semibold">${it.equivalencia || '--'}</td>
            <td class="p-2 text-center font-bold text-xs text-slate-600">${it.es_par === 'S' ? '✓' : 'N'}</td>
            <td class="p-2 text-center font-bold text-xs text-slate-600">${it.izq_der === 'S' ? '✓' : 'N'}</td>
            <td class="p-2 text-center">${celdaMultiploHtml}</td>
            <td class="p-2 text-center font-mono text-slate-400 text-xs">${it.grupo_id || '--'}</td>
        `;
        tbody.appendChild(tr);
    });

    actualizarPaginacionResurtidos(datosResurtidosFiltrados.length);
}

function actualizarPaginacionResurtidos(total) {
    const totalPaginas = Math.ceil(total / FILAS_POR_PAGINA_RESURTIDO) || 1;
    const txtInfo = document.getElementById('resurtidosPaginacionInfo');
    if (txtInfo) {
        const inicio = total === 0 ? 0 : (paginaActualResurtidos - 1) * FILAS_POR_PAGINA_RESURTIDO + 1;
        const fin = Math.min(paginaActualResurtidos * FILAS_POR_PAGINA_RESURTIDO, total);
        txtInfo.textContent = `Mostrando ${inicio} a ${fin} de ${total} registros`;
    }

    const btnPrev = document.getElementById('btnResurtidoPagPrev');
    const btnNext = document.getElementById('btnResurtidoPagNext');
    if (btnPrev) btnPrev.disabled = paginaActualResurtidos <= 1;
    if (btnNext) btnNext.disabled = paginaActualResurtidos >= totalPaginas;
}

function cambiarPaginaResurtidos(delta) {
    const totalPaginas = Math.ceil(datosResurtidosFiltrados.length / FILAS_POR_PAGINA_RESURTIDO) || 1;
    const nuevaPag = paginaActualResurtidos + delta;
    if (nuevaPag >= 1 && nuevaPag <= totalPaginas) {
        paginaActualResurtidos = nuevaPag;
        renderizarPaginaTablaResurtidos();
        document.getElementById('resurtidosTableContainer')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

async function editarMultiploPrompt(articuloId, clave, multiploActual) {
    const nuevoValStr = window.prompt(`Configurar múltiplo de venta/empaque para [${clave}]:\n(Ej. 4, 10, 12, etc.)`, multiploActual);
    if (nuevoValStr === null) return;
    const nuevoVal = parseInt(nuevoValStr.trim());
    if (isNaN(nuevoVal) || nuevoVal < 1) {
        mostrarAlerta('error', 'El múltiplo debe ser un número entero mayor o igual a 1.');
        return;
    }

    try {
        const res = await fetch('/api/resurtidos/guardar-multiplo', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ articulo_id: articuloId, clave: clave, multiplo: nuevoVal })
        });
        const data = await res.json();
        if (res.ok && data.success) {
            // Actualizar en memoria y recalcular este artículo
            const it = datosResurtidosActual.find(x => x.articulo_id === articuloId);
            if (it) {
                it.multiplo = nuevoVal;
                // Recalcular necesidad y surtido para este artículo con la regla estricta
                const promInv = it.promedio_inv || 0;
                const stockAlm = it.stock_almacen || 0;
                const stockCedis = it.stock_cedis || 0;
                const nec = Math.max(0, promInv - stockAlm);
                const reservarMinimoCedis = document.getElementById('chkResurtidoReservarCedis')?.checked ?? true;
                const dispCedis = Math.max(0, reservarMinimoCedis ? stockCedis - 1 : stockCedis);

                let cantSurtir = it.cantidad_surtir ?? 0;
                if (cantSurtir <= 0 && nec > 0) {
                    cantSurtir = Math.min(Math.ceil(nec), Math.floor(dispCedis));
                }
                it.cantidad_surtir = cantSurtir;

                const esPar = it.es_par === 'S';
                const pack = (esPar && (nuevoVal % 2 !== 0)) ? nuevoVal * 2 : nuevoVal;

                if (cantSurtir > 0) {
                    if (pack > 1) {
                        const paqs = Math.ceil(cantSurtir / pack);
                        const paqsDisp = Math.floor(dispCedis / pack);
                        if (paqsDisp >= paqs) {
                            it.cantidad_sugerida = paqs * pack;
                        } else if (paqsDisp > 0) {
                            it.cantidad_sugerida = paqsDisp * pack;
                        } else if (dispCedis >= pack) {
                            it.cantidad_sugerida = pack;
                        } else {
                            it.cantidad_sugerida = paqs * pack;
                        }
                    } else {
                        it.cantidad_sugerida = cantSurtir;
                    }
                } else {
                    it.cantidad_sugerida = 0;
                }

                const chkRespetar = document.getElementById('chkResurtidoRespetarMultiplo')?.checked ?? true;
                it.surtir_cedis = chkRespetar ? it.cantidad_sugerida : it.cantidad_surtir;
            }

            // Recalcular KPIs en memoria
            let totArt = 0, totPzas = 0, totPzasSug = 0;
            datosResurtidosActual.forEach(x => {
                const s = x.cantidad_surtir || 0;
                const sug = x.cantidad_sugerida || 0;
                if (s > 0 || sug > 0) totArt++;
                totPzas += s;
                totPzasSug += sug;
            });
            const elArt = document.getElementById('resurtidoKpiTotalArticulos');
            if (elArt) elArt.textContent = totArt;
            const elPzas = document.getElementById('resurtidoKpiTotalPiezas');
            if (elPzas) elPzas.textContent = totPzas;
            const elPzasSug = document.getElementById('resurtidoKpiTotalPiezasSugeridas');
            if (elPzasSug) elPzasSug.textContent = totPzasSug;

            renderizarPaginaTablaResurtidos();
            mostrarAlerta('success', `Múltiplo actualizado a ${nuevoVal} para [${clave}]. Guardado en Microsip.`);
        } else {
            mostrarAlerta('error', data.error || 'No se pudo guardar el múltiplo.');
        }
    } catch (e) {
        mostrarAlerta('error', 'Error de red al actualizar múltiplo.');
    }
}

async function exportarResurtidosAExcel(soloSurtir) {
    if (datosResurtidosActual.length === 0) {
        mostrarAlerta('error', 'No hay datos cargados para exportar. Presiona Buscar primero.');
        return;
    }

    const selAlm = document.getElementById('resurtidoSelectAlmacen');
    const nombreAlm = selAlm ? selAlm.options[selAlm.selectedIndex].text : 'ALMACEN';

    try {
        actualizarProgreso(40, 'Generando archivo Excel...', 'Escribiendo formato y celdas', 'bg-emerald-600');
        await renderYield();

        const res = await fetch('/api/resurtidos/exportar-excel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                articulos: datosResurtidosActual,
                solo_surtir: soloSurtir,
                nombre_almacen: nombreAlm
            })
        });

        if (!res.ok) {
            ocultarProgreso();
            mostrarAlerta('error', 'No se pudo generar el archivo Excel.');
            return;
        }

        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const suf = soloSurtir ? "solo_a_surtir" : "completo";
        a.download = `Resurtidos_${nombreAlm}_${suf}.xlsx`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);

        actualizarProgreso(100, '¡Excel descargado!', '', 'bg-emerald-600');
        setTimeout(ocultarProgreso, 500);
        mostrarAlerta('success', 'Archivo Excel descargado correctamente.');
    } catch (e) {
        ocultarProgreso();
        mostrarAlerta('error', 'Error al descargar el archivo Excel.');
    }
}

function transferirResurtidoATraspaso() {
    const aSurtir = datosResurtidosActual.filter(x => {
        const cant = x.cantidad_sugerida || x.cantidad_surtir || x.surtir_cedis || 0;
        return cant > 0;
    });
    if (aSurtir.length === 0) {
        mostrarAlerta('error', 'No hay artículos con cantidad a surtir (> 0) en esta consulta.');
        return;
    }

    const selAlm = document.getElementById('resurtidoSelectAlmacen');
    const destinoId = selAlm ? selAlm.value : '';
    const destinoNombre = selAlm ? selAlm.options[selAlm.selectedIndex].text : '';

    if (!confirm(`¿Deseas enviar ${aSurtir.length} artículos a surtir al Módulo de Traspasos para la sucursal [${destinoNombre}]?`)) {
        return;
    }

    // Cambiar al tab de traspasos
    activarTab('modulo3');

    // Asignar almacén destino
    const selectDest = document.getElementById('traspasoAlmacenDestino');
    if (selectDest && destinoId) {
        selectDest.value = destinoId;
    }

    // Agregar partidas
    partidasTraspaso = [];
    aSurtir.forEach(it => {
        const cantFinal = (it.cantidad_sugerida && it.cantidad_sugerida > 0) 
            ? it.cantidad_sugerida 
            : ((it.cantidad_surtir && it.cantidad_surtir > 0) ? it.cantidad_surtir : it.surtir_cedis);

        partidasTraspaso.push({
            articulo_id: it.articulo_id,
            clave: it.clave,
            nombre: it.nombre,
            cantidad: cantFinal,
            existencia_origen: it.stock_cedis,
            localizacion: '',
            unidad: 'PZA'
        });
    });

    if (typeof renderizarTablaPartidasTraspaso === 'function') {
        renderizarTablaPartidasTraspaso();
    }

    mostrarAlerta('success', `Se cargaron ${partidasTraspaso.length} partidas de resurtido listas para guardar e imprimir ticket.`, 6000);
}

// ================= CONFIGURACIÓN DE GRUPOS DE RESURTIDO =================
let configGruposResurtidoCache = null;
let tabActivaGruposConfig = 'excluido';

async function abrirModalConfigGruposResurtido() {
    const modal = document.getElementById('modalConfigGruposResurtido');
    if (!modal) return;
    modal.classList.remove('hidden');

    try {
        const res = await fetch('/api/resurtidos/grupos-config');
        const data = await res.json();
        if (!data.success) {
            mostrarAlerta('error', 'Error al cargar grupos de resurtido: ' + (data.error || ''));
            return;
        }

        configGruposResurtidoCache = data;
        actualizarBadgesConteoGrupos();
        renderizarListasGruposConfig();
    } catch (e) {
        mostrarAlerta('error', 'Error de red al consultar configuración de grupos: ' + e.message);
    }
}

function cerrarModalConfigGruposResurtido() {
    const modal = document.getElementById('modalConfigGruposResurtido');
    if (modal) modal.classList.add('hidden');
}

function cambiarTabGruposConfig(tab) {
    tabActivaGruposConfig = tab;
    const btnExc = document.getElementById('tabBtnGruposExcluidos');
    const btnSF = document.getElementById('tabBtnGruposSinFiltrar');
    const cntExc = document.getElementById('tabContentGruposExcluidos');
    const cntSF = document.getElementById('tabContentGruposSinFiltrar');

    if (tab === 'excluido') {
        if (btnExc) btnExc.className = "pb-3 px-2 text-xs font-black border-b-2 border-amber-600 text-amber-900 flex items-center gap-2 cursor-pointer transition";
        if (btnSF) btnSF.className = "pb-3 px-2 text-xs font-black border-b-2 border-transparent text-slate-500 hover:text-slate-700 flex items-center gap-2 cursor-pointer transition";
        if (cntExc) cntExc.classList.remove('hidden');
        if (cntSF) cntSF.classList.add('hidden');
    } else {
        if (btnSF) btnSF.className = "pb-3 px-2 text-xs font-black border-b-2 border-purple-600 text-purple-900 flex items-center gap-2 cursor-pointer transition";
        if (btnExc) btnExc.className = "pb-3 px-2 text-xs font-black border-b-2 border-transparent text-slate-500 hover:text-slate-700 flex items-center gap-2 cursor-pointer transition";
        if (cntSF) cntSF.classList.remove('hidden');
        if (cntExc) cntExc.classList.add('hidden');
    }
}

function actualizarBadgesConteoGrupos() {
    if (!configGruposResurtidoCache) return;
    const badgeExc = document.getElementById('badgeConteoExcluidos');
    const badgeSF = document.getElementById('badgeConteoSinFiltrar');
    if (badgeExc) badgeExc.textContent = configGruposResurtidoCache.grupos_excluidos ? configGruposResurtidoCache.grupos_excluidos.length : 0;
    if (badgeSF) badgeSF.textContent = configGruposResurtidoCache.grupos_sin_filtrar ? configGruposResurtidoCache.grupos_sin_filtrar.length : 0;
}

function renderizarListasGruposConfig() {
    if (!configGruposResurtidoCache) return;
    filtrarListaGruposTab('excluido');
    filtrarListaGruposTab('sin_filtrar');
}

function filtrarListaGruposTab(tab) {
    if (!configGruposResurtidoCache || !configGruposResurtidoCache.grupos) return;

    const inputId = tab === 'excluido' ? 'busquedaGruposExcluidos' : 'busquedaGruposSinFiltrar';
    const containerId = tab === 'excluido' ? 'listaGruposExcluidos' : 'listaGruposSinFiltrar';
    const q = (document.getElementById(inputId)?.value || '').toLowerCase().trim();
    const container = document.getElementById(containerId);
    if (!container) return;

    const listaSeleccionados = tab === 'excluido' ? configGruposResurtidoCache.grupos_excluidos : configGruposResurtidoCache.grupos_sin_filtrar;
    const seleccionadosSet = new Set(listaSeleccionados || []);

    const filtrados = configGruposResurtidoCache.grupos.filter(g => {
        if (!q) return true;
        return g.nombre.toLowerCase().includes(q) || String(g.grupo_id).includes(q);
    });

    if (filtrados.length === 0) {
        container.innerHTML = `<div class="p-6 text-center text-xs text-slate-400">No se encontraron grupos con el término "${q}".</div>`;
        return;
    }

    container.innerHTML = filtrados.map(g => {
        const isChecked = seleccionadosSet.has(g.grupo_id);
        const colorRing = tab === 'excluido' ? 'text-amber-600 focus:ring-amber-500' : 'text-purple-600 focus:ring-purple-500';
        return `
            <label class="flex items-center justify-between p-2 hover:bg-slate-50 rounded-lg cursor-pointer transition select-none">
                <div class="flex items-center gap-2.5">
                    <input type="checkbox" value="${g.grupo_id}" ${isChecked ? 'checked' : ''} onchange="toggleGrupoCheckbox('${tab}', ${g.grupo_id}, this.checked)" class="w-4 h-4 rounded border-slate-300 ${colorRing}">
                    <span class="text-xs font-bold text-slate-800">${g.nombre}</span>
                </div>
                <span class="text-[10px] font-mono text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">ID: ${g.grupo_id}</span>
            </label>
        `;
    }).join('');
}

function toggleGrupoCheckbox(tab, grupoId, checked) {
    if (!configGruposResurtidoCache) return;
    const lista = tab === 'excluido' ? configGruposResurtidoCache.grupos_excluidos : configGruposResurtidoCache.grupos_sin_filtrar;
    const set = new Set(lista || []);
    if (checked) {
        set.add(grupoId);
    } else {
        set.delete(grupoId);
    }
    if (tab === 'excluido') {
        configGruposResurtidoCache.grupos_excluidos = Array.from(set);
    } else {
        configGruposResurtidoCache.grupos_sin_filtrar = Array.from(set);
    }
    actualizarBadgesConteoGrupos();
}

function marcarTodosGruposTab(tab, valor) {
    if (!configGruposResurtidoCache || !configGruposResurtidoCache.grupos) return;
    const inputId = tab === 'excluido' ? 'busquedaGruposExcluidos' : 'busquedaGruposSinFiltrar';
    const q = (document.getElementById(inputId)?.value || '').toLowerCase().trim();

    const filtrados = configGruposResurtidoCache.grupos.filter(g => {
        if (!q) return true;
        return g.nombre.toLowerCase().includes(q) || String(g.grupo_id).includes(q);
    });

    const lista = tab === 'excluido' ? configGruposResurtidoCache.grupos_excluidos : configGruposResurtidoCache.grupos_sin_filtrar;
    const set = new Set(lista || []);

    filtrados.forEach(g => {
        if (valor) set.add(g.grupo_id);
        else set.delete(g.grupo_id);
    });

    if (tab === 'excluido') {
        configGruposResurtidoCache.grupos_excluidos = Array.from(set);
    } else {
        configGruposResurtidoCache.grupos_sin_filtrar = Array.from(set);
    }
    actualizarBadgesConteoGrupos();
    filtrarListaGruposTab(tab);
}

async function guardarConfigGruposResurtido() {
    if (!configGruposResurtidoCache) return;
    const btn = document.getElementById('btnGuardarConfigGrupos');
    if (btn) btn.disabled = true;

    try {
        const payload = {
            grupos_excluidos: configGruposResurtidoCache.grupos_excluidos || [],
            grupos_sin_filtrar: configGruposResurtidoCache.grupos_sin_filtrar || []
        };
        const res = await fetch('/api/resurtidos/grupos-config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.success) {
            mostrarAlerta('success', 'Configuración de grupos guardada exitosamente.');
            cerrarModalConfigGruposResurtido();
        } else {
            mostrarAlerta('error', 'Error al guardar: ' + (data.error || ''));
        }
    } catch (e) {
        mostrarAlerta('error', 'Error de conexión: ' + e.message);
    } finally {
        if (btn) btn.disabled = false;
    }
}
