// =========================================================================
// MÓDULO DE CONTROL DE CASCOS (BATERÍAS USADAS Y BONIFICACIONES)
// =========================================================================

let estadoCascos = {
    innerTabActual: 'inventario',
    config: null,
    almacenes: [],
    inventario: [],
    recepciones: [],
    facturasSinUsados: [],
    recepcionSeleccionada: null,
    facturaSeleccionada: null
};

// -------------------------------------------------------------------------
// 1. NAVEGACIÓN DE PESTAÑAS INTERNAS DE CASCOS
// -------------------------------------------------------------------------
function cambiarInnerTabCascos(tabName) {
    estadoCascos.innerTabActual = tabName;

    const tabs = ['inventario', 'recepciones', 'pendientes', 'config'];
    tabs.forEach(t => {
        const cont = document.getElementById(`cascosTabContent_${t}`);
        const btn = document.getElementById(`cascosInnerTabBtn_${t}`);
        if (cont) {
            if (t === tabName) cont.classList.remove('hidden');
            else cont.classList.add('hidden');
        }
        if (btn) {
            if (t === tabName) {
                btn.className = "px-4 py-2 rounded-xl text-xs font-black transition flex items-center gap-2 btn-theme-primary text-white shadow-sm cursor-pointer";
            } else {
                btn.className = "px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 text-slate-600 hover:text-slate-900 hover:bg-slate-200/60 cursor-pointer";
            }
        }
    });

    if (tabName === 'inventario') {
        cargarInventarioCascos();
    } else if (tabName === 'recepciones') {
        cargarRecepcionesCascos();
    } else if (tabName === 'pendientes') {
        cargarFacturasSinUsados();
    } else if (tabName === 'config') {
        cargarConfigCascos();
    }
}

// -------------------------------------------------------------------------
// 2. INVENTARIO EN VIVO DE CASCOS (B01..B07)
// -------------------------------------------------------------------------
async function cargarInventarioCascos() {
    const contenedorCards = document.getElementById('cascosGridCards');
    const tablaBody = document.getElementById('cascosTablaInventarioBody');
    const badgeTotal = document.getElementById('cascosTotalStockBadge');
    const badgeAlmacen = document.getElementById('cascosNombreAlmacenBadge');

    if (tablaBody) {
        tablaBody.innerHTML = `<tr><td colspan="5" class="p-8 text-center text-slate-400 italic">Consultando existencias de cascos en Microsip...</td></tr>`;
    }

    try {
        const resp = await fetch('/api/almacen/cascos/inventario');
        const data = await resp.json();

        if (!data.ok && data.error) {
            throw new Error(data.error);
        }

        estadoCascos.inventario = data.cascos || [];
        const totalPiezas = data.total_piezas || 0;
        const nombreAlmacen = (data.almacen && data.almacen.nombre) ? data.almacen.nombre : 'Almacén Usados';

        if (badgeTotal) badgeTotal.textContent = `${totalPiezas.toLocaleString('es-MX')} Piezas`;
        if (badgeAlmacen) badgeAlmacen.textContent = nombreAlmacen;

        // Render Cards para cada clave B01..B07 (Estilo Dashboard Ejecutivo)
        if (contenedorCards) {
            contenedorCards.innerHTML = estadoCascos.inventario.map((c, idx) => {
                return `
                    <div class="bg-white p-4 rounded-3xl border border-slate-200/80 shadow-xs hover:shadow-md transition relative overflow-hidden flex flex-col justify-between">
                        <div class="flex items-center justify-between">
                            <span class="text-xs font-black px-2.5 py-0.5 rounded-lg bg-slate-100 text-slate-800 uppercase tracking-wider border border-slate-200 font-mono">
                                ${c.clave}
                            </span>
                            <span class="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Grupo ${idx + 1}</span>
                        </div>
                        <div class="mt-3 flex items-baseline justify-between">
                            <div class="text-2xl font-black text-slate-900 tracking-tight">${Number(c.existencia || 0).toLocaleString('es-MX')}</div>
                            <span class="text-[11px] font-bold text-slate-400 uppercase tracking-wide">pzas</span>
                        </div>
                        <p class="text-[11px] font-semibold text-slate-600 mt-1 line-clamp-1" title="${c.nombre || ''}">${c.nombre || 'Bonificación Usado'}</p>
                    </div>
                `;
            }).join('');
        }

        // Render Tabla Detallada
        if (tablaBody) {
            if (estadoCascos.inventario.length === 0) {
                tablaBody.innerHTML = `<tr><td colspan="5" class="p-8 text-center text-slate-400 italic">No se encontraron artículos B01-B07 configurados en la base de datos.</td></tr>`;
            } else {
                tablaBody.innerHTML = estadoCascos.inventario.map(c => `
                    <tr class="hover:bg-slate-50 transition border-b border-slate-100">
                        <td class="p-3 text-center font-black">
                            <span class="px-2.5 py-1 bg-cyan-100 text-cyan-800 rounded-lg text-xs font-mono font-black">${c.clave}</span>
                        </td>
                        <td class="p-3 text-slate-800 font-bold text-xs">${c.nombre}</td>
                        <td class="p-3 text-center text-xs text-slate-500 font-mono">${c.articulo_id}</td>
                        <td class="p-3 text-right">
                            <span class="text-sm font-black ${Number(c.existencia) > 0 ? 'text-emerald-700 font-black' : 'text-slate-400'}">
                                ${Number(c.existencia || 0).toLocaleString('es-MX')}
                            </span>
                        </td>
                        <td class="p-3 text-center">
                            <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold ${Number(c.existencia) > 0 ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-500'}">
                                <span class="w-1.5 h-1.5 rounded-full ${Number(c.existencia) > 0 ? 'bg-emerald-500' : 'bg-slate-400'}"></span>
                                ${Number(c.existencia) > 0 ? 'Disponible' : 'Sin stock'}
                            </span>
                        </td>
                    </tr>
                `).join('');
            }
        }
    } catch (e) {
        console.error("Error al cargar inventario de cascos:", e);
        if (tablaBody) {
            tablaBody.innerHTML = `<tr><td colspan="5" class="p-8 text-center text-red-500 italic">Error al consultar existencias: ${e.message}</td></tr>`;
        }
    }
}

