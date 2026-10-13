// =========================================================================
// MÓDULO DE CONTROL DE VISIBILIDAD DE SUCURSALES Y VENDEDORES
// Permite activar/desactivar sucursales y vendedores mostrados en el sistema
// =========================================================================

let _visibSucursales = [];
let _visibVendedores = [];
let _visibSeccionActual = 'sucursales';
let _visibCargando = false;

// IDs de las 12 sucursales comerciales físicas principales
const SUCURSALES_FISICAS_DEFAULT = [11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22];

function formatearDineroVisib(num) {
    return '$' + Number(num || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatearEnteroVisib(num) {
    return Number(num || 0).toLocaleString('es-MX');
}

/**
 * Función principal llamada al entrar a la pestaña 'visibilidad' en Configuración
 */
async function cargarModuloVisibilidad() {
    if (_visibSeccionActual === 'sucursales') {
        await cargarVisibilidadSucursales();
    } else {
        await cargarVisibilidadVendedores();
    }
}

/**
 * Permite saltar directamente a la subsección ('sucursales' o 'vendedores')
 */
function cambiarSubSeccionVisibilidad(seccion) {
    _visibSeccionActual = seccion;
    const secSuc = document.getElementById('seccionVisibilidadSucursales');
    const secVend = document.getElementById('seccionVisibilidadVendedores');
    const btnPillSuc = document.getElementById('btnVisibPillSucursales');
    const btnPillVend = document.getElementById('btnVisibPillVendedores');

    if (seccion === 'sucursales') {
        if (secSuc) secSuc.classList.remove('hidden');
        if (secVend) secVend.classList.add('hidden');
        if (btnPillSuc) btnPillSuc.className = 'px-4 py-2 rounded-xl text-xs font-black transition flex items-center gap-2 bg-indigo-600 text-white shadow-sm cursor-pointer';
        if (btnPillVend) btnPillVend.className = 'px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 cursor-pointer';
        if (_visibSucursales.length === 0) {
            cargarVisibilidadSucursales();
        } else {
            actualizarKpisSucursales();
            filtrarSucursalesVisibilidad();
        }
    } else {
        if (secSuc) secSuc.classList.add('hidden');
        if (secVend) secVend.classList.remove('hidden');
        if (btnPillVend) btnPillVend.className = 'px-4 py-2 rounded-xl text-xs font-black transition flex items-center gap-2 bg-indigo-600 text-white shadow-sm cursor-pointer';
        if (btnPillSuc) btnPillSuc.className = 'px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 cursor-pointer';
        if (_visibVendedores.length === 0) {
            cargarVisibilidadVendedores();
        } else {
            actualizarKpisVendedores();
            filtrarVendedoresVisibilidad();
        }
    }
}

/**
 * Botón maestro "Guardar Cambios" de la barra superior
 */
function guardarVisibilidadActual() {
    if (_visibSeccionActual === 'sucursales') {
        guardarVisibilidadSucursales();
    } else {
        guardarVisibilidadVendedores();
    }
}

// =========================================================================
// GESTIÓN DE SUCURSALES Y ALMACENES
// =========================================================================

async function cargarVisibilidadSucursales() {
    const tbody = document.getElementById('tbodyVisibilidadSucursales');
    if (tbody && _visibSucursales.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="p-8 text-center text-slate-400 italic">Cargando catálogo completo de almacenes desde Microsip...</td></tr>`;
    }

    try {
        _visibCargando = true;
        const resp = await fetch('/api/config/visibilidad/sucursales');
        const data = await resp.json();

        if (!data.success) {
            throw new Error(data.error || 'Error al obtener sucursales');
        }

        _visibSucursales = data.sucursales || [];

        // Actualizar badge en la píldora superior
        const badgeCount = document.getElementById('badgePillSucursalesCount');
        if (badgeCount) {
            const visiblesCount = _visibSucursales.filter(s => s.visible).length;
            badgeCount.textContent = `${visiblesCount}/${_visibSucursales.length}`;
        }

        actualizarKpisSucursales();
        filtrarSucursalesVisibilidad();

    } catch (err) {
        console.error("Error al cargar visibilidad de sucursales:", err);
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="7" class="p-8 text-center text-red-500 font-bold">Error al cargar sucursales: ${err.message}</td></tr>`;
        }
        if (typeof mostrarAlerta === 'function') {
            mostrarAlerta('error', `No se pudo consultar el catálogo de sucursales: ${err.message}`);
        }
    } finally {
        _visibCargando = false;
    }
}

function actualizarKpisSucursales() {
    const total = _visibSucursales.length;
    const visibles = _visibSucursales.filter(s => s.visible);
    const ocultas = total - visibles.length;
    const totalVentaVisibles = visibles.reduce((acc, s) => acc + (Number(s.total_venta_2026) || 0), 0);

    const elTotal = document.getElementById('kpiVisibSucTotal');
    const elVisibles = document.getElementById('kpiVisibSucVisibles');
    const elOcultas = document.getElementById('kpiVisibSucOcultas');
    const elVenta = document.getElementById('kpiVisibSucVentaTotal');

    if (elTotal) elTotal.textContent = formatearEnteroVisib(total);
    if (elVisibles) elVisibles.textContent = formatearEnteroVisib(visibles.length);
    if (elOcultas) elOcultas.textContent = formatearEnteroVisib(ocultas);
    if (elVenta) elVenta.textContent = formatearDineroVisib(totalVentaVisibles);

    const badgeCount = document.getElementById('badgePillSucursalesCount');
    if (badgeCount) badgeCount.textContent = `${visibles.length}/${total}`;
}

function filtrarSucursalesVisibilidad() {
    const inputBusq = document.getElementById('inputBuscarSucursalVisib');
    const selectFiltro = document.getElementById('selectFiltroEstadoSucursalVisib');

    const texto = (inputBusq?.value || '').trim().toLowerCase();
    const filtro = selectFiltro?.value || 'todos';

    let filtrados = _visibSucursales.filter(s => {
        const matchTexto = !texto || 
            String(s.almacen_id).includes(texto) || 
            (s.nombre || '').toLowerCase().includes(texto);

        if (!matchTexto) return false;

        if (filtro === 'visibles') return s.visible === true;
        if (filtro === 'ocultos') return s.visible === false;
        if (filtro === 'con_ventas') return (Number(s.tickets_2026) || 0) > 0;
        return true;
    });

    renderizarTablaSucursalesVisibilidad(filtrados);
}

function renderizarTablaSucursalesVisibilidad(lista) {
    const tbody = document.getElementById('tbodyVisibilidadSucursales');
    if (!tbody) return;

    if (lista.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="p-8 text-center text-slate-400 italic">No se encontraron almacenes con los criterios aplicados.</td></tr>`;
        return;
    }

    tbody.innerHTML = lista.map(s => {
        const almId = s.almacen_id;
        const nombre = s.nombre || `Almacén ${almId}`;
        const esVisible = !!s.visible;
        const venta = Number(s.total_venta_2026) || 0;
        const tickets = Number(s.tickets_2026) || 0;
        const ultimaVenta = s.ultima_venta ? s.ultima_venta.split(' ')[0] : '<span class="text-slate-300">Sin ventas</span>';

        const switchBg = esVisible ? 'bg-emerald-600' : 'bg-slate-200';
        const switchDot = esVisible ? 'translate-x-5' : 'translate-x-1';

        const badgeEstado = esVisible 
            ? `<span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-800 border border-emerald-200"><span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>Visible</span>`
            : `<span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-black bg-slate-100 text-slate-500 border border-slate-200"><span class="w-1.5 h-1.5 rounded-full bg-slate-400"></span>Oculto</span>`;

        const rowBg = esVisible ? 'hover:bg-slate-50/80 transition-colors' : 'bg-slate-50/40 opacity-70 hover:opacity-100 transition-opacity';

        return `
            <tr class="${rowBg}">
                <td class="p-3 text-center">
                    <button type="button" onclick="toggleVisibilidadSucursal(${almId})" class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer focus:outline-none ${switchBg}" title="${esVisible ? 'Haga clic para ocultar' : 'Haga clic para mostrar'}">
                        <span class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform shadow-xs ${switchDot}"></span>
                    </button>
                </td>
                <td class="p-3 font-mono font-bold text-slate-500">#${almId}</td>
                <td class="p-3">
                    <div class="font-bold text-slate-900">${nombre}</div>
                    ${s.oculto_microsip ? '<span class="text-[9px] font-extrabold uppercase px-1.5 py-0.2 bg-amber-100 text-amber-800 rounded">Oculto en Microsip</span>' : ''}
                </td>
                <td class="p-3 text-right font-black ${venta > 0 ? 'text-indigo-950 font-mono' : 'text-slate-400'}">
                    ${formatearDineroVisib(venta)}
                </td>
                <td class="p-3 text-right font-mono font-bold ${tickets > 0 ? 'text-slate-700' : 'text-slate-300'}">
                    ${formatearEnteroVisib(tickets)}
                </td>
                <td class="p-3 text-center text-[11px] font-medium text-slate-600">
                    ${ultimaVenta}
                </td>
                <td class="p-3 text-center">
                    ${badgeEstado}
                </td>
            </tr>
        `;
    }).join('');
}

