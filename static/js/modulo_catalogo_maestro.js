/**
 * Módulo Catálogo Maestro de Artículos ERP BC Refaccionarias
 * Permite clasificar todos los artículos con Categoría, Línea, Sublínea y Marca,
 * editar múltiplos, equivalencias y visualizar las clasificaciones por sucursal
 * identificadas por su emblema (SA, AE, etc.).
 */

let _cmOpciones = { categorias: [], lineas: [], sublineas: [], marcas: [] };
let _cmPaginaActual = 1;
let _cmLimitePorPagina = 50;
let _cmFiltros = { busqueda: '', categoria_id: '', linea_id: '', sublinea_id: '', marca_id: '' };
let _cmTimerBusqueda = null;
let _cmArticuloEnEdicion = null;
let _cmTabOpcionesActual = 'categorias';

async function inicializarModuloCatalogoMaestro() {
    await cargarOpcionesClasificacionCM();
    llenarSelectsFiltrosCM();
    await cargarArticulosCatalogoMaestro(1);
}

// =========================================================================
// CARGA DE OPCIONES (CATEGORÍAS, LÍNEAS, SUBLÍNEAS, MARCAS)
// =========================================================================

async function cargarOpcionesClasificacionCM() {
    try {
        const resp = await fetch('/api/catalogo-maestro/opciones');
        const data = await resp.json();
        if (data.success) {
            _cmOpciones = {
                categorias: data.categorias || [],
                lineas: data.lineas || [],
                sublineas: data.sublineas || [],
                marcas: data.marcas || []
            };
        }
    } catch (e) {
        console.error("Error al cargar opciones de catálogo maestro:", e);
    }
}

function llenarSelectsFiltrosCM() {
    const selCat = document.getElementById('cmFiltroCategoria');
    const selLin = document.getElementById('cmFiltroLinea');
    const selSub = document.getElementById('cmFiltroSublinea');
    const selMar = document.getElementById('cmFiltroMarca');

    if (selCat) {
        selCat.innerHTML = `<option value="">Todas las categorías</option>` + 
            _cmOpciones.categorias.map(c => `<option value="${c.id}">${c.nombre}</option>`).join('');
        selCat.value = _cmFiltros.categoria_id;
    }
    if (selMar) {
        selMar.innerHTML = `<option value="">Todas las marcas</option>` + 
            _cmOpciones.marcas.map(m => `<option value="${m.id}">${m.nombre}</option>`).join('');
        selMar.value = _cmFiltros.marca_id;
    }
    actualizarFiltroLineasCM();
}

function actualizarFiltroLineasCM() {
    const selCat = document.getElementById('cmFiltroCategoria');
    const selLin = document.getElementById('cmFiltroLinea');
    if (!selLin) return;

    const catId = selCat ? selCat.value : '';
    const lineasFiltradas = catId 
        ? _cmOpciones.lineas.filter(l => String(l.categoria_id) === String(catId))
        : _cmOpciones.lineas;

    selLin.innerHTML = `<option value="">Todas las líneas</option>` + 
        lineasFiltradas.map(l => `<option value="${l.id}">${l.nombre}</option>`).join('');
    selLin.value = _cmFiltros.linea_id;

    actualizarFiltroSublineasCM();
}

function actualizarFiltroSublineasCM() {
    const selLin = document.getElementById('cmFiltroLinea');
    const selSub = document.getElementById('cmFiltroSublinea');
    if (!selSub) return;

    const linId = selLin ? selLin.value : '';
    const subFiltradas = linId 
        ? _cmOpciones.sublineas.filter(s => String(s.linea_id) === String(linId))
        : _cmOpciones.sublineas;

    selSub.innerHTML = `<option value="">Todas las sublíneas</option>` + 
        subFiltradas.map(s => `<option value="${s.id}">${s.nombre}</option>`).join('');
    selSub.value = _cmFiltros.sublinea_id;
}

// =========================================================================
// CARGA Y RENDERIZADO DE ARTÍCULOS
// =========================================================================