// -------------------------------------------------------------------------
// 3. RECEPCIONES DE CASCOS (ENVÍO SUCURSALES -> ALMACÉN USADOS)
// -------------------------------------------------------------------------
async function cargarRecepcionesCascos() {
    const tablaBody = document.getElementById('cascosTablaRecepcionesBody');
    const filtroEstatus = document.getElementById('cascosFiltroEstatusRecepcion') ? document.getElementById('cascosFiltroEstatusRecepcion').value : '';

    if (tablaBody) {
        tablaBody.innerHTML = `<tr><td colspan="8" class="p-8 text-center text-slate-400 italic">Cargando recepciones de cascos...</td></tr>`;
    }

    try {
        let url = '/api/almacen/cascos/recepciones';
        if (filtroEstatus) url += `?estatus=${encodeURIComponent(filtroEstatus)}`;

        const resp = await fetch(url);
        const data = await resp.json();

        if (!data.ok && data.error) {
            throw new Error(data.error);
        }

        estadoCascos.recepciones = data.recepciones || [];

        if (tablaBody) {
            if (estadoCascos.recepciones.length === 0) {
                tablaBody.innerHTML = `<tr><td colspan="8" class="p-8 text-center text-slate-400 italic">No se encontraron recepciones registradas.</td></tr>`;
            } else {
                tablaBody.innerHTML = estadoCascos.recepciones.map(r => {
                    let badgeEstado = '';
                    if (r.cancelado === 'S') {
                        badgeEstado = `<span class="px-2.5 py-1 rounded-full text-[10px] font-black bg-rose-100 text-rose-800 border border-rose-200">CANCELADA</span>`;
                    } else if (r.confirmado === 'S') {
                        badgeEstado = `<span class="px-2.5 py-1 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-800 border border-emerald-200">CONFIRMADA (${r.folio_microsip || 'MS'})</span>`;
                    } else {
                        badgeEstado = `<span class="px-2.5 py-1 rounded-full text-[10px] font-black bg-amber-100 text-amber-800 border border-amber-200 animate-pulse">PENDIENTE</span>`;
                    }

                    return `
                        <tr class="hover:bg-slate-50 transition border-b border-slate-100 text-xs">
                            <td class="p-3 font-mono font-black text-slate-900">${r.folio_recepcion}</td>
                            <td class="p-3 font-bold text-slate-800">${r.almacen_origen_nombre}</td>
                            <td class="p-3 text-slate-600">${r.almacen_destino_nombre}</td>
                            <td class="p-3 text-center text-slate-500 font-mono">${r.fecha_venta_inicio} al ${r.fecha_venta_final}</td>
                            <td class="p-3 text-right font-black text-slate-900">${Number(r.piezas || 0).toLocaleString('es-MX')}</td>
                            <td class="p-3 text-center">${badgeEstado}</td>
                            <td class="p-3 text-slate-500 text-[11px]">${r.fecha_hora_creacion || ''}</td>
                            <td class="p-3 text-center">
                                <div class="flex items-center justify-center gap-1.5">
                                    <button type="button" onclick="abrirModalVerificarRecepcion(${r.recepcion_id})" class="px-2.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-bold transition flex items-center gap-1 shadow-sm cursor-pointer" title="Ver desglose y verificar">
                                        <span>${r.confirmado === 'S' ? 'Ver Detalle' : 'Cotejar y Confirmar'}</span>
                                    </button>
                                    ${r.cancelado !== 'S' ? `
                                        <button type="button" onclick="cancelarRecepcionCascos(${r.recepcion_id})" class="px-2 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-lg text-xs font-bold transition border border-rose-200 cursor-pointer" title="Cancelar recepción">
                                            ✕
                                        </button>
                                    ` : ''}
                                </div>
                            </td>
                        </tr>
                    `;
                }).join('');
            }
        }
    } catch (e) {
        console.error("Error al cargar recepciones de cascos:", e);
        if (tablaBody) {
            tablaBody.innerHTML = `<tr><td colspan="8" class="p-8 text-center text-red-500 italic">Error al cargar recepciones: ${e.message}</td></tr>`;
        }
    }
}

