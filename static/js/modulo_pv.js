/**
 * Módulo Punto de Venta ERP BC Refaccionarias
 * Venta de mostrador, cotizaciones, consulta multi-almacén, catálogo vehicular y envío a caja Microsip.
 */

const PV_STATE = {
    clienteActual: null,
    vendedorActual: null,
    sucursalActualId: null,
    sucursalActualNombre: '',
    vendedorActualId: null,
    vendedorActualNombre: '',
    catalogoSucursales: [],
    catalogoVendedores: [],
    articulosEncontrados: [],
    carrito: [],
    observaciones: '',
    tipoEntrega: 'TIENDA',
    direccionEnvio: '',
    articuloModalActual: null,
    timerBusquedaCliente: null,
    timerBusquedaArticulo: null
};

// ================= INICIALIZACIÓN =================

function inicializarModuloPuntoVenta(forzar = false) {
    if (forzar) {
        pvDeseleccionarCliente();
        PV_STATE.carrito = [];
        PV_STATE.articulosEncontrados = [];
        pvActualizarCarritoUi();
        const inputArt = document.getElementById('pvInputBusquedaArticulo');
        if (inputArt) inputArt.value = '';
    } else {
        pvDeseleccionarCliente();
    }
    pvIniciarReloj();
    pvInicializarEventosCliente();
    pvInicializarAutocompletadoArticulos();
    pvCargarFiltrosVehicularesIniciales();
    pvCargarSucursalYVendedor();
    pvCargarArticulosIniciales();
}

function pvIniciarReloj() {
    function actualizarReloj() {
        const ahora = new Date();
        const fEl = document.getElementById('pvRelojFecha');
        const hEl = document.getElementById('pvRelojHora');
        if (fEl) {
            const anio = ahora.getFullYear();
            const mes = String(ahora.getMonth() + 1).padStart(2, '0');
            const dia = String(ahora.getDate()).padStart(2, '0');
            fEl.textContent = `${anio}-${mes}-${dia}`;
        }
        if (hEl) {
            hEl.textContent = ahora.toTimeString().split(' ')[0];
        }
    }
    actualizarReloj();
    setInterval(actualizarReloj, 1000);
}

async function pvCargarSucursalYVendedor() {
    if (!PV_STATE.catalogoSucursales || PV_STATE.catalogoSucursales.length === 0) {
        try {
            const res = await fetch('/api/catalogos/sucursales-vendedores');
            const data = await res.json();
            if (data.success) {
                PV_STATE.catalogoSucursales = data.sucursales || [];
                PV_STATE.catalogoVendedores = data.vendedores || [];
            }
        } catch (e) {
            console.error("Error al cargar sucursales y vendedores:", e);
        }
    }

    const u = (typeof currentUser !== 'undefined') ? currentUser : null;
    const esAdmin = u && (u.rol === 'ADMIN' || (Array.isArray(u.permisos) && u.permisos.includes('*')));

    if (u && u.sucursal_id) {
        PV_STATE.sucursalActualId = u.sucursal_id;
        PV_STATE.sucursalActualNombre = u.sucursal_nombre || 'Sucursal Asignada';
    } else if (PV_STATE.catalogoSucursales && PV_STATE.catalogoSucursales.length > 0) {
        const sucDef = PV_STATE.catalogoSucursales.find(s => s.nombre.toUpperCase().includes('CEDIS')) || PV_STATE.catalogoSucursales[0];
        PV_STATE.sucursalActualId = sucDef.id;
        PV_STATE.sucursalActualNombre = sucDef.nombre;
    }

    if (u && u.vendedor_id) {
        PV_STATE.vendedorActualId = u.vendedor_id;
        PV_STATE.vendedorActualNombre = u.vendedor_nombre || u.nombre;
    } else {
        PV_STATE.vendedorActualNombre = u ? (u.nombre || u.usuario) : 'Vendedor Mostrador';
    }

    pvActualizarUiSucursalYVendedor(esAdmin);
}

function pvActualizarUiSucursalYVendedor(esAdmin) {
    const wrapSel = document.getElementById('pvWrapSelectorSucursal');
    const txtFija = document.getElementById('pvTxtSucursalFija');
    const elNom = document.getElementById('pvTxtVendedorNombre');
    const selSuc = document.getElementById('pvSelectSucursalOperacion');

    if (elNom) elNom.textContent = PV_STATE.vendedorActualNombre || 'Vendedor Mostrador';

    if (esAdmin && wrapSel && selSuc && PV_STATE.catalogoSucursales && PV_STATE.catalogoSucursales.length > 0) {
        wrapSel.classList.remove('hidden');
        if (txtFija) txtFija.classList.add('hidden');
        selSuc.innerHTML = PV_STATE.catalogoSucursales.map(s => 
            `<option value="${s.id}" ${s.id === PV_STATE.sucursalActualId ? 'selected' : ''}>${s.nombre}</option>`
        ).join('');
    } else {
        if (wrapSel) wrapSel.classList.add('hidden');
        if (txtFija) {
            txtFija.classList.remove('hidden');
            txtFija.textContent = PV_STATE.sucursalActualNombre || 'Sucursal Principal';
        }
    }
}

function pvCambiarSucursalOperacion(sucId) {
    if (!sucId) return;
    const suc = (PV_STATE.catalogoSucursales || []).find(s => String(s.id) === String(sucId));
    if (suc) {
        PV_STATE.sucursalActualId = suc.id;
        PV_STATE.sucursalActualNombre = suc.nombre;
        
        // Auto-seleccionar vendedor que coincida con la sucursal seleccionada
        const palabras = suc.nombre.replace("SUCURSAL", "").replace("NO UTILIZAR", "").trim().split(/\s+/).filter(w => w.length > 3);
        let matchV = null;
        if (PV_STATE.catalogoVendedores) {
            for (let p of palabras) {
                matchV = PV_STATE.catalogoVendedores.find(v => v.nombre.toUpperCase().includes(p.toUpperCase()));
                if (matchV) break;
            }
        }
        if (matchV) {
            PV_STATE.vendedorActualId = matchV.id;
            PV_STATE.vendedorActualNombre = matchV.nombre;
            const elNom = document.getElementById('pvTxtVendedorNombre');
            if (elNom) elNom.textContent = matchV.nombre;
        }

        // Si hay una búsqueda activa, refrescar para consultar stock local de la nueva sucursal
        const inputArt = document.getElementById('pvInputBusquedaArticulo');
        if (inputArt && inputArt.value.trim()) {
            pvEjecutarBusquedaArticulos();
        }
    }
}

// ================= GESTIÓN DE CLIENTES Y CRÉDITO =================

function pvInicializarEventosCliente() {
    const input = document.getElementById('pvInputCliente');
    const dropdown = document.getElementById('pvDropdownClientes');
    if (!input || !dropdown) return;

    input.addEventListener('input', function() {
        const q = this.value.trim();
        clearTimeout(PV_STATE.timerBusquedaCliente);
        if (q.length < 2) {
            dropdown.classList.add('hidden');
            return;
        }
        PV_STATE.timerBusquedaCliente = setTimeout(() => {
            pvBuscarClientesApi(q);
        }, 200);
    });

    document.addEventListener('click', function(e) {
        if (!input.contains(e.target) && !dropdown.contains(e.target)) {
            dropdown.classList.add('hidden');
        }
    });
}