function toggleVisibilidadSucursal(almId) {
    const item = _visibSucursales.find(s => s.almacen_id === almId);
    if (!item) return;

    item.visible = !item.visible;
    actualizarKpisSucursales();
    filtrarSucursalesVisibilidad();
}

function activarTodasSucursales() {
    _visibSucursales.forEach(s => s.visible = true);
    actualizarKpisSucursales();
    filtrarSucursalesVisibilidad();
}

function desactivarTodasSucursales() {
    _visibSucursales.forEach(s => s.visible = false);
    actualizarKpisSucursales();
    filtrarSucursalesVisibilidad();
}

function restablecerSucursalesFisicas() {
    _visibSucursales.forEach(s => {
        const nom = (s.nombre || '').toUpperCase();
        const esDescarte = nom.includes('NO UTILIZAR') || nom.includes('NO USAR') || nom.includes('TRANSITO');
        s.visible = (SUCURSALES_FISICAS_DEFAULT.includes(s.almacen_id) || (s.es_comercial && (Number(s.tickets_2026) || 0) > 0)) && !esDescarte;
    });
    actualizarKpisSucursales();
    filtrarSucursalesVisibilidad();
    if (typeof mostrarAlerta === 'function') {
        mostrarAlerta('info', 'Se seleccionaron las sucursales físicas comerciales activas. Recuerde presionar "Guardar Cambios".');
    }
}