// -------------------------------------------------------------------------
// 4. NUEVA RECEPCIÓN DE CASCOS (MODAL DE PREPARACIÓN)
// -------------------------------------------------------------------------
async function abrirModalNuevaRecepcionCascos() {
    const modal = document.getElementById('modalCascosNuevaRecepcion');
    if (!modal) return;

    // Llenar selector de almacenes de origen
    const selectOrigen = document.getElementById('cascosSelectOrigenRecepcion');
    if (selectOrigen) {
        selectOrigen.innerHTML = `<option value="">Cargando sucursales...</option>`;
        try {
            const resp = await fetch('/api/almacen/cascos/config');
            const data = await resp.json();
            const almacenes = data.almacenes || [];
            const autorizados = (data.config && data.config.autorizados) ? data.config.autorizados : [];
            const idUsados = data.config ? data.config.almacen_id : 0;

            const opciones = almacenes
                .filter(a => a.id !== idUsados)
                .map(a => `<option value="${a.id}">${a.nombre} ${autorizados.includes(a.id) ? '⭐' : ''}</option>`);

            selectOrigen.innerHTML = `<option value="">-- Selecciona Sucursal Origen --</option>` + opciones.join('');
        } catch (e) {
            selectOrigen.innerHTML = `<option value="">Error al cargar sucursales</option>`;
        }
    }

    // Fechas por defecto: día actual
    const hoy = new Date().toISOString().slice(0, 10);
    const inputInicio = document.getElementById('cascosFechaInicioRecepcion');
    const inputFinal = document.getElementById('cascosFechaFinalRecepcion');
    if (inputInicio && !inputInicio.value) inputInicio.value = hoy;
    if (inputFinal && !inputFinal.value) inputFinal.value = hoy;

    // Limpiar tabla de vista previa
    const previewBody = document.getElementById('cascosPreviewVentasBody');
    if (previewBody) {
        previewBody.innerHTML = `<tr><td colspan="6" class="p-8 text-center text-slate-400 italic">Selecciona sucursal y rango de fechas para consultar bonificaciones vendidas.</td></tr>`;
    }

    const btnPreparar = document.getElementById('btnPrepararRecepcionCascos');
    if (btnPreparar) btnPreparar.disabled = true;

    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function cerrarModalNuevaRecepcionCascos() {
    const modal = document.getElementById('modalCascosNuevaRecepcion');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
}

async function consultarVentasParaRecepcion() {
    const almacenOrigenId = document.getElementById('cascosSelectOrigenRecepcion').value;
    const fechaInicio = document.getElementById('cascosFechaInicioRecepcion').value;
    const fechaFinal = document.getElementById('cascosFechaFinalRecepcion').value;
    const previewBody = document.getElementById('cascosPreviewVentasBody');
    const badgeTotal = document.getElementById('cascosPreviewTotalPiezas');
    const btnPreparar = document.getElementById('btnPrepararRecepcionCascos');

    if (!almacenOrigenId) {
        alert("Selecciona la sucursal de origen.");
        return;
    }
    if (!fechaInicio || !fechaFinal) {
        alert("Indica el rango de fechas.");
        return;
    }

    if (previewBody) {
        previewBody.innerHTML = `<tr><td colspan="6" class="p-8 text-center text-slate-400 italic">Consultando ventas de baterías con bonificación en Microsip...</td></tr>`;
    }

    try {
        const resp = await fetch(`/api/almacen/cascos/ventas-periodo?fecha_inicio=${fechaInicio}&fecha_final=${fechaFinal}&almacen_id=${almacenOrigenId}`);
        const data = await resp.json();

        if (!data.ok && data.error) {
            throw new Error(data.error);
        }

        const ventas = data.ventas || [];
        const totalPzas = ventas.reduce((acc, v) => acc + (v.cantidad || 0), 0);

        if (badgeTotal) badgeTotal.textContent = `${totalPzas.toLocaleString('es-MX')} piezas vendidas`;

        if (previewBody) {
            if (ventas.length === 0) {
                previewBody.innerHTML = `<tr><td colspan="6" class="p-8 text-center text-amber-600 font-bold">No se encontraron ventas de acumuladores con bonificación (B01-B07) en esa sucursal y rango de fechas.</td></tr>`;
                if (btnPreparar) btnPreparar.disabled = true;
            } else {
                previewBody.innerHTML = ventas.map(v => `
                    <tr class="hover:bg-slate-50 transition border-b border-slate-100 text-xs">
                        <td class="p-2.5 font-mono font-bold text-slate-900">${v.folio}</td>
                        <td class="p-2.5 text-center text-slate-500 font-mono">${v.fecha_venta}</td>
                        <td class="p-2.5 text-slate-700">${v.cliente_nombre || 'PÚBLICO GENERAL'}</td>
                        <td class="p-2.5 text-center font-mono font-bold"><span class="px-2 py-0.5 bg-blue-100 text-blue-800 rounded">${v.clave}</span></td>
                        <td class="p-2.5 text-right font-black text-slate-900">${v.cantidad}</td>
                        <td class="p-2.5 text-right text-slate-600 font-mono">$${Number(v.importe || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })}</td>
                    </tr>
                `).join('');
                if (btnPreparar) btnPreparar.disabled = false;
            }
        }
    } catch (e) {
        console.error("Error al consultar ventas para recepción:", e);
        if (previewBody) {
            previewBody.innerHTML = `<tr><td colspan="6" class="p-8 text-center text-red-500 font-bold">Error: ${e.message}</td></tr>`;
        }
        if (btnPreparar) btnPreparar.disabled = true;
    }
}

async function ejecutarPreparacionRecepcion() {
    const almacenOrigenId = document.getElementById('cascosSelectOrigenRecepcion').value;
    const fechaInicio = document.getElementById('cascosFechaInicioRecepcion').value;
    const fechaFinal = document.getElementById('cascosFechaFinalRecepcion').value;
    const btnPreparar = document.getElementById('btnPrepararRecepcionCascos');

    if (!almacenOrigenId || !fechaInicio || !fechaFinal) {
        alert("Completa todos los campos requeridos.");
        return;
    }

    if (btnPreparar) {
        btnPreparar.disabled = true;
        btnPreparar.textContent = "Preparando...";
    }

    try {
        const resp = await fetch('/api/almacen/cascos/recepciones/preparar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                almacen_origen_id: almacenOrigenId,
                fecha_inicio: fechaInicio,
                fecha_final: fechaFinal
            })
        });
        const data = await resp.json();

        if (!resp.ok || data.error) {
            throw new Error(data.error || "No se pudo preparar la recepción.");
        }

        alert(`Recepción #${data.recepcion_id} (${data.folio_recepcion}) preparada con éxito con ${data.piezas} piezas.`);
        cerrarModalNuevaRecepcionCascos();
        cargarRecepcionesCascos();

        // Abrir inmediatamente la verificación física
        abrirModalVerificarRecepcion(data.recepcion_id);
    } catch (e) {
        alert(e.message);
    } finally {
        if (btnPreparar) {
            btnPreparar.disabled = false;
            btnPreparar.textContent = "Preparar Recepción de Cascos";
        }
    }
}