async function cargarArticulosCatalogoMaestro(pagina = 1) {
    const tbody = document.getElementById('tbodyCatalogoMaestro');
    const loader = document.getElementById('cmLoader');
    if (loader) loader.classList.remove('hidden');

    _cmPaginaActual = pagina;
    const busq = document.getElementById('cmInputBusqueda')?.value || '';
    const catId = document.getElementById('cmFiltroCategoria')?.value || '';
    const linId = document.getElementById('cmFiltroLinea')?.value || '';
    const subId = document.getElementById('cmFiltroSublinea')?.value || '';
    const marId = document.getElementById('cmFiltroMarca')?.value || '';

    _cmFiltros = { busqueda: busq, categoria_id: catId, linea_id: linId, sublinea_id: subId, marca_id: marId };

    try {
        const params = new URLSearchParams({
            pagina: _cmPaginaActual,
            limite: _cmLimitePorPagina,
            busqueda: busq,
            categoria_id: catId,
            linea_id: linId,
            sublinea_id: subId,
            marca_id: marId
        });

        const resp = await fetch(`/api/catalogo-maestro/articulos?${params.toString()}`);
        const data = await resp.json();

        if (!data.success) {
            throw new Error(data.error || "No se pudieron obtener los artículos");
        }

        renderizarTablaArticulosCM(data);
    } catch (e) {
        console.error("Error al cargar artículos de catálogo maestro:", e);
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="8" class="p-8 text-center text-rose-500 font-bold text-xs">Error: ${e.message}</td></tr>`;
        }
    } finally {
        if (loader) loader.classList.add('hidden');
    }
}

function renderizarTablaArticulosCM(data) {
    const tbody = document.getElementById('tbodyCatalogoMaestro');
    const badgeTotal = document.getElementById('cmBadgeTotalArticulos');
    const infoPaginacion = document.getElementById('cmInfoPaginacion');
    const btnAnt = document.getElementById('cmBtnPaginaAnterior');
    const btnSig = document.getElementById('cmBtnPaginaSiguiente');

    if (!tbody) return;

    const items = data.items || [];
    if (badgeTotal) {
        badgeTotal.textContent = `${Number(data.total || 0).toLocaleString('es-MX')} Artículos`;
    }

    if (infoPaginacion) {
        infoPaginacion.textContent = `Página ${data.pagina} de ${data.total_paginas} (${Number(data.total).toLocaleString('es-MX')} registros)`;
    }
    if (btnAnt) btnAnt.disabled = (data.pagina <= 1);
    if (btnSig) btnSig.disabled = (data.pagina >= data.total_paginas);

    if (items.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" class="py-12 text-center text-slate-400 font-medium">
                    <div class="text-3xl mb-2">🔍</div>
                    No se encontraron artículos con los filtros seleccionados.
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = items.map((art) => {
        const tieneCat = !!art.categoria_id;
        const badgeCat = tieneCat 
            ? `<span class="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">${art.categoria_nombre}</span>`
            : `<span class="text-slate-300 italic text-[11px]">Sin asignar</span>`;

        const badgeLin = art.linea_id 
            ? `<span class="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 text-slate-700 border border-slate-200">${art.linea_nombre}</span>`
            : `<span class="text-slate-300 italic text-[11px]">--</span>`;

        const badgeSub = art.sublinea_id 
            ? `<span class="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 text-slate-700 border border-slate-200">${art.sublinea_nombre}</span>`
            : `<span class="text-slate-300 italic text-[11px]">--</span>`;

        const badgeMarca = art.marca_id 
            ? `<span class="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-black bg-purple-50 text-purple-700 border border-purple-200">${art.marca_nombre}</span>`
            : `<span class="text-slate-300 italic text-[11px]">Sin marca</span>`;

        const mult = art.multiplo > 1 
            ? `<span class="font-mono font-black text-xs text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">${art.multiplo}</span>`
            : `<span class="font-mono text-slate-500 text-xs">1</span>`;

        const equiv = art.equivalencia 
            ? `<span class="font-mono text-xs font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded">${art.equivalencia}</span>`
            : `<span class="text-slate-300 text-xs italic">--</span>`;

        return `
            <tr class="hover:bg-slate-50/80 transition-colors border-b border-slate-100 last:border-0">
                <td class="py-2.5 px-3">
                    <span class="font-mono font-black text-slate-900 text-xs bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                        ${art.clave}
                    </span>
                </td>
                <td class="py-2.5 px-3">
                    <div class="font-bold text-slate-800 text-xs max-w-sm md:max-w-md truncate" title="${art.nombre}">
                        ${art.nombre}
                    </div>
                </td>
                <td class="py-2.5 px-3 whitespace-nowrap">${badgeMarca}</td>
                <td class="py-2.5 px-3 whitespace-nowrap">${badgeCat}</td>
                <td class="py-2.5 px-3 whitespace-nowrap">${badgeLin}</td>
                <td class="py-2.5 px-3 whitespace-nowrap">${badgeSub}</td>
                <td class="py-2.5 px-3 text-center whitespace-nowrap">${mult}</td>
                <td class="py-2.5 px-3 text-center whitespace-nowrap">${equiv}</td>
                <td class="py-2.5 px-3 text-right whitespace-nowrap">
                    <button type="button" onclick="abrirModalEditarArticuloCM(${art.articulo_id})" class="px-3 py-1 bg-indigo-50 hover:bg-indigo-600 text-indigo-700 hover:text-white font-bold text-xs rounded-xl transition border border-indigo-200 hover:border-indigo-600 flex items-center gap-1 cursor-pointer ml-auto shadow-2xs">
                        <span>✏️</span> <span>Editar</span>
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

function onInputBusquedaCM() {
    if (_cmTimerBusqueda) clearTimeout(_cmTimerBusqueda);
    _cmTimerBusqueda = setTimeout(() => {
        cargarArticulosCatalogoMaestro(1);
    }, 350);
}

function paginaSiguienteCM() {
    cargarArticulosCatalogoMaestro(_cmPaginaActual + 1);
}

function paginaAnteriorCM() {
    if (_cmPaginaActual > 1) {
        cargarArticulosCatalogoMaestro(_cmPaginaActual - 1);
    }
}

// =========================================================================
// MODAL DE EDICIÓN DEL ARTÍCULO
// =========================================================================

async function abrirModalEditarArticuloCM(articuloId) {
    const modal = document.getElementById('modalEditarArticuloCM');
    if (!modal) return;

    modal.classList.remove('hidden');
    document.getElementById('cmModalArtClave').textContent = 'Cargando...';
    document.getElementById('cmModalArtNombre').textContent = 'Consultando detalle del artículo...';
    document.getElementById('cmContenedorClasificacionesSucursales').innerHTML = `
        <div class="p-6 text-center text-slate-400 text-xs italic col-span-full">Cargando clasificaciones por sucursal...</div>
    `;

    try {
        const resp = await fetch(`/api/catalogo-maestro/articulos/${articuloId}`);
        const data = await resp.json();

        if (!data.success) {
            throw new Error(data.error || "No se pudo obtener el detalle");
        }

        _cmArticuloEnEdicion = data.articulo;
        poblarModalEdicionArticulo(_cmArticuloEnEdicion);

    } catch (e) {
        console.error("Error al abrir modal de edición de artículo:", e);
        if (typeof mostrarAlerta === 'function') {
            mostrarAlerta('error', `Error: ${e.message}`);
        }
        cerrarModalEditarArticuloCM();
    }
}

function cerrarModalEditarArticuloCM() {
    const modal = document.getElementById('modalEditarArticuloCM');
    if (modal) modal.classList.add('hidden');
    _cmArticuloEnEdicion = null;
}

function poblarModalEdicionArticulo(art) {
    document.getElementById('cmModalArtClave').textContent = art.clave;
    document.getElementById('cmModalArtNombre').textContent = art.nombre;
    document.getElementById('cmEditArticuloId').value = art.articulo_id;

    // Llenar selects de clasificación
    const selCat = document.getElementById('cmEditCategoria');
    const selLin = document.getElementById('cmEditLinea');
    const selSub = document.getElementById('cmEditSublinea');
    const selMar = document.getElementById('cmEditMarca');

    if (selCat) {
        selCat.innerHTML = `<option value="">-- Sin categoría --</option>` +
            _cmOpciones.categorias.map(c => `<option value="${c.id}">${c.nombre}</option>`).join('');
        selCat.value = art.categoria_id || '';
    }

    if (selMar) {
        selMar.innerHTML = `<option value="">-- Sin marca --</option>` +
            _cmOpciones.marcas.map(m => `<option value="${m.id}">${m.nombre}</option>`).join('');
        selMar.value = art.marca_id || '';
    }

    onCambioCategoriaEditModal(art.linea_id, art.sublinea_id);

    // Múltiplos y notas
    document.getElementById('cmEditMultiplo').value = art.multiplo || 1;
    document.getElementById('cmEditMultiploCompra').value = art.multiplo_compra || 1;
    document.getElementById('cmEditEquivalencia').value = art.equivalencia || '';
    document.getElementById('cmEditNotas').value = art.notas || '';

    // Renderizar clasificaciones por emblema de sucursal
    renderizarClasificacionesSucursalesModal(art.clasificaciones_sucursales || []);

    // Renderizar claves alternas
    const contClaves = document.getElementById('cmContenedorClavesAlternas');
    if (contClaves) {
        if (!art.claves_alternas || art.claves_alternas.length === 0) {
            contClaves.innerHTML = `<span class="text-xs text-slate-400 italic">No tiene códigos o claves alternas registradas</span>`;
        } else {
            contClaves.innerHTML = art.claves_alternas.map(c => `
                <span class="inline-flex items-center gap-1 font-mono text-xs font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
                    ${c.clave}
                </span>
            `).join('');
        }
    }

    // Renderizar artículos equivalentes
    const contEquiv = document.getElementById('cmContenedorArticulosEquivalentes');
    if (contEquiv) {
        if (!art.articulos_equivalentes || art.articulos_equivalentes.length === 0) {
            contEquiv.innerHTML = `<span class="text-xs text-slate-400 italic">No hay otros artículos con esta misma equivalencia</span>`;
        } else {
            contEquiv.innerHTML = art.articulos_equivalentes.map(eq => `
                <div class="flex items-center justify-between p-2 rounded-xl bg-slate-50 border border-slate-200 text-xs">
                    <div>
                        <span class="font-mono font-black text-slate-800">${eq.clave}</span>
                        <span class="text-slate-600 ml-2">${eq.nombre}</span>
                    </div>
                    <span class="font-mono text-[10px] font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200">
                        ${eq.equivalencia}
                    </span>
                </div>
            `).join('');
        }
    }
}

function onCambioCategoriaEditModal(lineaSeleccionada = null, sublineaSeleccionada = null) {
    const selCat = document.getElementById('cmEditCategoria');
    const selLin = document.getElementById('cmEditLinea');
    if (!selLin) return;

    const catId = selCat ? selCat.value : '';
    const lineas = catId 
        ? _cmOpciones.lineas.filter(l => String(l.categoria_id) === String(catId))
        : _cmOpciones.lineas;

    selLin.innerHTML = `<option value="">-- Sin línea --</option>` +
        lineas.map(l => `<option value="${l.id}">${l.nombre}</option>`).join('');
    
    if (lineaSeleccionada) selLin.value = lineaSeleccionada;

    onCambioLineaEditModal(sublineaSeleccionada);
}

function onCambioLineaEditModal(sublineaSeleccionada = null) {
    const selLin = document.getElementById('cmEditLinea');
    const selSub = document.getElementById('cmEditSublinea');
    if (!selSub) return;

    const linId = selLin ? selLin.value : '';
    const subs = linId 
        ? _cmOpciones.sublineas.filter(s => String(s.linea_id) === String(linId))
        : _cmOpciones.sublineas;

    selSub.innerHTML = `<option value="">-- Sin sublínea --</option>` +
        subs.map(s => `<option value="${s.id}">${s.nombre}</option>`).join('');

    if (sublineaSeleccionada) selSub.value = sublineaSeleccionada;
}

function renderizarClasificacionesSucursalesModal(sucursales) {
    const cont = document.getElementById('cmContenedorClasificacionesSucursales');
    if (!cont) return;

    if (!sucursales || sucursales.length === 0) {
        cont.innerHTML = `<div class="p-4 text-center text-slate-400 text-xs italic col-span-full">Sin datos de clasificación</div>`;
        return;
    }

    const COLORES_CLASIF = {
        'A': 'bg-emerald-600 text-white ring-2 ring-emerald-300',
        'B': 'bg-blue-600 text-white ring-2 ring-blue-300',
        'C': 'bg-amber-500 text-white ring-2 ring-amber-300',
        'D': 'bg-slate-500 text-white',
        'E': 'bg-slate-400 text-white',
        'N/A': 'bg-slate-100 text-slate-400 border border-slate-200'
    };

    cont.innerHTML = sucursales.map(s => {
        const c = (s.clasificacion || 'N/A').trim().toUpperCase();
        const badgeColor = COLORES_CLASIF[c] || 'bg-slate-100 text-slate-600 border border-slate-200';

        return `
            <div class="p-2.5 rounded-xl border border-slate-200/80 bg-white shadow-2xs hover:border-slate-300 transition flex items-center justify-between gap-2">
                <div class="min-w-0">
                    <div class="flex items-center gap-1.5">
                        <span class="font-black text-xs px-1.5 py-0.5 rounded bg-slate-900 text-white font-mono tracking-wider">${s.emblema}</span>
                        <span class="text-[11px] font-bold text-slate-700 truncate" title="${s.nombre}">${s.nombre.replace(/^Sucursal\s+/i, '')}</span>
                    </div>
                </div>
                <div class="w-7 h-7 rounded-lg flex items-center justify-center font-black text-xs shrink-0 shadow-xs ${badgeColor}">
                    ${c}
                </div>
            </div>
        `;
    }).join('');
}

async function guardarCambiosArticuloCM() {
    const artId = document.getElementById('cmEditArticuloId')?.value;
    if (!artId) return;

    const btn = document.getElementById('cmBtnGuardarArticulo');
    const txtOriginal = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<span>⏳ Guardando...</span>`;
    }

    const payload = {
        categoria_id: document.getElementById('cmEditCategoria')?.value || null,
        linea_id: document.getElementById('cmEditLinea')?.value || null,
        sublinea_id: document.getElementById('cmEditSublinea')?.value || null,
        marca_id: document.getElementById('cmEditMarca')?.value || null,
        multiplo: parseInt(document.getElementById('cmEditMultiplo')?.value, 10) || 1,
        multiplo_compra: parseInt(document.getElementById('cmEditMultiploCompra')?.value, 10) || 1,
        equivalencia: document.getElementById('cmEditEquivalencia')?.value || '',
        notas: document.getElementById('cmEditNotas')?.value || ''
    };

    try {
        const resp = await fetch(`/api/catalogo-maestro/articulos/${artId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const res = await resp.json();

        if (!res.success) {
            throw new Error(res.error || "No se pudo guardar la información del artículo");
        }

        if (typeof mostrarAlerta === 'function') {
            mostrarAlerta('success', `Artículo ${document.getElementById('cmModalArtClave')?.textContent} actualizado correctamente`);
        }

        cerrarModalEditarArticuloCM();
        await cargarArticulosCatalogoMaestro(_cmPaginaActual);

    } catch (e) {
        console.error("Error al guardar artículo maestro:", e);
        if (typeof mostrarAlerta === 'function') {
            mostrarAlerta('error', `Error al guardar: ${e.message}`);
        }
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = txtOriginal;
        }
    }
}

// =========================================================================
// MODAL DE GESTIÓN DE CATEGORÍAS, LÍNEAS, SUBLÍNEAS Y MARCAS
// =========================================================================

function abrirModalGestionOpcionesCM(tab = 'categorias') {
    const modal = document.getElementById('modalGestionOpcionesCM');
    if (!modal) return;
    modal.classList.remove('hidden');
    cambiarTabOpcionesCM(tab);
}

function cerrarModalGestionOpcionesCM() {
    const modal = document.getElementById('modalGestionOpcionesCM');
    if (modal) modal.classList.add('hidden');
}

function cambiarTabOpcionesCM(tab) {
    _cmTabOpcionesActual = tab;
    ['categorias', 'lineas', 'sublineas', 'marcas'].forEach(t => {
        const btn = document.getElementById(`cmTabBtn_${t}`);
        const sec = document.getElementById(`cmTabSec_${t}`);
        if (btn) {
            if (t === tab) {
                btn.className = "pb-2 px-3 text-xs font-black border-b-2 border-indigo-600 text-indigo-600 transition flex items-center gap-1.5 cursor-pointer";
            } else {
                btn.className = "pb-2 px-3 text-xs font-bold border-b-2 border-transparent text-slate-500 hover:text-slate-800 transition flex items-center gap-1.5 cursor-pointer";
            }
        }
        if (sec) {
            if (t === tab) sec.classList.remove('hidden');
            else sec.classList.add('hidden');
        }
    });

    renderizarListasOpcionesTabCM();
}

function renderizarListasOpcionesTabCM() {
    // 1. Categorías
    const tbodyCat = document.getElementById('cmTbodyCategorias');
    if (tbodyCat) {
        tbodyCat.innerHTML = _cmOpciones.categorias.map((c, i) => `
            <tr class="hover:bg-slate-50 border-b border-slate-100 last:border-0 text-xs">
                <td class="py-2 px-3 font-mono text-slate-400 text-center w-8">${i + 1}</td>
                <td class="py-2 px-3 font-bold text-slate-900">${c.nombre}</td>
                <td class="py-2 px-3 text-slate-500">${c.descripcion || '--'}</td>
                <td class="py-2 px-3 text-right whitespace-nowrap">
                    <button type="button" onclick="editarCategoriaCM(${c.id}, '${escapeHtml(c.nombre)}', '${escapeHtml(c.descripcion || '')}')" class="px-2 py-1 text-indigo-600 hover:bg-indigo-50 rounded font-bold cursor-pointer">✏️ Editar</button>
                    <button type="button" onclick="eliminarCategoriaCM(${c.id}, '${escapeHtml(c.nombre)}')" class="px-2 py-1 text-rose-600 hover:bg-rose-50 rounded font-bold cursor-pointer ml-1">🗑️</button>
                </td>
            </tr>
        `).join('') || `<tr><td colspan="4" class="p-6 text-center text-slate-400 italic">No hay categorías registradas</td></tr>`;
    }

    // 2. Líneas
    const selCatParaLinea = document.getElementById('cmNuevaLineaCategoriaId');
    if (selCatParaLinea) {
        selCatParaLinea.innerHTML = `<option value="">-- Sin categoría asociada --</option>` + 
            _cmOpciones.categorias.map(c => `<option value="${c.id}">${c.nombre}</option>`).join('');
    }
    const tbodyLin = document.getElementById('cmTbodyLineas');
    if (tbodyLin) {
        tbodyLin.innerHTML = _cmOpciones.lineas.map((l, i) => `
            <tr class="hover:bg-slate-50 border-b border-slate-100 last:border-0 text-xs">
                <td class="py-2 px-3 font-mono text-slate-400 text-center w-8">${i + 1}</td>
                <td class="py-2 px-3 font-bold text-slate-900">${l.nombre}</td>
                <td class="py-2 px-3 text-indigo-600 font-semibold">${l.categoria_nombre || '-- Sin categoría --'}</td>
                <td class="py-2 px-3 text-right whitespace-nowrap">
                    <button type="button" onclick="editarLineaCM(${l.id}, '${escapeHtml(l.nombre)}', ${l.categoria_id || 'null'}, '${escapeHtml(l.descripcion || '')}')" class="px-2 py-1 text-indigo-600 hover:bg-indigo-50 rounded font-bold cursor-pointer">✏️ Editar</button>
                    <button type="button" onclick="eliminarLineaCM(${l.id}, '${escapeHtml(l.nombre)}')" class="px-2 py-1 text-rose-600 hover:bg-rose-50 rounded font-bold cursor-pointer ml-1">🗑️</button>
                </td>
            </tr>
        `).join('') || `<tr><td colspan="4" class="p-6 text-center text-slate-400 italic">No hay líneas registradas</td></tr>`;
    }

    // 3. Sublíneas
    const selLinParaSub = document.getElementById('cmNuevaSublineaLineaId');
    if (selLinParaSub) {
        selLinParaSub.innerHTML = `<option value="">-- Sin línea asociada --</option>` + 
            _cmOpciones.lineas.map(l => `<option value="${l.id}">${l.nombre} (${l.categoria_nombre || 'Sin cat.'})</option>`).join('');
    }
    const tbodySub = document.getElementById('cmTbodySublineas');
    if (tbodySub) {
        tbodySub.innerHTML = _cmOpciones.sublineas.map((s, i) => `
            <tr class="hover:bg-slate-50 border-b border-slate-100 last:border-0 text-xs">
                <td class="py-2 px-3 font-mono text-slate-400 text-center w-8">${i + 1}</td>
                <td class="py-2 px-3 font-bold text-slate-900">${s.nombre}</td>
                <td class="py-2 px-3 text-indigo-600 font-semibold">${s.linea_nombre || '-- Sin línea --'}</td>
                <td class="py-2 px-3 text-right whitespace-nowrap">
                    <button type="button" onclick="editarSublineaCM(${s.id}, '${escapeHtml(s.nombre)}', ${s.linea_id || 'null'}, '${escapeHtml(s.descripcion || '')}')" class="px-2 py-1 text-indigo-600 hover:bg-indigo-50 rounded font-bold cursor-pointer">✏️ Editar</button>
                    <button type="button" onclick="eliminarSublineaCM(${s.id}, '${escapeHtml(s.nombre)}')" class="px-2 py-1 text-rose-600 hover:bg-rose-50 rounded font-bold cursor-pointer ml-1">🗑️</button>
                </td>
            </tr>
        `).join('') || `<tr><td colspan="4" class="p-6 text-center text-slate-400 italic">No hay sublíneas registradas</td></tr>`;
    }

    // 4. Marcas
    const tbodyMar = document.getElementById('cmTbodyMarcas');
    if (tbodyMar) {
        tbodyMar.innerHTML = _cmOpciones.marcas.map((m, i) => `
            <tr class="hover:bg-slate-50 border-b border-slate-100 last:border-0 text-xs">
                <td class="py-2 px-3 font-mono text-slate-400 text-center w-8">${i + 1}</td>
                <td class="py-2 px-3 font-bold text-slate-900">${m.nombre}</td>
                <td class="py-2 px-3 text-slate-500">${m.descripcion || '--'}</td>
                <td class="py-2 px-3 text-right whitespace-nowrap">
                    <button type="button" onclick="editarMarcaCM(${m.id}, '${escapeHtml(m.nombre)}', '${escapeHtml(m.descripcion || '')}')" class="px-2 py-1 text-indigo-600 hover:bg-indigo-50 rounded font-bold cursor-pointer">✏️ Editar</button>
                    <button type="button" onclick="eliminarMarcaCM(${m.id}, '${escapeHtml(m.nombre)}')" class="px-2 py-1 text-rose-600 hover:bg-rose-50 rounded font-bold cursor-pointer ml-1">🗑️</button>
                </td>
            </tr>
        `).join('') || `<tr><td colspan="4" class="p-6 text-center text-slate-400 italic">No hay marcas registradas</td></tr>`;
    }
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

// Acciones de alta y modificación
async function agregarCategoriaCM() {
    const input = document.getElementById('cmNuevaCategoriaNombre');
    const nom = (input?.value || '').trim();
    if (!nom) return alert("Ingresa el nombre de la categoría");

    try {
        const resp = await fetch('/api/catalogo-maestro/categorias', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nombre: nom })
        });
        const res = await resp.json();
        if (!res.success) throw new Error(res.error);
        input.value = '';
        await cargarOpcionesClasificacionCM();
        renderizarListasOpcionesTabCM();
        llenarSelectsFiltrosCM();
    } catch (e) {
        alert("Error al crear categoría: " + e.message);
    }
}