async function guardarVisibilidadSucursales() {
    const btnGuardar = document.getElementById('btnGuardarVisibilidadActiva');
    const textoOriginal = btnGuardar ? btnGuardar.innerHTML : '';

    try {
        if (btnGuardar) {
            btnGuardar.disabled = true;
            btnGuardar.innerHTML = `<span class="animate-spin mr-1">⏳</span> Guardando...`;
        }

        const payload = {
            sucursales: _visibSucursales.map(s => ({
                almacen_id: s.almacen_id,
                nombre: s.nombre,
                visible: !!s.visible
            }))
        };

        const resp = await fetch('/api/config/visibilidad/sucursales', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await resp.json();
        if (!data.success) {
            throw new Error(data.error || 'No fue posible guardar la configuración');
        }

        if (typeof mostrarAlerta === 'function') {
            mostrarAlerta('success', `¡Configuración de sucursales guardada con éxito! (${_visibSucursales.filter(s => s.visible).length} sucursales activas en el Dashboard).`);
        }

        // Si el dashboard está presente, recargar resumen para reflejar inmediatamente
        if (typeof cargarResumenDashboard === 'function') {
            cargarResumenDashboard();
        }

    } catch (err) {
        console.error("Error al guardar visibilidad de sucursales:", err);
        if (typeof mostrarAlerta === 'function') {
            mostrarAlerta('error', `Error al guardar: ${err.message}`);
        }
    } finally {
        if (btnGuardar) {
            btnGuardar.disabled = false;
            btnGuardar.innerHTML = textoOriginal;
        }
    }
}

// =========================================================================
// GESTIÓN DE VENDEDORES
// =========================================================================

async function cargarVisibilidadVendedores() {
    const tbody = document.getElementById('tbodyVisibilidadVendedores');
    if (tbody && _visibVendedores.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="p-8 text-center text-slate-400 italic">Cargando catálogo de vendedores desde Microsip...</td></tr>`;
    }

    try {
        _visibCargando = true;
        const resp = await fetch('/api/config/visibilidad/vendedores');
        const data = await resp.json();

        if (!data.success) {
            throw new Error(data.error || 'Error al obtener vendedores');
        }

        _visibVendedores = data.vendedores || [];

        // Actualizar badge en la píldora superior
        const badgeCount = document.getElementById('badgePillVendedoresCount');
        if (badgeCount) {
            const visiblesCount = _visibVendedores.filter(v => v.visible).length;
            badgeCount.textContent = `${visiblesCount}/${_visibVendedores.length}`;
        }

        actualizarKpisVendedores();
        filtrarVendedoresVisibilidad();

    } catch (err) {
        console.error("Error al cargar visibilidad de vendedores:", err);
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="7" class="p-8 text-center text-red-500 font-bold">Error al cargar vendedores: ${err.message}</td></tr>`;
        }
        if (typeof mostrarAlerta === 'function') {
            mostrarAlerta('error', `No se pudo consultar el catálogo de vendedores: ${err.message}`);
        }
    } finally {
        _visibCargando = false;
    }
}