// -------------------------------------------------------------------------
// 5. COTEJO FÍSICO Y CONFIRMACIÓN DE RECEPCIÓN (ENTRADA EN MICROSIP)
// -------------------------------------------------------------------------
async function abrirModalVerificarRecepcion(recepcionId) {
    const modal = document.getElementById('modalCascosVerificarRecepcion');
    if (!modal) return;

    const titleElem = document.getElementById('modalVerificarTituloRecepcion');
    const badgeInfo = document.getElementById('modalVerificarBadgeRecepcion');
    const tablaDetalles = document.getElementById('cascosVerificarLineasBody');
    const btnConfirmar = document.getElementById('btnConfirmarRecepcionMicrosip');

    if (tablaDetalles) {
        tablaDetalles.innerHTML = `<tr><td colspan="7" class="p-8 text-center text-slate-400 italic">Cargando desglose de la recepción...</td></tr>`;
    }

    modal.classList.remove('hidden');
    modal.classList.add('flex');

    try {
        const resp = await fetch(`/api/almacen/cascos/recepciones/${recepcionId}`);
        const data = await resp.json();

        if (!data.ok && data.error) {
            throw new Error(data.error);
        }

        const r = data.recepcion || {};
        estadoCascos.recepcionSeleccionada = r;

        if (titleElem) titleElem.textContent = `Cotejo y Verificación: ${r.folio_recepcion || ('REC-' + r.recepcion_id)}`;
        if (badgeInfo) {
            badgeInfo.innerHTML = `
                <span class="font-bold">Origen:</span> ${r.almacen_origen_nombre} &bull;
                <span class="font-bold">Destino:</span> ${r.almacen_destino_nombre} &bull;
                <span class="font-bold">Ventas del:</span> ${r.fecha_venta_inicio} al ${r.fecha_venta_final}
            `;
        }

        const esConfirmada = r.confirmado === 'S';
        if (btnConfirmar) {
            if (esConfirmada) {
                btnConfirmar.disabled = true;
                btnConfirmar.className = "px-4 py-2 bg-slate-300 text-slate-600 rounded-xl text-xs font-bold cursor-not-allowed";
                btnConfirmar.textContent = `Ya Confirmada en Microsip (${r.folio_microsip})`;
            } else {
                btnConfirmar.disabled = false;
                btnConfirmar.className = "px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-black shadow-lg shadow-emerald-900/30 transition cursor-pointer";
                btnConfirmar.textContent = "Confirmar Recepción y Afectar Inventario Microsip";
            }
        }

        const clavesDisponibles = ["B01", "B02", "B03", "B04", "B05", "B06", "B07"];

        if (tablaDetalles) {
            tablaDetalles.innerHTML = (r.detalles || []).map((det, idx) => {
                const dist = (det.distribuciones && det.distribuciones[0]) ? det.distribuciones[0] : { clave_verificada: det.clave_vendida, piezas: det.piezas };

                return `
                    <tr class="border-b border-slate-100 text-xs hover:bg-slate-50 transition" data-det-id="${det.recepcion_det_id}">
                        <td class="p-2.5 font-mono font-bold text-slate-800">${det.folio_venta}</td>
                        <td class="p-2.5 text-center text-slate-500 font-mono">${det.fecha_venta || ''}</td>
                        <td class="p-2.5 text-center font-bold">
                            <span class="px-2 py-0.5 bg-slate-100 text-slate-700 rounded font-mono">${det.clave_vendida}</span>
                        </td>
                        <td class="p-2.5 text-right font-black text-slate-900">${det.piezas}</td>
                        <td class="p-2.5 text-center">
                            <select ${esConfirmada ? 'disabled' : ''} class="casco-select-clave border border-slate-300 rounded-lg p-1 text-xs font-black bg-white focus:ring-2 focus:ring-cyan-500">
                                ${clavesDisponibles.map(c => `
                                    <option value="${c}" ${c === (dist.clave_verificada || det.clave_vendida) ? 'selected' : ''}>${c}</option>
                                `).join('')}
                            </select>
                        </td>
                        <td class="p-2.5 text-right">
                            <input type="number" ${esConfirmada ? 'disabled' : ''} step="1" min="0" value="${dist.piezas || det.piezas}" class="casco-input-piezas w-20 border border-slate-300 rounded-lg p-1 text-xs font-black text-right focus:ring-2 focus:ring-cyan-500 bg-white">
                        </td>
                        <td class="p-2.5 text-right text-slate-600 font-mono">$${Number(det.importe || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })}</td>
                    </tr>
                `;
            }).join('');
        }
    } catch (e) {
        console.error("Error al cargar detalle de recepción:", e);
        if (tablaDetalles) {
            tablaDetalles.innerHTML = `<tr><td colspan="7" class="p-8 text-center text-red-500 font-bold">Error: ${e.message}</td></tr>`;
        }
    }
}