async function editarCategoriaCM(id, actual, descActual) {
    const nuevo = prompt("Modificar nombre de categoría:", actual);
    if (!nuevo || nuevo.trim() === actual) return;
    try {
        const resp = await fetch(`/api/catalogo-maestro/categorias/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nombre: nuevo.trim(), descripcion: descActual })
        });
        const res = await resp.json();
        if (!res.success) throw new Error(res.error);
        await cargarOpcionesClasificacionCM();
        renderizarListasOpcionesTabCM();
        llenarSelectsFiltrosCM();
    } catch (e) {
        alert("Error al modificar categoría: " + e.message);
    }
}

async function eliminarCategoriaCM(id, nombre) {
    if (!confirm(`¿Deseas eliminar la categoría "${nombre}"? Los artículos asignados no se borrarán, solo quedarán sin categoría.`)) return;
    try {
        const resp = await fetch(`/api/catalogo-maestro/categorias/${id}`, { method: 'DELETE' });
        const res = await resp.json();
        if (!res.success) throw new Error(res.error);
        await cargarOpcionesClasificacionCM();
        renderizarListasOpcionesTabCM();
        llenarSelectsFiltrosCM();
    } catch (e) {
        alert("Error al eliminar categoría: " + e.message);
    }
}

// Líneas
async function agregarLineaCM() {
    const input = document.getElementById('cmNuevaLineaNombre');
    const selCat = document.getElementById('cmNuevaLineaCategoriaId');
    const nom = (input?.value || '').trim();
    if (!nom) return alert("Ingresa el nombre de la línea");

    try {
        const resp = await fetch('/api/catalogo-maestro/lineas', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nombre: nom, categoria_id: selCat?.value || null })
        });
        const res = await resp.json();
        if (!res.success) throw new Error(res.error);
        input.value = '';
        await cargarOpcionesClasificacionCM();
        renderizarListasOpcionesTabCM();
        llenarSelectsFiltrosCM();
    } catch (e) {
        alert("Error al crear línea: " + e.message);
    }
}

async function editarLineaCM(id, actual, catActual, descActual) {
    const nuevo = prompt("Modificar nombre de línea:", actual);
    if (!nuevo || nuevo.trim() === actual) return;
    try {
        const resp = await fetch(`/api/catalogo-maestro/lineas/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nombre: nuevo.trim(), categoria_id: catActual, descripcion: descActual })
        });
        const res = await resp.json();
        if (!res.success) throw new Error(res.error);
        await cargarOpcionesClasificacionCM();
        renderizarListasOpcionesTabCM();
        llenarSelectsFiltrosCM();
    } catch (e) {
        alert("Error al modificar línea: " + e.message);
    }
}