async function pvBuscarClientesApi(q) {
    const dropdown = document.getElementById('pvDropdownClientes');
    if (!dropdown) return;
    try {
        const res = await fetch(`/api/pv/clientes/buscar?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        if (data.success && data.clientes && data.clientes.length > 0) {
            dropdown.innerHTML = data.clientes.map(c => `
                <div class="p-2.5 hover:bg-slate-50 cursor-pointer transition flex items-center justify-between"
                     onclick='pvSeleccionarCliente(${JSON.stringify(c).replace(/'/g, "&apos;")})'>
                    <div>
                        <div class="font-bold text-slate-900">${c.nombre}</div>
                        <div class="text-[10px] text-slate-500">${c.tipo_cliente} &bull; ${c.forma_cobro}</div>
                    </div>
                    <div class="text-right text-[10px]">
                        <span class="font-semibold text-slate-400">Límite:</span>
                        <span class="font-bold text-slate-700">${formatearMoneda(c.limite_credito)}</span>
                    </div>
                </div>
            `).join('');
            dropdown.classList.remove('hidden');
        } else {
            dropdown.innerHTML = `<div class="p-3 text-center text-slate-400 italic">No se encontraron clientes</div>`;
            dropdown.classList.remove('hidden');
        }
    } catch (e) {
        dropdown.classList.add('hidden');
    }
}

function pvBuscarClienteManual() {
    const input = document.getElementById('pvInputCliente');
    if (input && input.value.trim()) {
        pvBuscarClientesApi(input.value.trim());
    } else if (input) {
        input.focus();
    }
}

async function pvSeleccionarCliente(clienteSimple) {
    const dropdown = document.getElementById('pvDropdownClientes');
    if (dropdown) dropdown.classList.add('hidden');

    try {
        const res = await fetch(`/api/pv/clientes/detalle/${clienteSimple.id}`);
        const data = await res.json();
        if (data.success && data.cliente) {
            PV_STATE.clienteActual = data.cliente;
            pvActualizarUiCliente(data.cliente);
        }
    } catch (e) {
        console.error("Error al obtener detalle del cliente:", e);
    }
}

function pvActualizarUiCliente(cli) {
    const boxBusq = document.getElementById('pvBoxBusquedaCliente');
    const boxSel = document.getElementById('pvBoxClienteSeleccionado');
    const txtNom = document.getElementById('pvClienteNombre');
    const bTabla = document.getElementById('pvBadgeTablaAsignada');
    const bCobro = document.getElementById('pvBadgeFormaCobro');

    if (boxBusq) boxBusq.classList.add('hidden');
    if (boxSel) boxSel.classList.remove('hidden');
    if (txtNom) txtNom.textContent = cli.nombre;
    if (bTabla) {
        bTabla.textContent = `Tabla Asignada: ${cli.tabla_asignada || 'Público en General'}`;
        const esTaller = (cli.tabla_asignada || '').includes('Taller') || (cli.tabla_asignada || '').includes('Flotilla');
        bTabla.className = `text-[10px] font-bold ${esTaller ? 'bg-indigo-50 text-indigo-700 border-indigo-200/90' : 'bg-slate-100 text-slate-700 border-slate-200/90'} px-2.5 py-1.5 rounded-xl border shadow-2xs whitespace-nowrap`;
    }
    if (bCobro) bCobro.textContent = `FORMA DE COBRO: ${cli.forma_cobro || 'CONTADO'}`;

    // Tarjetas de Crédito
    const cardLim = document.getElementById('pvCardLimiteCredito');
    const cardVenc = document.getElementById('pvCardSaldoVencido');
    const cardSal = document.getElementById('pvCardSaldoCliente');
    const cardDisp = document.getElementById('pvCardSaldoDisponible');

    pvActualizarBadgeSaldo(cardLim, cli.limite_credito, 'limite');
    pvActualizarBadgeSaldo(cardVenc, cli.saldo_vencido, 'vencido');
    pvActualizarBadgeSaldo(cardSal, cli.saldo_cliente, 'saldo');
    pvActualizarBadgeSaldo(cardDisp, cli.saldo_disponible, 'disponible');

    // Al seleccionar cliente, si ya había un artículo en el mostrador o resultados, actualizar precios visuales
    if (PV_STATE.articuloMostradorActivo) {
        pvRenderizarFichaMostrador(PV_STATE.articuloMostradorActivo);
    } else if (PV_STATE.articulosEncontrados && PV_STATE.articulosEncontrados.length > 0) {
        pvRenderizarGridArticulos(PV_STATE.articulosEncontrados);
    }
    pvRecalcularPreciosCarrito();
}

function pvRecalcularPreciosCarrito() {
    if (!PV_STATE.carrito || PV_STATE.carrito.length === 0) return;
    PV_STATE.carrito.forEach(item => {
        if (!item.es_bonificacion) {
            item.precio = pvObtenerPrecioArticulo(item) || item.precio;
        }
    });
    pvActualizarCarritoUi();
}

// Determinar el precio exacto del artículo según el cliente (Público por default si no se busca cliente)
function pvObtenerPrecioArticulo(art) {
    if (!art) return 0;
    const cli = PV_STATE.clienteActual;
    const esTallerOMayoreo = cli && (
        (cli.tabla_asignada && (cli.tabla_asignada.includes('Taller') || cli.tabla_asignada.includes('Flotilla') || cli.tabla_asignada.includes('Mayoreo'))) ||
        (cli.tipo_cliente && (cli.tipo_cliente.includes('TALLER') || cli.tipo_cliente.includes('FLOTILLA') || cli.tipo_cliente.includes('MAYOREO')))
    );

    if (esTallerOMayoreo) {
        return (art.precio_taller && art.precio_taller > 0) ? art.precio_taller : (art.precio || art.precio_publico || 0);
    }
    // Si no se busca un cliente (o es Público en General), dar por default precio público
    return (art.precio_publico && art.precio_publico > 0) ? art.precio_publico : (art.precio || 0);
}

function pvActualizarBadgeSaldo(el, valor, tipo) {
    if (!el) return;
    const num = parseFloat(valor || 0);
    const txt = formatearMoneda(num);
    el.textContent = txt;
    el.title = `${txt}`;

    // Tipografía adaptativa para garantizar que NUNCA se corte la cifra
    let fontClass = 'text-xs xl:text-sm';
    if (txt.length >= 13) {
        fontClass = 'text-[9.5px] xl:text-[10.5px]';
    } else if (txt.length >= 11) {
        fontClass = 'text-[10.5px] xl:text-xs';
    } else if (txt.length >= 9) {
        fontClass = 'text-[11.5px] xl:text-xs';
    }

    let colorClass = 'text-slate-800';
    if (tipo === 'vencido') {
        colorClass = num > 0 ? 'text-rose-600 font-extrabold' : 'text-slate-800';
    } else if (tipo === 'disponible') {
        colorClass = num > 0 ? 'text-emerald-700 font-extrabold' : (num < 0 ? 'text-rose-600 font-extrabold' : 'text-slate-700');
    }

    el.className = `${fontClass} font-black mt-0.5 whitespace-nowrap tabular-nums tracking-tight leading-none ${colorClass}`;
}

function pvDeseleccionarCliente() {
    PV_STATE.clienteActual = null;
    const boxBusq = document.getElementById('pvBoxBusquedaCliente');
    const boxSel = document.getElementById('pvBoxClienteSeleccionado');
    const input = document.getElementById('pvInputCliente');
    const bTabla = document.getElementById('pvBadgeTablaAsignada');
    const bCobro = document.getElementById('pvBadgeFormaCobro');

    if (boxBusq) boxBusq.classList.remove('hidden');
    if (boxSel) boxSel.classList.add('hidden');
    if (input) {
        input.value = '';
    }

    // Por default: Tabla Asignada = Público en General, Forma de Cobro = CONTADO
    if (bTabla) {
        bTabla.textContent = 'Tabla Asignada: Público en General';
        bTabla.className = 'text-[10px] font-bold bg-slate-100 text-slate-700 px-2.5 py-1.5 rounded-xl border border-slate-200/90 shadow-2xs whitespace-nowrap';
    }
    if (bCobro) {
        bCobro.textContent = 'FORMA DE COBRO: CONTADO';
        bCobro.className = 'text-[10px] font-bold bg-slate-100 text-slate-700 px-2.5 py-1.5 rounded-xl border border-slate-200/90 shadow-2xs whitespace-nowrap';
    }

    // Resetear tarjetas a '$0.00'
    pvActualizarBadgeSaldo(document.getElementById('pvCardLimiteCredito'), 0, 'limite');
    pvActualizarBadgeSaldo(document.getElementById('pvCardSaldoVencido'), 0, 'vencido');
    pvActualizarBadgeSaldo(document.getElementById('pvCardSaldoCliente'), 0, 'saldo');
    pvActualizarBadgeSaldo(document.getElementById('pvCardSaldoDisponible'), 0, 'disponible');

    // Refrescar mostrador o grid para regresar a precio público
    if (PV_STATE.articuloMostradorActivo) {
        pvRenderizarFichaMostrador(PV_STATE.articuloMostradorActivo);
    } else if (PV_STATE.articulosEncontrados && PV_STATE.articulosEncontrados.length > 0) {
        pvRenderizarGridArticulos(PV_STATE.articulosEncontrados);
    }
    pvRecalcularPreciosCarrito();
}

// ================= CATÁLOGO VEHICULAR Y FILTROS =================

async function pvCargarFiltrosVehicularesIniciales() {
    // 1. Años (2026 a 1985)
    const selAnio = document.getElementById('pvFiltroAnio');
    if (selAnio) {
        let opts = '<option value="">Selecciona un año</option>';
        for (let y = 2026; y >= 1990; y--) {
            opts += `<option value="${y}">${y}</option>`;
        }
        selAnio.innerHTML = opts;
    }

    // 2. Marcas desde GLOBALVEHICULOS
    const selMarca = document.getElementById('pvFiltroMarca');
    if (selMarca) {
        try {
            const res = await fetch('/api/pv/vehiculos/marcas');
            const data = await res.json();
            if (data.success && data.marcas) {
                selMarca.innerHTML = '<option value="">Selecciona una marca</option>' +
                    data.marcas.map(m => `<option value="${m.nombre}" data-id="${m.id}">${m.nombre}</option>`).join('');
            }
        } catch (e) {
            console.error("Error al cargar marcas:", e);
        }
    }
}

async function pvAlCambiarMarca() {
    const selMarca = document.getElementById('pvFiltroMarca');
    const selModelo = document.getElementById('pvFiltroModelo');
    const selSub = document.getElementById('pvFiltroSubmodelo');
    const selMotor = document.getElementById('pvFiltroMotor');

    if (!selMarca || !selModelo) return;
    const marca = selMarca.value;

    selModelo.innerHTML = '<option value="">Cargando modelos...</option>';
    if (selSub) selSub.innerHTML = '<option value="">Selecciona un submodelo</option>';
    if (selMotor) selMotor.innerHTML = '<option value="">Todos</option>';

    if (!marca) {
        selModelo.innerHTML = '<option value="">Selecciona un modelo</option>';
        pvActualizarBarraFiltrosInfo();
        return;
    }

    try {
        const opt = selMarca.options[selMarca.selectedIndex];
        const idMarca = opt ? opt.getAttribute('data-id') : '';
        const res = await fetch(`/api/pv/vehiculos/modelos?id_marca=${idMarca}&marca=${encodeURIComponent(marca)}`);
        const data = await res.json();
        if (data.success && data.modelos) {
            selModelo.innerHTML = '<option value="">Selecciona un modelo</option>' +
                data.modelos.map(m => `<option value="${m.nombre}" data-id="${m.id}">${m.nombre}</option>`).join('');
        }
    } catch (e) {
        selModelo.innerHTML = '<option value="">Error al cargar</option>';
    }

    pvActualizarBarraFiltrosInfo();
}

async function pvAlCambiarModelo() {
    const selModelo = document.getElementById('pvFiltroModelo');
    const selSub = document.getElementById('pvFiltroSubmodelo');
    const selMotor = document.getElementById('pvFiltroMotor');
    if (!selModelo || !selSub) return;

    const opt = selModelo.options[selModelo.selectedIndex];
    const idModelo = opt ? opt.getAttribute('data-id') : '';
    const modelo = selModelo.value;

    if (!idModelo) {
        selSub.innerHTML = '<option value="">Selecciona un submodelo</option>';
        pvActualizarBarraFiltrosInfo();
        return;
    }

    try {
        const [resSub, resAnios] = await Promise.all([
            fetch(`/api/pv/vehiculos/submodelos?modelo_id=${idModelo}&modelo=${encodeURIComponent(modelo)}`),
            fetch(`/api/pv/vehiculos/anios-motores?modelo_id=${idModelo}`)
        ]);

        const dataSub = await resSub.json();
        const dataAnios = await resAnios.json();

        if (dataSub.success && dataSub.submodelos) {
            selSub.innerHTML = '<option value="">Selecciona un submodelo</option>' +
                dataSub.submodelos.map(s => `<option value="${s.nombre}" data-id="${s.id}">${s.nombre}</option>`).join('');
        }

        if (dataAnios.success && dataAnios.motores && selMotor) {
            selMotor.innerHTML = '<option value="">Todos</option>' +
                dataAnios.motores.map(m => `<option value="${m}">${m}</option>`).join('');
        }

        // Cargar familias de productos dinámicas existentes para este vehículo
        const selMarca = document.getElementById('pvFiltroMarca');
        const marca = selMarca ? selMarca.value : '';
        const anio = document.getElementById('pvFiltroAnio')?.value || '';
        
        try {
            const resProd = await fetch(`/api/pv/vehiculos/productos?marca=${encodeURIComponent(marca)}&modelo=${encodeURIComponent(modelo)}&anio=${encodeURIComponent(anio)}`);
            const dataProd = await resProd.json();
            const selProd = document.getElementById('pvFiltroProducto');
            if (selProd && dataProd.success && dataProd.productos && dataProd.productos.length > 0) {
                const prodActual = selProd.value;
                let opts = '<option value="">Todas las familias</option>';
                dataProd.productos.forEach(p => {
                    const iconP = p.toUpperCase().includes('AMORTIGUADOR') ? '🔩 ' :
                                  p.toUpperCase().includes('ACUMULADOR') ? '🔋 ' :
                                  p.toUpperCase().includes('FILTRO') ? '🛢️ ' :
                                  p.toUpperCase().includes('BALERO') || p.toUpperCase().includes('MAZA') ? '💿 ' :
                                  p.toUpperCase().includes('SOPORTE') ? '🧱 ' :
                                  p.toUpperCase().includes('ROTULA') || p.toUpperCase().includes('HORQUILLA') ? '🚗 ' :
                                  p.toUpperCase().includes('TERMINAL') ? '🧭 ' : '⚙️ ';
                    opts += `<option value="${p}">${iconP}${p}</option>`;
                });
                selProd.innerHTML = opts;
                if (prodActual) selProd.value = prodActual;
            }
        } catch (eProd) {
            console.error("Aviso al cargar productos vehiculares:", eProd);
        }
    } catch (e) {
        console.error("Error al cargar submodelos:", e);
    }

    pvActualizarBarraFiltrosInfo();
}

function pvAlCambiarSubmodelo() {
    pvActualizarBarraFiltrosInfo();
}

function pvAlCambiarFiltroVehicular() {
    pvActualizarBarraFiltrosInfo();
}

function pvActualizarBarraFiltrosInfo() {
    const elInfo = document.getElementById('pvInfoFiltrosActivos');
    if (!elInfo) return;

    const anio = document.getElementById('pvFiltroAnio')?.value || '';
    const marca = document.getElementById('pvFiltroMarca')?.value || '';
    const modelo = document.getElementById('pvFiltroModelo')?.value || '';
    const sub = document.getElementById('pvFiltroSubmodelo')?.value || '';
    const motor = document.getElementById('pvFiltroMotor')?.value || '';
    const prod = document.getElementById('pvFiltroProducto')?.value || '';

    const filtros = [];
    if (anio) filtros.push(`Año: ${anio}`);
    if (marca) filtros.push(`Marca: ${marca}`);
    if (modelo) filtros.push(`Modelo: ${modelo}`);
    if (sub) filtros.push(`Submodelo: ${sub}`);
    if (motor) filtros.push(`Motor: ${motor}`);
    if (prod) filtros.push(`Familia: ${prod}`);

    if (filtros.length > 0) {
        elInfo.innerHTML = `Filtros: <span class="font-bold text-slate-800">${filtros.join(' | ')}</span> &bull; <span class="text-indigo-600 font-bold">Haz clic en 'Buscar' o presiona Enter para consultar.</span>`;
    } else {
        elInfo.textContent = 'Selecciona un vehículo o escribe un código para iniciar la consulta.';
    }
}

// ================= CATÁLOGO DE ARTÍCULOS =================

async function pvCargarArticulosIniciales() {
    // Al abrir el punto de venta NO se muestran artículos si no se ha buscado nada
    PV_STATE.articulosEncontrados = [];
    pvRenderizarGridArticulos([]);
    const cEl = document.getElementById('pvConteoArticulosEncontrados');
    if (cEl) cEl.textContent = '0';
}

function pvLimpiarFiltrosVehiculares() {
    ['pvFiltroAnio', 'pvFiltroMarca', 'pvFiltroModelo', 'pvFiltroSubmodelo', 'pvFiltroMotor', 'pvFiltroProducto'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    const selMod = document.getElementById('pvFiltroModelo');
    if (selMod) selMod.innerHTML = '<option value="">Todos los modelos</option>';
    const selSub = document.getElementById('pvFiltroSubmodelo');
    if (selSub) selSub.innerHTML = '<option value="">Cualquier versión</option>';
    const selMot = document.getElementById('pvFiltroMotor');
    if (selMot) selMot.innerHTML = '<option value="">Cualquier motor</option>';
    const selProd = document.getElementById('pvFiltroProducto');
    if (selProd) {
        selProd.innerHTML = `
            <option value="">Todas las familias</option>
            <option value="AMORTIGUADOR">🔩 Amortiguadores</option>
            <option value="ACUMULADOR">🔋 Acumuladores</option>
            <option value="FILTRO">🛢️ Filtros</option>
            <option value="BUJIA">⚡ Bujías</option>
            <option value="BALATA">🛑 Frenos / Balatas</option>
            <option value="SUSPENSION">🚗 Suspensión</option>
            <option value="DIRECCION">🧭 Dirección</option>
            <option value="SOPORTE">🧱 Soportes</option>
            <option value="ACEITE">🧪 Aceites</option>
            <option value="BANDA">🔄 Bandas</option>
            <option value="MAZA">💿 Mazas y Baleros</option>
        `;
    }

    const input = document.getElementById('pvInputBusquedaArticulo');
    if (input) input.value = '';
    const btnClear = document.getElementById('pvBtnLimpiarBusqArt');
    if (btnClear) btnClear.classList.add('hidden');
    pvActualizarBarraFiltrosInfo();
    pvCargarArticulosIniciales();
}

let pvTimerSugerenciasArt = null;
let pvSugerenciasArtCache = [];
let pvIndiceSugerenciaArtActiva = -1;

function pvInicializarAutocompletadoArticulos() {
    const input = document.getElementById('pvInputBusquedaArticulo');
    const dropdown = document.getElementById('pvDropdownSugerenciasArticulo');
    const btnClear = document.getElementById('pvBtnLimpiarBusqArt');
    if (!input || !dropdown) return;

    input.addEventListener('input', function() {
        const query = this.value.trim().toUpperCase();
        if (btnClear) btnClear.classList.toggle('hidden', !query);
        clearTimeout(pvTimerSugerenciasArt);
        pvIndiceSugerenciaArtActiva = -1;

        if (query.length < 2) {
            pvCerrarDropdownSugerenciasArticulo();
            return;
        }

        pvTimerSugerenciasArt = setTimeout(async () => {
            try {
                const almId = PV_STATE.sucursalActualId || '';
                const res = await fetch(`/api/pv/articulos/sugerencias?q=${encodeURIComponent(query)}&almacen_id=${encodeURIComponent(almId)}`);
                const articulos = await res.json();
                pvSugerenciasArtCache = Array.isArray(articulos) ? articulos : [];
                pvRenderizarSugerenciasArticulos(query);
            } catch (e) {
                console.warn("Aviso al consultar sugerencias de artículos:", e);
                pvCerrarDropdownSugerenciasArticulo();
            }
        }, 180);
    });

    input.addEventListener('keydown', function(e) {
        if (dropdown && !dropdown.classList.contains('hidden')) {
            const items = dropdown.querySelectorAll('.pv-sugerencia-art-item');
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (items.length > 0) {
                    pvIndiceSugerenciaArtActiva = (pvIndiceSugerenciaArtActiva + 1) % items.length;
                    pvActualizarFocoSugerencia(items);
                }
                return;
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (items.length > 0) {
                    pvIndiceSugerenciaArtActiva = (pvIndiceSugerenciaArtActiva - 1 + items.length) % items.length;
                    pvActualizarFocoSugerencia(items);
                }
                return;
            } else if (e.key === 'Enter') {
                e.preventDefault();
                if (pvIndiceSugerenciaArtActiva >= 0 && pvIndiceSugerenciaArtActiva < pvSugerenciasArtCache.length) {
                    const sel = pvSugerenciasArtCache[pvIndiceSugerenciaArtActiva];
                    pvSeleccionarSugerenciaArticulo(sel.clave);
                    return;
                } else {
                    pvCerrarDropdownSugerenciasArticulo();
                    pvEjecutarBusquedaArticulos();
                    return;
                }
            } else if (e.key === 'Escape') {
                pvCerrarDropdownSugerenciasArticulo();
                return;
            }
        }

        if (e.key === 'Enter') {
            e.preventDefault();
            pvCerrarDropdownSugerenciasArticulo();
            pvEjecutarBusquedaArticulos();
        }
    });

    document.addEventListener('click', function(e) {
        if (input && !input.contains(e.target) && dropdown && !dropdown.contains(e.target)) {
            pvCerrarDropdownSugerenciasArticulo();
        }
    });
}

function pvRenderizarSugerenciasArticulos(query) {
    const dropdown = document.getElementById('pvDropdownSugerenciasArticulo');
    if (!dropdown) return;
    dropdown.innerHTML = '';

    if (!pvSugerenciasArtCache || pvSugerenciasArtCache.length === 0) {
        dropdown.innerHTML = `
            <div class="p-4 text-center text-xs text-slate-400 italic">
                No se encontraron refacciones con "<strong>${query}</strong>"
            </div>
        `;
        dropdown.classList.remove('hidden');
        return;
    }

    pvSugerenciasArtCache.forEach((art, idx) => {
        const item = document.createElement('div');
        item.className = "pv-sugerencia-art-item p-3 hover:bg-indigo-50/80 cursor-pointer flex items-center justify-between text-xs transition border-b border-slate-100 last:border-0";
        item.dataset.index = idx;

        const claveHigh = pvResaltarCoincidencia(art.clave, query);
        const nomHigh = pvResaltarCoincidencia(art.nombre, query);
        const eqBadge = art.equivalencia ? `<span class="text-[10px] font-mono font-bold bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded border border-slate-200">Eq: ${art.equivalencia}</span>` : '';

        const stockBc = Number(art.stock_bc || 0);
        const stockRt = Number(art.stock_rt || 0);

        // Requisito visual: Existencias de BC en rojo y RT en amarillo
        const badgeBc = stockBc > 0
            ? `<span class="inline-flex items-center gap-1 font-black text-[10.5px] text-red-700 bg-red-50 px-2 py-0.5 rounded-md border border-red-200 shadow-2xs">🔴 BC: ${stockBc} pzas</span>`
            : `<span class="inline-flex items-center gap-1 font-semibold text-[10px] text-slate-400 bg-slate-50 px-1.5 py-0.5 rounded-md border border-slate-200">BC: 0</span>`;

        const badgeRt = stockRt > 0
            ? `<span class="inline-flex items-center gap-1 font-black text-[10.5px] text-amber-900 bg-amber-50 px-2 py-0.5 rounded-md border border-amber-300 shadow-2xs">🟡 RT: ${stockRt} pzas</span>`
            : `<span class="inline-flex items-center gap-1 font-semibold text-[10px] text-slate-400 bg-slate-50 px-1.5 py-0.5 rounded-md border border-slate-200">RT: 0</span>`;

        const precioHtml = art.precio > 0
            ? `<span class="font-black text-slate-900 text-xs">${formatearMoneda(art.precio)}</span>`
            : '';

        item.innerHTML = `
            <div class="truncate mr-3 flex-1 min-w-0">
                <div class="flex items-center gap-2 flex-wrap">
                    <span class="font-mono font-black text-indigo-700 text-xs">${claveHigh}</span>
                    ${eqBadge}
                </div>
                <div class="text-[11px] text-slate-600 truncate mt-0.5 font-medium">${nomHigh}</div>
            </div>
            <div class="text-right flex flex-col items-end gap-1 shrink-0">
                ${precioHtml}
                <div class="flex items-center gap-1 flex-wrap justify-end">
                    ${badgeBc}
                    ${badgeRt}
                </div>
            </div>
        `;

        item.addEventListener('click', () => {
            pvSeleccionarSugerenciaArticulo(art.clave);
        });

        dropdown.appendChild(item);
    });

    dropdown.classList.remove('hidden');
}

function pvActualizarFocoSugerencia(items) {
    items.forEach((it, idx) => {
        if (idx === pvIndiceSugerenciaArtActiva) {
            it.classList.add('bg-indigo-100/90', 'ring-1', 'ring-indigo-300');
            it.scrollIntoView({ block: 'nearest' });
        } else {
            it.classList.remove('bg-indigo-100/90', 'ring-1', 'ring-indigo-300');
        }
    });
}

function pvSeleccionarSugerenciaArticulo(clave) {
    const input = document.getElementById('pvInputBusquedaArticulo');
    const btnClear = document.getElementById('pvBtnLimpiarBusqArt');
    if (input) {
        input.value = clave;
        if (btnClear) btnClear.classList.remove('hidden');
    }
    pvCerrarDropdownSugerenciasArticulo();
    // Cargar directamente la ficha de mostrador de 3 columnas solicitada
    pvCargarArticuloMostrador(clave);
}

function pvCerrarDropdownSugerenciasArticulo() {
    const dropdown = document.getElementById('pvDropdownSugerenciasArticulo');
    if (dropdown) dropdown.classList.add('hidden');
    pvIndiceSugerenciaArtActiva = -1;
}

function pvResaltarCoincidencia(texto, query) {
    if (!texto) return '';
    if (!query) return texto;
    const reg = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    return texto.replace(reg, '<span class="bg-amber-200 text-slate-900 rounded-xs px-0.5 font-black">$1</span>');
}

async function pvEjecutarBusquedaArticulos(terminoForzado) {
    pvCerrarDropdownSugerenciasArticulo();
    const input = document.getElementById('pvInputBusquedaArticulo');
    const q = (terminoForzado !== undefined) ? terminoForzado : (input ? input.value.trim() : '');
    const anio = document.getElementById('pvFiltroAnio')?.value || '';
    const marca = document.getElementById('pvFiltroMarca')?.value || '';
    const modelo = document.getElementById('pvFiltroModelo')?.value || '';
    const submodelo = document.getElementById('pvFiltroSubmodelo')?.value || '';
    const motor = document.getElementById('pvFiltroMotor')?.value || '';
    const producto = document.getElementById('pvFiltroProducto')?.value || '';

    const btnClear = document.getElementById('pvBtnLimpiarBusqArt');
    if (btnClear) btnClear.classList.toggle('hidden', !q);

    // Si no hay término ni filtros seleccionados, NO mostrar nada y dejar el placeholder limpio
    if (!q && !anio && !marca && !modelo && !submodelo && !motor && !producto) {
        PV_STATE.articulosEncontrados = [];
        pvRenderizarGridArticulos([]);
        const cEl = document.getElementById('pvConteoArticulosEncontrados');
        if (cEl) cEl.textContent = '0';
        return;
    }

    const grid = document.getElementById('pvGridArticulos');
    if (grid) {
        grid.innerHTML = `
            <div class="col-span-full bg-white p-12 text-center rounded-3xl border border-slate-200">
                <div class="animate-spin text-3xl mb-2">⚙️</div>
                <div class="text-sm font-bold text-slate-700">Buscando refacciones en catálogo...</div>
                <div class="text-xs text-slate-400 mt-1">Consultando existencias del Grupo y equivalencias</div>
            </div>
        `;
    }

    try {
        const query = new URLSearchParams();
        if (q) query.append('q', q);
        if (anio) query.append('anio', anio);
        if (marca) query.append('marca', marca);
        if (modelo) query.append('modelo', modelo);
        if (submodelo) query.append('submodelo', submodelo);
        if (motor) query.append('motor', motor);
        if (producto) query.append('producto', producto);
        if (PV_STATE.sucursalActualId) query.append('almacen_id', PV_STATE.sucursalActualId);
        if (PV_STATE.clienteActual?.id) query.append('cliente_id', PV_STATE.clienteActual.id);

        const res = await fetch(`/api/pv/articulos/buscar?${query.toString()}`);
        const data = await res.json();

        if (data.success && data.articulos) {
            PV_STATE.articulosEncontrados = data.articulos;
            const cEl = document.getElementById('pvConteoArticulosEncontrados');
            if (cEl) cEl.textContent = data.articulos.length;

            if (data.articulos.length === 1) {
                pvCargarArticuloMostrador(data.articulos[0].clave);
            } else {
                pvRenderizarGridArticulos(data.articulos);
            }
        } else {
            pvRenderizarGridArticulos([]);
            const cEl = document.getElementById('pvConteoArticulosEncontrados');
            if (cEl) cEl.textContent = '0';
        }
    } catch (e) {
        console.error("Error al buscar artículos:", e);
        if (grid) {
            grid.innerHTML = `<div class="col-span-full p-8 text-center text-red-500 font-bold text-xs bg-white rounded-2xl border border-red-200">Error al consultar el catálogo de artículos.</div>`;
        }
    }
}

function pvLimpiarBusquedaArticulos() {
    pvCerrarDropdownSugerenciasArticulo();
    const input = document.getElementById('pvInputBusquedaArticulo');
    if (input) {
        input.value = '';
        input.focus();
    }
    const btnClear = document.getElementById('pvBtnLimpiarBusqArt');
    if (btnClear) btnClear.classList.add('hidden');
    pvEjecutarBusquedaArticulos('');
}

function pvRenderizarGridArticulos(articulos) {
    const grid = document.getElementById('pvGridArticulos');
    if (!grid) return;

    const input = document.getElementById('pvInputBusquedaArticulo');
    const anio = document.getElementById('pvFiltroAnio')?.value || '';
    const marca = document.getElementById('pvFiltroMarca')?.value || '';
    const modelo = document.getElementById('pvFiltroModelo')?.value || '';
    const prod = document.getElementById('pvFiltroProducto')?.value || '';
    const qVal = input ? input.value.trim().toUpperCase() : '';

    const hayBusqueda = qVal || anio || marca || modelo || prod;

    if (!articulos || articulos.length === 0) {
        if (!hayBusqueda) {
            grid.innerHTML = `
                <div class="col-span-full bg-slate-50/70 border-2 border-dashed border-slate-200 p-12 text-center rounded-3xl">
                    <div class="w-16 h-16 mx-auto mb-3 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center text-3xl shadow-xs">
                        🔍
                    </div>
                    <h3 class="text-base font-black text-slate-800">Catálogo de Mostrador Listo</h3>
                    <p class="text-xs text-slate-500 max-w-md mx-auto mt-1 leading-relaxed">
                        Escribe un código, descripción o equivalente arriba, o selecciona los filtros de vehículo y presiona 'Buscar'.
                    </p>
                </div>
            `;
        } else {
            const esBujia = prod === 'BUJIA' || qVal.includes('BUJIA');
            const esFiltro = prod === 'FILTRO' || qVal.includes('FILTRO');
            const esAcum = prod === 'ACUMULADOR' || qVal.includes('ACUMULADOR') || qVal.includes('BATERIA');

            let iconMsg = '📦';
            let titleMsg = 'Sin coincidencias encontradas';
            let descMsg = 'No se encontraron artículos con los criterios seleccionados. Verifica la clave o intenta una búsqueda más amplia.';

            if (esBujia) {
                iconMsg = '⚡';
                titleMsg = 'No se encontraron bujías para este criterio';
                descMsg = 'No hay bujías específicas catalogadas para este modelo en la aplicación vehicular. Prueba buscando directamente por código de bujía (ej. NGK, Champion, Bosch) o borra el filtro de vehículo para ver bujías universales.';
            } else if (esFiltro) {
                iconMsg = '🛢️';
                titleMsg = 'No se encontraron filtros para este criterio';
                descMsg = 'Verifica que el año y modelo correspondan a las aplicaciones disponibles en catálogo.';
            } else if (esAcum) {
                iconMsg = '🔋';
                titleMsg = 'No se encontraron acumuladores para este criterio';
                descMsg = 'Verifica el tamaño de grupo o código de batería (ej. G-47, G-24, G-34) en la barra de búsqueda.';
            }

            grid.innerHTML = `
                <div class="col-span-full bg-slate-50/70 border-2 border-dashed border-slate-200 p-12 text-center rounded-3xl">
                    <div class="w-16 h-16 mx-auto mb-3 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center text-3xl shadow-xs">
                        ${iconMsg}
                    </div>
                    <h3 class="text-base font-black text-slate-800">${titleMsg}</h3>
                    <p class="text-xs text-slate-500 max-w-md mx-auto mt-1 leading-relaxed">
                        ${descMsg}
                    </p>
                </div>
            `;
        }
        return;
    }

    grid.innerHTML = articulos.map(art => {
        const nomUp = art.nombre.toUpperCase();
        const esBateria = art.clave.startsWith('G-') || art.clave.startsWith('CH-') || nomUp.includes('ACUMULADOR');
        const esAmort = nomUp.includes('AMORTIGUADOR');
        const esFiltro = art.clave.startsWith('GP-') || art.clave.startsWith('GA-') || nomUp.includes('FILTRO');
        const esBujia = nomUp.includes('BUJIA') || nomUp.includes('BUJÍA');
        const esFreno = nomUp.includes('BALATA') || nomUp.includes('FRENO');
        const iconSvg = esBateria ? '🔋' : esAmort ? '🔩' : esFiltro ? '🛢️' : esBujia ? '⚡' : esFreno ? '🛑' : '⚙️';

        const tieneFoto = !!(art.tiene_foto && art.foto_url);
        const fotoHtml = tieneFoto
            ? `<img src="${art.foto_url}" alt="${art.clave}" loading="lazy" class="w-full h-full object-contain p-1 rounded-xl transition duration-200 group-hover:scale-105" onerror="this.onerror=null; this.parentElement.innerHTML='<span class=\'text-2xl\'>${iconSvg}</span>';">`
            : `<span class="text-2xl">${iconSvg}</span>`;

        return `
            <div class="bg-white rounded-2xl border border-slate-200/90 shadow-2xs hover:shadow-md hover:border-indigo-400 transition-all duration-200 p-2.5 flex flex-col justify-between group">
                <div>
                    <!-- Fila Superior: Foto (izquierda) + Clave, Marca, Detalle y Nombre (derecha) -->
                    <div class="flex items-start gap-2.5">
                        <!-- Miniatura de Foto / Icono (Compacta y nítida) -->
                        <div class="w-16 h-16 sm:w-20 sm:h-20 bg-slate-50 rounded-xl border border-slate-100 flex items-center justify-center shrink-0 overflow-hidden relative cursor-pointer" onclick="pvCargarArticuloMostrador('${art.clave}')" title="Ver ficha completa de mostrador y existencias BC/RT">
                            ${fotoHtml}
                        </div>

                        <!-- Info: Clave, Marca, Equivalencia y Nombre -->
                        <div class="min-w-0 flex-1">
                            <div class="flex items-center justify-between gap-1">
                                <div class="flex items-center gap-1 min-w-0">
                                    <span class="text-xs sm:text-sm font-black text-slate-900 group-hover:text-indigo-600 transition tracking-tight truncate cursor-pointer" onclick="pvCargarArticuloMostrador('${art.clave}')">${art.clave}</span>
                                    <span class="text-[8px] font-black uppercase tracking-wider bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded border border-slate-200 shrink-0">${art.marca || 'GEN'}</span>
                                </div>
                                <button type="button" onclick="pvCargarArticuloMostrador('${art.clave}')" title="Ver ficha completa de mostrador y existencias BC/RT"
                                        class="h-7 w-7 rounded-lg bg-slate-100 hover:bg-indigo-50 hover:text-indigo-600 text-slate-500 flex items-center justify-center text-[10px] transition cursor-pointer active:scale-95 shrink-0">
                                    🔍
                                </button>
                            </div>

                            <!-- Nombre / Descripción bien visible y legible -->
                            <h4 class="text-[11px] sm:text-xs font-semibold text-slate-700 line-clamp-2 leading-tight mt-1" title="${art.nombre}">
                                ${art.nombre}
                            </h4>

                            ${art.equivalencia ? `
                                <div class="text-[9px] text-slate-400 font-mono truncate mt-0.5" title="Equivalencia: ${art.equivalencia}">
                                    Eq: ${art.equivalencia}
                                </div>
                            ` : ''}
                        </div>
                    </div>

                    <!-- Fila de Existencias (Compacta en 3 pastillas) -->
                    <div class="grid grid-cols-3 gap-1 text-[9px] mt-2">
                        <div class="px-1.5 py-1 rounded-lg border text-center ${art.stock_local > 0 ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-700'}">
                            <div class="font-bold uppercase text-[7px] truncate ${art.stock_local > 0 ? 'text-emerald-700' : 'text-rose-600'}">Tu Almacén</div>
                            <div class="font-black text-[11px] leading-tight">${art.stock_local}</div>
                        </div>
                        <div class="px-1.5 py-1 rounded-lg border text-center ${(art.stock_cedis || 0) > 0 ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-slate-50 border-slate-100 text-slate-400'}">
                            <div class="font-bold uppercase text-[7px] truncate ${(art.stock_cedis || 0) > 0 ? 'text-amber-700' : 'text-slate-400'}">CEDIS</div>
                            <div class="font-black text-[11px] leading-tight">${art.stock_cedis || 0}</div>
                        </div>
                        <div class="px-1.5 py-1 rounded-lg border border-slate-100 bg-slate-50 text-center">
                            <div class="text-slate-400 font-bold uppercase text-[7px] truncate">Global</div>
                            <div class="font-black text-slate-800 text-[11px] leading-tight">${art.stock_global}</div>
                        </div>
                    </div>
                </div>

                <!-- Footer Card: Precio y Botón de Acción -->
                <div class="mt-2.5 pt-2 border-t border-slate-100 flex items-center justify-between gap-1.5">
                    <div>
                        <div class="text-[8px] font-bold text-slate-400 uppercase tracking-wider">Precio Unitario</div>
                        <div class="text-sm sm:text-base font-black text-slate-900 leading-tight">${formatearMoneda(pvObtenerPrecioArticulo(art))}</div>
                    </div>
                    ${art.stock_local > 0 ? `
                        <button type="button" onclick='pvAgregarAlCarrito(${JSON.stringify(art).replace(/'/g, "&apos;")})'
                                class="h-8 px-3 bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white font-bold text-xs uppercase tracking-wider rounded-xl transition shadow-sm cursor-pointer flex items-center gap-1 shrink-0">
                            <span>➕</span>
                            <span>Agregar</span>
                        </button>
                    ` : (art.stock_cedis && art.stock_cedis > 0) ? `
                        <button type="button" onclick='pvAbrirModalSolicitarTraspasoCedis(${JSON.stringify(art).replace(/'/g, "&apos;")})'
                                class="h-8 px-2.5 bg-amber-500 hover:bg-amber-600 active:scale-95 text-white font-black text-[10px] uppercase tracking-wider rounded-xl transition shadow-sm cursor-pointer flex items-center gap-1 shrink-0"
                                title="Sin existencias locales. Solicitar traspaso a CEDIS">
                            <span>🚚</span>
                            <span>Pedir a CEDIS</span>
                        </button>
                    ` : `
                        <button type="button" disabled
                                class="h-8 px-2.5 bg-slate-100 text-slate-400 font-bold text-[10px] uppercase tracking-wider rounded-xl border border-slate-200 cursor-not-allowed flex items-center gap-1 shrink-0"
                                title="Agotado en tu sucursal y en CEDIS">
                            <span>✕</span>
                            <span>Sin Stock</span>
                        </button>
                    `}
                </div>
            </div>
        `;
    }).join('');
}

// ================= MOSTRADOR DE 3 COLUMNAS (Screenshot de Referencia) =================

async function pvCargarArticuloMostrador(clave) {
    if (!clave) return;
    const grid = document.getElementById('pvGridArticulos');
    if (grid) {
        grid.innerHTML = `
            <div class="col-span-full bg-white p-12 text-center rounded-3xl border border-slate-200 shadow-sm animate-pulse">
                <div class="text-3xl mb-2 animate-bounce">📦</div>
                <div class="text-base font-black text-slate-900 tracking-tight">Cargando mostrador de ${clave}...</div>
                <div class="text-xs text-slate-500 mt-1 flex items-center justify-center gap-2">
                    <span class="text-red-600 font-bold">🔴 Consultando BC Refaccionarias</span>
                    <span>&bull;</span>
                    <span class="text-amber-600 font-bold">🟡 Consultando RT Suspensiones</span>
                </div>
            </div>
        `;
    }

    try {
        const queryParams = new URLSearchParams();
        if (PV_STATE.sucursalActualId) queryParams.append('almacen_id', PV_STATE.sucursalActualId);
        if (PV_STATE.clienteActual?.id) queryParams.append('cliente_id', PV_STATE.clienteActual.id);
        const res = await fetch(`/api/pv/articulos/detalle/${encodeURIComponent(clave)}?${queryParams.toString()}`);
        const data = await res.json();
        if (data.success && data.articulo) {
            PV_STATE.articuloMostradorActivo = data.articulo;
            pvRenderizarFichaMostrador(data.articulo);
            const cEl = document.getElementById('pvConteoArticulosEncontrados');
            if (cEl) cEl.textContent = '1';
        } else {
            if (grid) {
                grid.innerHTML = `<div class="col-span-full p-8 text-center text-rose-600 font-bold text-xs bg-white rounded-2xl border border-rose-200">No fue posible obtener el detalle de ${clave}.</div>`;
            }
        }
    } catch (e) {
        console.error("Error al cargar artículo en mostrador:", e);
        if (grid) {
            grid.innerHTML = `<div class="col-span-full p-8 text-center text-rose-600 font-bold text-xs bg-white rounded-2xl border border-rose-200">Error de conexión al cargar la refacción.</div>`;
        }
    }
}

function pvRenderizarFichaMostrador(art) {
    const grid = document.getElementById('pvGridArticulos');
    if (!grid) return;

    // Detectar icono según familia si no tiene foto
    const nomUp = art.nombre.toUpperCase();
    const esBateria = art.clave.startsWith('G-') || art.clave.startsWith('CH-') || nomUp.includes('ACUMULADOR');
    const esAmort = nomUp.includes('AMORTIGUADOR');
    const esFiltro = art.clave.startsWith('GP-') || art.clave.startsWith('GA-') || nomUp.includes('FILTRO');
    const esBujia = nomUp.includes('BUJIA') || nomUp.includes('BUJÍA');
    const esFreno = nomUp.includes('BALATA') || nomUp.includes('FRENO');
    const iconSvg = esBateria ? '🔋' : esAmort ? '🔩' : esFiltro ? '🛢️' : esBujia ? '⚡' : esFreno ? '🛑' : '⚙️';

    const tieneFoto = !!(art.tiene_foto && art.foto_url);
    const fotoHtml = tieneFoto
        ? `<img src="${art.foto_url}" alt="${art.clave}" class="max-h-full max-w-full object-contain">`
        : `<div class="text-center text-slate-300 font-black tracking-widest text-xs uppercase flex flex-col items-center gap-1"><span class="text-3xl">${iconSvg}</span><span>IMAGEN</span></div>`;

    // Tabla asignada del cliente (si no se busca cliente, por default Público en General)
    const tablaAsig = PV_STATE.clienteActual ? (PV_STATE.clienteActual.tabla_asignada || 'Público en General') : 'Público en General';
    const precioMostrador = pvObtenerPrecioArticulo(art);

    // Barra de navegación si venía de una búsqueda amplia
    const barraVolver = (PV_STATE.articulosEncontrados && PV_STATE.articulosEncontrados.length > 1)
        ? `
            <div class="mb-3 flex items-center justify-between">
                <button type="button" onclick="pvVolverAGridResultados()"
                        class="text-xs font-black text-indigo-700 bg-indigo-50 hover:bg-indigo-100 active:scale-95 px-3 py-1.5 rounded-xl border border-indigo-200 transition cursor-pointer flex items-center gap-1.5 shadow-2xs">
                    <span>←</span>
                    <span>Volver a las ${PV_STATE.articulosEncontrados.length} refacciones encontradas</span>
                </button>
                <span class="text-[10px] text-slate-400 font-semibold">Mostrador de Refacción</span>
            </div>
        `
        : '';

    // Renderizar almacenes con diferenciación visual exacta de colores: BC en ROJO y RT en AMARILLO
    let almacenesHtml = '';
    if (art.existencias_almacenes && art.existencias_almacenes.length > 0) {
        almacenesHtml = art.existencias_almacenes.map(al => {
            const esRT = (al.empresa === 'RT' || al.nombre.toUpperCase().startsWith('RT '));
            if (esRT) {
                return `
                    <div class="bg-white rounded-xl border border-amber-300/90 hover:border-amber-500 p-2.5 flex items-center justify-between shadow-2xs transition">
                        <div class="flex items-center gap-2 min-w-0 pr-2">
                            <span class="text-[9px] font-black bg-amber-100 text-amber-900 border border-amber-300 px-1.5 py-0.5 rounded shrink-0">RT</span>
                            <span class="text-xs font-bold text-slate-800 uppercase tracking-tight truncate">${al.nombre}</span>
                        </div>
                        <div class="text-base font-black text-slate-900 shrink-0 tabular-nums">${al.piezas}</div>
                    </div>
                `;
            } else {
                return `
                    <div class="bg-white rounded-xl border border-red-200/90 hover:border-red-400 p-2.5 flex items-center justify-between shadow-2xs transition">
                        <div class="flex items-center gap-2 min-w-0 pr-2">
                            <span class="text-[9px] font-black bg-red-100 text-red-700 border border-red-200 px-1.5 py-0.5 rounded shrink-0">BC</span>
                            <span class="text-xs font-bold text-slate-800 uppercase tracking-tight truncate">${al.nombre}</span>
                        </div>
                        <div class="text-base font-black text-slate-900 shrink-0 tabular-nums">${al.piezas}</div>
                    </div>
                `;
            }
        }).join('');
    } else {
        almacenesHtml = '<div class="p-8 text-center text-xs text-slate-400 italic">Sin existencias registradas en almacenes</div>';
    }

    // Renderizar equivalencias con botón directo para agregar al pedido y stock ordenado desc
    let equivsHtml = '';
    if (art.equivalencias && art.equivalencias.length > 0) {
        equivsHtml = art.equivalencias.map(eq => {
            if (eq.stock > 0) {
                return `
                    <div class="bg-emerald-50/50 hover:bg-emerald-50 border border-emerald-200/90 hover:border-emerald-400 rounded-2xl p-2.5 transition shadow-2xs">
                        <div class="flex items-center justify-between gap-1">
                            <span class="text-xs font-black text-slate-900 hover:text-indigo-600 cursor-pointer"
                                  onclick="pvCargarArticuloMostrador('${eq.clave}')" title="Cargar equivalente ${eq.clave}">
                                ${eq.clave}
                            </span>
                            <div class="flex items-center gap-1.5">
                                <span class="text-xs font-black text-slate-900">${formatearMoneda(eq.precio)}</span>
                                <button type="button" onclick="event.stopPropagation(); pvAgregarEquivalenciaAlCarrito('${eq.clave}')"
                                        class="px-2 py-0.5 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-black text-[10px] rounded-lg transition shadow-2xs cursor-pointer flex items-center gap-1"
                                        title="Agregar esta equivalencia directamente al pedido">
                                    <span>🛒</span>
                                    <span>+ Carrito</span>
                                </button>
                            </div>
                        </div>
                        <div class="flex items-end justify-between gap-1 mt-1">
                            <div class="text-[10px] text-slate-600 line-clamp-2 leading-tight flex-1 pr-1 font-medium cursor-pointer"
                                 onclick="pvCargarArticuloMostrador('${eq.clave}')">${eq.nombre}</div>
                            <div class="text-xs font-black text-emerald-700 shrink-0 whitespace-nowrap">${eq.stock} pzas</div>
                        </div>
                        ${(eq.stock_bc > 0 || eq.stock_rt > 0) ? `
                            <div class="flex items-center gap-1.5 mt-1.5 text-[8.5px] font-bold">
                                ${eq.stock_bc > 0 ? `<span class="bg-red-50 text-red-700 border border-red-200 px-1 py-0.2 rounded">🔴 BC: ${eq.stock_bc}</span>` : ''}
                                ${eq.stock_rt > 0 ? `<span class="bg-amber-50 text-amber-900 border border-amber-300 px-1 py-0.2 rounded">🟡 RT: ${eq.stock_rt}</span>` : ''}
                            </div>
                        ` : ''}
                    </div>
                `;
            } else {
                return `
                    <div class="bg-rose-50/50 hover:bg-rose-50 border border-rose-200/80 rounded-2xl p-2.5 transition cursor-pointer shadow-2xs"
                         onclick="pvCargarArticuloMostrador('${eq.clave}')" title="Cargar equivalente ${eq.clave}">
                        <div class="flex items-center justify-between">
                            <span class="text-xs font-black text-slate-800">${eq.clave}</span>
                            <span class="text-xs font-black text-slate-800">${formatearMoneda(eq.precio)}</span>
                        </div>
                        <div class="flex items-end justify-between gap-1 mt-1">
                            <div class="text-[10px] text-slate-500 line-clamp-2 leading-tight flex-1 pr-1">${eq.nombre}</div>
                            <div class="text-[10px] font-black text-rose-600 shrink-0 whitespace-nowrap">Sin existencia</div>
                        </div>
                    </div>
                `;
            }
        }).join('');
    } else {
        equivsHtml = '<div class="p-8 text-center text-xs text-slate-400 italic">No hay equivalencias registradas para esta pieza</div>';
    }

    grid.innerHTML = `
        <div class="col-span-full bg-white rounded-3xl border border-slate-200/90 shadow-sm p-4 sm:p-5">
            ${barraVolver}

            <div class="grid grid-cols-1 lg:grid-cols-12 gap-5">
                
                <!-- COLUMNA 1: FICHA TÉCNICA DEL PRODUCTO (lg:col-span-5) -->
                <div class="lg:col-span-5 flex flex-col justify-between space-y-3.5 border-b lg:border-b-0 lg:border-r border-slate-200 pb-5 lg:pb-0 lg:pr-5">
                    <div>
                        <div class="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight leading-none">${art.clave}</div>
                        <div class="text-sm font-bold text-slate-700 mt-2">
                            Inventario almacén: <span class="text-emerald-600 font-black text-base sm:text-lg">${art.stock_tu_almacen || 0}</span> pzas
                        </div>
                        <div class="text-xs font-bold text-blue-700 mt-1">
                            Tabla asignada: ${tablaAsig}
                        </div>
                        <div class="flex flex-wrap items-center gap-1.5 mt-2">
                            <span class="text-[11px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200 px-2 py-0.5 rounded-lg">
                                🏷️ Clasificación: ${art.linea || 'GENERAL'}
                            </span>
                            ${art.marca ? `<span class="text-[11px] font-bold bg-slate-100 text-slate-700 border border-slate-200 px-2 py-0.5 rounded-lg">Marca: ${art.marca}</span>` : ''}
                        </div>
                        <h2 class="text-lg sm:text-xl font-black text-slate-900 uppercase leading-snug mt-2 tracking-tight">
                            ${art.nombre}
                        </h2>
                        <div class="text-xs text-slate-500 font-semibold mt-1">
                            Ubicación: <span class="text-slate-700 font-bold">${art.ubicacion || '-'}</span>
                        </div>
                        <div class="text-2xl sm:text-3xl font-black text-slate-900 mt-2 tracking-tight">
                            ${formatearMoneda(precioMostrador)}
                        </div>

                        <!-- Botones de Acción (AGREGAR AL PEDIDO, SOLICITAR TRASLADO, COTIZACION) -->
                        <div class="flex flex-wrap items-center gap-2 pt-3">
                            <button type="button" onclick="pvAgregarAlPedidoDesdeMostrador()"
                                    class="flex-1 min-w-[130px] py-3 px-3.5 bg-amber-400 hover:bg-amber-500 active:scale-95 text-slate-950 font-black text-xs uppercase tracking-wider rounded-xl shadow-sm transition cursor-pointer flex items-center justify-center gap-1.5">
                                <span>AGREGAR AL PEDIDO</span>
                            </button>
                            <button type="button" onclick="pvSolicitarTrasladoDesdeMostrador()"
                                    class="flex-1 min-w-[130px] py-3 px-3.5 bg-amber-400 hover:bg-amber-500 active:scale-95 text-slate-950 font-black text-xs uppercase tracking-wider rounded-xl shadow-sm transition cursor-pointer flex items-center justify-center gap-1.5">
                                <span>SOLICITAR TRASLADO</span>
                            </button>
                            <button type="button" onclick="pvCotizarDesdeMostrador()"
                                    class="py-2.5 px-3.5 bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 font-bold text-xs uppercase rounded-xl transition cursor-pointer">
                                <span>COTIZACION</span>
                            </button>
                        </div>
                    </div>

                    <!-- Contenedor de IMAGEN con Lupa Naranja para Zoom -->
                    <div class="h-44 sm:h-52 bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200 relative flex items-center justify-center overflow-hidden p-2 mt-2">
                        ${fotoHtml}
                        <button type="button" onclick="pvAbrirFotoZoom('${art.foto_url || ''}', '${art.clave}', '${art.nombre}')"
                                title="Ampliar imagen"
                                class="w-8 h-8 rounded-full bg-amber-400 hover:bg-amber-500 text-slate-950 shadow-md flex items-center justify-center text-sm font-black absolute top-2 right-2 transition cursor-pointer active:scale-95">
                            🔍
                        </button>
                    </div>
                </div>

                <!-- COLUMNA 2: EXISTENCIAS POR ALMACÉN (lg:col-span-4) -->
                <div class="lg:col-span-4 flex flex-col justify-between border-b lg:border-b-0 lg:border-r border-slate-200 pb-5 lg:pb-0 lg:pr-5">
                    <div>
                        <div class="flex flex-col gap-1.5 pb-2.5 border-b border-slate-100">
                            <div class="flex items-center justify-between">
                                <span class="text-xs font-black uppercase tracking-wider text-slate-900">EXISTENCIAS POR ALMACÉN</span>
                                <span class="text-xs font-bold text-slate-600">TOTAL: <strong class="text-sm font-black text-slate-900">${art.total_piezas || 0}</strong></span>
                            </div>
                            <div class="flex items-center gap-1.5 flex-wrap pt-0.5">
                                <span class="inline-flex items-center gap-1 font-black text-[10px] text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">🔴 BC: ${art.stock_bc_total || 0} pzas</span>
                                <span class="inline-flex items-center gap-1 font-black text-[10px] text-amber-900 bg-amber-50 border border-amber-300 px-2 py-0.5 rounded-full">🟡 RT: ${art.stock_rt_total || 0} pzas</span>
                            </div>
                        </div>

                        <!-- Lista con Scroll de Almacenes -->
                        <div class="max-h-[460px] overflow-y-auto space-y-2 pr-1 pt-2">
                            ${almacenesHtml}
                        </div>
                    </div>
                </div>

                <!-- COLUMNA 3: EQUIVALENCIAS (lg:col-span-3) -->
                <div class="lg:col-span-3 flex flex-col justify-between">
                    <div>
                        <div class="flex items-center justify-between pb-2.5 border-b border-slate-100">
                            <span class="text-xs font-black uppercase tracking-wider text-slate-900">Equivalencias (${art.equivalencias ? art.equivalencias.length : 0})</span>
                        </div>

                        <!-- Lista con Scroll de Equivalencias -->
                        <div class="max-h-[460px] overflow-y-auto space-y-2 pr-1 pt-2">
                            ${equivsHtml}
                        </div>
                    </div>
                </div>

            </div>
        </div>
    `;
}

function pvVolverAGridResultados() {
    if (PV_STATE.articulosEncontrados && PV_STATE.articulosEncontrados.length > 0) {
        pvRenderizarGridArticulos(PV_STATE.articulosEncontrados);
        const cEl = document.getElementById('pvConteoArticulosEncontrados');
        if (cEl) cEl.textContent = PV_STATE.articulosEncontrados.length;
    }
}

function pvAgregarAlPedidoDesdeMostrador() {
    const art = PV_STATE.articuloMostradorActivo;
    if (!art) return;
    const stockLocal = parseFloat(art.stock_tu_almacen) || 0;
    const stockCedis = parseFloat(art.stock_cedis) || 0;

    pvAgregarAlCarrito({
        articulo_id: art.articulo_id,
        clave: art.clave,
        nombre: art.nombre,
        precio: pvObtenerPrecioArticulo(art),
        precio_publico: art.precio_publico,
        precio_taller: art.precio_taller,
        stock_global: art.total_piezas || 0,
        stock_local: stockLocal,
        stock_cedis: stockCedis,
        bonificacion: (art.clave.startsWith('G-') || art.nombre.toUpperCase().includes('ACUMULADOR'))
            ? { clave: 'B03', monto: 525.0, nombre: 'BONIFICACION ACUMULADOR USADO GRUPO 3' }
            : null
    });
}

function pvSolicitarTrasladoDesdeMostrador() {
    const art = PV_STATE.articuloMostradorActivo;
    if (!art) return;
    const stockLocal = parseFloat(art.stock_tu_almacen) || 0;
    const stockCedis = parseFloat(art.stock_cedis) || 0;

    pvAbrirModalSolicitarTraspasoCedis({
        articulo_id: art.articulo_id,
        clave: art.clave,
        nombre: art.nombre,
        stock_local: stockLocal,
        stock_cedis: stockCedis
    });
}

function pvCotizarDesdeMostrador() {
    pvAgregarAlPedidoDesdeMostrador();
    pvGenerarCotizacion();
}

function pvAbrirFotoZoom(url, clave, nombre) {
    if (!url) {
        mostrarNotificacion(`No hay imagen fotográfica disponible para ${clave}.`, "info");
        return;
    }
    let modalZoom = document.getElementById('pvModalFotoZoomFull');
    if (!modalZoom) {
        modalZoom = document.createElement('div');
        modalZoom.id = 'pvModalFotoZoomFull';
        modalZoom.className = 'fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-xs';
        modalZoom.onclick = (e) => {
            if (e.target === modalZoom || e.target.classList.contains('pv-close-zoom')) {
                modalZoom.classList.add('hidden');
            }
        };
        document.body.appendChild(modalZoom);
    }
    modalZoom.innerHTML = `
        <div class="bg-white rounded-3xl p-4 max-w-2xl w-full shadow-2xl relative flex flex-col items-center">
            <button type="button" class="pv-close-zoom absolute top-3 right-3 text-slate-400 hover:text-slate-800 text-2xl font-black cursor-pointer">&times;</button>
            <div class="text-xs font-black text-slate-800 uppercase tracking-tight mb-2">${clave} &bull; ${nombre}</div>
            <div class="h-96 w-full flex items-center justify-center bg-slate-50 rounded-2xl overflow-hidden p-2">
                <img src="${url}" alt="${clave}" class="max-h-full max-w-full object-contain">
            </div>
        </div>
    `;
    modalZoom.classList.remove('hidden');
}

// ================= MODAL DETALLE DE ARTÍCULO (Screenshot 3) =================

async function pvAbrirModalDetalle(clave) {
    const modal = document.getElementById('pvModalDetalleArticulo');
    if (!modal) return;
    modal.classList.remove('hidden');

    document.getElementById('pvModalClaveTitulo').textContent = clave;
    document.getElementById('pvModalNombreArticulo').textContent = 'Cargando información...';
    document.getElementById('pvModalPrecioArticulo').textContent = '$0.00';
    document.getElementById('pvModalListaAlmacenes').innerHTML = '<div class="p-4 text-center text-slate-400 italic">Consultando almacenes...</div>';
    document.getElementById('pvModalListaEquivalencias').innerHTML = '<div class="p-4 text-center text-slate-400 italic">Consultando equivalencias...</div>';

    try {
        const queryParams = new URLSearchParams();
        if (PV_STATE.sucursalActualId) queryParams.append('almacen_id', PV_STATE.sucursalActualId);
        if (PV_STATE.clienteActual?.id) queryParams.append('cliente_id', PV_STATE.clienteActual.id);
        const res = await fetch(`/api/pv/articulos/detalle/${encodeURIComponent(clave)}?${queryParams.toString()}`);
        const data = await res.json();
        if (data.success && data.articulo) {
            const art = data.articulo;
            PV_STATE.articuloModalActual = art;

            document.getElementById('pvModalClaveTitulo').textContent = art.clave;
            document.getElementById('pvModalLineaTitulo').textContent = art.linea || 'REFACCIONES';
            document.getElementById('pvModalNombreArticulo').textContent = art.nombre;
            document.getElementById('pvModalStockAlmacen').textContent = `${art.stock_tu_almacen || 0} pzas`;
            document.getElementById('pvModalTotalExistencias').textContent = art.total_piezas || 0;
            const tablaModalEl = document.getElementById('pvModalTablaAsignada');
            if (tablaModalEl) {
                const tablaAsig = PV_STATE.clienteActual ? (PV_STATE.clienteActual.tabla_asignada || 'Público en General') : 'Público en General';
                tablaModalEl.textContent = `Tabla Asignada: ${tablaAsig}`;
            }
            document.getElementById('pvModalPrecioArticulo').textContent = formatearMoneda(pvObtenerPrecioArticulo(art));

            // Foto ampliada
            const fotoImg = document.getElementById('pvModalFotoImg');
            const fotoIcon = document.getElementById('pvModalFotoIcon');
            if (art.tiene_foto && art.foto_url) {
                if (fotoImg) {
                    fotoImg.src = art.foto_url;
                    fotoImg.classList.remove('hidden');
                }
                if (fotoIcon) fotoIcon.classList.add('hidden');
            } else {
                if (fotoImg) {
                    fotoImg.classList.add('hidden');
                    fotoImg.src = '';
                }
                if (fotoIcon) fotoIcon.classList.remove('hidden');
            }

            // Botón Agregar al pedido o Solicitar Traspaso a CEDIS
            const btnAgr = document.getElementById('pvBtnModalAgregarPedido');
            if (btnAgr) {
                const stockLocal = parseFloat(art.stock_tu_almacen) || 0;
                let stockCedis = parseFloat(art.stock_cedis) || 0;
                if (!stockCedis && art.existencias_almacenes) {
                    const cedisAlm = art.existencias_almacenes.find(a => a.almacen_id === 620110 || a.nombre.toUpperCase().includes('CEDIS'));
                    if (cedisAlm) stockCedis = parseFloat(cedisAlm.piezas) || 0;
                }

                if (stockLocal > 0) {
                    btnAgr.disabled = false;
                    btnAgr.className = "w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs uppercase rounded-xl transition shadow-md shadow-indigo-600/20 active:scale-95 cursor-pointer flex items-center justify-center gap-1.5";
                    btnAgr.innerHTML = '<span>➕</span> <span>Agregar a la Venta</span>';
                    btnAgr.onclick = () => {
                        pvAgregarAlCarrito({
                            articulo_id: art.articulo_id,
                            clave: art.clave,
                            nombre: art.nombre,
                            precio: pvObtenerPrecioArticulo(art),
                            precio_publico: art.precio_publico,
                            precio_taller: art.precio_taller,
                            stock_global: art.total_piezas,
                            stock_local: stockLocal,
                            stock_cedis: stockCedis,
                            bonificacion: (art.clave.startsWith('G-') || art.nombre.toUpperCase().includes('ACUMULADOR')) ? { clave: 'B03', monto: 525.0, nombre: 'BONIFICACION ACUMULADOR USADO GRUPO 3' } : null
                        });
                        pvCerrarModalDetalle();
                    };
                } else if (stockCedis > 0) {
                    btnAgr.disabled = false;
                    btnAgr.className = "w-full py-3 bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs uppercase rounded-xl transition shadow-md shadow-amber-500/20 active:scale-95 cursor-pointer flex items-center justify-center gap-1.5";
                    btnAgr.innerHTML = `<span>🚚</span> <span>Solicitar Traspaso a CEDIS (${stockCedis} pzas disp.)</span>`;
                    btnAgr.onclick = () => {
                        pvCerrarModalDetalle();
                        pvAbrirModalSolicitarTraspasoCedis({
                            articulo_id: art.articulo_id,
                            clave: art.clave,
                            nombre: art.nombre,
                            stock_local: 0,
                            stock_cedis: stockCedis
                        });
                    };
                } else {
                    btnAgr.disabled = true;
                    btnAgr.className = "w-full py-3 bg-slate-200 text-slate-400 font-bold text-xs uppercase rounded-xl transition cursor-not-allowed flex items-center justify-center gap-1.5";
                    btnAgr.innerHTML = '<span>✕</span> <span>Sin Existencias (Agotado en Sucursal y CEDIS)</span>';
                    btnAgr.onclick = null;
                }
            }

            // Desglose de existencias por almacén
            const contAlm = document.getElementById('pvModalListaAlmacenes');
            if (contAlm) {
                if (art.existencias_almacenes && art.existencias_almacenes.length > 0) {
                    contAlm.innerHTML = art.existencias_almacenes.map(al => {
                        const esRT = (al.empresa === 'RT' || al.nombre.toUpperCase().startsWith('RT '));
                        const badgeColor = esRT
                            ? '<span class="text-[9px] font-black bg-amber-100 text-amber-900 border border-amber-300 px-1.5 py-0.5 rounded shrink-0 mr-1.5">RT</span>'
                            : '<span class="text-[9px] font-black bg-red-100 text-red-700 border border-red-200 px-1.5 py-0.5 rounded shrink-0 mr-1.5">BC</span>';
                        return `
                            <div class="py-1.5 flex items-center justify-between text-xs border-b border-slate-50 last:border-0">
                                <div class="flex items-center min-w-0 pr-2">
                                    ${badgeColor}
                                    <div class="font-bold text-slate-800 truncate">${al.nombre}</div>
                                </div>
                                <div class="text-sm font-black text-slate-900 shrink-0 tabular-nums">${al.piezas}</div>
                            </div>
                        `;
                    }).join('');
                } else {
                    contAlm.innerHTML = '<div class="p-3 text-center text-slate-400 italic">Sin existencias registradas</div>';
                }
            }

            // Equivalencias
            const contEq = document.getElementById('pvModalListaEquivalencias');
            const conEqCount = document.getElementById('pvModalConteoEquivalencias');
            if (conEqCount) conEqCount.textContent = `(${art.equivalencias ? art.equivalencias.length : 0})`;
            if (contEq) {
                if (art.equivalencias && art.equivalencias.length > 0) {
                    contEq.innerHTML = art.equivalencias.map(eq => `
                        <div class="p-2 bg-emerald-50/50 hover:bg-emerald-50 rounded-xl border border-emerald-100 flex items-center justify-between text-xs transition">
                            <div class="min-w-0 pr-2 cursor-pointer flex-1" onclick="pvAbrirModalDetalle('${eq.clave}')">
                                <div class="font-black text-slate-900">${eq.clave}</div>
                                <div class="text-[10px] text-slate-500 truncate" title="${eq.nombre}">${eq.nombre}</div>
                            </div>
                            <div class="flex items-center gap-2 shrink-0">
                                <div class="text-right">
                                    <div class="font-black text-slate-900">${formatearMoneda(eq.precio)}</div>
                                    <div class="text-[10px] font-bold ${eq.stock > 0 ? 'text-emerald-700' : 'text-rose-600'}">${eq.stock > 0 ? `${eq.stock} pzas` : 'Sin stock'}</div>
                                </div>
                                ${eq.stock > 0 ? `
                                    <button type="button" onclick="event.stopPropagation(); pvAgregarEquivalenciaAlCarrito('${eq.clave}'); pvCerrarModalDetalle();"
                                            class="p-1.5 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white rounded-lg transition shadow-2xs cursor-pointer"
                                            title="Agregar al carrito">
                                        🛒+
                                    </button>
                                ` : ''}
                            </div>
                        </div>
                    `).join('');
                } else {
                    contEq.innerHTML = '<div class="p-3 text-center text-slate-400 italic">No hay equivalencias registradas</div>';
                }
            }
        }
    } catch (e) {
        console.error("Error al cargar detalle modal:", e);
    }
}

function pvCerrarModalDetalle() {
    const modal = document.getElementById('pvModalDetalleArticulo');
    if (modal) modal.classList.add('hidden');
}

// ================= CARRITO Y PUNTO DE VENTA EN CURSO (Screenshot 4) =================

function pvAgregarAlCarrito(art) {
    const stockLocal = parseFloat(art.stock_local) || 0;
    const stockCedis = parseFloat(art.stock_cedis) || 0;

    // Validación estricta: NO permitir agregar si no tiene existencia local
    if (stockLocal <= 0) {
        if (stockCedis > 0) {
            // Ofrecer solicitar traspaso a CEDIS
            if (confirm(`⚠️ El artículo "${art.clave}" no tiene existencia física en tu sucursal, pero hay ${stockCedis} pzas disponibles en CEDIS.\n\n¿Deseas enviar una Solicitud de Traspaso a Compras para su validación y autorización?`)) {
                pvAbrirModalSolicitarTraspasoCedis(art);
            }
        } else {
            alert(`⚠️ El artículo "${art.clave}" no cuenta con existencia en tu sucursal ni en CEDIS.`);
        }
        return;
    }

    const precioFinal = pvObtenerPrecioArticulo(art) || parseFloat(art.precio) || 0;

    const idx = PV_STATE.carrito.findIndex(item => item.articulo_id === art.articulo_id);
    if (idx >= 0) {
        if (PV_STATE.carrito[idx].cantidad + 1 > stockLocal) {
            alert(`⚠️ No puedes agregar más piezas de "${art.clave}". Existencia local disponible: ${stockLocal} pzas.`);
            return;
        }
        PV_STATE.carrito[idx].cantidad += 1;
    } else {
        const nuevoItem = {
            articulo_id: art.articulo_id,
            clave: art.clave,
            nombre: art.nombre,
            precio: precioFinal,
            precio_publico: art.precio_publico,
            precio_taller: art.precio_taller,
            cantidad: 1,
            descuento_pct: 0,
            stock_local: stockLocal,
            stock_cedis: stockCedis,
            bonificacion: art.bonificacion || null
        };
        PV_STATE.carrito.push(nuevoItem);

        // Si tiene bonificación de acumulador (casco), agregar partida de bonificación asociada
        if (art.bonificacion && art.bonificacion.monto) {
            const bonifItem = {
                articulo_id: `BONIF_${art.bonificacion.clave}`,
                clave: art.bonificacion.clave,
                nombre: art.bonificacion.nombre,
                es_bonificacion: true,
                asociado_a_clave: art.clave,
                precio: parseFloat(art.bonificacion.monto) || 0,
                cantidad: 1,
                descuento_pct: 100.0,
                bonificacion: null
            };
            PV_STATE.carrito.push(bonifItem);
        }
    }

    pvActualizarCarritoUi();
}

function pvModificarCantidadCarrito(index, cambio) {
    if (!PV_STATE.carrito[index]) return;
    const item = PV_STATE.carrito[index];

    if (cambio > 0 && item.stock_local !== undefined && (item.cantidad + cambio) > item.stock_local) {
        alert(`⚠️ No puedes agregar más piezas de "${item.clave}". Stock físico disponible en tu sucursal: ${item.stock_local} pzas.`);
        return;
    }

    item.cantidad += cambio;
    if (item.cantidad <= 0) {
        pvEliminarItemCarrito(index);
        return;
    }
    pvActualizarCarritoUi();
}

function pvModificarDescuentoCarrito(index, val) {
    if (!PV_STATE.carrito[index]) return;
    const num = Math.min(100, Math.max(0, parseFloat(val) || 0));
    PV_STATE.carrito[index].descuento_pct = num;
    pvActualizarCarritoUi();
}

function pvEliminarItemCarrito(index) {
    const item = PV_STATE.carrito[index];
    if (item && !item.es_bonificacion) {
        // Si tiene bonificación asociada, eliminarla también
        PV_STATE.carrito = PV_STATE.carrito.filter(it => it.asociado_a_clave !== item.clave);
    }
    PV_STATE.carrito.splice(index, 1);
    pvActualizarCarritoUi();
}

function pvLimpiarCarrito() {
    if (PV_STATE.carrito.length === 0) return;
    if (confirm("¿Deseas vaciar el carrito de venta actual?")) {
        PV_STATE.carrito = [];
        pvActualizarCarritoUi();
    }
}

function pvActualizarCarritoUi() {
    const tbody = document.getElementById('pvTbodyCarrito');
    const badgeCount = document.getElementById('pvBadgeTotalItemsCarrito');
    if (!tbody) return;

    if (PV_STATE.carrito.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="6" class="py-12 text-center text-slate-400 text-xs">
                    El carrito de venta está vacío.<br>Agrega refacciones desde el catálogo.
                </td>
            </tr>
        `;
        if (badgeCount) badgeCount.textContent = '0 pzs';
        pvActualizarTotalesUi(0, 0, 0, 0, 0);
        return;
    }

    let subtotalNeto = 0.0;
    let ahorroAplicado = 0.0;
    let bonificacionRelacionada = 0.0;
    let piezasTotales = 0;

    tbody.innerHTML = PV_STATE.carrito.map((item, idx) => {
        piezasTotales += item.cantidad;

        const precioUnit = item.precio;
        const subSinDesc = precioUnit * item.cantidad;
        const montoDesc = (subSinDesc * (item.descuento_pct / 100.0));
        const totalLinea = subSinDesc - montoDesc;

        if (item.es_bonificacion) {
            bonificacionRelacionada += item.precio * item.cantidad;
        } else {
            subtotalNeto += totalLinea / 1.16; // sin IVA
            ahorroAplicado += montoDesc;
        }

        const esBonif = !!item.es_bonificacion;

        return `
            <tr class="hover:bg-slate-50/80 transition border-b border-slate-100 last:border-0 text-xs ${esBonif ? 'bg-emerald-50/60' : ''}">
                <td class="py-3 px-3">
                    <div class="font-black text-slate-900">${item.clave}</div>
                    <div class="text-[10px] text-slate-500 truncate max-w-[150px]" title="${item.nombre}">${item.nombre}</div>
                    ${item.bonificacion ? `<div class="text-[9px] text-emerald-700 font-bold mt-0.5">✓ Casco bonificado (-$${item.bonificacion.monto})</div>` : ''}
                </td>
                <td class="py-2.5 px-2 text-center whitespace-nowrap">
                    <div class="inline-flex items-center gap-1.5 bg-slate-100/90 rounded-xl p-1 border border-slate-200/80">
                        <button type="button" onclick="pvModificarCantidadCarrito(${idx}, -1)" class="w-8 h-8 rounded-lg bg-white hover:bg-slate-200 active:scale-95 text-slate-900 font-black text-sm flex items-center justify-center select-none shadow-2xs cursor-pointer">-</button>
                        <span class="min-w-[24px] text-center font-black text-xs text-slate-900">${item.cantidad}</span>
                        <button type="button" onclick="pvModificarCantidadCarrito(${idx}, 1)" class="w-8 h-8 rounded-lg bg-slate-900 hover:bg-slate-800 active:scale-95 text-white font-black text-sm flex items-center justify-center select-none shadow-2xs cursor-pointer">+</button>
                    </div>
                </td>
                <td class="py-2.5 px-2 text-right font-bold text-slate-800 whitespace-nowrap">
                    ${formatearMoneda(item.precio)}
                </td>
                <td class="py-2.5 px-2 text-center">
                    <input type="number" min="0" max="100" value="${item.descuento_pct}"
                           onchange="pvModificarDescuentoCarrito(${idx}, this.value)"
                           class="w-14 text-center text-xs font-bold bg-white border border-slate-200 rounded-xl py-1.5 px-1 focus:ring-2 focus:ring-indigo-500 focus:outline-none">
                </td>
                <td class="py-2.5 px-3 text-right font-black ${esBonif ? 'text-emerald-700' : 'text-slate-900'} whitespace-nowrap text-xs">
                    ${formatearMoneda(totalLinea)}
                </td>
                <td class="py-2.5 px-1.5 text-center">
                    <button type="button" onclick="pvEliminarItemCarrito(${idx})" title="Quitar artículo" class="w-8 h-8 rounded-lg hover:bg-rose-50 text-slate-400 hover:text-rose-600 flex items-center justify-center text-xs font-bold transition active:scale-95 cursor-pointer">
                        ✕
                    </button>
                </td>
            </tr>
        `;
    }).join('');

    if (badgeCount) badgeCount.textContent = `${piezasTotales} pzs`;

    const subtotal = subtotalNeto;
    const iva = subtotalNeto * 0.16;
    const totalPagar = (subtotal + iva) - bonificacionRelacionada;

    pvActualizarTotalesUi(ahorroAplicado, bonificacionRelacionada, subtotal, iva, totalPagar);
}