function cerrarModalVerificarRecepcion() {
    const modal = document.getElementById('modalCascosVerificarRecepcion');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
    estadoCascos.recepcionSeleccionada = null;
}

async function ejecutarConfirmacionRecepcionMicrosip() {
    if (!estadoCascos.recepcionSeleccionada) return;
    const recepcionId = estadoCascos.recepcionSeleccionada.recepcion_id;

    const filas = document.querySelectorAll('#cascosVerificarLineasBody tr[data-det-id]');
    const detallesPayload = [];

    filas.forEach(fila => {
        const detId = fila.getAttribute('data-det-id');
        const clave = fila.querySelector('.casco-select-clave').value;
        const piezas = parseFloat(fila.querySelector('.casco-input-piezas').value) || 0;

        detallesPayload.push({
            recepcion_det_id: parseInt(detId),
            distribuciones: [
                {
                    clave_verificada: clave,
                    piezas: piezas
                }
            ]
        });
    });

    const notaCredito = document.getElementById('cascosNotaCreditoConfirmacion') ? document.getElementById('cascosNotaCreditoConfirmacion').value : '';
    const btnConfirmar = document.getElementById('btnConfirmarRecepcionMicrosip');

    if (!confirm("¿Deseas confirmar la recepción física y generar el documento de Entrada de Almacén en Microsip?")) {
        return;
    }

    if (btnConfirmar) {
        btnConfirmar.disabled = true;
        btnConfirmar.textContent = "Generando entrada en Microsip...";
    }

    try {
        const resp = await fetch(`/api/almacen/cascos/recepciones/${recepcionId}/confirmar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                detalles: detallesPayload,
                nota_credito: notaCredito
            })
        });
        const data = await resp.json();

        if (!resp.ok || data.error) {
            throw new Error(data.error || "Error al confirmar la recepción en Microsip.");
        }

        alert(`¡Recepción confirmada con éxito!\n\nFolio Microsip generado: ${data.folio_microsip}\nDocumento ID: ${data.docto_in_id}\nTotal de cascos ingresados: ${data.total_piezas}`);
        cerrarModalVerificarRecepcion();
        cargarRecepcionesCascos();
        cargarInventarioCascos();
    } catch (e) {
        alert(e.message);
        if (btnConfirmar) {
            btnConfirmar.disabled = false;
            btnConfirmar.textContent = "Confirmar Recepción y Afectar Inventario Microsip";
        }
    }
}

async function cancelarRecepcionCascos(recepcionId) {
    const motivo = prompt("Indica el motivo de cancelación de la recepción:");
    if (!motivo) return;

    try {
        const resp = await fetch(`/api/almacen/cascos/recepciones/${recepcionId}/cancelar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ motivo: motivo })
        });
        const data = await resp.json();
        if (!resp.ok || data.error) {
            throw new Error(data.error || "No se pudo cancelar la recepción.");
        }
        alert("Recepción cancelada correctamente.");
        cargarRecepcionesCascos();
    } catch (e) {
        alert(e.message);
    }
}