function actualizarKpisVendedores() {
    const total = _visibVendedores.length;
    const visibles = _visibVendedores.filter(v => v.visible);
    const ocultos = total - visibles.length;
    const totalVentaVisibles = visibles.reduce((acc, v) => acc + (Number(v.total_venta_2026) || 0), 0);

    const elTotal = document.getElementById('kpiVisibVendTotal');
    const elVisibles = document.getElementById('kpiVisibVendVisibles');
    const elOcultos = document.getElementById('kpiVisibVendOcultos');
    const elVenta = document.getElementById('kpiVisibVendVentaTotal');

    if (elTotal) elTotal.textContent = formatearEnteroVisib(total);
    if (elVisibles) elVisibles.textContent = formatearEnteroVisib(visibles.length);
    if (elOcultos) elOcultos.textContent = formatearEnteroVisib(ocultos);
    if (elVenta) elVenta.textContent = formatearDineroVisib(totalVentaVisibles);

    const badgeCount = document.getElementById('badgePillVendedoresCount');
    if (badgeCount) badgeCount.textContent = `${visibles.length}/${total}`;
}

function filtrarVendedoresVisibilidad() {
    const inputBusq = document.getElementById('inputBuscarVendedorVisib');
    const selectFiltro = document.getElementById('selectFiltroEstadoVendedorVisib');

    const texto = (inputBusq?.value || '').trim().toLowerCase();
    const filtro = selectFiltro?.value || 'todos';

    let filtrados = _visibVendedores.filter(v => {
        const matchTexto = !texto || 
            String(v.vendedor_id).includes(texto) || 
            (v.nombre || '').toLowerCase().includes(texto);

        if (!matchTexto) return false;

        if (filtro === 'visibles') return v.visible === true;
        if (filtro === 'ocultos') return v.visible === false;
        if (filtro === 'con_ventas') return (Number(v.tickets_2026) || 0) > 0;
        return true;
    });

    renderizarTablaVendedoresVisibilidad(filtrados);
}

function renderizarTablaVendedoresVisibilidad(lista) {
    const tbody = document.getElementById('tbodyVisibilidadVendedores');
    if (!tbody) return;

    if (lista.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="p-8 text-center text-slate-400 italic">No se encontraron vendedores con los criterios aplicados.</td></tr>`;
        return;
    }

    tbody.innerHTML = lista.map(v => {
        const vId = v.vendedor_id;
        const nombre = v.nombre || `Vendedor ${vId}`;
        const esVisible = !!v.visible;
        const venta = Number(v.total_venta_2026) || 0;
        const tickets = Number(v.tickets_2026) || 0;
        const ultimaVenta = v.ultima_venta ? v.ultima_venta.split(' ')[0] : '<span class="text-slate-300">Sin ventas</span>';

        const switchBg = esVisible ? 'bg-emerald-600' : 'bg-slate-200';
        const switchDot = esVisible ? 'translate-x-5' : 'translate-x-1';

        const badgeEstado = esVisible 
            ? `<span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-800 border border-emerald-200"><span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>Visible</span>`
            : `<span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-black bg-slate-100 text-slate-500 border border-slate-200"><span class="w-1.5 h-1.5 rounded-full bg-slate-400"></span>Oculto</span>`;

        const rowBg = esVisible ? 'hover:bg-slate-50/80 transition-colors' : 'bg-slate-50/40 opacity-70 hover:opacity-100 transition-opacity';

        return `
            <tr class="${rowBg}">
                <td class="p-3 text-center">
                    <button type="button" onclick="toggleVisibilidadVendedor(${vId})" class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer focus:outline-none ${switchBg}" title="${esVisible ? 'Haga clic para ocultar' : 'Haga clic para mostrar'}">
                        <span class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform shadow-xs ${switchDot}"></span>
                    </button>
                </td>
                <td class="p-3 font-mono font-bold text-slate-500">#${vId}</td>
                <td class="p-3">
                    <div class="font-bold text-slate-900">${nombre}</div>
                    ${v.oculto_microsip ? '<span class="text-[9px] font-extrabold uppercase px-1.5 py-0.2 bg-amber-100 text-amber-800 rounded">Oculto en Microsip</span>' : ''}
                </td>
                <td class="p-3 text-right font-black ${venta > 0 ? 'text-indigo-950 font-mono' : 'text-slate-400'}">
                    ${formatearDineroVisib(venta)}
                </td>
                <td class="p-3 text-right font-mono font-bold ${tickets > 0 ? 'text-slate-700' : 'text-slate-300'}">
                    ${formatearEnteroVisib(tickets)}
                </td>
                <td class="p-3 text-center text-[11px] font-medium text-slate-600">
                    ${ultimaVenta}
                </td>
                <td class="p-3 text-center">
                    ${badgeEstado}
                </td>
            </tr>
        `;
    }).join('');
}

