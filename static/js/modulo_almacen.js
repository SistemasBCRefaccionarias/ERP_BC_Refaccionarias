        // ================= GESTIÓN SUB-MÓDULO ALMACÉN: ESCÁNER Y TRASPASOS =================
        let traspasoActualEscaner = null;
        let historialEscaneosSesion = [];

        function reproducirBeep(exito = true) {
            const chk = document.getElementById('chkSonidoEscaner');
            if (chk && !chk.checked) return;
            try {
                const AudioCtx = window.AudioContext || window.webkitAudioContext;
                if (!AudioCtx) return;
                const ctx = new AudioCtx();
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.connect(gain);
                gain.connect(ctx.destination);
                if (exito) {
                    osc.type = 'sine';
                    osc.frequency.setValueAtTime(880, ctx.currentTime);
                    gain.gain.setValueAtTime(0.12, ctx.currentTime);
                    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
                    osc.start();
                    osc.stop(ctx.currentTime + 0.15);
                } else {
                    osc.type = 'sawtooth';
                    osc.frequency.setValueAtTime(220, ctx.currentTime);
                    gain.gain.setValueAtTime(0.2, ctx.currentTime);
                    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
                    osc.start();
                    osc.stop(ctx.currentTime + 0.3);
                }
            } catch (e) {}
        }

        function irASubTabAlmacen(subTab) {
            const mapSub = {
                'escaner': 'almacen_traspasos',
                'catalogo': 'almacen_stock',
                'recepcion_compra': 'almacen_recepcion',
                'cascos': 'almacen_cascos',
                'embarques': 'almacen_embarques'
            };
            activarTab(mapSub[subTab] || 'almacen');
        }

        function cambiarSubTabAlmacen(subTab) {
            const escanerContent = document.getElementById('subAlmEscanerContent');
            const catalogoContent = document.getElementById('subAlmCatalogoContent');
            const recepcionContent = document.getElementById('subAlmRecepcionContent');
            const cascosContent = document.getElementById('subAlmCascosContent');
            const embarquesContent = document.getElementById('subAlmEmbarquesContent');

            const btnEscaner = document.getElementById('tabSubAlmEscaner');
            const btnCatalogo = document.getElementById('tabSubAlmCatalogo');
            const btnRecepcion = document.getElementById('tabSubAlmRecepcion');
            const btnCascos = document.getElementById('tabSubAlmCascos');
            const btnEmbarques = document.getElementById('tabSubAlmEmbarques');

            const sideEscaner = document.getElementById('tabBtnAlmEscaner');
            const sideCatalogo = document.getElementById('tabBtnAlmCatalogo');
            const sideRecepcion = document.getElementById('tabBtnAlmRecepcion');
            const sideCascos = document.getElementById('tabBtnAlmCascos');
            const sideEmbarques = document.getElementById('tabBtnAlmEmbarques');

            const tabInactivo = "px-3.5 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-200 cursor-pointer";
            const tabActivo = "px-3.5 py-1.5 rounded-lg text-xs font-black transition flex items-center gap-1.5 bg-slate-900 text-white shadow-sm cursor-pointer";
            const sideInactivo = "sidebar-item w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-bold text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer";

            if (btnEscaner) btnEscaner.className = tabInactivo;
            if (btnCatalogo) btnCatalogo.className = tabInactivo;
            if (btnRecepcion) btnRecepcion.className = tabInactivo;
            if (btnCascos) btnCascos.className = tabInactivo;
            if (btnEmbarques) btnEmbarques.className = tabInactivo;

            if (sideEscaner) sideEscaner.className = sideInactivo;
            if (sideCatalogo) sideCatalogo.className = sideInactivo;
            if (sideRecepcion) sideRecepcion.className = sideInactivo;
            if (sideCascos) sideCascos.className = sideInactivo;
            if (sideEmbarques) sideEmbarques.className = sideInactivo;

            if (escanerContent) escanerContent.classList.add('hidden');
            if (catalogoContent) catalogoContent.classList.add('hidden');
            if (recepcionContent) recepcionContent.classList.add('hidden');
            if (cascosContent) cascosContent.classList.add('hidden');
            if (embarquesContent) embarquesContent.classList.add('hidden');

            if (subTab === 'embarques') {
                if (embarquesContent) embarquesContent.classList.remove('hidden');
                if (btnEmbarques) btnEmbarques.className = tabActivo;
                if (sideEmbarques) sideEmbarques.className = "sidebar-item w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-bold text-amber-400 bg-slate-800 transition cursor-pointer";
                if (typeof inicializarModuloEmbarques === 'function') {
                    inicializarModuloEmbarques();
                }
            } else if (subTab === 'escaner') {
                if (escanerContent) escanerContent.classList.remove('hidden');
                if (btnEscaner) btnEscaner.className = tabActivo;
                if (sideEscaner) sideEscaner.className = "sidebar-item w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-bold text-amber-400 bg-slate-800 transition cursor-pointer";
                setTimeout(() => {
                    const inp = document.getElementById('inputCodigoEscaner');
                    if (inp) { inp.focus(); inp.select(); }
                }, 100);
            } else if (subTab === 'recepcion_compra') {
                if (recepcionContent) recepcionContent.classList.remove('hidden');
                if (btnRecepcion) btnRecepcion.className = tabActivo;
                if (sideRecepcion) sideRecepcion.className = "sidebar-item w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-bold text-emerald-400 bg-slate-800 transition cursor-pointer";
                cargarOrdenesCompraAlmacen();
            } else if (subTab === 'cascos') {
                if (cascosContent) cascosContent.classList.remove('hidden');
                if (btnCascos) btnCascos.className = tabActivo;
                if (sideCascos) sideCascos.className = "sidebar-item w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-bold text-cyan-400 bg-slate-800 transition cursor-pointer";
                if (typeof window.cargarCascosInicial === 'function') {
                    window.cargarCascosInicial();
                }
            } else {
                if (catalogoContent) catalogoContent.classList.remove('hidden');
                if (btnCatalogo) btnCatalogo.className = tabActivo;
                if (sideCatalogo) sideCatalogo.className = "sidebar-item w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-bold text-white bg-slate-800 transition cursor-pointer";
                cargarAlmacenes();
            }
        }

        function mostrarAlertaEscaner(tipo, mensaje) {
            const box = document.getElementById('alertaEscaner');
            const ico = document.getElementById('alertaEscanerIcono');
            const txt = document.getElementById('alertaEscanerTexto');
            if (!box || !txt) return;

            if (tipo === 'error') {
                box.className = "p-3 rounded-xl text-xs font-bold bg-rose-500 text-white flex items-center justify-between";
                if (ico) ico.textContent = "❌";
            } else if (tipo === 'success') {
                box.className = "p-3 rounded-xl text-xs font-bold bg-emerald-600 text-white flex items-center justify-between";
                if (ico) ico.textContent = "✅";
            } else {
                box.className = "p-3 rounded-xl text-xs font-bold bg-amber-400 text-slate-950 flex items-center justify-between";
                if (ico) ico.textContent = "⚠️";
            }
            txt.textContent = mensaje;
            box.classList.remove('hidden');
        }

        function ocultarAlertaEscaner() {
            const box = document.getElementById('alertaEscaner');
            if (box) box.classList.add('hidden');
        }

        function limpiarEscanerAlmacen() {
            const inp = document.getElementById('inputCodigoEscaner');
            if (inp) {
                inp.value = '';
                inp.focus();
            }
            ocultarAlertaEscaner();
            document.getElementById('cardDetalleEscaner')?.classList.add('hidden');
            document.getElementById('cardPlaceholderEscaner')?.classList.remove('hidden');
            traspasoActualEscaner = null;
        }

        async function procesarEscaneoTraspasoSubmit(e) {
            if (e) e.preventDefault();
            const input = document.getElementById('inputCodigoEscaner');
            if (!input) return;
            const codigo = input.value.trim().toUpperCase();
            if (!codigo) {
                mostrarAlertaEscaner('warn', 'Por favor apunte el escáner o escriba un folio de traspaso.');
                reproducirBeep(false);
                input.focus();
                return;
            }

            ocultarAlertaEscaner();
            const btn = document.getElementById('btnBuscarEscaner');
            if (btn) btn.disabled = true;

            try {
                const res = await fetch(`/api/traspasos/escanear?codigo=${encodeURIComponent(codigo)}`);
                const data = await res.json();
                if (!res.ok || !data.success) {
                    throw new Error(data.error || `No se encontró ningún traspaso con el código '${codigo}'`);
                }

                const t = data.traspaso;
                traspasoActualEscaner = t;
                renderizarDetalleTraspasoEscaner(t);

                // Verificar si auto-aplicar estatus está activo
                const chkAuto = document.getElementById('chkAutoCambiarStatus');
                const selStatus = document.getElementById('selectStatusObjetivo');
                if (chkAuto && chkAuto.checked && selStatus) {
                    const targetSt = parseInt(selStatus.value, 10);
                    const targetEnt = targetSt === 14 ? 1 : 0;
                    if (t.status !== targetSt) {
                        await ejecutarCambioEstatusEscaner(targetSt, targetEnt, true);
                    } else {
                        reproducirBeep(true);
                        mostrarAlertaEscaner('success', `Traspaso ${t.folio} leído. Ya se encuentra en estatus: ${t.status_nombre}`);
                        agregarAHistorialEscaneos(t, t.status_nombre);
                    }
                } else {
                    reproducirBeep(true);
                    mostrarAlertaEscaner('success', `Traspaso ${t.folio} cargado correctamente.`);
                }
            } catch (err) {
                reproducirBeep(false);
                mostrarAlertaEscaner('error', err.message);
                input.select();
                input.focus();
            } finally {
                if (btn) btn.disabled = false;
            }
        }

        function renderizarDetalleTraspasoEscaner(t) {
            if (!t) return;
            document.getElementById('cardPlaceholderEscaner')?.classList.add('hidden');
            const card = document.getElementById('cardDetalleEscaner');
            if (!card) return;
            card.classList.remove('hidden');

            document.getElementById('escFolioBadge').textContent = t.folio || '--';
            document.getElementById('escTituloFolio').textContent = `Traspaso ${t.folio}`;
            
            const badge = document.getElementById('escStatusBadge');
            if (badge) {
                badge.className = `px-3 py-1 rounded-full text-xs font-extrabold uppercase tracking-wide border shadow-sm ${t.status_badge || 'bg-slate-100 text-slate-800'}`;
                badge.textContent = t.status_nombre || `STATUS ${t.status}`;
            }

            document.getElementById('escRutaAlmacenes').textContent = `${t.almacen_origen || 'CEDIS'} ➔ ${t.almacen_destino || 'SUCURSAL'}`;
            document.getElementById('escFechaHora').textContent = `${t.fecha || ''} ${t.hora_caja || ''}`;
            document.getElementById('escUsuario').textContent = t.usuario || 'ADMIN';

            // Microsip Metadata
            const metaSt = document.getElementById('escMetaStatus');
            const metaStDesc = document.getElementById('escMetaStatusDesc');
            if (metaSt) metaSt.textContent = `${t.status} - ${t.status_nombre}`;
            if (metaStDesc) metaStDesc.textContent = t.status_desc || 'Estatus de salida de almacén';

            const metaEnt = document.getElementById('escMetaEntregado');
            if (metaEnt) metaEnt.textContent = `${t.entregado} (${t.entregado_label || 'NO ENTREGADO'})`;

            const metaCond = document.getElementById('escMetaCondicion');
            if (metaCond) metaCond.textContent = `${t.condicion} (NORMAL)`;

            const metaTipo = document.getElementById('escMetaTipo');
            if (metaTipo) metaTipo.textContent = `${t.tipo || 'N'} (NORMAL)`;

            // Total partidas y piezas
            const totPartidas = (t.partidas || []).length;
            const totPzas = t.total_piezas || 0;
            const bPartidas = document.getElementById('escTotalPartidasBadge');
            const bPzas = document.getElementById('escTotalPiezasBadge');
            if (bPartidas) bPartidas.textContent = `${totPartidas} partidas`;
            if (bPzas) bPzas.textContent = `${totPzas} piezas`;

            // Partidas Picking Table
            const tbody = document.getElementById('escTablaPartidasBody');
            if (tbody) {
                if (!t.partidas || !t.partidas.length) {
                    tbody.innerHTML = `<tr><td colspan="6" class="p-6 text-center text-slate-400 italic">No hay partidas registradas para este traspaso.</td></tr>`;
                } else {
                    tbody.innerHTML = t.partidas.map((p, idx) => {
                        const locText = p.localizacion ? p.localizacion : 'CEDIS GRAL';
                        return `
                            <tr class="hover:bg-slate-50 transition border-b border-slate-100">
                                <td class="p-3 text-center text-slate-400 font-mono text-xs">${idx + 1}</td>
                                <td class="p-3 font-mono font-bold text-slate-900">${p.clave}</td>
                                <td class="p-3 font-semibold text-slate-700">${p.nombre}</td>
                                <td class="p-3 text-center">
                                    <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-black font-mono ${p.localizacion ? 'bg-amber-100 text-amber-900 border border-amber-300' : 'bg-slate-100 text-slate-600'}">
                                        📍 ${locText}
                                    </span>
                                </td>
                                <td class="p-3 text-right font-black font-mono text-sm text-slate-900">${p.cantidad}</td>
                                <td class="p-3 text-center font-bold text-slate-500 text-xs">${p.unidad || 'PZA'}</td>
                            </tr>
                        `;
                    }).join('');
                }
            }
        }

        async function ejecutarCambioEstatusEscaner(nuevoStatus, nuevoEntregado = 0, esAuto = false) {
            if (!traspasoActualEscaner) {
                mostrarAlertaEscaner('error', 'Primero debe escanear o cargar un traspaso.');
                reproducirBeep(false);
                return;
            }

            const docId = traspasoActualEscaner.docto_in_id;
            const folio = traspasoActualEscaner.folio;
            const usuario = (currentUser && (currentUser.nombre || currentUser.usuario)) || 'ALMACEN';

            try {
                const res = await fetch('/api/traspasos/cambiar-estatus', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        docto_in_id: docId,
                        folio: folio,
                        status: nuevoStatus,
                        entregado: nuevoEntregado,
                        usuario: usuario
                    })
                });

                const data = await res.json();
                if (!res.ok || !data.success) {
                    throw new Error(data.error || 'Error al actualizar estatus');
                }

                // Actualizar objeto en memoria
                const stInfo = data.estatus;
                traspasoActualEscaner.status = stInfo.status;
                traspasoActualEscaner.status_nombre = stInfo.status_nombre;
                traspasoActualEscaner.status_color = stInfo.status_color;
                traspasoActualEscaner.status_badge = stInfo.status_badge;
                traspasoActualEscaner.status_desc = stInfo.status_desc;
                traspasoActualEscaner.entregado = stInfo.entregado;
                traspasoActualEscaner.entregado_label = stInfo.entregado_label;

                renderizarDetalleTraspasoEscaner(traspasoActualEscaner);
                reproducirBeep(true);
                mostrarAlertaEscaner('success', `¡Traspaso ${folio} actualizado exitosamente a ${stInfo.status_nombre}!`);
                agregarAHistorialEscaneos(traspasoActualEscaner, stInfo.status_nombre);

                // Re-enfocar el input para el siguiente escaneo
                setTimeout(() => {
                    const inp = document.getElementById('inputCodigoEscaner');
                    if (inp) {
                        inp.value = '';
                        inp.focus();
                    }
                }, 150);
            } catch (err) {
                reproducirBeep(false);
                mostrarAlertaEscaner('error', `Error al cambiar estatus: ${err.message}`);
            }
        }

        function agregarAHistorialEscaneos(t, estatusAplicado) {
            if (!t) return;
            const now = new Date();
            const hora = now.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            
            // Agregar al inicio del array
            historialEscaneosSesion.unshift({
                hora: hora,
                docto_in_id: t.docto_in_id,
                folio: t.folio,
                origen: t.almacen_origen || 'CEDIS',
                destino: t.almacen_destino || 'SUCURSAL',
                estatus: estatusAplicado || t.status_nombre,
                status_badge: t.status_badge || 'bg-slate-100 text-slate-800',
                piezas: t.total_piezas || 0
            });

            // Limitar a los 50 más recientes
            if (historialEscaneosSesion.length > 50) historialEscaneosSesion.pop();
            renderizarHistorialEscaneos();
        }

        function renderizarHistorialEscaneos() {
            const tbody = document.getElementById('tablaHistorialEscaneosBody');
            const badge = document.getElementById('badgeHistorialCount');
            if (badge) badge.textContent = `${historialEscaneosSesion.length} leídos`;
            if (!tbody) return;

            if (!historialEscaneosSesion.length) {
                tbody.innerHTML = `<tr><td colspan="6" class="p-6 text-center text-slate-400 italic">No hay traspasos escaneados en esta sesión todavía.</td></tr>`;
                return;
            }

            tbody.innerHTML = historialEscaneosSesion.map(h => `
                <tr class="hover:bg-slate-50 transition border-b border-slate-100">
                    <td class="p-3 font-mono text-slate-400 text-xs">${h.hora}</td>
                    <td class="p-3 font-mono font-black text-slate-900">${h.folio}</td>
                    <td class="p-3 font-semibold text-slate-700">${h.origen} ➔ ${h.destino}</td>
                    <td class="p-3 text-center">
                        <span class="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wide border shadow-xs ${h.status_badge}">
                            ${h.estatus}
                        </span>
                    </td>
                    <td class="p-3 text-right font-black font-mono text-xs text-slate-900">${h.piezas}</td>
                    <td class="p-3 text-center">
                        <div class="flex items-center justify-center gap-1.5">
                            <button type="button" onclick="cargarTraspasoPorIdEscaner(${h.docto_in_id})" class="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-[10px] rounded-lg transition border border-slate-200 cursor-pointer">
                                🔍 Ver
                            </button>
                            <button type="button" onclick="reimprimirTraspasoDesdeHistorial(${h.docto_in_id})" title="Reimprimir en POS-80C" class="px-2 py-1 bg-slate-900 hover:bg-slate-800 text-white font-bold text-[10px] rounded-lg transition cursor-pointer">
                                🖨️
                            </button>
                        </div>
                    </td>
                </tr>
            `).join('');
        }

        async function cargarTraspasoPorIdEscaner(doctoId) {
            try {
                const res = await fetch(`/api/traspasos/detalle/${doctoId}`);
                const data = await res.json();
                if (data.success && data.traspaso) {
                    traspasoActualEscaner = data.traspaso;
                    renderizarDetalleTraspasoEscaner(data.traspaso);
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                }
            } catch (err) {
                mostrarAlertaEscaner('error', `Error al cargar detalle: ${err.message}`);
            }
        }

        function limpiarHistorialSesion() {
            historialEscaneosSesion = [];
            renderizarHistorialEscaneos();
        }

        async function reimprimirDesdeEscaner() {
            if (!traspasoActualEscaner) return;
            await reimprimirTraspasoDesdeHistorial(traspasoActualEscaner.docto_in_id);
        }

        async function reimprimirTraspasoDesdeHistorial(doctoId) {
            try {
                mostrarAlertaEscaner('info', 'Enviando trabajo de reimpresión a la impresora POS-80C...');
                const res = await fetch(`/api/traspasos/reimprimir-id/${doctoId}`, { method: 'POST' });
                const data = await res.json();
                if (data.success) {
                    mostrarAlertaEscaner('success', `Ticket reimpreso correctamente en POS-80C (2 copias) (Folio: ${data.folio})`);
                    reproducirBeep(true);
                } else {
                    mostrarAlertaEscaner('warn', `Aviso al reimprimir: ${data.mensaje}`);
                }
            } catch (err) {
                mostrarAlertaEscaner('error', `Error al reimprimir ticket: ${err.message}`);
            }
        }

        // ================= GESTIÓN MÓDULO ALMACÉN: CATÁLOGO Y STOCK =================
        let listaAlmacenesCache = [];

        async function cargarAlmacenes(forceRefresh = false) {
            const tbody = document.getElementById('tablaAlmacenesBody');
            if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="p-8 text-center text-slate-400 italic">Cargando inventarios de almacenes...</td></tr>`;
            try {
                const url = forceRefresh ? '/api/almacenes/resumen?refresh=1' : '/api/almacenes/resumen';
                const res = await fetch(url);
                const data = await res.json();
                if (!data.success) throw new Error(data.error || 'Error al obtener datos');

                listaAlmacenesCache = data.almacenes || [];

                const elTot = document.getElementById('kpiAlmTotal');
                const elStock = document.getElementById('kpiAlmConStock');
                const elCedis = document.getElementById('kpiAlmCedis');
                const elRed = document.getElementById('kpiAlmRedTotal');
                const elSkus = document.getElementById('kpiAlmSkusActivos');
                const elBadge = document.getElementById('badgeTotalAlmacenesTabla');

                if (elTot) elTot.textContent = data.kpis.total_almacenes || 0;
                if (elStock) elStock.textContent = `${data.kpis.almacenes_con_stock || 0} con inventario activo`;
                if (elCedis) elCedis.textContent = `${Number(data.kpis.piezas_cedis || 0).toLocaleString('es-MX', {maximumFractionDigits: 0})} pzs`;
                if (elRed) elRed.textContent = `${Number(data.kpis.piezas_red || 0).toLocaleString('es-MX', {maximumFractionDigits: 0})} pzs`;
                if (elSkus) elSkus.textContent = Number(data.kpis.skus_activos || 104272).toLocaleString('es-MX');
                if (elBadge) elBadge.textContent = `${listaAlmacenesCache.length} almacenes`;

                renderizarTablaAlmacenes(listaAlmacenesCache);
            } catch (err) {
                if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="p-6 text-center text-rose-500 font-bold">Error: ${err.message}</td></tr>`;
            }
        }

        function renderizarTablaAlmacenes(items) {
            const tbody = document.getElementById('tablaAlmacenesBody');
            if (!tbody) return;
            if (!items.length) {
                tbody.innerHTML = `<tr><td colspan="6" class="p-6 text-center text-slate-400 italic">No se encontraron almacenes con el filtro aplicado.</td></tr>`;
                return;
            }

            tbody.innerHTML = items.map(a => {
                let badgeTipo = '';
                if (a.es_cedis) {
                    badgeTipo = `<span class="bg-amber-100 text-amber-800 text-[10px] font-black px-2.5 py-0.5 rounded-full border border-amber-200">🏭 CEDIS</span>`;
                } else if (a.es_sucursal) {
                    badgeTipo = `<span class="bg-blue-50 text-blue-700 text-[10px] font-black px-2.5 py-0.5 rounded-full border border-blue-200">🏪 Sucursal</span>`;
                } else if (a.tipo === 'Devoluciones') {
                    badgeTipo = `<span class="bg-rose-50 text-rose-700 text-[10px] font-bold px-2.5 py-0.5 rounded-full">Devolución</span>`;
                } else if (a.tipo === 'Tránsito') {
                    badgeTipo = `<span class="bg-purple-50 text-purple-700 text-[10px] font-bold px-2.5 py-0.5 rounded-full">Tránsito</span>`;
                } else {
                    badgeTipo = `<span class="bg-slate-100 text-slate-600 text-[10px] font-bold px-2.5 py-0.5 rounded-full">${a.tipo}</span>`;
                }

                const piezasFmt = Number(a.piezas).toLocaleString('es-MX', { maximumFractionDigits: 0 });
                const articulosFmt = Number(a.articulos).toLocaleString('es-MX');

                return `
                    <tr class="hover:bg-slate-50 transition border-b border-slate-100">
                        <td class="p-3 text-center font-mono text-[11px] text-slate-400 font-bold">${a.id}</td>
                        <td class="p-3 font-bold text-slate-800 flex items-center gap-2">
                            <span>${a.nombre}</span>
                            ${a.es_cedis ? '<span class="text-[9px] bg-red-600 text-white font-black px-1.5 py-0.2 rounded">CENTRAL</span>' : ''}
                        </td>
                        <td class="p-3 text-center">${badgeTipo}</td>
                        <td class="p-3 text-right font-black ${a.piezas > 0 ? 'text-slate-900' : 'text-slate-300'} font-mono text-xs">
                            ${piezasFmt}
                        </td>
                        <td class="p-3 text-right font-semibold text-slate-600 font-mono text-xs">
                            ${articulosFmt}
                        </td>
                        <td class="p-3 text-center">
                            <div class="flex items-center justify-center gap-1.5">
                                ${a.es_sucursal ? `
                                    <button type="button" onclick="irATraspasos(${a.id})" title="Enviar traspaso a este almacén" class="px-2 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold text-[10px] rounded-lg transition border border-blue-200">
                                        📦 Traspasar
                                    </button>
                                ` : ''}
                                <button type="button" onclick="irABuscadorArticulos()" title="Buscar existencias" class="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-[10px] rounded-lg transition border border-slate-200">
                                    🔍 Artículos
                                </button>
                            </div>
                        </td>
                    </tr>
                `;
            }).join('');
        }

        document.getElementById('filtroTablaAlmacenes')?.addEventListener('input', (e) => {
            const q = e.target.value.trim().toUpperCase();
            if (!q) {
                renderizarTablaAlmacenes(listaAlmacenesCache);
                return;
            }
            const filtrados = listaAlmacenesCache.filter(a => 
                a.nombre.toUpperCase().includes(q) || String(a.id).includes(q) || (a.tipo && a.tipo.toUpperCase().includes(q))
            );
            renderizarTablaAlmacenes(filtrados);
        });

        // ================= GESTIÓN MÓDULO SUCURSALES =================
        let listaSucursalesCache = [];

        async function cargarSucursales(forceRefresh = false) {
            const grid = document.getElementById('gridSucursales');
            if (grid) grid.innerHTML = `<div class="col-span-full p-8 text-center text-slate-400 italic bg-white rounded-2xl border border-slate-200">Cargando directorio de sucursales...</div>`;
            try {
                const url = forceRefresh ? '/api/sucursales/resumen?refresh=1' : '/api/sucursales/resumen';
                const res = await fetch(url);
                const data = await res.json();
                if (!data.success) throw new Error(data.error || 'Error al obtener datos');

                listaSucursalesCache = data.sucursales || [];

                const elTot = document.getElementById('kpiSucTotal');
                const elAct = document.getElementById('kpiSucActivas');
                const elPz = document.getElementById('kpiSucPiezasTotal');
                const elLid = document.getElementById('kpiSucLider');
                const elBadge = document.getElementById('badgeTotalSucursales');
                const elCosto = document.getElementById('kpiSucCostoTotal');
                const elVentaHoy = document.getElementById('kpiSucVentaHoyTotal');
                const elVentaProm = document.getElementById('kpiSucVentaPromTotal');

                if (elTot) elTot.textContent = data.kpis.total_sucursales || 0;
                if (elAct) elAct.textContent = `${data.kpis.activas_con_stock || 0} con stock`;
                if (elPz) elPz.textContent = `${Number(data.kpis.piezas_sucursales || 0).toLocaleString('es-MX', {maximumFractionDigits: 0})} pzs`;
                if (elLid) elLid.textContent = data.kpis.sucursal_lider || 'N/A';
                if (elBadge) elBadge.textContent = `${listaSucursalesCache.length} sucursales`;

                if (elCosto) elCosto.textContent = '$' + Number(data.kpis.costo_total_existencia || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                if (elVentaHoy) elVentaHoy.textContent = '$' + Number(data.kpis.venta_total_hoy || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                if (elVentaProm) elVentaProm.textContent = '$' + Number(data.kpis.venta_promedio_total_diaria || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

                renderizarGridSucursales(listaSucursalesCache);
            } catch (err) {
                if (grid) grid.innerHTML = `<div class="col-span-full p-6 text-center text-rose-500 font-bold bg-white rounded-2xl border border-rose-200">Error: ${err.message}</div>`;
            }
        }

        function renderizarGridSucursales(items) {
            const grid = document.getElementById('gridSucursales');
            if (!grid) return;
            if (!items.length) {
                grid.innerHTML = `<div class="col-span-full p-6 text-center text-slate-400 italic bg-white rounded-2xl border border-slate-200">No se encontraron sucursales con el criterio de búsqueda.</div>`;
                return;
            }

            grid.innerHTML = items.map(s => {
                const piezasFmt = Number(s.piezas || 0).toLocaleString('es-MX', { maximumFractionDigits: 0 });
                const articulosFmt = Number(s.articulos || 0).toLocaleString('es-MX');
                const pct = s.porcentaje_red || 0;

                const costoExtFmt = '$' + Number(s.costo_existencia || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                const ventaHoyFmt = '$' + Number(s.venta_hoy || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                const ventaPromFmt = '$' + Number(s.venta_promedio_diaria || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

                return `
                    <div class="bg-white p-4 rounded-2xl border border-slate-200 hover:border-blue-400 hover:shadow-md transition space-y-3 flex flex-col justify-between">
                        <div>
                            <div class="flex items-start justify-between gap-2">
                                <div class="flex items-center gap-2.5">
                                    <div class="w-8 h-8 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center text-sm font-black">
                                        🏪
                                    </div>
                                    <div>
                                        <h3 class="text-xs font-black text-slate-900 leading-tight">${s.nombre}</h3>
                                        <span class="text-[10px] font-mono text-slate-400">ID: ${s.id}</span>
                                    </div>
                                </div>
                                <span class="text-[10px] font-extrabold ${s.piezas > 0 ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-400 border-slate-200'} border px-2 py-0.5 rounded-full">
                                    ${s.piezas > 0 ? 'Activa' : 'Sin stock'}
                                </span>
                            </div>

                            <!-- Existencia y Artículos -->
                            <div class="grid grid-cols-2 gap-2 mt-3 p-2.5 bg-slate-50 rounded-xl border border-slate-100">
                                <div>
                                    <div class="text-[9px] uppercase tracking-wider font-extrabold text-slate-400">Existencia</div>
                                    <div class="text-sm font-black text-slate-900 font-mono">${piezasFmt} <span class="text-[10px] font-medium text-slate-500">pzs</span></div>
                                </div>
                                <div>
                                    <div class="text-[9px] uppercase tracking-wider font-extrabold text-slate-400">Artículos</div>
                                    <div class="text-sm font-black text-slate-700 font-mono">${articulosFmt}</div>
                                </div>
                            </div>

                            <!-- Costo de la Existencia -->
                            <div class="mt-2 p-2.5 bg-amber-50/80 border border-amber-200/80 rounded-xl flex items-center justify-between">
                                <div class="flex items-center gap-1.5">
                                    <span class="text-xs">💰</span>
                                    <span class="text-[9px] uppercase tracking-wider font-extrabold text-amber-900">Costo Existencia</span>
                                </div>
                                <div class="text-xs font-black text-amber-950 font-mono" title="Existencia x último costo de compra">
                                    ${costoExtFmt}
                                </div>
                            </div>

                            <!-- Ventas: Hoy y Promedio Diario -->
                            <div class="grid grid-cols-2 gap-2 mt-2 p-2.5 bg-slate-50/90 border border-slate-100 rounded-xl">
                                <div>
                                    <div class="text-[9px] uppercase tracking-wider font-extrabold text-emerald-700 flex items-center gap-1">
                                        <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block animate-pulse"></span>
                                        Venta Hoy
                                    </div>
                                    <div class="text-xs font-black text-emerald-950 font-mono mt-0.5">${ventaHoyFmt}</div>
                                </div>
                                <div>
                                    <div class="text-[9px] uppercase tracking-wider font-extrabold text-indigo-700 flex items-center gap-1">
                                        <span>📈</span>
                                        Prom. Diario
                                    </div>
                                    <div class="text-xs font-black text-indigo-950 font-mono mt-0.5" title="${s.dias_activos ? s.dias_activos + ' días con venta en el último mes' : 'Promedio 30 días'}">${ventaPromFmt}</div>
                                </div>
                            </div>

                            <!-- % del Stock Sucursales -->
                            <div class="mt-2.5 space-y-1">
                                <div class="flex justify-between text-[10px] text-slate-400 font-medium">
                                    <span>% del Stock Sucursales</span>
                                    <span class="font-bold text-slate-700">${pct}%</span>
                                </div>
                                <div class="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                                    <div class="bg-blue-600 h-1.5 rounded-full" style="width: ${Math.min(pct, 100)}%"></div>
                                </div>
                            </div>
                        </div>

                        <!-- Acciones -->
                        <div class="pt-2 border-t border-slate-100 flex items-center gap-2">
                            <button type="button" onclick="irATraspasos(${s.id})" class="flex-1 py-1.5 px-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-[11px] font-bold transition flex items-center justify-center gap-1.5 shadow-sm">
                                <span>📦 Traspasar</span>
                            </button>
                            <button type="button" onclick="irABuscadorArticulos()" class="py-1.5 px-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-[11px] font-bold transition" title="Consultar artículos">
                                🔍
                            </button>
                        </div>
                    </div>
                `;
            }).join('');
        }

        document.getElementById('filtroGridSucursales')?.addEventListener('input', (e) => {
            const q = e.target.value.trim().toUpperCase();
            if (!q) {
                renderizarGridSucursales(listaSucursalesCache);
                return;
            }
            const filtrados = listaSucursalesCache.filter(s => 
                s.nombre.toUpperCase().includes(q) || String(s.id).includes(q)
            );
            renderizarGridSucursales(filtrados);
        });

        // =====================================================================
        // SUBMÓDULO ALMACÉN: RECEPCIÓN DE ÓRDENES DE COMPRA (OC)
        // =====================================================================
        let _ordenesCompraAlmacenCache = [];
        let _ordenCompraSeleccionada = null;
        let _ordenCompraRapida = null;

        async function cargarOrdenesCompraAlmacen() {
            const tbody = document.getElementById('tablaAlmRecBody');
            if (tbody) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="9" class="p-8 text-center text-slate-400">
                            <div class="inline-flex items-center gap-2 font-bold text-xs">
                                <span class="animate-spin text-emerald-600 text-lg">⏳</span> Consultando órdenes de compra pendientes en Microsip...
                            </div>
                        </td>
                    </tr>
                `;
            }

            const selPeriodo = document.getElementById('selectFiltroAlmRecPeriodo');
            const selAlm = document.getElementById('selectFiltroAlmRecAlmacen');
            const inpBusq = document.getElementById('inputFiltroAlmRecBusqueda');

            const periodo = selPeriodo ? selPeriodo.value : 'anio_actual';
            const almacen_id = selAlm ? selAlm.value : '';
            const busqueda = inpBusq ? inpBusq.value.trim() : '';

            try {
                const params = new URLSearchParams();
                if (periodo) params.set('periodo', periodo);
                if (almacen_id) params.set('almacen_id', almacen_id);
                if (busqueda) params.set('busqueda', busqueda);

                const res = await fetch(`/api/almacen/ordenes-compra-pendientes?${params.toString()}`);
                const data = await res.json();

                if (!data.success) {
                    throw new Error(data.error || 'Error al obtener órdenes de compra.');
                }

                _ordenesCompraAlmacenCache = data.ordenes || [];

                // Actualizar KPIs
                const kpiTotal = document.getElementById('kpiAlmRecTotal');
                const kpiPiezas = document.getElementById('kpiAlmRecPiezas');
                const kpiImporte = document.getElementById('kpiAlmRecImporte');
                const kpiAlms = document.getElementById('kpiAlmRecAlmacenes');
                const badgeTotal = document.getElementById('badgeTotalOrdenesRec');

                if (kpiTotal) kpiTotal.textContent = (data.kpis?.total_ordenes || 0).toLocaleString('es-MX');
                if (kpiPiezas) kpiPiezas.textContent = (data.kpis?.total_piezas_pendientes || 0).toLocaleString('es-MX', { maximumFractionDigits: 1 }) + ' pzs';
                if (kpiImporte) kpiImporte.textContent = '$' + (data.kpis?.total_importe || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                if (kpiAlms) kpiAlms.textContent = (data.kpis?.almacenes_involucrados || 0) + ' almacenes';
                if (badgeTotal) badgeTotal.textContent = `${data.total || 0} Órdenes`;

                // Poblar dropdown de almacenes si solo tiene la opción por defecto
                if (selAlm && selAlm.options.length <= 1 && Array.isArray(data.almacenes)) {
                    data.almacenes.forEach(a => {
                        const opt = document.createElement('option');
                        opt.value = a.id;
                        opt.textContent = a.nombre;
                        selAlm.appendChild(opt);
                    });
                }

                renderTablaOrdenesCompraAlmacen(_ordenesCompraAlmacenCache);

            } catch (err) {
                console.error("Error al cargar órdenes de compra de almacén:", err);
                if (tbody) {
                    tbody.innerHTML = `
                        <tr>
                            <td colspan="9" class="p-8 text-center text-rose-600 font-bold text-xs">
                                ❌ Ocurrió un error al cargar las órdenes de compra: ${err.message}
                            </td>
                        </tr>
                    `;
                }
            }
        }

        function filtrarOrdenesCompraLocalmente() {
            const inp = document.getElementById('inputFiltroAlmRecBusqueda');
            const q = inp ? inp.value.trim().toUpperCase() : '';
            if (!q) {
                renderTablaOrdenesCompraAlmacen(_ordenesCompraAlmacenCache);
                return;
            }
            const filtradas = _ordenesCompraAlmacenCache.filter(o => 
                (o.folio && o.folio.toUpperCase().includes(q)) ||
                (o.proveedor_nombre && o.proveedor_nombre.toUpperCase().includes(q)) ||
                (o.almacen_nombre && o.almacen_nombre.toUpperCase().includes(q))
            );
            renderTablaOrdenesCompraAlmacen(filtradas);
        }

        function renderTablaOrdenesCompraAlmacen(lista) {
            const tbody = document.getElementById('tablaAlmRecBody');
            if (!tbody) return;

            if (!lista || lista.length === 0) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="9" class="p-10 text-center text-slate-400 italic">
                            <div class="space-y-1">
                                <div class="text-2xl">📋</div>
                                <div class="font-bold text-slate-600 text-xs">No hay órdenes de compra pendientes</div>
                                <div class="text-[11px] text-slate-400">No se encontraron órdenes con estatus pendiente para el filtro seleccionado.</div>
                            </div>
                        </td>
                    </tr>
                `;
                return;
            }

            tbody.innerHTML = lista.map((o) => {
                const esCedis = (o.almacen_nombre || '').toUpperCase().includes('CEDIS');
                const badgeAlmClass = esCedis ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-slate-100 text-slate-700 border-slate-200';
                const tieneRecepcionParcial = o.piezas_recibidas > 0;

                return `
                    <tr class="hover:bg-slate-50/80 transition-colors border-b border-slate-100">
                        <td class="p-3">
                            <span class="inline-flex items-center font-mono font-black text-slate-900 bg-slate-100 border border-slate-300 px-2 py-0.5 rounded-lg text-xs tracking-wider">
                                ${o.folio}
                            </span>
                        </td>
                        <td class="p-3 text-slate-600 font-mono text-[11px] whitespace-nowrap">
                            ${o.fecha}
                        </td>
                        <td class="p-3">
                            <div class="font-bold text-slate-800 text-xs leading-tight">${o.proveedor_nombre}</div>
                            <div class="text-[10px] text-slate-400 font-mono">Prov #${o.proveedor_id}</div>
                        </td>
                        <td class="p-3">
                            <span class="inline-flex items-center px-2 py-0.5 rounded-lg text-[10px] font-bold border ${badgeAlmClass}">
                                ${o.almacen_nombre}
                            </span>
                        </td>
                        <td class="p-3 text-center">
                            <span class="inline-flex items-center justify-center font-bold text-slate-700 bg-slate-100 w-7 h-7 rounded-lg text-xs">
                                ${o.total_partidas}
                            </span>
                        </td>
                        <td class="p-3 text-right">
                            <div class="font-black text-amber-600 text-xs">${o.piezas_pendientes.toLocaleString('es-MX')} pzs</div>
                            ${tieneRecepcionParcial ? `<div class="text-[10px] text-emerald-600 font-semibold">${o.piezas_recibidas.toLocaleString('es-MX')} ya rec.</div>` : ''}
                        </td>
                        <td class="p-3 text-right font-black text-emerald-700 text-xs">
                            $${o.total.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                        <td class="p-3 text-center">
                            <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${tieneRecepcionParcial ? 'bg-amber-100 text-amber-800 border border-amber-300' : 'bg-orange-50 text-orange-700 border border-orange-200'}">
                                <span class="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                                ${tieneRecepcionParcial ? 'Parcial' : 'Pendiente'}
                            </span>
                        </td>
                        <td class="p-3 text-center">
                            <div class="flex items-center justify-center gap-1.5">
                                <button type="button" onclick="abrirModalDetalleOrden(${o.docto_cm_id})" class="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs transition inline-flex items-center gap-1 cursor-pointer" title="Ver partidas detalladas">
                                    <span>👁️</span> Partidas
                                </button>
                                <button type="button" onclick="abrirModalRecepcionRapida(${o.docto_cm_id})" class="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-black rounded-xl text-xs transition shadow-sm inline-flex items-center gap-1 cursor-pointer" title="Recibir en almacén">
                                    <span>📥</span> Recibir
                                </button>
                            </div>
                        </td>
                    </tr>
                `;
            }).join('');
        }

        async function abrirModalDetalleOrden(doctoCmId) {
            const modal = document.getElementById('modalDetalleOrdenCompra');
            const alertBox = document.getElementById('modalDetalleAlerta');
            if (alertBox) alertBox.classList.add('hidden');

            // Resetear textos iniciales
            document.getElementById('modalDetalleFolio').textContent = '...';
            document.getElementById('modalDetalleSubtitulo').textContent = 'Cargando información desde Microsip...';
            document.getElementById('modalDetalleProveedor').textContent = '...';
            document.getElementById('modalDetalleAlmacen').textContent = '...';
            document.getElementById('modalDetalleFecha').textContent = '...';
            document.getElementById('modalDetalleTotal').textContent = '...';
            document.getElementById('modalDetalleNotas').value = '';
            
            const tbody = document.getElementById('modalDetalleTablaPartidas');
            if (tbody) {
                tbody.innerHTML = '<tr><td colspan="8" class="p-6 text-center text-slate-400 italic">Cargando partidas...</td></tr>';
            }

            if (modal) modal.classList.remove('hidden');

            try {
                const res = await fetch(`/api/almacen/orden-compra/${doctoCmId}`);
                const data = await res.json();
                if (!data.success) {
                    throw new Error(data.error || 'No se pudo cargar la orden.');
                }

                _ordenCompraSeleccionada = data.orden;
                _ordenCompraSeleccionada.partidas = data.partidas || [];

                document.getElementById('modalDetalleFolio').textContent = data.orden.folio;
                document.getElementById('modalDetalleSubtitulo').textContent = `Destino: ${data.orden.almacen_nombre} · Emisión: ${data.orden.fecha}`;
                document.getElementById('modalDetalleProveedor').textContent = data.orden.proveedor_nombre;
                document.getElementById('modalDetalleAlmacen').textContent = data.orden.almacen_nombre;
                document.getElementById('modalDetalleFecha').textContent = data.orden.fecha;
                document.getElementById('modalDetalleTotal').textContent = '$' + data.orden.total.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

                const sigFolioSpan = document.getElementById('modalDetalleSigFolio');
                if (sigFolioSpan) sigFolioSpan.textContent = data.siguiente_folio_recepcion || 'BR0003591';

                renderPartidasModalDetalle(data.partidas);

            } catch (err) {
                console.error("Error al abrir detalle de orden:", err);
                if (alertBox) {
                    alertBox.className = "p-3 rounded-xl text-xs font-bold bg-rose-100 text-rose-800 border border-rose-200";
                    alertBox.textContent = "❌ " + err.message;
                    alertBox.classList.remove('hidden');
                }
            }
        }

        function renderPartidasModalDetalle(partidas) {
            const tbody = document.getElementById('modalDetalleTablaPartidas');
            if (!tbody) return;

            if (!partidas || partidas.length === 0) {
                tbody.innerHTML = '<tr><td colspan="8" class="p-6 text-center text-slate-400 italic">No hay partidas registradas en esta orden.</td></tr>';
                return;
            }

            const modoParcial = document.querySelector('input[name="modoRecepcionModal"]:checked')?.value === 'parcial';

            tbody.innerHTML = partidas.map((p, idx) => {
                const disabledAttr = modoParcial ? '' : 'disabled';
                return `
                    <tr class="hover:bg-slate-50 transition-colors">
                        <td class="p-2.5 text-center font-mono text-[10px] text-slate-400">${p.posicion || (idx + 1)}</td>
                        <td class="p-2.5 font-mono font-bold text-slate-800 text-xs">${p.clave}</td>
                        <td class="p-2.5 text-slate-800 font-medium text-xs leading-tight">${p.nombre}</td>
                        <td class="p-2.5 text-right font-mono text-xs text-slate-600">${p.unidades_solicitadas.toLocaleString('es-MX')}</td>
                        <td class="p-2.5 text-right font-mono text-xs text-emerald-600 font-bold">${p.unidades_recibidas.toLocaleString('es-MX')}</td>
                        <td class="p-2.5 text-right font-mono text-xs text-amber-600 font-bold">${p.unidades_pendientes.toLocaleString('es-MX')}</td>
                        <td class="p-2.5 text-center">
                            <input type="number" step="any" min="0" max="${p.unidades_pendientes}" value="${p.unidades_pendientes}"
                                   data-det-id="${p.docto_cm_det_id}"
                                   class="input-rec-parcial w-24 px-2 py-1 text-center font-bold text-xs text-slate-900 bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:outline-none disabled:bg-slate-100 disabled:text-slate-500 transition">
                        </td>
                        <td class="p-2.5 text-right font-mono text-xs text-slate-700">$${p.precio_unitario.toLocaleString('es-MX', { minimumFractionDigits: 2 })}</td>
                    </tr>
                `;
            }).join('');
        }

        function toggleModoRecepcionModal() {
            const modoParcial = document.querySelector('input[name="modoRecepcionModal"]:checked')?.value === 'parcial';
            const inputs = document.querySelectorAll('.input-rec-parcial');
            inputs.forEach(inp => {
                inp.disabled = !modoParcial;
                if (!modoParcial) {
                    inp.value = inp.getAttribute('max') || inp.value;
                }
            });
        }

        function cerrarModalDetalleOrden() {
            const modal = document.getElementById('modalDetalleOrdenCompra');
            if (modal) modal.classList.add('hidden');
            _ordenCompraSeleccionada = null;
        }

        async function ejecutarRecepcionDesdeModal() {
            if (!_ordenCompraSeleccionada) return;

            const btn = document.getElementById('btnConfirmarRecepcionModal');
            const alertBox = document.getElementById('modalDetalleAlerta');
            const modo = document.querySelector('input[name="modoRecepcionModal"]:checked')?.value || 'completo';
            const notas = document.getElementById('modalDetalleNotas')?.value.trim() || '';

            const payload = {
                orden_id: _ordenCompraSeleccionada.docto_cm_id,
                modo: modo,
                notas: notas,
                partidas: []
            };

            if (modo === 'parcial') {
                const inputs = document.querySelectorAll('.input-rec-parcial');
                inputs.forEach(inp => {
                    const detId = parseInt(inp.getAttribute('data-det-id'));
                    const cant = parseFloat(inp.value) || 0;
                    if (detId && cant > 0) {
                        payload.partidas.push({
                            docto_cm_det_id: detId,
                            unidades_recibir: cant
                        });
                    }
                });

                if (payload.partidas.length === 0) {
                    if (alertBox) {
                        alertBox.className = "p-3 rounded-xl text-xs font-bold bg-amber-100 text-amber-800 border border-amber-200";
                        alertBox.textContent = "⚠️ Debes ingresar al menos una cantidad mayor a cero para recibir en modo parcial.";
                        alertBox.classList.remove('hidden');
                    }
                    return;
                }
            }

            if (btn) {
                btn.disabled = true;
                btn.innerHTML = `
                    <span class="animate-spin text-lg">⏳</span>
                    <span>Procesando entrada Microsip...</span>
                `;
            }

            try {
                const res = await fetch('/api/almacen/recibir-orden-compra', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const data = await res.json();

                if (!data.success) {
                    throw new Error(data.error || 'Error al procesar la recepción.');
                }

                if (alertBox) {
                    alertBox.className = "p-3 rounded-xl text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-200";
                    alertBox.textContent = `✅ Recepción Exitosa! Generado Folio ${data.folio_recepcion}. Estatus OC: ${data.estatus_texto}.`;
                    alertBox.classList.remove('hidden');
                }

                mostrarAlerta('success', `✅ Recepción de compra generada: Folio ${data.folio_recepcion}. Inventarios actualizados en Microsip.`);

                setTimeout(() => {
                    cerrarModalDetalleOrden();
                    cargarOrdenesCompraAlmacen();
                }, 1600);

            } catch (err) {
                console.error("Error al procesar recepción desde modal:", err);
                if (alertBox) {
                    alertBox.className = "p-3 rounded-xl text-xs font-bold bg-rose-100 text-rose-800 border border-rose-200";
                    alertBox.textContent = "❌ " + err.message;
                    alertBox.classList.remove('hidden');
                }
            } finally {
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = `
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>
                        <span>Confirmar Recepción en Almacén</span>
                    `;
                }
            }
        }

        async function abrirModalRecepcionRapida(doctoCmId) {
            const orden = _ordenesCompraAlmacenCache.find(o => o.docto_cm_id === doctoCmId);
            if (!orden) return;

            _ordenCompraRapida = orden;

            document.getElementById('rapidaFolioOC').textContent = orden.folio;
            document.getElementById('rapidaProveedor').textContent = orden.proveedor_nombre;
            document.getElementById('rapidaAlmacen').textContent = orden.almacen_nombre;
            document.getElementById('rapidaPiezas').textContent = `${orden.piezas_pendientes.toLocaleString('es-MX')} piezas (${orden.total_partidas} partidas)`;

            const alertBox = document.getElementById('modalRapidaAlerta');
            if (alertBox) alertBox.classList.add('hidden');

            // Consultar siguiente folio
            try {
                const res = await fetch('/api/almacen/siguiente-folio-recepcion');
                const data = await res.json();
                if (data.success && data.siguiente_folio) {
                    document.getElementById('rapidaFolioEntrada').textContent = data.siguiente_folio;
                }
            } catch (e) {}

            const modal = document.getElementById('modalConfirmarRecepcionRapida');
            if (modal) modal.classList.remove('hidden');
        }

        function cerrarModalRecepcionRapida() {
            const modal = document.getElementById('modalConfirmarRecepcionRapida');
            if (modal) modal.classList.add('hidden');
            _ordenCompraRapida = null;
        }

        async function confirmarEjecutarRecepcionRapida() {
            if (!_ordenCompraRapida) return;

            const btn = document.getElementById('btnEjecutarRecepcionRapida');
            const alertBox = document.getElementById('modalRapidaAlerta');

            if (btn) {
                btn.disabled = true;
                btn.innerHTML = `<span class="animate-spin text-sm">⏳</span> Recibiendo...`;
            }

            try {
                const res = await fetch('/api/almacen/recibir-orden-compra', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        orden_id: _ordenCompraRapida.docto_cm_id,
                        modo: 'completo',
                        notas: `Recepción rápida desde módulo almacén por usuario.`
                    })
                });
                const data = await res.json();

                if (!data.success) {
                    throw new Error(data.error || 'Error al ejecutar recepción rápida.');
                }

                if (alertBox) {
                    alertBox.className = "p-3 rounded-xl text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-200";
                    alertBox.textContent = `✅ Recepción generada con Folio ${data.folio_recepcion}. Stock ingresado en ${data.almacen_nombre}.`;
                    alertBox.classList.remove('hidden');
                }

                mostrarAlerta('success', `✅ Recepción generada con Folio ${data.folio_recepcion}.`);

                setTimeout(() => {
                    cerrarModalRecepcionRapida();
                    cargarOrdenesCompraAlmacen();
                }, 1300);

            } catch (err) {
                console.error("Error al ejecutar recepción rápida:", err);
                if (alertBox) {
                    alertBox.className = "p-3 rounded-xl text-xs font-bold bg-rose-100 text-rose-800 border border-rose-200";
                    alertBox.textContent = "❌ " + err.message;
                    alertBox.classList.remove('hidden');
                }
            } finally {
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = `
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>
                        <span>Sí, Recibir en Almacén</span>
                    `;
                }
            }
        }