// -------------------------------------------------------------------------
// 6. CASCOS PENDIENTES / FACTURAS SIN USADOS
// -------------------------------------------------------------------------
async function cargarFacturasSinUsados() {
    const tablaBody = document.getElementById('cascosTablaPendientesBody');
    const inputFolio = document.getElementById('cascosFiltroFolioFactura') ? document.getElementById('cascosFiltroFolioFactura').value.trim() : '';
    const inputCliente = document.getElementById('cascosFiltroClienteFactura') ? document.getElementById('cascosFiltroClienteFactura').value.trim() : '';
    const inputFechaInicio = document.getElementById('cascosFiltroFechaInicioFactura') ? document.getElementById('cascosFiltroFechaInicioFactura').value : '';
    const inputFechaFinal = document.getElementById('cascosFiltroFechaFinalFactura') ? document.getElementById('cascosFiltroFechaFinalFactura').value : '';

    if (tablaBody) {
        tablaBody.innerHTML = `<tr><td colspan="8" class="p-8 text-center text-slate-400 italic">Buscando facturas de baterías sin cascos entregados...</td></tr>`;
    }

    try {
        let url = `/api/almacen/cascos/facturas-sin-usados?folio=${encodeURIComponent(inputFolio)}&cliente=${encodeURIComponent(inputCliente)}`;
        if (inputFechaInicio) url += `&fecha_inicio=${encodeURIComponent(inputFechaInicio)}`;
        if (inputFechaFinal) url += `&fecha_final=${encodeURIComponent(inputFechaFinal)}`;

        const resp = await fetch(url);
        const data = await resp.json();

        if (!data.ok && data.error) {
            throw new Error(data.error);
        }

        estadoCascos.facturasSinUsados = data.facturas || [];

        if (tablaBody) {
            if (estadoCascos.facturasSinUsados.length === 0) {
                tablaBody.innerHTML = `<tr><td colspan="8" class="p-8 text-center text-slate-400 italic">No se encontraron facturas pendientes con esos filtros.</td></tr>`;
            } else {
                tablaBody.innerHTML = estadoCascos.facturasSinUsados.map(f => {
                    let badgePago = '';
                    const pzasBat = f.piezas_baterias || 1;
                    const pzasPag = f.piezas_pagadas || 0;
                    if (f.cerrado_pago) {
                        badgePago = `<span class="px-2.5 py-1 rounded-full text-[10px] font-black bg-slate-100 text-slate-700 border border-slate-200">LIQUIDADA / CERRADA</span>`;
                    } else if (pzasPag >= pzasBat && pzasBat > 0) {
                        badgePago = `<span class="px-2.5 py-1 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-800 border border-emerald-200">✓ CASCOS COMPLETOS</span>`;
                    } else if (pzasPag > 0) {
                        badgePago = `<span class="px-2.5 py-1 rounded-full text-[10px] font-black bg-cyan-100 text-cyan-800 border border-cyan-200">PARCIAL (${pzasPag}/${pzasBat} pzas)</span>`;
                    } else {
                        badgePago = `<span class="px-2.5 py-1 rounded-full text-[10px] font-black bg-amber-100 text-amber-800 border border-amber-200 animate-pulse">CASCO PENDIENTE (${pzasBat} pza${pzasBat > 1 ? 's' : ''})</span>`;
                    }

                    return `
                        <tr class="hover:bg-slate-50 transition border-b border-slate-100 text-xs">
                            <td class="p-3 font-mono font-black text-slate-900">${f.folio}</td>
                            <td class="p-3 text-center text-slate-500 font-mono">${f.fecha}</td>
                            <td class="p-3">
                                <div class="font-bold text-slate-900">${f.cliente}</div>
                                <div class="text-[10px] text-slate-400 font-mono">${f.clave_cliente || ''}</div>
                            </td>
                            <td class="p-3 text-slate-600">${f.almacen}</td>
                            <td class="p-3 text-slate-600">${f.vendedor}</td>
                            <td class="p-3 text-right font-black text-slate-900">$${Number(f.importe || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })}</td>
                            <td class="p-3 text-center">${badgePago}</td>
                            <td class="p-3 text-center">
                                <div class="flex items-center justify-center gap-1.5">
                                    <button type="button" onclick="abrirModalRecibirCascoCliente(${f.docto_ve_id})" class="px-2.5 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-xs font-bold transition flex items-center gap-1 shadow-sm cursor-pointer" title="Recibir entrega de casco">
                                        <span>Recibir Casco</span>
                                    </button>
                                    <button type="button" onclick="verDetalleFacturaCasco(${f.docto_ve_id})" class="px-2 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-bold transition border border-slate-200 cursor-pointer" title="Ver detalle">
                                        👁️
                                    </button>
                                    ${!f.cerrado_pago ? `
                                        <button type="button" onclick="cerrarPagoFacturaCasco(${f.docto_ve_id})" class="px-2 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-xs font-bold transition cursor-pointer" title="Cerrar como liquidada en caja">
                                            ✓
                                        </button>
                                    ` : ''}
                                </div>
                            </td>
                        </tr>
                    `;
                }).join('');
            }
        }
    } catch (e) {
        console.error("Error al cargar facturas sin usados:", e);
        if (tablaBody) {
            tablaBody.innerHTML = `<tr><td colspan="8" class="p-8 text-center text-red-500 italic">Error: ${e.message}</td></tr>`;
        }
    }
}