function toggleVisibilidadVendedor(vId) {
    const item = _visibVendedores.find(v => v.vendedor_id === vId);
    if (!item) return;

    item.visible = !item.visible;
    actualizarKpisVendedores();
    filtrarVendedoresVisibilidad();
}

function activarTodosVendedores() {
    _visibVendedores.forEach(v => v.visible = true);
    actualizarKpisVendedores();
    filtrarVendedoresVisibilidad();
}

function desactivarTodosVendedores() {
    _visibVendedores.forEach(v => v.visible = false);
    actualizarKpisVendedores();
    filtrarVendedoresVisibilidad();
}

async function guardarVisibilidadVendedores() {
    const btnGuardar = document.getElementById('btnGuardarVisibilidadActiva');
    const textoOriginal = btnGuardar ? btnGuardar.innerHTML : '';

    try {
        if (btnGuardar) {
            btnGuardar.disabled = true;
            btnGuardar.innerHTML = `<span class="animate-spin mr-1">⏳</span> Guardando...`;
        }

        const payload = {
            vendedores: _visibVendedores.map(v => ({
                vendedor_id: v.vendedor_id,
                nombre: v.nombre,
                visible: !!v.visible
            }))
        };

        const resp = await fetch('/api/config/visibilidad/vendedores', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await resp.json();
        if (!data.success) {
            throw new Error(data.error || 'No fue posible guardar la configuración');
        }

        if (typeof mostrarAlerta === 'function') {
            mostrarAlerta('success', `¡Configuración de vendedores guardada con éxito! (${_visibVendedores.filter(v => v.visible).length} vendedores activos).`);
        }

    } catch (err) {
        console.error("Error al guardar visibilidad de vendedores:", err);
        if (typeof mostrarAlerta === 'function') {
            mostrarAlerta('error', `Error al guardar: ${err.message}`);
        }
    } finally {
        if (btnGuardar) {
            btnGuardar.disabled = false;
            btnGuardar.innerHTML = textoOriginal;
        }
    }
}

// Exportar globalmente
window.cargarModuloVisibilidad = cargarModuloVisibilidad;
window.cambiarSubSeccionVisibilidad = cambiarSubSeccionVisibilidad;
window.guardarVisibilidadActual = guardarVisibilidadActual;
window.cargarVisibilidadSucursales = cargarVisibilidadSucursales;
window.filtrarSucursalesVisibilidad = filtrarSucursalesVisibilidad;
window.toggleVisibilidadSucursal = toggleVisibilidadSucursal;
window.activarTodasSucursales = activarTodasSucursales;
window.desactivarTodasSucursales = desactivarTodasSucursales;
window.restablecerSucursalesFisicas = restablecerSucursalesFisicas;
window.guardarVisibilidadSucursales = guardarVisibilidadSucursales;
window.cargarVisibilidadVendedores = cargarVisibilidadVendedores;
window.filtrarVendedoresVisibilidad = filtrarVendedoresVisibilidad;
window.toggleVisibilidadVendedor = toggleVisibilidadVendedor;
window.activarTodosVendedores = activarTodosVendedores;
window.desactivarTodosVendedores = desactivarTodosVendedores;
window.guardarVisibilidadVendedores = guardarVisibilidadVendedores;