function pvActualizarTotalesUi(ahorro, bonif, subtotal, iva, total) {
    const elAh = document.getElementById('pvTxtAhorro');
    const elBon = document.getElementById('pvTxtBonificacion');
    const elSub = document.getElementById('pvTxtSubtotal');
    const elIva = document.getElementById('pvTxtIva');
    const elTot = document.getElementById('pvTxtTotalPagar');

    if (elAh) elAh.textContent = formatearMoneda(ahorro);
    if (elBon) elBon.textContent = formatearMoneda(bonif);
    if (elSub) elSub.textContent = formatearMoneda(subtotal);
    if (elIva) elIva.textContent = formatearMoneda(iva);
    if (elTot) elTot.textContent = formatearMoneda(total);
}

// ================= ENVÍO A CAJA MICROSIP Y MODALIDAD DE ENTREGA =================

function pvSetTipoEntrega(tipo) {
    PV_STATE.tipoEntrega = tipo;
    const btnTienda = document.getElementById('pvBtnEntregaTienda');
    const btnEnvio = document.getElementById('pvBtnEntregaEnvio');
    const contDir = document.getElementById('pvContenedorDireccionEnvio');
    const inputDir = document.getElementById('pvInputDireccionEnvio');

    if (tipo === 'ENVIO') {
        if (btnEnvio) {
            btnEnvio.className = "py-2 px-3 rounded-xl font-black text-xs border border-indigo-600 bg-indigo-50 text-indigo-700 flex items-center justify-center gap-1.5 transition shadow-2xs";
        }
        if (btnTienda) {
            btnTienda.className = "py-2 px-3 rounded-xl font-bold text-xs border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 flex items-center justify-center gap-1.5 transition";
        }
        if (contDir) contDir.classList.remove('hidden');
        if (inputDir) {
            inputDir.focus();
            if (!inputDir.value && PV_STATE.clienteActual?.direccion) {
                inputDir.value = PV_STATE.clienteActual.direccion;
            }
        }
    } else {
        if (btnTienda) {
            btnTienda.className = "py-2 px-3 rounded-xl font-black text-xs border border-indigo-600 bg-indigo-50 text-indigo-700 flex items-center justify-center gap-1.5 transition shadow-2xs";
        }
        if (btnEnvio) {
            btnEnvio.className = "py-2 px-3 rounded-xl font-bold text-xs border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 flex items-center justify-center gap-1.5 transition";
        }
        if (contDir) contDir.classList.add('hidden');
    }
}