// -------------------------------------------------------------------------
// 7. RECEPCIÓN DE CASCO POR CLIENTE (MODAL RÁPIDO)
// -------------------------------------------------------------------------
async function abrirModalRecibirCascoCliente(doctoVeId) {
    const modal = document.getElementById('modalCascosRecibirCliente');
    if (!modal) return;

    modal.setAttribute('data-docto-id', doctoVeId);
    const infoElem = document.getElementById('modalRecibirClienteInfoFactura');
    if (infoElem) infoElem.innerHTML = "Cargando datos de la factura...";

    modal.classList.remove('hidden');
    modal.classList.add('flex');

    try {
        const resp = await fetch(`/api/almacen/cascos/facturas-sin-usados/${doctoVeId}`);
        const data = await resp.json();
        if (!data.ok && data.error) throw new Error(data.error);

        const f = data.factura || {};
        estadoCascos.facturaSeleccionada = f;

        if (infoElem) {
            infoElem.innerHTML = `
                <div class="p-3 bg-slate-100 rounded-xl space-y-1 text-xs">
                    <div><span class="font-bold text-slate-900">Factura:</span> ${f.folio} &bull; <span class="font-bold">Fecha:</span> ${f.fecha}</div>
                    <div><span class="font-bold text-slate-900">Cliente:</span> ${f.cliente}</div>
                    <div><span class="font-bold text-slate-900">Sucursal:</span> ${f.almacen} &bull; <span class="font-bold">Total:</span> $${Number(f.importe || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })}</div>
                    <div class="pt-1 text-[11px] font-black text-cyan-800">
                        🔋 Baterías vendidas: ${f.piezas_acumuladores || 0} pza(s) &bull; Cascos recibidos: ${f.piezas_pagadas || 0} &bull; Pendientes: ${f.cascos_pendientes || 0}
                    </div>
                </div>
            `;
        }

        // Llenar tabla de captura de cascos
        const bodyCaptura = document.getElementById('cascosCapturaLineasClienteBody');
        const claves = ["B01", "B02", "B03", "B04", "B05", "B06", "B07"];
        if (bodyCaptura) {
            bodyCaptura.innerHTML = claves.map(c => `
                <tr class="border-b border-slate-100 text-xs">
                    <td class="p-2 font-mono font-black text-slate-800">${c}</td>
                    <td class="p-2 text-slate-600">Bonificación Acumulador Usado ${c}</td>
                    <td class="p-2 text-right">
                        <input type="number" min="0" step="1" value="0" class="input-casco-recibir-pzas w-20 border border-slate-300 rounded-lg p-1 text-xs font-black text-right focus:ring-2 focus:ring-cyan-500" data-clave="${c}">
                    </td>
                </tr>
            `).join('');
        }
    } catch (e) {
        if (infoElem) infoElem.innerHTML = `<span class="text-red-500 font-bold">${e.message}</span>`;
    }
}

function cerrarModalRecibirCascoCliente() {
    const modal = document.getElementById('modalCascosRecibirCliente');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
}

async function ejecutarRecepcionCascoCliente() {
    const modal = document.getElementById('modalCascosRecibirCliente');
    const doctoVeId = modal ? modal.getAttribute('data-docto-id') : null;
    if (!doctoVeId) return;

    const inputs = document.querySelectorAll('.input-casco-recibir-pzas');
    const lineas = [];
    inputs.forEach(inp => {
        const pzas = parseFloat(inp.value) || 0;
        if (pzas > 0) {
            lineas.push({
                clave: inp.getAttribute('data-clave'),
                piezas: pzas
            });
        }
    });

    if (lineas.length === 0) {
        alert("Captura al menos una pieza en alguna de las claves B01–B07.");
        return;
    }

    try {
        const resp = await fetch(`/api/almacen/cascos/facturas-sin-usados/${doctoVeId}/recibir`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lineas: lineas })
        });
        const data = await resp.json();
        if (!resp.ok || data.error) throw new Error(data.error || "No se pudo registrar la recepción del casco.");

        alert(`¡Casco recibido con éxito!\n\nEntrada en Microsip: ${data.folio_microsip}\nTotal piezas: ${data.total_piezas}`);
        cerrarModalRecibirCascoCliente();
        cargarFacturasSinUsados();
        cargarInventarioCascos();
    } catch (e) {
        alert(e.message);
    }
}

async function cerrarPagoFacturaCasco(doctoVeId) {
    const motivo = prompt("Indica el motivo de liquidación / cierre de la obligación de casco (ej. 'PAGÓ DIFERENCIA EN EFECTIVO'):", "PAGÓ DIFERENCIA EN EFECTIVO");
    if (!motivo) return;

    try {
        const resp = await fetch(`/api/almacen/cascos/facturas-sin-usados/${doctoVeId}/cerrar-pago`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ motivo: motivo })
        });
        const data = await resp.json();
        if (!resp.ok || data.error) throw new Error(data.error || "Error al cerrar la factura.");

        alert("Obligación de casco cerrada correctamente.");
        cargarFacturasSinUsados();
    } catch (e) {
        alert(e.message);
    }
}