async function eliminarLineaCM(id, nombre) {
    if (!confirm(`¿Deseas eliminar la línea "${nombre}"?`)) return;
    try {
        const resp = await fetch(`/api/catalogo-maestro/lineas/${id}`, { method: 'DELETE' });
        const res = await resp.json();
        if (!res.success) throw new Error(res.error);
        await cargarOpcionesClasificacionCM();
        renderizarListasOpcionesTabCM();
        llenarSelectsFiltrosCM();
    } catch (e) {
        alert("Error al eliminar línea: " + e.message);
    }
}

// Sublíneas
async function agregarSublineaCM() {
    const input = document.getElementById('cmNuevaSublineaNombre');
    const selLin = document.getElementById('cmNuevaSublineaLineaId');
    const nom = (input?.value || '').trim();
    if (!nom) return alert("Ingresa el nombre de la sublínea");

    try {
        const resp = await fetch('/api/catalogo-maestro/sublineas', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nombre: nom, linea_id: selLin?.value || null })
        });
        const res = await resp.json();
        if (!res.success) throw new Error(res.error);
        input.value = '';
        await cargarOpcionesClasificacionCM();
        renderizarListasOpcionesTabCM();
        llenarSelectsFiltrosCM();
    } catch (e) {
        alert("Error al crear sublínea: " + e.message);
    }
}