async function pvAgregarEquivalenciaAlCarrito(clave) {
    if (!clave) return;
    try {
        const queryParams = new URLSearchParams();
        if (PV_STATE.sucursalActualId) queryParams.append('almacen_id', PV_STATE.sucursalActualId);
        if (PV_STATE.clienteActual?.id) queryParams.append('cliente_id', PV_STATE.clienteActual.id);
        const res = await fetch(`/api/pv/articulos/detalle/${encodeURIComponent(clave)}?${queryParams.toString()}`);
        const data = await res.json();
        if (data.success && data.articulo) {
            const art = data.articulo;
            const stockLocal = parseFloat(art.stock_tu_almacen) || 0;
            const stockCedis = parseFloat(art.stock_cedis) || 0;
            pvAgregarAlCarrito({
                articulo_id: art.articulo_id,
                clave: art.clave,
                nombre: art.nombre,
                precio: pvObtenerPrecioArticulo(art),
                precio_publico: art.precio_publico,
                precio_taller: art.precio_taller,
                stock_global: art.total_piezas || 0,
                stock_local: stockLocal,
                stock_cedis: stockCedis,
                bonificacion: (art.clave.startsWith('G-') || art.nombre.toUpperCase().includes('ACUMULADOR'))
                    ? { clave: 'B03', monto: 525.0, nombre: 'BONIFICACION ACUMULADOR USADO GRUPO 3' }
                    : null
            });
        } else {
            alert(`No se pudo obtener la información de la equivalencia ${clave}`);
        }
    } catch (e) {
        console.error("Error al agregar equivalencia al carrito:", e);
        alert(`Error al agregar equivalencia ${clave}`);
    }
}

