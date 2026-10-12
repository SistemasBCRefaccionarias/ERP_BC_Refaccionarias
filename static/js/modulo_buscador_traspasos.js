        // ================= BUSCADOR DE FOLIOS DE TRASPASOS & REIMPRESIÓN =================
        window.cambiarSubTabTraspaso = function(subtab) {
            const btnNuevo = document.getElementById('tabSubTraspasoNuevo');
            const btnBuscador = document.getElementById('tabSubTraspasoBuscador');
            const vistaNuevo = document.getElementById('vistaTraspasoNuevo');
            const vistaBuscador = document.getElementById('vistaTraspasoBuscador');

            if (subtab === 'nuevo') {
                if (btnNuevo) btnNuevo.className = "px-4 py-2 rounded-xl text-xs font-black transition flex items-center gap-2 bg-blue-600 text-white shadow-md shadow-blue-600/20 cursor-pointer";
                if (btnBuscador) btnBuscador.className = "px-4 py-2 rounded-xl text-xs font-black transition flex items-center gap-2 bg-slate-100 text-slate-700 hover:bg-slate-200 cursor-pointer";
                if (vistaNuevo) vistaNuevo.classList.remove('hidden');
                if (vistaBuscador) vistaBuscador.classList.add('hidden');
            } else {
                if (btnBuscador) btnBuscador.className = "px-4 py-2 rounded-xl text-xs font-black transition flex items-center gap-2 bg-blue-600 text-white shadow-md shadow-blue-600/20 cursor-pointer";
                if (btnNuevo) btnNuevo.className = "px-4 py-2 rounded-xl text-xs font-black transition flex items-center gap-2 bg-slate-100 text-slate-700 hover:bg-slate-200 cursor-pointer";
                if (vistaNuevo) vistaNuevo.classList.add('hidden');
                if (vistaBuscador) vistaBuscador.classList.remove('hidden');

                // Asegurar que los selects estén sincronizados
                if (typeof catalogoAlmacenes !== 'undefined' && catalogoAlmacenes && catalogoAlmacenes.length) {
                    const bOri = document.getElementById('buscTraspasoOrigen');
                    const bDes = document.getElementById('buscTraspasoDestino');
                    if (bOri && bOri.options.length <= 1) {
                        catalogoAlmacenes.forEach(a => {
                            const opt1 = document.createElement('option');
                            opt1.value = a.id;
                            opt1.textContent = a.nombre;
                            bOri.appendChild(opt1);

                            const opt2 = document.createElement('option');
                            opt2.value = a.id;
                            opt2.textContent = a.nombre;
                            bDes.appendChild(opt2);
                        });
                    }
                }

                // Cargar traspasos si la tabla está vacía
                const tbody = document.getElementById('tbodyBuscadorTraspasos');
                if (tbody && (tbody.innerText.includes('Ingresa un folio') || tbody.children.length <= 1)) {
                    cargarTraspasosHoy();
                }

                const inpBusc = document.getElementById('buscTraspasoTexto');
                if (inpBusc) {
                    setTimeout(() => inpBusc.focus(), 150);
                }
            }
        };

        window.cargarTraspasosHoy = function() {
            const today = new Date().toISOString().split('T')[0];
            const inpDesde = document.getElementById('buscTraspasoFechaDesde');
            const inpHasta = document.getElementById('buscTraspasoFechaHasta');
            if (inpDesde) inpDesde.value = today;
            if (inpHasta) inpHasta.value = today;
            const inpText = document.getElementById('buscTraspasoTexto');
            if (inpText) inpText.value = '';
            const sOri = document.getElementById('buscTraspasoOrigen');
            if (sOri) sOri.value = '';
            const sDes = document.getElementById('buscTraspasoDestino');
            if (sDes) sDes.value = '';
            ejecutarBusquedaTraspasos();
        };

        window.limpiarFiltrosBuscadorTraspasos = function() {
            const inpText = document.getElementById('buscTraspasoTexto');
            if (inpText) inpText.value = '';
            const sOri = document.getElementById('buscTraspasoOrigen');
            if (sOri) sOri.value = '';
            const sDes = document.getElementById('buscTraspasoDestino');
            if (sDes) sDes.value = '';
            const inpDesde = document.getElementById('buscTraspasoFechaDesde');
            if (inpDesde) inpDesde.value = '';
            const inpHasta = document.getElementById('buscTraspasoFechaHasta');
            if (inpHasta) inpHasta.value = '';
            cargarTraspasosHoy();
        };

        window.ejecutarBusquedaTraspasos = async function(e) {
            if (e && e.preventDefault) e.preventDefault();

            const q = (document.getElementById('buscTraspasoTexto')?.value || '').trim();
            const oriId = document.getElementById('buscTraspasoOrigen')?.value || '';
            const desId = document.getElementById('buscTraspasoDestino')?.value || '';
            const fDesde = document.getElementById('buscTraspasoFechaDesde')?.value || '';
            const fHasta = document.getElementById('buscTraspasoFechaHasta')?.value || '';

            const tbody = document.getElementById('tbodyBuscadorTraspasos');
            if (tbody) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="8" class="p-8 text-center text-slate-500 font-medium">
                            <div class="flex items-center justify-center gap-2">
                                <span class="animate-spin inline-block w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full"></span>
                                <span>Buscando traspasos en Microsip...</span>
                            </div>
                        </td>
                    </tr>
                `;
            }

            const btn = document.getElementById('btnEjecutarBusquedaTraspasos');
            if (btn) btn.disabled = true;

            try {
                const params = new URLSearchParams();
                if (q) params.append('q', q);
                if (oriId) params.append('origen_id', oriId);
                if (desId) params.append('destino_id', desId);
                if (fDesde) params.append('fecha_desde', fDesde);
                if (fHasta) params.append('fecha_hasta', fHasta);

                const res = await fetch(`/api/traspasos/buscar-folios?${params.toString()}`);
                const data = await res.json();

                if (!res.ok || !data.success) {
                    throw new Error(data.error || 'Error al consultar traspasos');
                }

                renderTablaResultadosTraspasos(data.traspasos || []);
            } catch (err) {
                if (tbody) {
                    tbody.innerHTML = `
                        <tr>
                            <td colspan="8" class="p-8 text-center text-rose-600 font-bold">
                                ⚠️ Error al buscar traspasos: ${err.message}
                            </td>
                        </tr>
                    `;
                }
            } finally {
                if (btn) btn.disabled = false;
            }
        };

        function renderTablaResultadosTraspasos(traspasos) {
            const tbody = document.getElementById('tbodyBuscadorTraspasos');
            const contador = document.getElementById('contadorResultadosTraspasos');
            if (!tbody) return;
            tbody.innerHTML = '';

            if (contador) {
                contador.textContent = `${traspasos.length} traspaso(s) encontrado(s)`;
            }

            if (!traspasos || traspasos.length === 0) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="8" class="p-8 text-center text-slate-400 italic">
                            No se encontraron traspasos con los criterios ingresados.
                        </td>
                    </tr>
                `;
                return;
            }

            traspasos.forEach((t, idx) => {
                const tr = document.createElement('tr');
                tr.className = "hover:bg-slate-50 transition border-b border-slate-100 text-slate-700";

                tr.innerHTML = `
                    <td class="p-2.5 text-center font-bold text-slate-400">${idx + 1}</td>
                    <td class="p-2.5">
                        <div class="font-mono font-black text-blue-900 text-xs">${t.folio}</div>
                        ${t.status_nombre ? `<span class="inline-block mt-0.5 px-2 py-0.5 rounded-full text-[9px] font-black uppercase border ${t.status_badge || 'bg-slate-100 text-slate-700'}">${t.status_nombre}</span>` : ''}
                    </td>
                    <td class="p-2.5 whitespace-nowrap">
                        <div class="font-bold text-slate-800 text-[11px]">${t.fecha}</div>
                        <div class="text-[10px] text-slate-400 font-mono">${t.hora_caja}</div>
                    </td>
                    <td class="p-2.5">
                        <div class="flex items-center gap-1.5 flex-wrap text-xs">
                            <span class="font-bold text-slate-900">${t.almacen_origen}</span>
                            <span class="text-blue-500 font-bold">➔</span>
                            <span class="font-bold text-blue-900 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-100">${t.almacen_destino}</span>
                        </div>
                    </td>
                    <td class="p-2.5 text-center">
                        <span class="bg-blue-50 text-blue-950 font-bold px-2 py-0.5 rounded font-mono text-[10px] border border-blue-200 inline-block whitespace-nowrap">
                            ${t.total_partidas} part. (${t.total_piezas} pz)
                        </span>
                    </td>
                    <td class="p-2.5 max-w-xs truncate text-[11px] text-slate-600" title="${t.descripcion || ''}">
                        ${t.descripcion || '<span class="text-slate-300 italic">Sin observaciones</span>'}
                    </td>
                    <td class="p-2.5 text-[10px] font-mono text-slate-500 whitespace-nowrap">
                        ${t.usuario || 'SYSDBA'}
                    </td>
                    <td class="p-2.5 text-center whitespace-nowrap">
                        <div class="flex items-center justify-center gap-1.5">
                            <button type="button" onclick="consultarVerTicketTraspaso(${t.docto_in_id})" 
                                    class="bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold px-2.5 py-1.5 rounded-lg text-[10px] flex items-center gap-1 border border-slate-200 transition cursor-pointer">
                                <span>👁️</span> Ver Ticket
                            </button>
                            <button type="button" onclick="reimprimirTraspasoDirecto(${t.docto_in_id}, this)" 
                                    class="bg-slate-900 hover:bg-slate-800 text-white font-bold px-2.5 py-1.5 rounded-lg text-[10px] flex items-center gap-1 shadow-sm transition cursor-pointer">
                                <span>🖨️</span> Imprimir POS-80C
                            </button>
                        </div>
                    </td>
                `;
                tbody.appendChild(tr);
            });
        }

        window.consultarVerTicketTraspaso = async function(doctoId) {
            actualizarProgreso(30, 'Consultando traspaso...', 'Cargando partidas y ubicaciones...');
            try {
                const res = await fetch(`/api/traspasos/detalle/${doctoId}`);
                const data = await res.json();
                if (!res.ok || !data.success) {
                    throw new Error(data.error || 'No se pudo obtener el detalle del traspaso');
                }

                ocultarProgreso();
                const t = data.traspaso;

                // Llenar campos del modal de ticket
                const elDestEnc = document.getElementById('tckDestinoEncabezado');
                if (elDestEnc) elDestEnc.textContent = t.almacen_destino;

                const elEmpNom = document.getElementById('tckEmpresaNombre');
                if (elEmpNom) elEmpNom.textContent = t.empresa || 'BC REFACCIONARIAS';

                const elConcepto = document.getElementById('tckConcepto');
                if (elConcepto) elConcepto.textContent = t.concepto || 'Traspaso (Salida)';

                const elOri = document.getElementById('tckOrigen');
                if (elOri) elOri.textContent = t.almacen_origen;

                const elDes = document.getElementById('tckDestino');
                if (elDes) elDes.textContent = t.almacen_destino;

                const elFecha = document.getElementById('tckFecha');
                if (elFecha) elFecha.textContent = t.fecha_caja || '';

                const elHora = document.getElementById('tckHora');
                if (elHora) elHora.textContent = t.hora_caja || '';

                const elFolio = document.getElementById('tckFolio');
                if (elFolio) elFolio.textContent = t.folio;

                const elFechaImpr = document.getElementById('tckFechaImpresion');
                if (elFechaImpr) elFechaImpr.textContent = t.fecha_impresion || '';

                const tckBadge = document.getElementById('tckImpresionBadge');
                const tckTexto = document.getElementById('tckImpresionTexto');
                if (tckBadge && tckTexto) {
                    tckBadge.className = "bg-blue-50 text-blue-800 border border-blue-200 rounded-xl px-3 py-2 text-[11px] font-bold flex items-center gap-2";
                    tckTexto.innerHTML = `Visualizando Traspaso Folio <strong>${t.folio}</strong>`;
                }

                const tckBody = document.getElementById('tckItemsBody');
                if (tckBody) {
                    tckBody.innerHTML = '';
                    (t.partidas || []).forEach(p => {
                        const row = document.createElement('div');
                        row.className = "grid grid-cols-12 py-1.5 px-2 text-[10px] leading-tight items-start border-b border-dashed border-slate-300";
                        row.innerHTML = `
                            <div class="col-span-3 font-mono font-bold border-r border-slate-700 pr-1.5 break-words">${p.clave || ''}</div>
                            <div class="col-span-8 px-1.5 text-slate-900 border-r border-slate-700">
                                <div class="font-semibold text-slate-800">${p.nombre || ''}</div>
                                <div class="mt-1">
                                    ${p.localizacion ? 
                                        `<span class="inline-flex items-center gap-1 bg-amber-100 text-amber-950 border border-amber-400 font-mono font-black px-1.5 py-0.5 rounded text-[10px] tracking-wide">📍 UBIC: ${p.localizacion}</span>` : 
                                        `<span class="inline-flex items-center gap-1 bg-slate-100 text-slate-500 border border-slate-300 font-mono text-[9px] px-1 py-0.5 rounded italic">📍 Sin ubic. asignada en CEDIS</span>`
                                    }
                                </div>
                            </div>
                            <div class="col-span-1 text-center font-bold font-mono text-xs">${p.cantidad}</div>
                        `;
                        tckBody.appendChild(row);
                    });
                }

                // Generar código de barras en SVG con el folio oficial de Microsip (ej. TFC005761)
                if (window.JsBarcode) {
                    try {
                        JsBarcode("#tckBarcodeSvg", t.folio, {
                            format: "CODE128",
                            width: 2,
                            height: 48,
                            displayValue: true,
                            fontSize: 13,
                            textMargin: 4,
                            font: "monospace"
                        });
                    } catch (eBarcode) {
                        console.error("Error generando código de barras:", eBarcode);
                    }
                }

                // Guardar para posible reimpresión desde el modal
                ultimoTraspasoParaTicket = {
                    folio: t.folio,
                    origen: t.almacen_origen,
                    destino: t.almacen_destino,
                    concepto: t.concepto || 'Traspaso (Salida)',
                    descripcion: t.descripcion || '',
                    empresa: t.empresa || 'BC REFACCIONARIAS',
                    partidas: [...(t.partidas || [])]
                };

                const modal = document.getElementById('ticketModal');
                if (modal) modal.classList.remove('hidden');
            } catch (err) {
                ocultarProgreso();
                alert("Error al cargar ticket del traspaso: " + err.message);
            }
        };

        window.reimprimirTraspasoDirecto = async function(doctoId, btn) {
            if (btn.disabled) return;
            const confirmar = confirm("¿Deseas imprimir el ticket térmico de este traspaso en la POS-80C?");
            if (!confirmar) return;

            const htmlOriginal = btn.innerHTML;
            btn.disabled = true;
            btn.innerHTML = `<span class="animate-spin inline-block mr-1">⌛</span> Imprimiendo...`;

            try {
                const res = await fetch(`/api/traspasos/reimprimir-id/${doctoId}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ forzar: true })
                });
                const data = await res.json();

                if (data.success) {
                    btn.className = "bg-emerald-600 text-white font-bold px-2.5 py-1.5 rounded-lg text-[10px] flex items-center gap-1 shadow-sm transition";
                    btn.innerHTML = `<span>✓</span> Impreso`;
                    mostrarAlerta('success', `✓ Folio ${data.folio || ''}: ${data.mensaje || 'Ticket enviado a POS-80C'}`);
                    setTimeout(() => {
                        btn.className = "bg-slate-900 hover:bg-slate-800 text-white font-bold px-2.5 py-1.5 rounded-lg text-[10px] flex items-center gap-1 shadow-sm transition cursor-pointer";
                        btn.disabled = false;
                        btn.innerHTML = htmlOriginal;
                    }, 5000);
                } else {
                    btn.disabled = false;
                    btn.innerHTML = htmlOriginal;
                    mostrarAlerta('error', `Aviso de impresora: ${data.mensaje || 'Error al imprimir'}`);
                }
            } catch (e) {
                btn.disabled = false;
                btn.innerHTML = htmlOriginal;
                mostrarAlerta('error', `Error de comunicación al reimprimir: ${e.message}`);
            }
        };