async function editarSublineaCM(id, actual, linActual, descActual) {
    const nuevo = prompt("Modificar nombre de sublínea:", actual);
    if (!nuevo || nuevo.trim() === actual) return;
    try {
        const resp = await fetch(`/api/catalogo-maestro/sublineas/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nombre: nuevo.trim(), linea_id: linActual, descripcion: descActual })
        });
        const res = await resp.json();
        if (!res.success) throw new Error(res.error);
        await cargarOpcionesClasificacionCM();
        renderizarListasOpcionesTabCM();
        llenarSelectsFiltrosCM();
    } catch (e) {
        alert("Error al modificar sublínea: " + e.message);
    }
}

async function eliminarSublineaCM(id, nombre) {
    if (!confirm(`¿Deseas eliminar la sublínea "${nombre}"?`)) return;
    try {
        const resp = await fetch(`/api/catalogo-maestro/sublineas/${id}`, { method: 'DELETE' });
        const res = await resp.json();
        if (!res.success) throw new Error(res.error);
        await cargarOpcionesClasificacionCM();
        renderizarListasOpcionesTabCM();
        llenarSelectsFiltrosCM();
    } catch (e) {
        alert("Error al eliminar sublínea: " + e.message);
    }
}

// Marcas
async function agregarMarcaCM() {
    const input = document.getElementById('cmNuevaMarcaNombre');
    const nom = (input?.value || '').trim();
    if (!nom) return alert("Ingresa el nombre de la marca");

    try {
        const resp = await fetch('/api/catalogo-maestro/marcas', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nombre: nom })
        });
        const res = await resp.json();
        if (!res.success) throw new Error(res.error);
        input.value = '';
        await cargarOpcionesClasificacionCM();
        renderizarListasOpcionesTabCM();
        llenarSelectsFiltrosCM();
    } catch (e) {
        alert("Error al crear marca: " + e.message);
    }
}

async function editarMarcaCM(id, actual, descActual) {
    const nuevo = prompt("Modificar nombre de marca:", actual);
    if (!nuevo || nuevo.trim() === actual) return;
    try {
        const resp = await fetch(`/api/catalogo-maestro/marcas/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nombre: nuevo.trim(), descripcion: descActual })
        });
        const res = await resp.json();
        if (!res.success) throw new Error(res.error);
        await cargarOpcionesClasificacionCM();
        renderizarListasOpcionesTabCM();
        llenarSelectsFiltrosCM();
    } catch (e) {
        alert("Error al modificar marca: " + e.message);
    }
}