async function pvEnviarACaja() {
    if (PV_STATE.carrito.length === 0) {
        alert("El carrito está vacío. Agrega refacciones antes de enviar a caja.");
        return;
    }

    let obsFinal = PV_STATE.observaciones || '';
    if (PV_STATE.tipoEntrega === 'ENVIO') {
        const inpDir = document.getElementById('pvInputDireccionEnvio');
        const dir = (inpDir ? inpDir.value.trim() : '') || PV_STATE.direccionEnvio;
        if (!dir) {
            alert("⚠️ Por favor ingresa la dirección de entrega a domicilio antes de enviar a caja.");
            if (inpDir) inpDir.focus();
            return;
        }
        PV_STATE.direccionEnvio = dir;
        obsFinal = `[ENVÍO A DOMICILIO: ${dir}] ${obsFinal}`.trim();
    } else {
        obsFinal = `[ENTREGA EN TIENDA] ${obsFinal}`.trim();
    }

    const payload = {
        cliente_id: PV_STATE.clienteActual ? PV_STATE.clienteActual.id : null,
        almacen_id: PV_STATE.sucursalActualId || (typeof currentUser !== 'undefined' ? currentUser.sucursal_id : null),
        vendedor_id: PV_STATE.vendedorActualId || (typeof currentUser !== 'undefined' ? currentUser.vendedor_id : null),
        observaciones: obsFinal,
        partidas: PV_STATE.carrito.filter(it => !it.es_bonificacion).map(it => ({
            articulo_id: it.articulo_id,
            clave: it.clave,
            cantidad: it.cantidad,
            precio_unitario: it.precio,
            descuento_pct: it.descuento_pct,
            bonificacion: it.bonificacion || null
        }))
    };

    try {
        const res = await fetch('/api/pv/enviar-a-caja', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (data.success) {
            // Mostrar modal de éxito
            const mExito = document.getElementById('pvModalExitoCaja');
            const elFolio = document.getElementById('pvModalExitoFolio');
            const elTotal = document.getElementById('pvModalExitoTotal');

            if (elFolio) elFolio.textContent = data.folio;
            if (elTotal) elTotal.textContent = formatearMoneda(data.total_a_pagar);
            if (mExito) mExito.classList.remove('hidden');

            // Vaciar carrito
            PV_STATE.carrito = [];
            PV_STATE.observaciones = '';
            pvSetTipoEntrega('TIENDA');
            const inpDir = document.getElementById('pvInputDireccionEnvio');
            if (inpDir) inpDir.value = '';
            pvActualizarCarritoUi();
        } else {
            alert(`Error al enviar a caja: ${data.error || 'No se pudo generar la orden'}`);
        }
    } catch (e) {
        alert(`Error de red al conectar con el servidor: ${e.message}`);
    }
}

function pvCerrarModalExito() {
    const mExito = document.getElementById('pvModalExitoCaja');
    if (mExito) mExito.classList.add('hidden');
}

// ================= OBSERVACIONES Y COTIZACIÓN (WHATSAPP E IMPRESIÓN) =================

function pvAbrirModalObservaciones() {
    const modal = document.getElementById('pvModalObservaciones');
    const txt = document.getElementById('pvTextareaObservaciones');
    if (txt) txt.value = PV_STATE.observaciones;
    if (modal) modal.classList.remove('hidden');
}

function pvCerrarModalObservaciones() {
    const modal = document.getElementById('pvModalObservaciones');
    const txt = document.getElementById('pvTextareaObservaciones');
    if (txt) PV_STATE.observaciones = txt.value.trim();
    if (modal) modal.classList.add('hidden');
}

function pvGenerarCotizacion() {
    if (PV_STATE.carrito.length === 0) {
        alert("Agrega artículos para generar una cotización.");
        return;
    }
    window.print();
}

function pvEnviarCotizacionWhatsApp() {
    if (PV_STATE.carrito.length === 0) {
        alert("Agrega artículos al pedido antes de enviar la cotización por WhatsApp.");
        return;
    }

    const clienteNom = PV_STATE.clienteActual ? (PV_STATE.clienteActual.nombre || PV_STATE.clienteActual.label) : 'Cliente Mostrador';
    const fechaHoy = new Date().toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' });
    
    let subtotal = 0;
    let itemsTexto = '';
    PV_STATE.carrito.forEach((it, idx) => {
        const sub = it.cantidad * it.precio;
        subtotal += sub;
        itemsTexto += `${idx + 1}. *${it.clave}* - ${it.nombre}\n   Cant: ${it.cantidad} pza(s) | P.U: ${formatearMoneda(it.precio)} | Importe: ${formatearMoneda(sub)}\n`;
    });

    const iva = subtotal * 0.16;
    const total = subtotal + iva;
    const modEntrega = PV_STATE.tipoEntrega === 'ENVIO' ? '🚚 Envío a Domicilio' : '🏬 Entrega en Tienda';

    let msj = `🛒 *COTIZACIÓN DE REFACCIONES - BC REFACCIONARIAS*\n`;
    msj += `📅 *Fecha:* ${fechaHoy}\n`;
    msj += `👤 *Cliente:* ${clienteNom}\n`;
    msj += `📍 *Modalidad:* ${modEntrega}\n\n`;
    msj += `*Detalle de Refacciones:*\n`;
    msj += `${itemsTexto}\n`;
    msj += `─────────────────────────\n`;
    msj += `💵 *Subtotal:* ${formatearMoneda(subtotal)}\n`;
    msj += `🧾 *IVA (16%):* ${formatearMoneda(iva)}\n`;
    msj += `💰 *TOTAL:* ${formatearMoneda(total)}\n\n`;
    msj += `⚠️ *Precios con IVA incluido sujetos a cambio sin previo aviso.*`;

    let telDefault = (PV_STATE.clienteActual?.telefono || '').replace(/\D/g, '');
    let tel = prompt("Ingresa el número de WhatsApp (10 dígitos) del cliente:", telDefault);
    if (!tel) return;
    tel = tel.replace(/\D/g, '');
    if (tel.length === 10) {
        tel = '52' + tel;
    }

    const url = `https://api.whatsapp.com/send?phone=${tel}&text=${encodeURIComponent(msj)}`;
    window.open(url, '_blank');
}

// ================= SOLICITUDES DE TRASPASO A CEDIS (VALIDADAS POR COMPRAS) =================

function pvAbrirModalSolicitarTraspasoCedis(art) {
    if (!art) return;
    const modal = document.getElementById('pvModalSolicitarTraspasoCedis');
    if (!modal) return;

    const elArtId = document.getElementById('pvSolArticuloId');
    const elClaveInp = document.getElementById('pvSolClaveInput');
    const elNomInp = document.getElementById('pvSolNombreInput');
    const elClave = document.getElementById('pvModalSolClave');
    const elNom = document.getElementById('pvModalSolNombre');
    const elStkLocal = document.getElementById('pvModalSolStockLocal');
    const elStkCedis = document.getElementById('pvModalSolStockCedis');
    const elSucDest = document.getElementById('pvSolSucursalDestino');
    const elCant = document.getElementById('pvSolCantidad');
    const elCli = document.getElementById('pvSolCliente');
    const elNotas = document.getElementById('pvSolNotas');

    if (elArtId) elArtId.value = art.articulo_id || '';
    if (elClaveInp) elClaveInp.value = art.clave || '';
    if (elNomInp) elNomInp.value = art.nombre || '';
    if (elClave) elClave.textContent = art.clave || '-';
    if (elNom) elNom.textContent = art.nombre || '-';
    if (elStkLocal) elStkLocal.textContent = `${art.stock_local || 0} pzas (Agotado)`;
    if (elStkCedis) elStkCedis.textContent = `${art.stock_cedis || 0} pzas disponibles`;
    if (elSucDest) elSucDest.value = PV_STATE.sucursalActualNombre || 'Sucursal Actual';
    if (elCant) {
        elCant.value = 1;
        elCant.max = Math.max(1, art.stock_cedis || 9999);
    }
    if (elCli) {
        elCli.value = PV_STATE.clienteActual ? (PV_STATE.clienteActual.nombre || '') : '';
    }
    if (elNotas) elNotas.value = '';

    modal.classList.remove('hidden');
}

function pvCerrarModalSolicitarTraspasoCedis() {
    const modal = document.getElementById('pvModalSolicitarTraspasoCedis');
    if (modal) modal.classList.add('hidden');
}

async function pvEnviarSolicitudTraspaso(event) {
    if (event) event.preventDefault();

    const artId = document.getElementById('pvSolArticuloId')?.value;
    const clave = document.getElementById('pvSolClaveInput')?.value;
    const nombre = document.getElementById('pvSolNombreInput')?.value;
    const cantVal = parseFloat(document.getElementById('pvSolCantidad')?.value || 1);
    const cliente = document.getElementById('pvSolCliente')?.value?.trim() || '';
    const notas = document.getElementById('pvSolNotas')?.value?.trim() || '';

    if (!artId || !clave || cantVal <= 0) {
        alert("Por favor indica una cantidad válida para la solicitud.");
        return;
    }

    const btnSubmit = document.getElementById('pvBtnEnviarSolicitudCedis');
    const txtOriginal = btnSubmit ? btnSubmit.innerHTML : '';
    if (btnSubmit) {
        btnSubmit.disabled = true;
        btnSubmit.innerHTML = '<span>⏳</span> <span>Enviando a Compras...</span>';
    }

    try {
        const payload = {
            articulo_id: parseInt(artId),
            clave: clave,
            nombre: nombre,
            cantidad: cantVal,
            sucursal_destino_id: PV_STATE.sucursalActualId,
            sucursal_destino_nombre: PV_STATE.sucursalActualNombre,
            cliente_nombre: cliente,
            notas: notas
        };

        const res = await fetch('/api/pv/solicitar-traspaso-cedis', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await res.json();
        if (data.success) {
            pvCerrarModalSolicitarTraspasoCedis();
            alert(`✅ Solicitud de Traspaso ${data.folio} registrada exitosamente.\n\nHa quedado en estatus PENDIENTE de validación por el departamento de Compras. Una vez autorizada por Compras, CEDIS programará el surtido a tu sucursal.`);
        } else {
            alert(`Error al enviar la solicitud: ${data.error || 'Ocurrió un error inesperado'}`);
        }
    } catch (e) {
        console.error("Error al enviar solicitud:", e);
        alert(`Error de conexión con el servidor: ${e.message}`);
    } finally {
        if (btnSubmit) {
            btnSubmit.disabled = false;
            btnSubmit.innerHTML = txtOriginal;
        }
    }
}

async function pvAbrirModalMisSolicitudes() {
    const modal = document.getElementById('pvModalMisSolicitudesCedis');
    if (!modal) return;
    modal.classList.remove('hidden');

    const contenedor = document.getElementById('pvContenedorMisSolicitudes');
    if (contenedor) {
        contenedor.innerHTML = `
            <div class="p-8 text-center text-slate-400 italic">
                <div class="animate-spin text-2xl mb-2">⏳</div>
                Cargando historial de solicitudes enviadas a CEDIS...
            </div>
        `;
    }

    try {
        const sucParam = PV_STATE.sucursalActualId ? `?sucursal_id=${PV_STATE.sucursalActualId}` : '';
        const res = await fetch(`/api/pv/mis-solicitudes-traspasos${sucParam}`);
        const data = await res.json();

        if (!data.success || !data.solicitudes || data.solicitudes.length === 0) {
            if (contenedor) {
                contenedor.innerHTML = `
                    <div class="p-8 text-center text-slate-400 italic bg-slate-50 rounded-2xl border border-slate-200">
                        No hay solicitudes de traspaso registradas para esta sucursal.
                    </div>
                `;
            }
            return;
        }

        if (contenedor) {
            contenedor.innerHTML = `
                <div class="space-y-2.5">
                    ${data.solicitudes.map(s => {
                        let badgeStatus = '';
                        if (s.estatus === 'PENDIENTE_COMPRAS') {
                            badgeStatus = `<span class="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase bg-amber-100 text-amber-800 border border-amber-200">⏳ Pendiente Compras</span>`;
                        } else if (s.estatus === 'APROBADA') {
                            badgeStatus = `<span class="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase bg-emerald-100 text-emerald-800 border border-emerald-200">✓ Aprobada por Compras</span>`;
                        } else if (s.estatus === 'RECHAZADA') {
                            badgeStatus = `<span class="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase bg-rose-100 text-rose-800 border border-rose-200">✕ Rechazada</span>`;
                        } else {
                            badgeStatus = `<span class="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase bg-slate-100 text-slate-700">${s.estatus}</span>`;
                        }

                        return `
                            <div class="p-4 bg-slate-50 hover:bg-white rounded-2xl border border-slate-200 hover:border-indigo-300 transition shadow-2xs space-y-2">
                                <div class="flex items-center justify-between gap-2 flex-wrap">
                                    <div class="flex items-center gap-2">
                                        <span class="font-mono font-black text-xs text-indigo-700">${s.folio}</span>
                                        <span class="text-[11px] text-slate-500 font-medium">${s.fecha}</span>
                                    </div>
                                    <div>${badgeStatus}</div>
                                </div>
                                <div class="flex items-start justify-between gap-4">
                                    <div>
                                        <div class="text-xs font-black text-slate-900">${s.clave} &bull; <span class="text-slate-700 font-normal">${s.nombre}</span></div>
                                        <div class="text-[11px] text-slate-500 mt-0.5">
                                            Cantidad Solicitada: <strong class="text-slate-900">${s.cantidad} pzas</strong> &bull; Solicitado por: <strong>${s.solicitado_por || s.vendedor || 'Vendedor'}</strong>
                                            ${s.cliente ? ` &bull; Cliente: <strong class="text-indigo-600">${s.cliente}</strong>` : ''}
                                        </div>
                                        ${s.notas ? `<div class="text-[10px] text-slate-500 italic mt-1 bg-white p-2 rounded-lg border border-slate-100">Notas: ${s.notas}</div>` : ''}
                                    </div>
                                </div>
                                ${s.estatus === 'APROBADA' && s.autorizado_por ? `
                                    <div class="text-[10px] text-emerald-800 font-bold bg-emerald-50/80 p-2 rounded-xl border border-emerald-200 flex items-center justify-between">
                                        <span>✓ Autorizado por Compras (${s.autorizado_por}) el ${s.fecha_autorizacion || ''}</span>
                                        ${s.folio_traspaso ? `<span class="font-mono text-emerald-900">Traspaso Microsip: ${s.folio_traspaso}</span>` : '<span class="text-emerald-700 text-[9px]">En cola de surtido CEDIS</span>'}
                                    </div>
                                ` : ''}
                                ${s.estatus === 'RECHAZADA' && s.motivo_rechazo ? `
                                    <div class="text-[10px] text-rose-800 font-bold bg-rose-50/80 p-2 rounded-xl border border-rose-200">
                                        ✕ Rechazado por Compras (${s.autorizado_por || 'Compras'}) &bull; Motivo: ${s.motivo_rechazo}
                                    </div>
                                ` : ''}
                            </div>
                        `;
                    }).join('')}
                </div>
            `;
        }
    } catch (e) {
        console.error("Error al cargar mis solicitudes:", e);
        if (contenedor) {
            contenedor.innerHTML = `<div class="p-4 text-center text-rose-500 text-xs font-bold">Error al cargar las solicitudes: ${e.message}</div>`;
        }
    }
}

function pvCerrarModalMisSolicitudes() {
    const modal = document.getElementById('pvModalMisSolicitudesCedis');
    if (modal) modal.classList.add('hidden');
}

// ================= ALTA DE CLIENTES Y VENTAS PERDIDAS =================

function pvAbrirModalAltaCliente() {
    const modal = document.getElementById('modalAltaClienteRapido');
    if (!modal) return;
    const form = document.getElementById('formAltaClienteRapido');
    if (form) form.reset();
    const inputNom = document.getElementById('nuevoCliNombre');
    modal.classList.remove('hidden');
    if (inputNom) setTimeout(() => inputNom.focus(), 50);
}

function pvCerrarModalAltaCliente() {
    const modal = document.getElementById('modalAltaClienteRapido');
    if (modal) modal.classList.add('hidden');
}

async function pvGuardarClienteNuevo(event) {
    if (event) event.preventDefault();
    const btn = document.getElementById('btnGuardarClienteNuevo');
    const nom = document.getElementById('nuevoCliNombre')?.value.trim();
    const tel = document.getElementById('nuevoCliTelefono')?.value.trim();
    const rfc = document.getElementById('nuevoCliRfc')?.value.trim();
    const dir = document.getElementById('nuevoCliDireccion')?.value.trim();
    const email = document.getElementById('nuevoCliEmail')?.value.trim();

    if (!nom) {
        alert("Por favor ingresa el nombre o razón social del cliente.");
        return;
    }

    try {
        if (btn) {
            btn.disabled = true;
            btn.textContent = "Guardando en Microsip...";
        }

        const res = await fetch('/api/pv/clientes/crear', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nombre: nom, telefono: tel, rfc: rfc, direccion: dir, email: email })
        });
        const data = await res.json();

        if (data.success && data.cliente) {
            // Seleccionar cliente de inmediato
            pvSeleccionarCliente(data.cliente);
            pvCerrarModalAltaCliente();
            alert(`✅ Cliente "${data.cliente.nombre}" registrado exitosamente en Microsip (Clave: ${data.cliente.clave}).`);
        } else {
            alert(`Error al registrar cliente: ${data.error || 'Ocurrió un error inesperado'}`);
        }
    } catch (e) {
        alert(`Error de red al registrar cliente: ${e.message}`);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `<span>💾</span><span>Guardar y Seleccionar Cliente</span>`;
        }
    }
}

