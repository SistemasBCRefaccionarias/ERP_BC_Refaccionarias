        // ================= MÓDULO 3: BÚSQUEDA INTELIGENTE Y TRASPASOS =================
        async function cargarCatalogosTraspaso() {
            try {
                const res = await fetch('/api/traspasos/catalogos');
                const data = await res.json();
                catalogoAlmacenes = data.almacenes || [];

                if (data.concepto_fijo) {
                    document.getElementById('traspasoConceptoTexto').value = data.concepto_fijo.nombre || "Traspaso (salida)";
                    document.getElementById('traspasoConceptoId').value = data.concepto_fijo.id;
                }

                const sOri = document.getElementById('traspasoAlmacenOrigen');
                const sDes = document.getElementById('traspasoAlmacenDestino');

                sOri.innerHTML = '<option value="">-- Almacén Origen --</option>';
                sDes.innerHTML = '<option value="">-- Sucursal Destino --</option>';

                catalogoAlmacenes.forEach(a => {
                    const opt1 = document.createElement('option');
                    opt1.value = a.id;
                    opt1.textContent = a.nombre;
                    sOri.appendChild(opt1);

                    const opt2 = document.createElement('option');
                    opt2.value = a.id;
                    opt2.textContent = a.nombre;
                    sDes.appendChild(opt2);
                });

                const bOri = document.getElementById('buscTraspasoOrigen');
                const bDes = document.getElementById('buscTraspasoDestino');
                if (bOri && bDes) {
                    bOri.innerHTML = '<option value="">-- Todos los orígenes --</option>';
                    bDes.innerHTML = '<option value="">-- Todos los destinos --</option>';
                    catalogoAlmacenes.forEach(a => {
                        const optB1 = document.createElement('option');
                        optB1.value = a.id;
                        optB1.textContent = a.nombre;
                        bOri.appendChild(optB1);

                        const optB2 = document.createElement('option');
                        optB2.value = a.id;
                        optB2.textContent = a.nombre;
                        bDes.appendChild(optB2);
                    });
                }

                const cedis = catalogoAlmacenes.find(a => a.nombre.toUpperCase().includes('CEDIS'));
                if (cedis) sOri.value = cedis.id;
                else if (catalogoAlmacenes.length) sOri.value = catalogoAlmacenes[0].id;

                actualizarFolioSugerido();
            } catch (e) {
                console.error("Error cargando almacenes:", e);
            }
        }

        async function actualizarFolioSugerido() {
            const sOri = document.getElementById('traspasoAlmacenOrigen');
            const sDes = document.getElementById('traspasoAlmacenDestino');
            if (!sDes || sDes.selectedIndex <= 0) {
                document.getElementById('traspasoFolio').value = '';
                return;
            }

            const origenId = sOri ? sOri.value : '';
            const origenNombre = (sOri && sOri.selectedIndex >= 0) ? sOri.options[sOri.selectedIndex].text : '';
            const destinoId = sDes.value;
            const destinoNombre = sDes.options[sDes.selectedIndex].text;

            try {
                const res = await fetch(`/api/traspasos/siguiente-folio?origen_id=${origenId}&origen_nombre=${encodeURIComponent(origenNombre)}&destino_id=${destinoId}&destino_nombre=${encodeURIComponent(destinoNombre)}&_t=${Date.now()}`, { cache: 'no-store' });
                const data = await res.json();
                if (data.folio) {
                    document.getElementById('traspasoFolio').value = data.folio;
                }
            } catch (e) {
                console.error("Error al obtener folio:", e);
            }
        }

        document.getElementById('traspasoAlmacenOrigen')?.addEventListener('change', actualizarFolioSugerido);
        document.getElementById('traspasoAlmacenDestino')?.addEventListener('change', actualizarFolioSugerido);

        document.getElementById('traspasoFolio')?.addEventListener('blur', function() {
            let val = (this.value || '').trim().toUpperCase();
            if (!val) return;
            let match = val.match(/^([A-Z]+)(\d+)$/i);
            if (match) {
                let prefix = match[1];
                let num = match[2];
                let ceros = Math.max(0, 9 - prefix.length - num.length);
                this.value = prefix + '0'.repeat(ceros) + num;
            }
        });

        // BÚSQUEDA INTELIGENTE
        document.getElementById('artClaveInput').addEventListener('keydown', async function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                await buscarArticuloParaTraspaso();
            }
        });

        document.getElementById('btnBuscarArticulo').addEventListener('click', async () => {
            await buscarArticuloParaTraspaso();
        });

        // Al presionar Enter en Cantidad, agregar la partida directamente
        document.getElementById('artCantidadInput').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                document.getElementById('btnAgregarPartida').click();
            }
        });

        // Si borra el texto de clave, limpiar el cuadro de detalle
        document.getElementById('artClaveInput').addEventListener('input', function() {
            if (!this.value.trim()) {
                limpiarDetalleArticulo();
            }
        });

        async function buscarArticuloParaTraspaso() {
            const texto = document.getElementById('artClaveInput').value.trim();
            const oriId = document.getElementById('traspasoAlmacenOrigen').value;
            const btnBuscar = document.getElementById('btnBuscarArticulo');
            const inpExistencia = document.getElementById('artExistenciaInput');

            if (!oriId) {
                alert("Selecciona primero el Almacén Origen.");
                return;
            }
            if (!texto) {
                document.getElementById('artClaveInput').focus();
                return;
            }

            ocultarSugerencias();

            // 1. Respuesta visual instantánea en 0 ms
            const btnHtmlOriginal = btnBuscar.innerHTML;
            btnBuscar.disabled = true;
            btnBuscar.innerHTML = `
                <svg class="animate-spin w-3.5 h-3.5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
                </svg>
                <span>Buscando...</span>
            `;
            inpExistencia.value = "Consultando...";
            inpExistencia.className = "w-full font-mono font-bold text-xs text-center bg-amber-50 border border-amber-300 rounded-xl p-2.5 text-amber-800 animate-pulse";

            try {
                const res = await fetch(`/api/traspasos/buscar-articulo?clave=${encodeURIComponent(texto)}&almacen_id=${oriId}`);
                const data = await res.json();

                if (!res.ok || !data.coincidencias || data.coincidencias.length === 0) {
                    limpiarDetalleArticulo();
                    inpExistencia.value = "0";
                    inpExistencia.className = "w-full font-mono font-bold text-xs text-center bg-slate-100 border border-slate-200 rounded-xl p-2.5 text-slate-400";
                    alert(data.mensaje || `No se encontró ningún artículo para '${texto}'.`);
                    return;
                }

                // 2. Pintar y seleccionar INMEDIATAMENTE la mejor coincidencia en el cuadro de abajo
                const mejor = data.seleccion_rapida || data.coincidencias[0];
                seleccionarArticulo(mejor, data.tiempo_ms);

                // 3. Si hay múltiples alternativas, mostrar la lista abajo para poder cambiar con 1 clic
                if (data.coincidencias.length > 1) {
                    mostrarMenuSugerencias(data.coincidencias, mejor.articulo_id);
                } else {
                    ocultarSugerencias();
                }

            } catch (e) {
                alert("Error de comunicación: " + e.message);
                limpiarDetalleArticulo();
            } finally {
                btnBuscar.disabled = false;
                btnBuscar.innerHTML = btnHtmlOriginal;
            }
        }

        function mostrarMenuSugerencias(articulos, activoId = null) {
            const container = document.getElementById('sugerenciasContainer');
            const lista = document.getElementById('sugerenciasLista');
            const contador = document.getElementById('contadorSugerencias');
            if (contador) contador.textContent = `${articulos.length} resultados`;
            lista.innerHTML = '';

            articulos.forEach(art => {
                const esActivo = activoId && String(art.articulo_id) === String(activoId);
                const item = document.createElement('div');
                item.className = `p-2.5 rounded-xl border cursor-pointer flex items-center justify-between transition ${
                    esActivo 
                    ? 'bg-blue-50/90 border-blue-400 ring-2 ring-blue-400/30' 
                    : 'bg-white border-amber-200 hover:border-blue-400 hover:bg-slate-50'
                }`;
                item.innerHTML = `
                    <div class="truncate mr-2">
                        <div class="flex items-center gap-2">
                            <span class="font-mono font-extrabold text-slate-900 text-xs">${art.clave}</span>
                            ${esActivo ? '<span class="text-[9px] bg-blue-600 text-white font-bold px-1.5 py-0.2 rounded font-mono">✓ Activo</span>' : ''}
                            <span class="text-[11px] text-slate-500 truncate">${art.nombre}</span>
                        </div>
                        <div class="flex items-center gap-2 mt-0.5">
                            ${art.equivalencia ? `<span class="text-[10px] text-indigo-600 font-mono">Equiv: ${art.equivalencia}</span>` : ''}
                            ${art.localizacion ? `<span class="text-[10px] bg-amber-100 text-amber-950 font-bold px-1.5 py-0.5 rounded font-mono border border-amber-300">📍 ${art.localizacion}</span>` : ''}
                        </div>
                    </div>
                    <span class="px-2.5 py-1 rounded-lg text-xs font-black font-mono flex-shrink-0 ${art.existencia > 0 ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}">
                        Stock: ${art.existencia}
                    </span>
                `;
                item.onclick = () => {
                    seleccionarArticulo(art);
                    mostrarMenuSugerencias(articulos, art.articulo_id);
                };
                lista.appendChild(item);
            });

            container.classList.remove('hidden');
        }

        function ocultarSugerencias() {
            document.getElementById('sugerenciasContainer').classList.add('hidden');
        }

        function seleccionarArticulo(art, tiempoMs = null) {
            articuloActualBuscado = art;
            document.getElementById('artClaveInput').value = art.clave;
            
            // Pintar Existencia en el input superior con color llamativo
            const inpExistencia = document.getElementById('artExistenciaInput');
            inpExistencia.value = art.existencia;
            if (art.existencia > 0) {
                inpExistencia.className = "w-full font-mono font-black text-xs text-center bg-emerald-100/90 border-2 border-emerald-500 rounded-xl p-2.5 text-emerald-950 shadow-sm";
            } else {
                inpExistencia.className = "w-full font-mono font-black text-xs text-center bg-rose-100/90 border-2 border-rose-400 rounded-xl p-2.5 text-rose-900 shadow-sm";
            }

            // Pintar Nombre y Detalles en el cuadro de abajo
            document.getElementById('artNombreText').textContent = art.nombre;
            
            const claveBadge = document.getElementById('artClaveBadge');
            if (claveBadge) claveBadge.textContent = art.clave;
            
            const equivBadge = document.getElementById('artEquivBadge');
            if (equivBadge) {
                equivBadge.textContent = art.equivalencia ? `• Equiv: ${art.equivalencia}` : '';
            }

            document.getElementById('artIdText').textContent = `ID: ${art.articulo_id} • Unidad: ${art.unidad}`;

            const ubiBadge = document.getElementById('artUbicacionBadge');
            const ubiText = document.getElementById('artUbicacionText');
            if (ubiBadge && ubiText) {
                if (art.localizacion) {
                    ubiText.textContent = `Ubicación: ${art.localizacion}`;
                    ubiBadge.classList.remove('hidden');
                } else {
                    ubiText.textContent = '--';
                    ubiBadge.classList.add('hidden');
                }
            }

            const speedBadge = document.getElementById('speedBadge');
            if (speedBadge) {
                if (tiempoMs) {
                    speedBadge.textContent = `⚡ ${tiempoMs} ms`;
                    speedBadge.classList.remove('hidden');
                } else {
                    speedBadge.classList.add('hidden');
                }
            }

            // Pintar Badge de Existencia en el cuadro de abajo
            const badge = document.getElementById('stockBadge');
            if (art.existencia > 0) {
                badge.className = "px-4 py-2 rounded-xl font-black text-xs font-mono bg-emerald-600 text-white shadow-md shadow-emerald-600/20";
                badge.innerHTML = `EXISTENCIA: <span class="text-sm font-black">${art.existencia}</span> ${art.unidad}`;
            } else {
                badge.className = "px-4 py-2 rounded-xl font-black text-xs font-mono bg-rose-600 text-white shadow-md shadow-rose-600/20";
                badge.textContent = "SIN EXISTENCIA EN ESTE ALMACÉN (0)";
            }

            // Mostrar el cuadro de abajo
            document.getElementById('artInfoBox').classList.remove('hidden');

            // Foco en cantidad para capturar rápidamente
            const cantInput = document.getElementById('artCantidadInput');
            cantInput.focus();
            cantInput.select();
        }

        function limpiarDetalleArticulo() {
            articuloActualBuscado = null;
            document.getElementById('artClaveInput').value = '';
            document.getElementById('artCantidadInput').value = '1';
            
            const inpExistencia = document.getElementById('artExistenciaInput');
            inpExistencia.value = '';
            inpExistencia.className = "w-full font-mono font-black text-xs text-center bg-slate-100 border border-slate-200 rounded-xl p-2.5 text-slate-700";

            const ubiBadge = document.getElementById('artUbicacionBadge');
            if (ubiBadge) ubiBadge.classList.add('hidden');

            document.getElementById('artInfoBox').classList.add('hidden');
            ocultarSugerencias();
        }

        document.getElementById('btnCancelarPartida').addEventListener('click', limpiarDetalleArticulo);

        document.getElementById('btnAgregarPartida').addEventListener('click', () => {
            if (!articuloActualBuscado) {
                alert("Primero busca y selecciona un artículo.");
                return;
            }

            const cant = parseFloat(document.getElementById('artCantidadInput').value) || 0;
            const stock = parseFloat(articuloActualBuscado.existencia) || 0;

            if (stock <= 0) {
                alert(`No se puede agregar: El artículo '${articuloActualBuscado.clave}' NO TIENE EXISTENCIA en el almacén origen.`);
                return;
            }

            if (cant <= 0) {
                alert("Ingresa una cantidad mayor a 0.");
                return;
            }

            if (cant > stock) {
                alert(`No es posible surtir ${cant} piezas. La existencia actual en almacén origen es de solo ${stock} piezas.`);
                return;
            }

            const existeIndex = partidasTraspaso.findIndex(p => p.articulo_id === articuloActualBuscado.articulo_id);
            if (existeIndex >= 0) {
                const nuevaCant = partidasTraspaso[existeIndex].cantidad + cant;
                if (nuevaCant > stock) {
                    alert(`El total acumulado (${nuevaCant}) superaría la existencia física disponible de ${stock} piezas.`);
                    return;
                }
                partidasTraspaso[existeIndex].cantidad = nuevaCant;
            } else {
                partidasTraspaso.push({
                    articulo_id: articuloActualBuscado.articulo_id,
                    clave: articuloActualBuscado.clave,
                    nombre: articuloActualBuscado.nombre,
                    localizacion: articuloActualBuscado.localizacion || '',
                    cantidad: cant,
                    existencia: stock,
                    unidad: articuloActualBuscado.unidad
                });
            }

            renderTablaTraspasos();
            limpiarDetalleArticulo();
            document.getElementById('artClaveInput').focus();
        });

        function renderTablaTraspasos() {
            const tbody = document.getElementById('traspasoTableBody');
            tbody.innerHTML = '';

            if (partidasTraspaso.length === 0) {
                tbody.innerHTML = `<tr><td colspan="7" class="p-6 text-center text-slate-400 italic">No hay partidas agregadas al traspaso.</td></tr>`;
                document.getElementById('contadorPartidas').textContent = `0 partidas agregadas`;
                return;
            }

            partidasTraspaso.forEach((p, idx) => {
                const tr = document.createElement('tr');
                tr.className = "hover:bg-slate-50 transition border-b border-slate-100";
                tr.innerHTML = `
                    <td class="p-2.5 text-center font-bold text-slate-400">${idx + 1}</td>
                    <td class="p-2.5 font-mono font-black text-blue-900 text-xs">${p.clave}</td>
                    <td class="p-2.5 wrap-desc leading-tight font-medium text-slate-800">${p.nombre}</td>
                    <td class="p-2.5 text-center">
                        ${p.localizacion ? `<span class="bg-amber-100 text-amber-950 font-bold px-2 py-0.5 rounded border border-amber-300 font-mono text-[11px] inline-flex items-center gap-1 shadow-xs">📍 ${p.localizacion}</span>` : '<span class="text-slate-400 font-mono text-[10px] italic">Sin reg.</span>'}
                    </td>
                    <td class="p-2.5 text-center font-mono font-black text-blue-700 bg-blue-50/50 text-xs">${p.cantidad} ${p.unidad}</td>
                    <td class="p-2.5 text-center font-mono font-bold text-slate-600 bg-slate-50">${p.existencia}</td>
                    <td class="p-2.5 text-center">
                        <button type="button" onclick="eliminarPartidaTraspaso(${idx})" class="text-rose-600 hover:text-rose-800 p-1 font-bold text-xs">✕ Quitar</button>
                    </td>
                `;
                tbody.appendChild(tr);
            });

            const totalPzas = partidasTraspaso.reduce((acc, p) => acc + p.cantidad, 0);
            document.getElementById('contadorPartidas').textContent = `${partidasTraspaso.length} partidas (${totalPzas} piezas en total)`;
        }

        window.eliminarPartidaTraspaso = function(index) {
            partidasTraspaso.splice(index, 1);
            renderTablaTraspasos();
        };

        document.getElementById('btnNuevoTraspaso').addEventListener('click', () => {
            if (partidasTraspaso.length > 0 && !confirm("¿Iniciar un nuevo traspaso y limpiar las partidas actuales?")) return;
            partidasTraspaso = [];
            limpiarDetalleArticulo();
            document.getElementById('traspasoDescripcion').value = '';
            actualizarFolioSugerido();
            renderTablaTraspasos();
        });

        document.getElementById('btnGuardarTraspaso').addEventListener('click', async () => {
            const btn = document.getElementById('btnGuardarTraspaso');
            if (btn.dataset.guardando === '1') return;

            if (partidasTraspaso.length === 0) {
                alert("Agrega al menos un artículo a la lista de traspaso.");
                return;
            }

            const oriId = document.getElementById('traspasoAlmacenOrigen').value;
            const desId = document.getElementById('traspasoAlmacenDestino').value;
            const conId = document.getElementById('traspasoConceptoId').value;
            const folio = document.getElementById('traspasoFolio').value.trim();
            const desc = document.getElementById('traspasoDescripcion').value.trim();

            if (!oriId || !desId) {
                alert("Debes seleccionar Almacén Origen y Destino.");
                return;
            }
            if (oriId === desId) {
                alert("El Almacén Origen y Destino no pueden ser el mismo.");
                return;
            }
            if (!folio) {
                alert("Ingresa un folio para el traspaso.");
                return;
            }

            btn.dataset.guardando = '1';
            const totalPiezas = partidasTraspaso.reduce((a, b) => a + b.cantidad, 0);
            const confirmar = confirm(`¿Guardar Traspaso de salida con Folio "${folio}" por un total de ${partidasTraspaso.length} partidas (${totalPiezas} piezas)?\n\nSe descontarán las existencias inmediatamente en Microsip.`);
            if (!confirmar) {
                btn.dataset.guardando = '0';
                return;
            }

            btn.disabled = true;
            btn.classList.add('opacity-50', 'pointer-events-none');
            actualizarProgreso(40, 'Guardando movimiento en Microsip...', 'Actualizando inventarios...');

            try {
                const res = await fetch('/api/traspasos/guardar', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        almacen_origen_id: oriId,
                        almacen_destino_id: desId,
                        concepto_id: conId,
                        folio: folio,
                        descripcion: desc,
                        partidas: partidasTraspaso
                    })
                });

                const data = await res.json();
                if (!res.ok || !data.success) throw new Error(data.error || 'Error al guardar el traspaso');

                actualizarProgreso(100, 'Traspaso Guardado con Éxito');
                setTimeout(ocultarProgreso, 1500);

                const sOri = document.getElementById('traspasoAlmacenOrigen');
                const sDes = document.getElementById('traspasoAlmacenDestino');
                const nomOri = data.almacen_origen || (sOri.selectedIndex >= 0 ? sOri.options[sOri.selectedIndex].text : '');
                const nomDes = data.almacen_destino || (sDes.selectedIndex >= 0 ? sDes.options[sDes.selectedIndex].text : '');

                const impInfo = data.impresion || {};
                const esOrigenCedis = nomOri.toUpperCase().includes('CEDIS');
                const esDestinoCedis = nomDes.toUpperCase().includes('CEDIS');
                const debeImprimirTicket = impInfo.aplica !== undefined ? impInfo.aplica : (esOrigenCedis && !esDestinoCedis);

                if (debeImprimirTicket) {
                    // Traspaso de CEDIS a sucursal: se envía e imprime en POS-80C
                    const selectEmp = document.getElementById('selectEmpresa');
                    const empNombre = (selectEmp && selectEmp.selectedIndex >= 0) ? selectEmp.options[selectEmp.selectedIndex].text : 'BC REFACCIONARIAS';
                    
                    const elDestEnc = document.getElementById('tckDestinoEncabezado');
                    if (elDestEnc) elDestEnc.textContent = nomDes;

                    const elEmpNom = document.getElementById('tckEmpresaNombre');
                    if (elEmpNom) elEmpNom.textContent = empNombre;

                    const elConcepto = document.getElementById('tckConcepto');
                    if (elConcepto) elConcepto.textContent = data.concepto || 'Traspaso (Salida)';

                    const elOri = document.getElementById('tckOrigen');
                    if (elOri) elOri.textContent = nomOri;

                    const elDes = document.getElementById('tckDestino');
                    if (elDes) elDes.textContent = nomDes;

                    const elFecha = document.getElementById('tckFecha');
                    if (elFecha) elFecha.textContent = data.fecha_caja || '';

                    const elHora = document.getElementById('tckHora');
                    if (elHora) elHora.textContent = data.hora_caja || '';

                    const folioFinal = data.folio || folio;

                    const elFolio = document.getElementById('tckFolio');
                    if (elFolio) elFolio.textContent = folioFinal;

                    const elFechaImpr = document.getElementById('tckFechaImpresion');
                    if (elFechaImpr) elFechaImpr.textContent = data.fecha_impresion || '';

                    const tckBadge = document.getElementById('tckImpresionBadge');
                    const tckTexto = document.getElementById('tckImpresionTexto');
                    if (impInfo.ejecutada) {
                        tckBadge.className = "bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-xl px-3 py-2 text-[11px] font-bold flex items-center gap-2";
                        tckTexto.innerHTML = `Ticket impreso automáticamente en <strong>POS-80C</strong> (Original y Copia)`;
                    } else {
                        tckBadge.className = "bg-amber-50 text-amber-800 border border-amber-200 rounded-xl px-3 py-2 text-[11px] font-bold flex items-center gap-2";
                        tckTexto.innerHTML = `Aviso de impresora: ${impInfo.mensaje || 'Compruebe conexión de POS-80C'}`;
                    }

                    const tckBody = document.getElementById('tckItemsBody');
                    tckBody.innerHTML = '';
                    const listaPartidas = data.partidas || partidasTraspaso;
                    listaPartidas.forEach(p => {
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

                    // Generar código de barras en SVG con el folio oficial de Microsip (ej. TFC005761)
                    if (window.JsBarcode) {
                        try {
                            JsBarcode("#tckBarcodeSvg", folioFinal, {
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

                    // Guardar para posible reimpresión manual si se requiere
                    ultimoTraspasoParaTicket = {
                        folio: folioFinal,
                        origen: nomOri,
                        destino: nomDes,
                        concepto: data.concepto || 'Traspaso (Salida)',
                        descripcion: desc,
                        empresa: empNombre,
                        partidas: [...listaPartidas]
                    };

                    // Incidencia 3: NO abrir modal automáticamente para no congelar ni atrapar la pantalla/mouse.
                    document.getElementById('ticketModal')?.classList.add('hidden');
                } else {
                    // Traspaso de Sucursal a Sucursal o de Sucursal a CEDIS:
                    document.getElementById('modalFolioSoloNumero').textContent = data.folio || folio;
                    document.getElementById('modalFolioSoloOrigen').textContent = nomOri;
                    document.getElementById('modalFolioSoloDestino').textContent = nomDes;
                    document.getElementById('modalFolioSoloTotal').textContent = `${partidasTraspaso.length} partida(s) (${totalPiezas} piezas)`;
                    
                    // Mantener modal oculto
                    document.getElementById('modalFolioSolo')?.classList.add('hidden');
                }

                // Mostrar botón de consultar ticket si existe último traspaso
                const btnVerTicket = document.getElementById('btnVerUltimoTicket');
                if (btnVerTicket) {
                    btnVerTicket.classList.remove('hidden');
                    btnVerTicket.textContent = `📄 Ticket Folio: ${folioFinal}`;
                }

                // Banner inline temporal en la vista de traspasos (desaparece en 6.5s)
                const banner = document.getElementById('bannerTraspasoExito');
                if (banner) {
                    const ticketTextoBanner = impInfo.ejecutada 
                        ? '<span class="text-emerald-700 font-bold ml-1.5">• Ticket impreso en POS-80C</span>' 
                        : (debeImprimirTicket ? `<span class="text-amber-700 font-semibold ml-1.5">• Impresora: ${impInfo.mensaje || 'Compruebe conexión POS-80C'}</span>` : '');
                    
                    banner.innerHTML = `
                        <div class="flex items-center justify-between gap-3 p-3.5 bg-emerald-50 border border-emerald-300 text-emerald-950 rounded-2xl shadow-sm">
                            <div class="flex items-center gap-3">
                                <span class="text-xl">✅</span>
                                <div>
                                    <div class="font-black text-sm">Listo: Traspaso generado con éxito</div>
                                    <div class="text-xs text-emerald-900 font-medium">
                                        Folio: <strong class="font-mono text-sm bg-emerald-200/90 text-emerald-950 px-1.5 py-0.5 rounded shadow-2xs">${folioFinal}</strong> 
                                        • ${nomOri} ➔ ${nomDes} • ${partidasTraspaso.length} partida(s) (${totalPiezas} piezas)
                                        ${ticketTextoBanner}
                                    </div>
                                </div>
                            </div>
                            <div class="flex items-center gap-2">
                                <button type="button" onclick="abrirModalUltimoTicket()" class="px-2.5 py-1 bg-white hover:bg-emerald-100 text-emerald-800 border border-emerald-300 rounded-xl text-xs font-bold transition shadow-2xs cursor-pointer">Ver Ticket</button>
                                <button type="button" onclick="this.closest('#bannerTraspasoExito').classList.add('hidden')" class="text-emerald-700 hover:text-emerald-950 font-bold text-sm px-1.5 cursor-pointer">✕</button>
                            </div>
                        </div>
                    `;
                    banner.classList.remove('hidden');
                    if (window._timerBannerTraspaso) clearTimeout(window._timerBannerTraspaso);
                    window._timerBannerTraspaso = setTimeout(() => {
                        if (banner) banner.classList.add('hidden');
                    }, 6500);
                }

                // Notificación flotante global que se retira sola
                const msgNotif = impInfo.ejecutada 
                    ? ' • Ticket enviado a POS-80C' 
                    : (debeImprimirTicket ? ` • Impresora: ${impInfo.mensaje || 'Sin conectar'}` : '');
                mostrarAlerta('success', `<strong>Listo: Traspaso generado con éxito</strong> — Folio: <span class="font-mono font-black text-base bg-emerald-100 text-emerald-950 px-2 py-0.5 rounded ml-1">${folioFinal}</span> (${nomOri} ➔ ${nomDes})${msgNotif}`, 6000);

                partidasTraspaso = [];
                renderTablaTraspasos();
                limpiarDetalleArticulo();
                document.getElementById('traspasoDescripcion').value = '';

                if (data.siguiente_folio) {
                    document.getElementById('traspasoFolio').value = data.siguiente_folio;
                } else {
                    await actualizarFolioSugerido();
                }

            } catch (err) {
                ocultarProgreso();
                alert("Error al guardar traspaso en Microsip: " + err.message);
                actualizarFolioSugerido();
            } finally {
                btn.dataset.guardando = '0';
                btn.disabled = false;
                btn.classList.remove('opacity-50', 'pointer-events-none');
            }
        });

        window.abrirModalUltimoTicket = function() {
            if (!ultimoTraspasoParaTicket) {
                mostrarAlerta('warn', 'No hay ningún ticket reciente disponible.');
                return;
            }
            document.getElementById('ticketModal')?.classList.remove('hidden');
        };

        window.cerrarTicketModal = function() {
            document.getElementById('ticketModal')?.classList.add('hidden');
            actualizarFolioSugerido();
        };

        window.cerrarModalFolioSolo = function() {
            document.getElementById('modalFolioSolo')?.classList.add('hidden');
            actualizarFolioSugerido();
        };

        window.confirmarReimpresionPos80 = async function() {
            if (!ultimoTraspasoParaTicket) {
                mostrarAlerta('warn', 'No hay datos de traspaso para reimprimir.');
                return;
            }
            const btn = document.getElementById('btnReimprimirPos80');
            if (btn && btn.disabled) return;

            const confirmar = confirm(
                `El ticket de este traspaso ya fue enviado automáticamente a la impresora POS-80C.\n\n` +
                `¿Deseas enviar una reimpresión?\n(Solo es necesario si la impresora se quedó sin papel o hubo un fallo físico).`
            );
            if (!confirmar) return;

            await reimprimirTicketPos80(true);
        };

        window.reimprimirTicketPos80 = async function(forzar = false) {
            if (!ultimoTraspasoParaTicket) {
                mostrarAlerta('warn', 'No hay datos de traspaso para reimprimir.');
                return;
            }
            const btn = document.getElementById('btnReimprimirPos80');
            const textoOriginal = btn ? btn.innerHTML : 'Reimprimir';
            if (btn) {
                btn.disabled = true;
                btn.innerHTML = `<span class="animate-spin inline-block mr-1">⌛</span> Imprimiendo...`;
            }

            try {
                const res = await fetch('/api/traspasos/reimprimir-ticket', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ...ultimoTraspasoParaTicket, forzar: forzar })
                });
                const data = await res.json();
                if (data.success) {
                    mostrarAlerta('success', '✓ ' + (data.mensaje || 'Ticket enviado a POS-80C'));
                } else {
                    mostrarAlerta('error', 'Aviso al imprimir en POS-80C: ' + (data.mensaje || 'Verifique la impresora'));
                }
            } catch (e) {
                mostrarAlerta('error', 'Error al comunicarse con la impresora POS-80C: ' + e.message);
            } finally {
                if (btn) {
                    let segundos = 10;
                    btn.disabled = true;
                    btn.classList.add('opacity-60', 'cursor-not-allowed');
                    const timer = setInterval(() => {
                        segundos--;
                        if (segundos <= 0) {
                            clearInterval(timer);
                            btn.disabled = false;
                            btn.classList.remove('opacity-60', 'cursor-not-allowed');
                            btn.innerHTML = textoOriginal;
                        } else {
                            btn.innerHTML = `Espera (${segundos}s)`;
                        }
                    }, 1000);
                }
            }
        };