async function eliminarMarcaCM(id, nombre) {
    if (!confirm(`¿Deseas eliminar la marca "${nombre}"?`)) return;
    try {
        const resp = await fetch(`/api/catalogo-maestro/marcas/${id}`, { method: 'DELETE' });
        const res = await resp.json();
        if (!res.success) throw new Error(res.error);
        await cargarOpcionesClasificacionCM();
        renderizarListasOpcionesTabCM();
        llenarSelectsFiltrosCM();
    } catch (e) {
        alert("Error al eliminar marca: " + e.message);
    }
}

// Exportar funciones globales
window.inicializarModuloCatalogoMaestro = inicializarModuloCatalogoMaestro;
window.cargarArticulosCatalogoMaestro = cargarArticulosCatalogoMaestro;
window.onInputBusquedaCM = onInputBusquedaCM;
window.actualizarFiltroLineasCM = actualizarFiltroLineasCM;
window.actualizarFiltroSublineasCM = actualizarFiltroSublineasCM;
window.paginaSiguienteCM = paginaSiguienteCM;
window.paginaAnteriorCM = paginaAnteriorCM;
window.abrirModalEditarArticuloCM = abrirModalEditarArticuloCM;
window.cerrarModalEditarArticuloCM = cerrarModalEditarArticuloCM;
window.onCambioCategoriaEditModal = onCambioCategoriaEditModal;
window.onCambioLineaEditModal = onCambioLineaEditModal;
window.guardarCambiosArticuloCM = guardarCambiosArticuloCM;
window.abrirModalGestionOpcionesCM = abrirModalGestionOpcionesCM;
window.cerrarModalGestionOpcionesCM = cerrarModalGestionOpcionesCM;
window.cambiarTabOpcionesCM = cambiarTabOpcionesCM;
window.agregarCategoriaCM = agregarCategoriaCM;
window.editarCategoriaCM = editarCategoriaCM;
window.eliminarCategoriaCM = eliminarCategoriaCM;
window.agregarLineaCM = agregarLineaCM;
window.editarLineaCM = editarLineaCM;
window.eliminarLineaCM = eliminarLineaCM;
window.agregarSublineaCM = agregarSublineaCM;
window.editarSublineaCM = editarSublineaCM;
window.eliminarSublineaCM = eliminarSublineaCM;
window.agregarMarcaCM = agregarMarcaCM;
window.editarMarcaCM = editarMarcaCM;
window.eliminarMarcaCM = eliminarMarcaCM;