function pvAbrirModalVentaPerdida() {
    const modal = document.getElementById('modalRegistrarVentaPerdida');
    if (!modal) return;

    // Si hay un artículo en mostrador, prellenar los campos
    const art = PV_STATE.articuloModalActual;
    const inpClave = document.getElementById('vpClaveArticulo');
    const inpNom = document.getElementById('vpArticuloNombre');
    const inpPrec = document.getElementById('vpPrecioEstimado');

    if (inpClave) inpClave.value = art ? art.clave : '';
    if (inpNom) inpNom.value = art ? art.nombre : '';
    if (inpPrec) inpPrec.value = art ? (parseFloat(art.precio) || 0) : '';

    modal.classList.remove('hidden');
    if (inpClave && !inpClave.value) inpClave.focus();
}

function pvCerrarModalVentaPerdida() {
    const modal = document.getElementById('modalRegistrarVentaPerdida');
    if (modal) modal.classList.add('hidden');
}

async function pvGuardarVentaPerdida(event) {
    if (event) event.preventDefault();
    const btn = document.getElementById('btnGuardarVentaPerdida');
    const clave = document.getElementById('vpClaveArticulo')?.value.trim();
    const cant = parseFloat(document.getElementById('vpCantidad')?.value || 1);
    const nom = document.getElementById('vpArticuloNombre')?.value.trim();
    const motivo = document.getElementById('vpMotivo')?.value;
    const prec = parseFloat(document.getElementById('vpPrecioEstimado')?.value || 0);
    const notas = document.getElementById('vpNotas')?.value.trim();

    if (!clave) {
        alert("Por favor ingresa la clave o código del producto.");
        return;
    }

    try {
        if (btn) {
            btn.disabled = true;
            btn.textContent = "Enviando reporte...";
        }

        const payload = {
            clave_articulo: clave,
            articulo_nombre: nom,
            cantidad: cant,
            precio_estimado: prec,
            motivo: motivo,
            notas: notas,
            cliente_nombre: PV_STATE.clienteActual ? (PV_STATE.clienteActual.nombre || PV_STATE.clienteActual.label) : 'Cliente Mostrador',
            sucursal_id: PV_STATE.sucursalActualId,
            sucursal_nombre: PV_STATE.sucursalActualNombre,
            vendedor_id: PV_STATE.vendedorActualId,
            vendedor_nombre: PV_STATE.vendedorActualNombre
        };

        const res = await fetch('/api/ventas/venta-perdida', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();

        if (data.success) {
            pvCerrarModalVentaPerdida();
            alert(`📢 Venta perdida registrada exitosamente.\n\nSe ha notificado al departamento de Compras para su análisis de abasto y demanda.`);
        } else {
            alert(`Error: ${data.error || 'No se pudo guardar la venta perdida'}`);
        }
    } catch (e) {
        alert(`Error al conectar con el servidor: ${e.message}`);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `<span>📢</span><span>Enviar Reporte a Compras</span>`;
        }
    }
}

// Exportaciones globales
window.inicializarModuloPuntoVenta = inicializarModuloPuntoVenta;
window.pvAbrirModalSolicitarTraspasoCedis = pvAbrirModalSolicitarTraspasoCedis;
window.pvCerrarModalSolicitarTraspasoCedis = pvCerrarModalSolicitarTraspasoCedis;
window.pvEnviarSolicitudTraspaso = pvEnviarSolicitudTraspaso;
window.pvAbrirModalMisSolicitudes = pvAbrirModalMisSolicitudes;
window.pvCerrarModalMisSolicitudes = pvCerrarModalMisSolicitudes;
window.pvAbrirModalAltaCliente = pvAbrirModalAltaCliente;
window.pvCerrarModalAltaCliente = pvCerrarModalAltaCliente;
window.pvGuardarClienteNuevo = pvGuardarClienteNuevo;
window.pvAbrirModalVentaPerdida = pvAbrirModalVentaPerdida;
window.pvCerrarModalVentaPerdida = pvCerrarModalVentaPerdida;
window.pvGuardarVentaPerdida = pvGuardarVentaPerdida;