async function verDetalleFacturaCasco(doctoVeId) {
    try {
        const resp = await fetch(`/api/almacen/cascos/facturas-sin-usados/${doctoVeId}`);
        const data = await resp.json();
        if (!data.ok && data.error) throw new Error(data.error);

        const f = data.factura || {};
        let texto = `Factura: ${f.folio} (${f.fecha})\nCliente: ${f.cliente}\nSucursal: ${f.almacen}\nTotal Factura: $${Number(f.importe || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })}\n\n`;
        texto += `🔋 Baterías vendidas: ${f.piezas_acumuladores || 0} pza(s)\n`;
        texto += `📥 Cascos recibidos: ${f.piezas_pagadas || 0} pza(s)\n`;
        texto += `⏳ Cascos pendientes: ${f.cascos_pendientes || 0} pza(s)\n\n`;
        texto += `Artículos vendidos en la factura:\n`;
        (f.partidas || []).forEach(p => {
            const etiqueta = p.es_acumulador ? '🔋 [ACUMULADOR]' : '⚙️ [REFACCIÓN/ACCESORIO]';
            texto += ` ${etiqueta} ${p.clave} (${p.nombre}) x ${p.unidades} ($${p.importe.toFixed(2)})\n`;
        });

        if (f.entregas && f.entregas.length > 0) {
            texto += `\nCascos recibidos con posterioridad:\n`;
            f.entregas.forEach(e => {
                texto += ` - ${e.clave} x ${e.piezas} (Recepción: ${e.folio_recepcion}, Fecha: ${e.fecha_hora})\n`;
            });
        } else {
            texto += `\nNo se han recibido cascos todavía para esta factura.`;
        }

        if (f.cerrado_pago && f.datos_cierre) {
            texto += `\n\nLiquidada/Cerrada por: ${f.datos_cierre.usuario} (${f.datos_cierre.fecha})\nMotivo: ${f.datos_cierre.motivo}`;
        }

        alert(texto);
    } catch (e) {
        alert(e.message);
    }
}

// -------------------------------------------------------------------------
// 8. CONFIGURACIÓN DEL ALMACÉN DE CASCOS
// -------------------------------------------------------------------------
async function cargarConfigCascos() {
    const selectDestino = document.getElementById('cascosConfigAlmacenDestino');
    const containerAutorizados = document.getElementById('cascosConfigAutorizadosContainer');

    if (selectDestino) selectDestino.innerHTML = `<option value="">Cargando almacenes...</option>`;

    try {
        const resp = await fetch('/api/almacen/cascos/config');
        const data = await resp.json();

        estadoCascos.config = data.config || {};
        estadoCascos.almacenes = data.almacenes || [];

        const idDestinoActual = estadoCascos.config.almacen_id || 2464549;
        const autorizadosActuales = new Set(estadoCascos.config.autorizados || []);

        // Selector almacén de usados
        if (selectDestino) {
            selectDestino.innerHTML = estadoCascos.almacenes.map(a => `
                <option value="${a.id}" ${a.id === idDestinoActual ? 'selected' : ''}>${a.nombre} (ID: ${a.id})</option>
            `).join('');
        }

        // Checkboxes sucursales autorizadas
        if (containerAutorizados) {
            containerAutorizados.innerHTML = estadoCascos.almacenes
                .filter(a => a.id !== idDestinoActual)
                .map(a => `
                    <label class="flex items-center gap-2.5 p-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 transition cursor-pointer text-xs">
                        <input type="checkbox" value="${a.id}" ${autorizadosActuales.has(a.id) ? 'checked' : ''} class="casco-chk-autorizado rounded text-cyan-600 focus:ring-cyan-500 w-4 h-4">
                        <span class="font-bold text-slate-800">${a.nombre}</span>
                    </label>
                `).join('');
        }
    } catch (e) {
        console.error("Error al cargar configuración de cascos:", e);
    }
}

async function guardarConfigCascos() {
    const selectDestino = document.getElementById('cascosConfigAlmacenDestino');
    const almacenId = selectDestino ? selectDestino.value : null;
    const almacenNombre = selectDestino ? selectDestino.options[selectDestino.selectedIndex].text.split(' (ID:')[0] : '';

    const chks = document.querySelectorAll('.casco-chk-autorizado:checked');
    const autorizados = Array.from(chks).map(c => parseInt(c.value));

    if (!almacenId) {
        alert("Selecciona el almacén de cascos.");
        return;
    }

    try {
        const resp = await fetch('/api/almacen/cascos/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                almacen_id: parseInt(almacenId),
                almacen_nombre: almacenNombre,
                autorizados: autorizados
            })
        });
        const data = await resp.json();
        if (!resp.ok || data.error) throw new Error(data.error || "Error al guardar la configuración.");

        alert("¡Configuración guardada exitosamente!");
        cargarInventarioCascos();
    } catch (e) {
        alert(e.message);
    }
}

// -------------------------------------------------------------------------
// 9. INICIALIZADOR GLOBAL AL ACTIVAR LA PESTAÑA DE CASCOS
// -------------------------------------------------------------------------
window.cargarCascosInicial = function() {
    cambiarInnerTabCascos(estadoCascos.innerTabActual || 'inventario');
};

