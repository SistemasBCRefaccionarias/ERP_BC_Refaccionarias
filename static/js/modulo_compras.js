        // ================= GESTIÓN MÓDULO COMPRAS =================
        async function cargarComprasDashboard(forceRefresh = false) {
            try {
                const res = await fetch('/api/compras/resumen');
                const data = await res.json();
                if (!data.success) return;

                const kpis = data.kpis || {};
                const elProv = document.getElementById('kpiComprasProveedores');
                const elLin = document.getElementById('kpiComprasLineas');
                const elArt = document.getElementById('kpiComprasArticulos');
                const elMov = document.getElementById('kpiComprasMovimientos');

                if (elProv) elProv.textContent = Number(kpis.total_proveedores || 0).toLocaleString('es-MX');
                if (elLin) elLin.textContent = Number(kpis.total_lineas || 0).toLocaleString('es-MX');
                if (elArt) elArt.textContent = Number(kpis.total_articulos || 0).toLocaleString('es-MX');
                if (elMov) elMov.textContent = Number(kpis.traspasos_mes || 0).toLocaleString('es-MX');
            } catch (err) {
                console.error("Error al cargar resumen de compras:", err);
            }
        }

        function irABuscadorArticulos(query = '') {
            activarTab('modulo4');
            if (query) {
                const inp = document.getElementById('inputBusquedaArticulo');
                if (inp) {
                    inp.value = query;
                    inp.dispatchEvent(new Event('input'));
                }
            }
        }

        function irATraspasos(destinoId = null) {
            activarTab('modulo3');
            if (destinoId) {
                setTimeout(() => {
                    const sel = document.getElementById('selectDestino');
                    if (sel) {
                        sel.value = String(destinoId);
                        sel.dispatchEvent(new Event('change'));
                    }
                }, 350);
            }
        }


        // ================= BUSCADOR Y AUTOCOMPLETADO DE PROVEEDOR =================
        let proveedorSeleccionado = null;
        let sugerenciasProveedoresFiltradas = [];
        let indiceSugerenciaProvActiva = -1;

        function normalizarTextoBusqueda(str) {
            return (str || '')
                .toString()
                .toLowerCase()
                .normalize("NFD")
                .replace(/[\u0300-\u036f]/g, "")
                .trim();
        }

        function resaltarCoincidencia(texto, query) {
            if (!query || !texto) return texto || '';
            const terminos = normalizarTextoBusqueda(query).split(/\s+/).filter(Boolean);
            if (!terminos.length) return texto;

            const patron = terminos.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
            try {
                const regex = new RegExp(`(${patron})`, 'gi');
                return texto.replace(regex, '<mark class="bg-amber-200 text-slate-900 rounded-sm px-0.5 font-bold">$1</mark>');
            } catch (e) {
                return texto;
            }
        }

        function initProveedorAutocomplete() {
            const input = document.getElementById('inputBuscarProveedor');
            const dropdown = document.getElementById('dropdownSugerenciasProveedor');
            const btnClear = document.getElementById('btnClearProveedor');
            const btnCambiar = document.getElementById('btnCambiarProveedor');

            if (!input || !dropdown) return;

            input.addEventListener('input', function() {
                if (this.value.trim().length > 0) {
                    if (btnClear) btnClear.classList.remove('hidden');
                } else {
                    if (btnClear) btnClear.classList.add('hidden');
                }
                filtrarSugerenciasProveedor(this.value);
            });

            input.addEventListener('focus', function() {
                filtrarSugerenciasProveedor(this.value);
            });

            input.addEventListener('keydown', function(e) {
                const dropdownOculto = dropdown.classList.contains('hidden');

                if (dropdownOculto || !sugerenciasProveedoresFiltradas.length) {
                    if (e.key === 'ArrowDown' || e.key === 'Enter') {
                        filtrarSugerenciasProveedor(this.value);
                    }
                    return;
                }

                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    indiceSugerenciaProvActiva = (indiceSugerenciaProvActiva + 1) % sugerenciasProveedoresFiltradas.length;
                    actualizarResaltadoSugerencia();
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    indiceSugerenciaProvActiva = (indiceSugerenciaProvActiva - 1 + sugerenciasProveedoresFiltradas.length) % sugerenciasProveedoresFiltradas.length;
                    actualizarResaltadoSugerencia();
                } else if (e.key === 'Enter') {
                    e.preventDefault();
                    if (indiceSugerenciaProvActiva >= 0 && indiceSugerenciaProvActiva < sugerenciasProveedoresFiltradas.length) {
                        seleccionarProveedor(sugerenciasProveedoresFiltradas[indiceSugerenciaProvActiva]);
                    } else if (sugerenciasProveedoresFiltradas.length > 0) {
                        seleccionarProveedor(sugerenciasProveedoresFiltradas[0]);
                    }
                } else if (e.key === 'Escape') {
                    dropdown.classList.add('hidden');
                }
            });

            document.addEventListener('click', function(e) {
                if (!e.target.closest('#inputBuscarProveedor') && !e.target.closest('#dropdownSugerenciasProveedor') && !e.target.closest('#btnClearProveedor')) {
                    dropdown.classList.add('hidden');
                }
            });

            if (btnClear) {
                btnClear.addEventListener('click', function(e) {
                    e.stopPropagation();
                    limpiarProveedorSeleccionado();
                    input.focus();
                });
            }

            if (btnCambiar) {
                btnCambiar.addEventListener('click', function(e) {
                    e.stopPropagation();
                    limpiarProveedorSeleccionado();
                    input.focus();
                    filtrarSugerenciasProveedor('');
                });
            }
        }

        function filtrarSugerenciasProveedor(texto) {
            const dropdown = document.getElementById('dropdownSugerenciasProveedor');
            if (!dropdown) return;

            const terminos = normalizarTextoBusqueda(texto).split(/\s+/).filter(Boolean);

            if (!proveedoresMicrosip || proveedoresMicrosip.length === 0) {
                dropdown.innerHTML = `
                    <div class="p-3 text-center text-xs text-slate-400 italic">
                        Cargando proveedores desde Microsip...
                    </div>
                `;
                dropdown.classList.remove('hidden');
                return;
            }

            if (terminos.length === 0) {
                sugerenciasProveedoresFiltradas = proveedoresMicrosip.slice(0, 25);
            } else {
                sugerenciasProveedoresFiltradas = proveedoresMicrosip.filter(prov => {
                    const nomNorm = normalizarTextoBusqueda(prov.nombre);
                    const cveNorm = normalizarTextoBusqueda(prov.clave);
                    const rfcNorm = normalizarTextoBusqueda(prov.rfc);
                    return terminos.every(term =>
                        nomNorm.includes(term) || cveNorm.includes(term) || rfcNorm.includes(term)
                    );
                });

                const primerTermino = terminos[0];
                sugerenciasProveedoresFiltradas.sort((a, b) => {
                    const aNom = normalizarTextoBusqueda(a.nombre);
                    const bNom = normalizarTextoBusqueda(b.nombre);
                    const aEmpieza = aNom.startsWith(primerTermino) || (a.clave && normalizarTextoBusqueda(a.clave) === primerTermino);
                    const bEmpieza = bNom.startsWith(primerTermino) || (b.clave && normalizarTextoBusqueda(b.clave) === primerTermino);
                    if (aEmpieza && !bEmpieza) return -1;
                    if (!aEmpieza && bEmpieza) return 1;
                    return a.nombre.localeCompare(b.nombre);
                });

                sugerenciasProveedoresFiltradas = sugerenciasProveedoresFiltradas.slice(0, 30);
            }

            indiceSugerenciaProvActiva = -1;
            renderSugerenciasDropdown(texto);
        }

        function renderSugerenciasDropdown(query) {
            const dropdown = document.getElementById('dropdownSugerenciasProveedor');
            if (!dropdown) return;

            dropdown.innerHTML = '';

            if (sugerenciasProveedoresFiltradas.length === 0) {
                dropdown.innerHTML = `
                    <div class="p-3 text-center text-xs text-slate-400 italic">
                        No se encontró ningún proveedor con "${query}".
                    </div>
                `;
                dropdown.classList.remove('hidden');
                return;
            }

            sugerenciasProveedoresFiltradas.forEach((prov, idx) => {
                const item = document.createElement('div');
                item.className = 'sug-prov-item p-2.5 hover:bg-red-50/70 cursor-pointer transition flex items-center justify-between gap-2 text-xs text-slate-700';
                item.dataset.index = idx;

                const nombreResaltado = resaltarCoincidencia(prov.nombre, query);
                const claveBadge = prov.clave ? `<span class="bg-slate-100 text-slate-700 font-bold px-1.5 py-0.5 rounded text-[10px] font-mono border border-slate-200">#${prov.clave}</span>` : '';
                const rfcBadge = prov.rfc ? `<span class="text-slate-400 text-[10px] font-mono font-semibold">${prov.rfc}</span>` : '';

                item.innerHTML = `
                    <div class="min-w-0 flex-1">
                        <div class="font-extrabold text-slate-900 truncate">${nombreResaltado}</div>
                        <div class="flex items-center gap-2 mt-0.5">
                            ${claveBadge}
                            ${rfcBadge}
                        </div>
                    </div>
                    <span class="text-[10px] text-slate-300 hover:text-red-600 font-bold flex-shrink-0">↵ Seleccionar</span>
                `;

                item.addEventListener('mouseenter', () => {
                    indiceSugerenciaProvActiva = idx;
                    actualizarResaltadoSugerencia();
                });

                item.addEventListener('click', (e) => {
                    e.stopPropagation();
                    seleccionarProveedor(prov);
                });

                dropdown.appendChild(item);
            });

            dropdown.classList.remove('hidden');
        }

        function actualizarResaltadoSugerencia() {
            const items = document.querySelectorAll('.sug-prov-item');
            items.forEach((it, idx) => {
                if (idx === indiceSugerenciaProvActiva) {
                    it.classList.add('bg-red-50', 'border-l-4', 'border-red-600');
                    it.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                } else {
                    it.classList.remove('bg-red-50', 'border-l-4', 'border-red-600');
                }
            });
        }

        function seleccionarProveedor(prov) {
            proveedorSeleccionado = prov;
            const input = document.getElementById('inputBuscarProveedor');
            const selectProv = document.getElementById('selectProveedor');
            const btnClear = document.getElementById('btnClearProveedor');
            const detalleBox = document.getElementById('detalleProveedorSeleccionado');
            const badgeSel = document.getElementById('badgeProveedorSeleccionado');
            const dropdown = document.getElementById('dropdownSugerenciasProveedor');

            if (input) {
                input.value = prov.nombre;
                if (btnClear) btnClear.classList.remove('hidden');
            }

            if (selectProv) {
                let opt = Array.from(selectProv.options).find(o => String(o.value) === String(prov.id));
                if (!opt) {
                    opt = document.createElement('option');
                    opt.value = prov.id;
                    opt.textContent = prov.clave ? `[${prov.clave}] ${prov.nombre}` : prov.nombre;
                    selectProv.appendChild(opt);
                }
                selectProv.value = prov.id;
                selectProv.dispatchEvent(new Event('change'));
            }

            if (detalleBox) {
                document.getElementById('txtNombreProvSel').textContent = prov.nombre;
                document.getElementById('txtClaveProvSel').textContent = prov.clave ? `Clave: ${prov.clave}` : 'Sin clave';
                document.getElementById('txtRfcProvSel').textContent = prov.rfc ? `RFC: ${prov.rfc}` : '';
                detalleBox.classList.remove('hidden');
            }

            if (badgeSel) {
                badgeSel.classList.remove('hidden');
                badgeSel.classList.add('inline-flex');
            }

            if (dropdown) {
                dropdown.classList.add('hidden');
            }

            if (typeof esProveedorCiosaActivo === 'function' && esProveedorCiosaActivo() && typeof parsedItems !== 'undefined' && parsedItems.length > 0) {
                analizarSimilaresCiosa();
            } else if (typeof ocultarPanelCiosaSimilares === 'function') {
                ocultarPanelCiosaSimilares();
            }

            if (typeof esProveedorRubberMolding === 'function' && esProveedorRubberMolding(prov) && typeof parsedItems !== 'undefined' && parsedItems.length > 0) {
                aplicarCondicionProveedorRubberMolding();
            }
        }

        function limpiarProveedorSeleccionado() {
            proveedorSeleccionado = null;
            if (typeof ocultarPanelCiosaSimilares === 'function') {
                ocultarPanelCiosaSimilares();
            }
            const input = document.getElementById('inputBuscarProveedor');
            const selectProv = document.getElementById('selectProveedor');
            const btnClear = document.getElementById('btnClearProveedor');
            const detalleBox = document.getElementById('detalleProveedorSeleccionado');
            const badgeSel = document.getElementById('badgeProveedorSeleccionado');
            const dropdown = document.getElementById('dropdownSugerenciasProveedor');

            if (input) input.value = '';
            if (btnClear) btnClear.classList.add('hidden');
            if (detalleBox) detalleBox.classList.add('hidden');
            if (badgeSel) {
                badgeSel.classList.add('hidden');
                badgeSel.classList.remove('inline-flex');
            }
            if (dropdown) dropdown.classList.add('hidden');

            if (selectProv) {
                selectProv.value = '';
                selectProv.dispatchEvent(new Event('change'));
            }
        }

        function esProveedorRubberMolding(prov = null) {
            const candidatos = [prov, proveedorSeleccionado, proveedorDetectadoXml].filter(Boolean);
            for (const p of candidatos) {
                const rfc = (p.rfc || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
                const nom = (p.nombre || '').toUpperCase();
                const id = String(p.id || '');
                if (rfc === 'RM020502H98' || rfc === 'RMS020502H98' || id === '800441' ||
                    nom.includes('RUBBER MOLDING') || nom.includes('DC AUTO PARTS') || nom.includes('DC GASKETS')) {
                    return true;
                }
            }
            const sel = document.getElementById('selectProveedor');
            if (sel && sel.selectedIndex >= 0) {
                const txt = sel.options[sel.selectedIndex].text.toUpperCase();
                if (txt.includes('RUBBER MOLDING') || txt.includes('DC AUTO PARTS') || sel.value === '800441') return true;
            }
            const inp = document.getElementById('inputBuscarProveedor');
            if (inp && inp.value) {
                const val = inp.value.toUpperCase();
                if (val.includes('RUBBER MOLDING') || val.includes('DC AUTO PARTS')) return true;
            }
            return false;
        }

        function normalizarCodigoRubberMolding(codigo) {
            if (!codigo) return '';
            // Remueve ceros a la izquierda después de un guión: ej. FS-000099-1ML -> FS-99-1ML, FS-000100 -> FS-100
            let clean = String(codigo).trim().replace(/-0+(\d+)/g, '-$1');
            // Remueve ceros a la izquierda al inicio si aplica
            clean = clean.replace(/^0+(\d+)/g, '$1');
            return clean.trim().toUpperCase();
        }

        async function aplicarCondicionProveedorRubberMolding() {
            if (!parsedItems || parsedItems.length === 0) return;

            let huboCambios = false;
            parsedItems.forEach(it => {
                const norm = normalizarCodigoRubberMolding(it.codigo);
                if (norm !== it.codigo) {
                    it.codigoXml = it.codigoXml || it.codigo;
                    it.codigo = norm;
                    huboCambios = true;
                }
                if (!it.lineaRegistrada) {
                    it.lineaRegistrada = "DC";
                }
            });

            // Re-verificar contra el servidor
            const claves = [];
            parsedItems.forEach(it => {
                claves.push(it.codigo);
                if (it.codigoXml && it.codigoXml !== it.codigo) {
                    claves.push(it.codigoXml);
                }
            });

            try {
                const res = await fetch('/api/verificar-articulos', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ claves: claves })
                });
                if (res.ok) {
                    const data = await res.json();
                    const mapa = data.existentes || {};
                    parsedItems.forEach(item => {
                        const up = item.codigo.trim().toUpperCase();
                        const upXml = (item.codigoXml || item.codigo).trim().toUpperCase();
                        const info = mapa[up] || mapa[upXml];
                        if (info) {
                            item.yaExiste = true;
                            item.nombreMicrosip = info.nombre_microsip || "";
                            item.lineaRegistrada = info.linea || item.lineaRegistrada || "DC";
                            item.equivalenciaRegistrada = info.equivalencia || "";
                            item.preciosActualesBD = info.precios || null;
                            item.preciosActualesBDSinIva = info.precios_sin_iva || null;
                            item.tasaIvaBD = info.tasa_iva || 16.0;
                            item.costoBD = info.costo_bd || null;
                            item.costoBDConIva = info.costo_bd_con_iva || (info.costo_bd ? Number((info.costo_bd * (1 + (info.tasa_iva || 16.0)/100)).toFixed(2)) : null);
                            if (info.clave_microsip) {
                                item.codigo = info.clave_microsip;
                            }
                        }
                    });
                }
            } catch (err) {
                console.warn("Aviso al verificar artículos Rubber Molding:", err);
            }

            renderTable();
            actualizarContadorSeleccionados();
            mostrarAlerta('info', 'Condición de Rubber Molding / DC aplicada: Claves normalizadas sin ceros y verificadas en Microsip.', 4500);
        }

        function autoDetectarProveedorXML(rfc, nombreEmisor) {
            proveedorDetectadoXml = { rfc: rfc || '', nombre: nombreEmisor || '' };
            if (!proveedoresMicrosip || proveedoresMicrosip.length === 0) return;

            let match = null;

            if (rfc) {
                const rfcNorm = normalizarTextoBusqueda(rfc);
                const rfcSoloAlfanum = rfc.toUpperCase().replace(/[^A-Z0-9]/g, '');
                match = proveedoresMicrosip.find(p => {
                    if (!p.rfc) return false;
                    const pNorm = normalizarTextoBusqueda(p.rfc);
                    if (pNorm === rfcNorm) return true;
                    const pAlfanum = p.rfc.toUpperCase().replace(/[^A-Z0-9]/g, '');
                    if (pAlfanum === rfcSoloAlfanum) return true;
                    // Caso Rubber Molding: RM&020502H98 <-> RMS020502H98
                    if ((pAlfanum === 'RM020502H98' || pAlfanum === 'RMS020502H98') && (rfcSoloAlfanum === 'RM020502H98' || rfcSoloAlfanum === 'RMS020502H98')) {
                        return true;
                    }
                    return false;
                });
            }

            if (!match && nombreEmisor) {
                const nomNorm = normalizarTextoBusqueda(nombreEmisor);
                match = proveedoresMicrosip.find(p => {
                    const pNorm = normalizarTextoBusqueda(p.nombre);
                    return pNorm === nomNorm || pNorm.includes(nomNorm) || nomNorm.includes(pNorm);
                });

                if (!match) {
                    const palabras = nomNorm.split(/\s+/).filter(w => w.length > 3 && !['s.a.', 'de', 'c.v.', 's.a', 'c.v', 'sapi'].includes(w));
                    if (palabras.length > 0) {
                        match = proveedoresMicrosip.find(p => {
                            const pNorm = normalizarTextoBusqueda(p.nombre);
                            return palabras.some(palabra => pNorm.includes(palabra));
                        });
                    }
                }
            }

            // Fallback directo para Rubber Molding si menciona Rubber o DC
            if (!match && (nombreEmisor || rfc)) {
                const txtCompleto = `${nombreEmisor || ''} ${rfc || ''}`.toUpperCase();
                if (txtCompleto.includes('RUBBER') || txtCompleto.includes('MOLDING') || txtCompleto.includes('DC AUTO PARTS') || txtCompleto.includes('RM020502') || txtCompleto.includes('RMS020502')) {
                    match = proveedoresMicrosip.find(p => String(p.id) === '800441' || (p.nombre && p.nombre.toUpperCase().includes('RUBBER')));
                }
            }

            if (match) {
                seleccionarProveedor(match);
                mostrarAlerta('success', `Proveedor detectado automáticamente de la factura: <strong>${match.nombre}</strong> (${match.rfc || 'RFC: ' + rfc})`);
            }
        }

        async function cargarProveedoresEmpresa() {
            const selectProv = document.getElementById('selectProveedor');
            try {
                const res = await fetch('/api/proveedores');
                proveedoresMicrosip = await res.json();
                selectProv.innerHTML = '<option value="">-- Selecciona un proveedor --</option>';
                proveedoresMicrosip.forEach(prov => {
                    const opt = document.createElement('option');
                    opt.value = prov.id;
                    opt.textContent = prov.clave ? `[${prov.clave}] ${prov.nombre}` : prov.nombre;
                    selectProv.appendChild(opt);
                });

                if (proveedorSeleccionado) {
                    const reencontrado = proveedoresMicrosip.find(p => String(p.id) === String(proveedorSeleccionado.id));
                    if (reencontrado) {
                        seleccionarProveedor(reencontrado);
                    } else {
                        limpiarProveedorSeleccionado();
                    }
                }
            } catch (err) {
                selectProv.innerHTML = '<option value="">Error al cargar proveedores</option>';
            }
        }

        async function cargarLineasEmpresa() {
            try {
                const resLineas = await fetch('/api/lineas');
                lineasMicrosip = await resLineas.json();
                actualizarSelectsGlobal();
            } catch (err) {
                console.error(err);
            }
        }

        document.getElementById('selectEmpresa').addEventListener('change', function() {
            cambiarEmpresa(this.value);
        });

        document.getElementById('btnSyncOdbc').addEventListener('click', () => {
            const val = document.getElementById('selectEmpresa').value;
            if (val) cambiarEmpresa(val); else cargarEmpresas();
        });

        function formatearMoneda(monto) {
            if (monto === null || monto === undefined || isNaN(monto)) return "$0.00";
            const num = Number(monto);
            const diffCentavos = Math.abs(num * 100 - Math.round(num * 100));
            const maxDec = diffCentavos > 0.0005 ? 4 : 2;
            return "$" + num.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: maxDec });
        }

        // ================= CÉLULA CON ETIQUETAS EXPLÍCITAS DE PRECIO Y MARGEN (CON IMPUESTOS) =================
        function renderCeldaSemaforo(precioNuevo, precioActualBD, costoConIva, margenObjetivo) {
            const precioNuevoFmt = formatearMoneda(precioNuevo);

            if (precioActualBD === null || precioActualBD === undefined || precioActualBD === 0) {
                return `
                    <div class="px-2 py-1.5 rounded-xl text-right bg-slate-50 border border-slate-200">
                        <div class="flex items-center justify-between gap-1 leading-none mb-1">
                            <span class="text-[8px] font-bold uppercase text-slate-400">Meta:</span>
                            <span class="font-mono font-black text-slate-800 text-xs">${margenObjetivo.toFixed(1)}%</span>
                        </div>
                        <div class="text-[8px] font-bold text-slate-400 uppercase leading-none">Sugerido (c/IVA)</div>
                        <div class="text-[11px] font-extrabold text-blue-700 font-mono mt-0.5 leading-none">${precioNuevoFmt}</div>
                        <div class="text-[8px] font-semibold text-slate-400 mt-1 leading-none">Sin registro previo</div>
                    </div>
                `;
            }

            const precioAntFmt = formatearMoneda(precioActualBD);
            const difMonto = Number((precioNuevo - precioActualBD).toFixed(2));
            
            // Margen / Utilidad actual que deja el precio vigente en el sistema frente al nuevo costo de la factura (ambos con IVA)
            let margenActual = 0;
            if (precioActualBD > 0 && costoConIva > 0) {
                margenActual = ((precioActualBD - costoConIva) / precioActualBD) * 100;
            }
            const margenFmt = margenActual.toFixed(1) + "%";

            if (difMonto > 0.05) {
                return `
                    <div class="px-2 py-1.5 rounded-xl text-right bg-rose-50 border border-rose-300 leading-tight">
                        <div class="flex items-center justify-between gap-1 leading-none mb-1" title="Utilidad actual en BD frente al nuevo costo con IVA: (Precio BD - Costo Factura) / Precio BD">
                            <span class="text-[8px] font-extrabold uppercase text-rose-600">Utilidad BD:</span>
                            <span class="font-mono font-black text-rose-700 text-xs tracking-tight">▲ ${margenFmt}</span>
                        </div>
                        <div class="text-[8px] font-bold text-slate-500 uppercase leading-none">Sugerido (${margenObjetivo}% c/IVA):</div>
                        <div class="text-[11px] font-black text-rose-700 font-mono mt-0.5 leading-none">${precioNuevoFmt}</div>
                        <div class="text-[8px] font-bold text-slate-600 mt-1 border-t border-rose-200/60 pt-0.5 leading-none">
                            Actual (BD c/IVA): <span class="font-mono font-bold">${precioAntFmt}</span>
                        </div>
                        <div class="text-[7.5px] font-extrabold text-rose-600 mt-0.5 leading-none">▲ Actualiza a ${precioNuevoFmt}</div>
                    </div>
                `;
            }

            if (difMonto < -0.05) {
                return `
                    <div class="px-2 py-1.5 rounded-xl text-right bg-emerald-50 border border-emerald-300 leading-tight">
                        <div class="flex items-center justify-between gap-1 leading-none mb-1" title="Utilidad actual en BD frente al nuevo costo con IVA: (Precio BD - Costo Factura) / Precio BD">
                            <span class="text-[8px] font-extrabold uppercase text-emerald-600">Utilidad BD:</span>
                            <span class="font-mono font-black text-emerald-700 text-xs tracking-tight">▼ ${margenFmt}</span>
                        </div>
                        <div class="text-[8px] font-bold text-slate-500 uppercase leading-none">Sugerido (${margenObjetivo}% c/IVA):</div>
                        <div class="text-[11px] font-extrabold text-slate-700 font-mono mt-0.5 leading-none">${precioNuevoFmt}</div>
                        <div class="text-[8px] font-bold text-emerald-800 mt-1 border-t border-emerald-200/60 pt-0.5 leading-none">
                            Actual (BD c/IVA): <span class="font-mono font-bold">${precioAntFmt}</span>
                        </div>
                        <div class="text-[7.5px] font-extrabold text-emerald-700 mt-0.5 leading-none">✔ Conserva ${precioAntFmt}</div>
                    </div>
                `;
            }

            return `
                <div class="px-2 py-1.5 rounded-xl text-right bg-amber-50/70 border border-amber-200 leading-tight">
                    <div class="flex items-center justify-between gap-1 leading-none mb-1">
                        <span class="text-[8px] font-extrabold uppercase text-amber-700">Utilidad BD:</span>
                        <span class="font-mono font-black text-amber-800 text-xs tracking-tight">= ${margenFmt}</span>
                    </div>
                    <div class="text-[8px] font-bold text-slate-500 uppercase leading-none">Sugerido (${margenObjetivo}% c/IVA):</div>
                    <div class="text-[11px] font-bold text-slate-700 font-mono mt-0.5 leading-none">${precioNuevoFmt}</div>
                    <div class="text-[8px] font-bold text-amber-800 mt-1 border-t border-amber-200/60 pt-0.5 leading-none">
                        Actual (BD c/IVA): <span class="font-mono font-bold">${precioAntFmt}</span>
                    </div>
                    <div class="text-[7.5px] font-semibold text-amber-700 mt-0.5 leading-none">Sin cambio</div>
                </div>
            `;
        }

        // ================= MARCAS COMPUESTAS (MASTER CUT, ETC.) =================
        function procesarDescripcionConMarca(descripcionOriginal) {
            const moverMarca = document.getElementById('chkMoverMarca').checked;
            if (!moverMarca) return descripcionOriginal.trim();

            let desc = descripcionOriginal.trim().replace(/\s{2,}/g, ' ');
            const marcasCompuestas = ["MASTER CUT", "MATER CUT", "FIVE PLUS", "SAFETY PLUS", "POWER STEERING", "PERFECT CIRCLE", "FEDERAL MOGUL"];

            for (const marcaComp of marcasCompuestas) {
                const regexFin = new RegExp(`\\s+${marcaComp}$`, 'i');
                if (regexFin.test(desc)) {
                    if (desc.toUpperCase().startsWith(marcaComp)) return desc;
                    const resto = desc.replace(regexFin, '').trim();
                    return `${marcaComp} ${resto}`.trim();
                }
            }

            const selectProv = document.getElementById('selectProveedor');
            const provTexto = selectProv && selectProv.selectedIndex >= 0 ? selectProv.options[selectProv.selectedIndex].text.toUpperCase() : "";
            const esNikko = provTexto.includes("NIKKO");

            if (esNikko || (!desc.includes("(") && !desc.includes("（"))) {
                const palabras = desc.split(' ').filter(p => p.trim());
                if (palabras.length > 1) {
                    const ultimaPalabra = palabras[palabras.length - 1].trim();
                    if (!desc.toUpperCase().startsWith(ultimaPalabra.toUpperCase())) {
                        palabras.pop();
                        return `${ultimaPalabra} ${palabras.join(' ')}`.trim();
                    }
                }
            }

            const regexTodosParentesis = /[\(\（]\s*([^\)\）]+?)\s*[\)\）]/g;
            const coincidencias = [...desc.matchAll(regexTodosParentesis)];
            if (coincidencias.length > 0) {
                const ultimaCoincidencia = coincidencias[coincidencias.length - 1];
                const marca = ultimaCoincidencia[1].trim();
                const textoParentesisCompleto = ultimaCoincidencia[0];
                if (desc.toUpperCase().startsWith(marca.toUpperCase())) return desc;
                const posicionUltimo = desc.lastIndexOf(textoParentesisCompleto);
                let resto = desc.substring(0, posicionUltimo) + desc.substring(posicionUltimo + textoParentesisCompleto.length);
                return `${marca} ${resto.replace(/\s{2,}/g, ' ').trim()}`.trim();
            }
            return desc;
        }

        function obtenerOptionsLineas(selectedId = null) {
            let html = '<option value="">-- En blanco --</option>';
            if (!lineasMicrosip || lineasMicrosip.length === 0) return html;
            const idStr = selectedId ? String(selectedId).trim().toUpperCase() : "";
            lineasMicrosip.forEach(l => {
                const lId = String(l.id).trim().toUpperCase();
                const lClave = String(l.clave || '').trim().toUpperCase();
                const lNombre = String(l.nombre || '').trim().toUpperCase();
                const esMatch = idStr && (lId === idStr || lClave === idStr || lNombre === idStr);
                const etiqueta = l.clave ? `[${l.clave}] ${l.nombre}` : l.nombre;
                html += `<option value="${l.id}" ${esMatch ? 'selected' : ''}>${etiqueta}</option>`;
            });
            return html;
        }

        function actualizarSelectsGlobal() {
            const globalSelect = document.getElementById('lineaGlobal');
            globalSelect.innerHTML = '<option value="">-- Selecciona Línea --</option>';
            lineasMicrosip.forEach(linea => {
                const opt = document.createElement('option');
                opt.value = linea.id;
                opt.textContent = linea.clave ? `[${linea.clave}] ${linea.nombre}` : linea.nombre;
                globalSelect.appendChild(opt);
            });
        }

        // ================= MÓDULO 1: XML PARSER =================
        document.getElementById('xmlFile').addEventListener('change', function(event) {
            const file = event.target.files[0];
            if (!file) return;
            nombreArchivoXmlActual = file.name;
            ocultarAlerta();
            const avisoBox = document.getElementById('avisoExcelGuardadoE');
            if (avisoBox) avisoBox.classList.add('hidden');
            document.getElementById('tableContainer').classList.add('hidden');
            actualizarProgreso(10, 'Leyendo factura XML...', `Archivo: ${file.name}`);
            const reader = new FileReader();
            reader.onload = async function(e) {
                rawXmlString = e.target.result;
                await parseXML(rawXmlString, file.name);
            };
            reader.readAsText(file);
        });

        function renderizarResumenXml(datos) {
            const cardVacio = document.getElementById('resumenXmlVacio');
            const cardContenido = document.getElementById('resumenXmlContenido');
            const xmlFileInfo = document.getElementById('xmlFileInfo');

            if (!datos) {
                if (cardVacio) cardVacio.classList.remove('hidden');
                if (cardContenido) {
                    cardContenido.classList.add('hidden');
                    cardContenido.classList.remove('flex');
                }
                if (xmlFileInfo) xmlFileInfo.classList.add('hidden');
                return;
            }

            if (cardVacio) cardVacio.classList.add('hidden');
            if (cardContenido) {
                cardContenido.classList.remove('hidden');
                cardContenido.classList.add('flex');
            }

            // Folio, Serie y Moneda
            const serieFolio = [datos.serie, datos.folio].filter(Boolean).join('-') || 'Sin folio';
            const badgeFolio = document.getElementById('badgeFolioXml');
            if (badgeFolio) badgeFolio.textContent = serieFolio;

            const badgeMoneda = document.getElementById('badgeMonedaXml');
            if (badgeMoneda) badgeMoneda.textContent = datos.moneda || 'MXN';

            // Archivo en selector
            if (xmlFileInfo) {
                xmlFileInfo.classList.remove('hidden');
                const fn = document.getElementById('xmlFileName');
                if (fn) fn.textContent = datos.nombreArchivo || 'Factura.xml';
                const bf = document.getElementById('badgeFolioXmlInline');
                if (bf) bf.textContent = serieFolio;
            }

            // 1. Artículos Fact vs Leídos
            const elFact = document.getElementById('resumenArticulosFact');
            const elLeidos = document.getElementById('resumenArticulosLeidos');
            const elPzas = document.getElementById('resumenArticulosPzas');

            if (elFact) elFact.textContent = datos.totalFactura;
            if (elLeidos) elLeidos.textContent = datos.totalLeidos;
            if (elPzas) {
                const pzasFormateadas = Number(datos.totalPiezas || 0).toLocaleString('es-MX', { maximumFractionDigits: 2 });
                elPzas.textContent = `${pzasFormateadas} pzas tot.`;
            }

            if (elLeidos) {
                if (datos.totalFactura === datos.totalLeidos) {
                    elLeidos.className = "text-xs font-black text-emerald-700";
                } else {
                    elLeidos.className = "text-xs font-black text-amber-600";
                    if (elPzas) {
                        const dif = Math.abs(datos.totalFactura - datos.totalLeidos);
                        elPzas.textContent += ` (${dif} dif.)`;
                    }
                }
            }

            // 2. Subtotal y Descuento
            const elSub = document.getElementById('resumenSubtotal');
            if (elSub) elSub.textContent = formatearMoneda(datos.subtotal);

            const elDesc = document.getElementById('resumenDescuento');
            if (elDesc) {
                if (datos.descuento > 0) {
                    elDesc.textContent = `Desc: -${formatearMoneda(datos.descuento)}`;
                    elDesc.classList.remove('hidden');
                } else {
                    elDesc.classList.add('hidden');
                }
            }

            // 3. IVA(s) y Desglose
            const elIva = document.getElementById('resumenIva');
            if (elIva) elIva.textContent = formatearMoneda(datos.totalIva);

            const elIvaDesglose = document.getElementById('resumenIvaDesglose');
            if (elIvaDesglose) {
                const keys = Object.keys(datos.desgloseIva || {});
                if (keys.length > 1) {
                    const desgloseItems = Object.entries(datos.desgloseIva).map(([etq, imp]) => `${etq}: ${formatearMoneda(imp)}`);
                    elIvaDesglose.textContent = desgloseItems.join(' • ');
                    elIvaDesglose.title = desgloseItems.join('\n');
                } else if (keys.length === 1) {
                    const unicaTasa = keys[0];
                    elIvaDesglose.textContent = unicaTasa;
                    elIvaDesglose.title = `${unicaTasa}: ${formatearMoneda(datos.desgloseIva[unicaTasa])}`;
                } else {
                    elIvaDesglose.textContent = '16%';
                }
            }

            // 4. Total Factura
            const elTotal = document.getElementById('resumenTotal');
            if (elTotal) elTotal.textContent = formatearMoneda(datos.total);
        }

        async function parseXML(xmlString, fileName = '') {
            actualizarProgreso(25, 'Analizando conceptos del XML...', 'Calculando márgenes...');
            await renderYield();
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(xmlString, "text/xml");

            // Comprobante nodo raíz
            const comprobante = xmlDoc.getElementsByTagNameNS("*", "Comprobante")[0] 
                             || xmlDoc.getElementsByTagName("cfdi:Comprobante")[0] 
                             || xmlDoc.getElementsByTagName("Comprobante")[0] 
                             || xmlDoc.documentElement;

            const subtotalVal = parseFloat(comprobante.getAttribute("SubTotal") || comprobante.getAttribute("subTotal") || "0") || 0;
            const descuentoVal = parseFloat(comprobante.getAttribute("Descuento") || comprobante.getAttribute("descuento") || "0") || 0;
            const totalVal = parseFloat(comprobante.getAttribute("Total") || comprobante.getAttribute("total") || "0") || 0;
            const monedaVal = (comprobante.getAttribute("Moneda") || comprobante.getAttribute("moneda") || "MXN").trim();
            const serieVal = (comprobante.getAttribute("Serie") || comprobante.getAttribute("serie") || "").trim();
            const folioVal = (comprobante.getAttribute("Folio") || comprobante.getAttribute("folio") || "").trim();

            // Auto-detección del proveedor emisor en la factura
            try {
                const emisor = xmlDoc.getElementsByTagNameNS("*", "Emisor")[0] || xmlDoc.getElementsByTagName("cfdi:Emisor")[0] || xmlDoc.getElementsByTagName("Emisor")[0];
                if (emisor) {
                    const rfcEm = (emisor.getAttribute("Rfc") || emisor.getAttribute("rfc") || "").trim();
                    const nomEm = (emisor.getAttribute("Nombre") || emisor.getAttribute("nombre") || "").trim();
                    autoDetectarProveedorXML(rfcEm, nomEm);
                }
            } catch (errEmisor) {
                console.warn("Aviso al detectar emisor de XML:", errEmisor);
            }

            const conceptos = xmlDoc.getElementsByTagNameNS("*", "Concepto");
            const totalArticulosFactura = conceptos.length;
            let totalPiezasFactura = 0;

            parsedItems = [];
            const clavesParaVerificar = [];

            if (totalArticulosFactura === 0) {
                ocultarProgreso();
                mostrarAlerta('error', 'No se encontraron conceptos válidos en el XML.');
                renderizarResumenXml(null);
                return;
            }

            const esRubberActivo = esProveedorRubberMolding();

            for (let i = 0; i < conceptos.length; i++) {
                const c = conceptos[i];
                const cant = parseFloat(c.getAttribute("Cantidad") || "1") || 0;
                totalPiezasFactura += cant;

                const costoUnitario = parseFloat(c.getAttribute("ValorUnitario")) || 0;
                const codigoRaw = (c.getAttribute("NoIdentificacion") || "SIN_CODIGO").trim();
                let codigo = codigoRaw;
                if (esRubberActivo) {
                    codigo = normalizarCodigoRubberMolding(codigoRaw);
                }

                clavesParaVerificar.push(codigo);
                if (codigo !== codigoRaw) {
                    clavesParaVerificar.push(codigoRaw);
                }

                // Detectar tasa de impuesto del concepto en el XML (CFDI 3.3 / 4.0 Traslados)
                let tasaConcepto = 0.16; // default IVA México 16%
                try {
                    const trasladosConcepto = c.getElementsByTagNameNS("*", "Traslado");
                    if (trasladosConcepto && trasladosConcepto.length > 0) {
                        for (let t = 0; t < trasladosConcepto.length; t++) {
                            const tr = trasladosConcepto[t];
                            const tStr = tr.getAttribute("TasaOCuota");
                            if (tStr) {
                                const tVal = parseFloat(tStr);
                                if (!isNaN(tVal) && tVal >= 0) {
                                    tasaConcepto = tVal;
                                    break;
                                }
                            }
                        }
                    }
                } catch (eTax) {}
                const costoConIva = Number((costoUnitario * (1 + tasaConcepto)).toFixed(2));

                const descXml = c.getAttribute("Descripcion") || "";
                parsedItems.push({
                    codigo: codigo,
                    codigoXml: codigoRaw,
                    descripcion: descXml,
                    descripcionOriginalXml: descXml,
                    descripcionEditada: undefined,
                    haSidoEditadoManualmente: false,
                    claveSat: c.getAttribute("ClaveProdServ") || "",
                    unidad: c.getAttribute("Unidad") || c.getAttribute("ClaveUnidad") || "PZA",
                    costo: costoUnitario,
                    tasaIva: tasaConcepto,
                    costoConIva: costoConIva,
                    cantidad: cant,
                    precioPublico: costoConIva > 0 ? Number((costoConIva / 0.40).toFixed(2)) : 0,
                    precioTalleres: costoConIva > 0 ? Number((costoConIva / 0.50).toFixed(2)) : 0,
                    precioMayoreo: costoConIva > 0 ? Number((costoConIva / 0.60).toFixed(2)) : 0,
                    precioMinimo: costoConIva > 0 ? Number((costoConIva / 0.70).toFixed(2)) : 0,
                    yaExiste: false,
                    nombreMicrosip: "",
                    lineaRegistrada: esRubberActivo ? "DC" : "",
                    equivalenciaRegistrada: "",
                    costoBD: null,
                    costoBDConIva: null,
                    preciosActualesBD: null
                });
            }

            // Extracción de Impuestos y Traslados (IVA 16%, 8%, etc.)
            let totalImpuestosTrasladados = 0;
            const desgloseIva = {};

            let impuestosGlobales = null;
            for (let i = 0; i < comprobante.children.length; i++) {
                const ch = comprobante.children[i];
                if (ch.localName === 'Impuestos' || ch.tagName.endsWith('Impuestos')) {
                    impuestosGlobales = ch;
                    break;
                }
            }

            if (impuestosGlobales) {
                totalImpuestosTrasladados = parseFloat(impuestosGlobales.getAttribute("TotalImpuestosTrasladados") || "0") || 0;
                const trasladosNodes = impuestosGlobales.getElementsByTagNameNS("*", "Traslado");
                for (let i = 0; i < trasladosNodes.length; i++) {
                    const tr = trasladosNodes[i];
                    const impTipo = tr.getAttribute("Impuesto") || "002";
                    const tasaStr = tr.getAttribute("TasaOCuota") || "";
                    const importe = parseFloat(tr.getAttribute("Importe") || "0") || 0;
                    let etq = "IVA";
                    if (tasaStr) {
                        const tasaPct = Math.round(parseFloat(tasaStr) * 100);
                        etq = `IVA ${tasaPct}%`;
                    }
                    if (impTipo === "003") etq = "IEPS";
                    desgloseIva[etq] = (desgloseIva[etq] || 0) + importe;
                }
            }

            if (Object.keys(desgloseIva).length === 0) {
                const trasladosConceptos = xmlDoc.getElementsByTagNameNS("*", "Traslado");
                for (let i = 0; i < trasladosConceptos.length; i++) {
                    const tr = trasladosConceptos[i];
                    const parent = tr.parentElement;
                    if (parent && (parent.localName === 'Traslados' || parent.tagName.endsWith('Traslados'))) {
                        const impTipo = tr.getAttribute("Impuesto") || "002";
                        const tasaStr = tr.getAttribute("TasaOCuota") || "";
                        const importe = parseFloat(tr.getAttribute("Importe") || "0") || 0;
                        let etq = "IVA 16%";
                        if (tasaStr) {
                            const tasaPct = Math.round(parseFloat(tasaStr) * 100);
                            etq = `IVA ${tasaPct}%`;
                        }
                        if (impTipo === "003") etq = "IEPS";
                        desgloseIva[etq] = (desgloseIva[etq] || 0) + importe;
                        totalImpuestosTrasladados += importe;
                    }
                }
            }

            if (totalImpuestosTrasladados === 0 && (totalVal - (subtotalVal - descuentoVal)) > 0.01) {
                totalImpuestosTrasladados = Math.max(0, totalVal - (subtotalVal - descuentoVal));
                desgloseIva["IVA"] = totalImpuestosTrasladados;
            }

            // Renderizar resumen en el widget al lado del selector de archivo
            renderizarResumenXml({
                nombreArchivo: fileName || nombreArchivoXmlActual,
                serie: serieVal,
                folio: folioVal,
                moneda: monedaVal,
                totalFactura: totalArticulosFactura,
                totalLeidos: parsedItems.length,
                totalPiezas: totalPiezasFactura,
                subtotal: subtotalVal,
                descuento: descuentoVal,
                totalIva: totalImpuestosTrasladados,
                desgloseIva: desgloseIva,
                total: totalVal
            });

            folioFacturaActual = folioVal || (fileName ? fileName.split('-')[0].split('.')[0] : '');
            serieFacturaActual = serieVal || '';

            // Verificar si el archivo Excel ya existe en E:\ (para avisar al usuario antes de guardar)
            if (folioFacturaActual) {
                verificarSiExcelExisteEnE(folioFacturaActual);
            }

            actualizarProgreso(50, 'Verificando en Microsip...', `Consultando ${clavesParaVerificar.length} artículos...`);
            await renderYield();

            try {
                const res = await fetch('/api/verificar-articulos', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ claves: clavesParaVerificar })
                });
                if (res.ok) {
                    const data = await res.json();
                    const mapa = data.existentes || {};
                    parsedItems.forEach(item => {
                        const up = item.codigo.trim().toUpperCase();
                        const upXml = (item.codigoXml || item.codigo).trim().toUpperCase();
                        const info = mapa[up] || mapa[upXml];
                        if (info) {
                            item.yaExiste = true;
                            item.nombreMicrosip = info.nombre_microsip || "";
                            item.lineaRegistrada = info.linea || item.lineaRegistrada || (esRubberActivo ? "DC" : "");
                            item.equivalenciaRegistrada = info.equivalencia || "";
                            item.preciosActualesBD = info.precios || null;
                            item.preciosActualesBDSinIva = info.precios_sin_iva || null;
                            item.tasaIvaBD = info.tasa_iva || 16.0;
                            item.costoBD = info.costo_bd || null;
                            item.costoBDConIva = info.costo_bd_con_iva || (info.costo_bd ? Number((info.costo_bd * (1 + (info.tasa_iva || 16.0)/100)).toFixed(2)) : null);
                            if (info.clave_microsip) {
                                item.codigo = info.clave_microsip;
                            }
                        } else if (esRubberActivo && !item.lineaRegistrada) {
                            item.lineaRegistrada = "DC";
                        }
                    });
                }
            } catch (err) {
                console.warn(err);
            }

            renderTable();
            actualizarProgreso(100, '¡Completado!', 'Factura lista.');
            await renderYield();
            setTimeout(ocultarProgreso, 500);

            // Verificación especial exclusiva para CIOSA
            if (typeof esProveedorCiosaActivo === 'function' && esProveedorCiosaActivo()) {
                await analizarSimilaresCiosa();
            } else if (typeof ocultarPanelCiosaSimilares === 'function') {
                ocultarPanelCiosaSimilares();
            }

            if (esRubberActivo) {
                mostrarAlerta('info', 'Proveedor Rubber Molding detectado: Se aplicó la normalización de claves DC (sin ceros) para coincidir con Microsip.', 5000);
            }
        }

        // ================= CLASIFICACIÓN Y ORDENAMIENTO DE ARTÍCULOS =================
        function calcularEstadoPrecioItem(item) {
            if (!item.yaExiste) return 'nuevo'; // 1. Nuevo

            // 1. Verificación si el costo de compra en la factura (con IVA) subió respecto a BD
            const costoFacturaIva = item.costoConIva || Number(((item.costo || 0) * 1.16).toFixed(2));
            if (item.costoBDConIva && item.costoBDConIva > 0) {
                if ((costoFacturaIva - item.costoBDConIva) > 0.05) {
                    return 'subida';
                }
            }

            // 2. Verificación si los precios de venta sugeridos (para cumplir meta con IVA) son mayores que los precios actuales en BD
            const pBD = item.preciosActualesBD || {};
            const listas = [
                { nuevo: item.precioPublico, bd: pBD.publico },
                { nuevo: item.precioTalleres, bd: pBD.talleres },
                { nuevo: item.precioMayoreo, bd: pBD.mayoreo },
                { nuevo: item.precioMinimo, bd: pBD.minimo }
            ];

            let tieneSubida = false;
            for (const l of listas) {
                if (l.bd !== null && l.bd !== undefined && l.bd > 0) {
                    const dif = Number((l.nuevo - l.bd).toFixed(2));
                    if (dif > 0.05) {
                        tieneSubida = true;
                        break;
                    }
                }
            }

            if (tieneSubida) return 'subida'; // 2. Ya registrado pero con subida de precio o costo
            return 'igual'; // 3. Ya registrado sin aumento (igual o bajó)
        }

        function obtenerMaximoAumentoPrecio(item) {
            const pBD = item.preciosActualesBD || {};
            const difs = [
                (pBD.publico > 0) ? (item.precioPublico - pBD.publico) : 0,
                (pBD.talleres > 0) ? (item.precioTalleres - pBD.talleres) : 0,
                (pBD.mayoreo > 0) ? (item.precioMayoreo - pBD.mayoreo) : 0,
                (pBD.minimo > 0) ? (item.precioMinimo - pBD.minimo) : 0
            ];
            const costoFacturaIva = item.costoConIva || Number(((item.costo || 0) * 1.16).toFixed(2));
            if (item.costoBDConIva && item.costoBDConIva > 0) {
                difs.push(costoFacturaIva - item.costoBDConIva);
            }
            return Math.max(0, ...difs);
        }

        function obtenerPrioridadItem(item) {
            const estado = calcularEstadoPrecioItem(item);
            if (estado === 'nuevo') return 1;
            if (estado === 'subida') return 2;
            return 3;
        }

        function ordenarParsedItemsPrioridad() {
            if (!parsedItems || parsedItems.length <= 1) return;

            parsedItems.sort((a, b) => {
                const pA = obtenerPrioridadItem(a);
                const pB = obtenerPrioridadItem(b);
                if (pA !== pB) {
                    return pA - pB;
                }
                // Si ambos tienen subida de precios, ordenar por mayor incremento de precio primero
                if (pA === 2 && pB === 2) {
                    const maxA = obtenerMaximoAumentoPrecio(a);
                    const maxB = obtenerMaximoAumentoPrecio(b);
                    if (Math.abs(maxB - maxA) > 0.05) {
                        return maxB - maxA;
                    }
                }
                // Ordenar por clave alfanuméricamente dentro del mismo grupo
                return (a.codigo || '').localeCompare(b.codigo || '', undefined, { numeric: true, sensitivity: 'base' });
            });
        }

        window.restaurarDescOriginal = function(idx) {
            if (!parsedItems || !parsedItems[idx]) return;
            const it = parsedItems[idx];
            const orig = it.descripcionOriginalXml || it.descripcion || "";
            const inp = document.getElementById(`desc_${idx}`);
            if (inp) {
                inp.value = orig;
                it.descripcionEditada = orig;
                it.descripcion = orig;
                it.haSidoEditadoManualmente = false;
                if (typeof mostrarAlerta === 'function') {
                    mostrarAlerta('info', `Descripción original del XML restaurada para ${it.codigo}`, 2000);
                }
            }
        };

        function sincronizarDescripcionesEditadas() {
            if (!parsedItems) return;
            parsedItems.forEach((item, index) => {
                if (!item.yaExiste) {
                    const inp = document.getElementById(`desc_${index}`);
                    if (inp) {
                        const val = inp.value.trim();
                        item.descripcionEditada = val;
                        item.descripcion = val;
                    }
                }
            });
        }

        function renderTable() {
            const tbody = document.getElementById('itemsTableBody');
            tbody.innerHTML = "";
            if (parsedItems.length === 0) return;

            // Ordenamiento por prioridad solicitado:
            // 1. Nuevos al principio
            // 2. Ya registrados con aumento de precios
            // 3. Ya registrados que se quedan igual
            ordenarParsedItemsPrioridad();

            let ultimoGrupo = null;
            parsedItems.forEach((item, index) => {
                const grupoActual = obtenerPrioridadItem(item);
                if (grupoActual !== ultimoGrupo) {
                    ultimoGrupo = grupoActual;
                    const sepRow = document.createElement('tr');
                    let tituloGrupo = "";
                    let colorGrupo = "";

                    if (grupoActual === 1) {
                        const totalNuevos = parsedItems.filter(i => !i.yaExiste).length;
                        tituloGrupo = `✨ 1. Artículos Nuevos a Registrar en Catálogo (${totalNuevos} artículos)`;
                        colorGrupo = "bg-emerald-100/90 text-emerald-950 border-emerald-300 font-extrabold";
                    } else if (grupoActual === 2) {
                        const totalSubida = parsedItems.filter(i => i.yaExiste && calcularEstadoPrecioItem(i) === 'subida').length;
                        tituloGrupo = `▲ 2. Artículos Registrados con Subida de Precios (${totalSubida} artículos)`;
                        colorGrupo = "bg-rose-100/90 text-rose-950 border-rose-300 font-extrabold";
                    } else {
                        const totalIgual = parsedItems.filter(i => i.yaExiste && calcularEstadoPrecioItem(i) !== 'subida').length;
                        tituloGrupo = `✔ 3. Artículos Registrados sin Aumento / Precios Vigentes (${totalIgual} artículos)`;
                        colorGrupo = "bg-slate-200/80 text-slate-800 border-slate-300 font-bold";
                    }

                    sepRow.innerHTML = `
                        <td colspan="11" class="py-1 px-3 text-[10px] uppercase tracking-wider ${colorGrupo} border-y select-none">
                            <div class="flex items-center justify-between">
                                <span>${tituloGrupo}</span>
                                <span class="text-[9px] lowercase font-normal opacity-75">sección prioritaria</span>
                            </div>
                        </td>
                    `;
                    tbody.appendChild(sepRow);
                }

                let descMostrar = (item.yaExiste && item.nombreMicrosip) ? item.nombreMicrosip : procesarDescripcionConMarca(item.descripcion);

                let celdaDescripcionHtml = "";
                if (!item.yaExiste) {
                    const descVal = item.descripcionEditada !== undefined 
                        ? item.descripcionEditada 
                        : (procesarDescripcionConMarca(item.descripcion) || item.descripcion);
                    celdaDescripcionHtml = `
                        <div class="space-y-1 min-w-[250px]">
                            <textarea id="desc_${index}" rows="2" 
                                      oninput="parsedItems[${index}].descripcionEditada = this.value; parsedItems[${index}].descripcion = this.value; parsedItems[${index}].haSidoEditadoManualmente = true;"
                                      class="w-full text-xs font-semibold text-slate-800 bg-amber-50/70 border border-amber-300 hover:bg-white focus:bg-white focus:border-red-500 focus:ring-1 focus:ring-red-500 rounded-lg p-1.5 transition leading-snug resize-y shadow-2xs"
                                      placeholder="Descripción para alta en catálogo...">${descVal}</textarea>
                            <div class="flex items-center justify-between text-[9px] px-0.5">
                                <span class="inline-flex items-center gap-1 font-bold text-amber-800 bg-amber-100/90 px-1.5 py-0.5 rounded text-[8.5px]">
                                    ✏️ Editable para Alta
                                </span>
                                <button type="button" onclick="restaurarDescOriginal(${index})" 
                                        class="text-slate-400 hover:text-slate-700 underline text-[8.5px] cursor-pointer" 
                                        title="Restaurar a como viene en el XML original">
                                    Restaurar original
                                </button>
                            </div>
                        </div>
                    `;
                } else {
                    celdaDescripcionHtml = `
                        <div id="desc_text_${index}" class="font-medium text-slate-800 text-xs">${descMostrar}</div>
                        ${(item.descripcion && item.nombreMicrosip && item.descripcion.trim().toUpperCase() !== item.nombreMicrosip.trim().toUpperCase()) 
                            ? `<div class="text-[9.5px] text-slate-400 truncate mt-0.5" title="En XML: ${item.descripcion}">XML: ${item.descripcion}</div>` 
                            : ''}
                    `;
                }

                const upCode = item.codigo.trim().toUpperCase();
                const tieneSimilarCiosa = !!(mapaSimilaresCiosaPorCodigo[upCode] && mapaSimilaresCiosaPorCodigo[upCode].length > 0);
                const estadoPrecio = calcularEstadoPrecioItem(item);

                let badgeEstado = '';
                if (!item.yaExiste) {
                    badgeEstado = `<span class="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-black bg-emerald-100 text-emerald-800 border border-emerald-300 shadow-2xs">NVO</span>`;
                } else if (estadoPrecio === 'subida') {
                    badgeEstado = `
                        <div class="flex flex-col items-center gap-0.5">
                            <span class="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-slate-100 text-slate-700">REG</span>
                            <span class="inline-flex items-center px-1 py-0.5 rounded text-[8px] font-black bg-rose-100 text-rose-800 border border-rose-300 leading-none">▲ SUBE</span>
                        </div>
                    `;
                } else {
                    badgeEstado = `<span class="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-slate-100 text-slate-600">REG</span>`;
                }

                if (tieneSimilarCiosa) {
                    badgeEstado = `
                        <div class="flex flex-col items-center gap-1">
                            ${badgeEstado}
                            <span class="inline-flex items-center px-1.5 py-0.5 rounded text-[8.5px] font-black bg-amber-300 text-amber-950 border border-amber-400 shadow-xs" title="Tiene artículo con clave similar en Microsip">SIMILAR</span>
                        </div>
                    `;
                }

                const isChecked = !item.yaExiste ? "checked" : "";
                const pBD = item.preciosActualesBD || {};
                const badgeCiosaHtml = (typeof renderBadgeCiosaSimilares === 'function') ? renderBadgeCiosaSimilares(item.codigo) : '';

                const row = document.createElement('tr');
                if (tieneSimilarCiosa) {
                    row.className = "bg-amber-100/50 hover:bg-amber-100/80 transition border-b border-amber-300/80 border-l-4 border-l-amber-500 font-medium";
                } else if (!item.yaExiste) {
                    row.className = "bg-emerald-50/25 hover:bg-emerald-50/50 transition border-b border-slate-100 border-l-4 border-l-emerald-500";
                } else if (estadoPrecio === 'subida') {
                    row.className = "bg-rose-50/25 hover:bg-rose-50/50 transition border-b border-slate-100 border-l-4 border-l-rose-500";
                } else {
                    row.className = "hover:bg-slate-50 transition border-b border-slate-100 border-l-4 border-l-slate-200";
                }

                const costoFacturaIva = item.costoConIva || Number(((item.costo || 0) * 1.16).toFixed(2));
                let celdaCostoFacturaHtml = `
                    <div class="text-[11.5px] font-black text-slate-900 font-mono leading-tight">${formatearMoneda(costoFacturaIva)}</div>
                    <div class="text-[8.5px] font-semibold text-slate-400 font-mono mt-0.5 leading-tight" title="Precio unitario neto de la factura sin IVA">s/IVA: ${formatearMoneda(item.costo)}</div>
                `;
                if (item.costoBDConIva && item.costoBDConIva > 0) {
                    const difCosto = Number((costoFacturaIva - item.costoBDConIva).toFixed(2));
                    let badgeCosto = '';
                    if (difCosto > 0.05) {
                        const pctSubio = ((difCosto / item.costoBDConIva) * 100).toFixed(1);
                        badgeCosto = `<span class="inline-flex items-center text-[8px] font-black text-rose-700 bg-rose-100/90 px-1 py-0.2 rounded mt-0.5 leading-none">▲ +${pctSubio}% vs BD</span>`;
                    } else if (difCosto < -0.05) {
                        const pctBajo = ((-difCosto / item.costoBDConIva) * 100).toFixed(1);
                        badgeCosto = `<span class="inline-flex items-center text-[8px] font-black text-emerald-700 bg-emerald-100/90 px-1 py-0.2 rounded mt-0.5 leading-none">▼ -${pctBajo}% vs BD</span>`;
                    } else {
                        badgeCosto = `<span class="inline-flex items-center text-[8px] font-bold text-slate-500 bg-slate-100 px-1 py-0.2 rounded mt-0.5 leading-none">= Mismo costo</span>`;
                    }
                    celdaCostoFacturaHtml += `
                        <div class="text-[8px] text-slate-500 border-t border-slate-200 mt-1 pt-0.5 leading-none" title="Último costo de compra registrado en base de datos con IVA">
                            BD: <span class="font-bold text-slate-700 font-mono">${formatearMoneda(item.costoBDConIva)}</span>
                        </div>
                        <div class="leading-none mt-0.5">${badgeCosto}</div>
                    `;
                }

                row.innerHTML = `
                    <td class="p-2.5 text-center align-middle">
                        <input type="checkbox" id="item_check_${index}" ${isChecked} class="item-checkbox w-3.5 h-3.5 text-red-600 rounded border-slate-300 focus:ring-red-500 cursor-pointer" onchange="actualizarContadorSeleccionados()">
                    </td>
                    <td class="p-2.5 text-center align-middle">${badgeEstado}</td>
                    <td class="p-2.5 align-middle">
                        <div class="font-mono font-bold text-slate-800 text-xs">${item.codigo}</div>
                        ${(item.codigoXml && item.codigoXml !== item.codigo) ? `<div class="font-mono text-[9px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-1 mt-0.5 inline-block" title="Código original en la factura XML">XML: ${item.codigoXml}</div>` : ''}
                        <div class="font-mono text-[10px] text-slate-400">SAT: ${item.claveSat}</div>
                        ${badgeCiosaHtml}
                    </td>
                    <td class="p-2.5 text-desc wrap-desc leading-tight align-middle min-w-[240px]">${celdaDescripcionHtml}</td>
                    <td class="p-2.5 align-middle">
                        <select id="linea_${index}" class="linea-select border border-slate-200 rounded-lg px-2 py-1 text-[11px] bg-slate-50 focus:ring-1 focus:ring-red-500 w-full text-slate-800">
                            ${obtenerOptionsLineas(item.lineaRegistrada)}
                        </select>
                    </td>
                    <td class="p-2.5 bg-red-50/20 align-middle">
                        <input type="text" id="equiv_${index}" list="dlEquivalencias" value="${item.equivalenciaRegistrada || ''}" placeholder="Cód. equivalente" 
                               oninput="this.value = this.value.toUpperCase(); buscarEquivalenciasEnServidor(this)"
                               class="border border-red-200 rounded-lg px-2 py-1 text-[11px] w-full bg-white focus:ring-1 focus:ring-red-500 font-mono font-semibold text-slate-800 placeholder-slate-400">
                    </td>
                    <td class="p-2.5 text-right font-mono bg-slate-50 align-middle">${celdaCostoFacturaHtml}</td>
                    <td class="p-1.5 align-middle">${renderCeldaSemaforo(item.precioPublico, pBD.publico, costoFacturaIva, 60)}</td>
                    <td class="p-1.5 align-middle">${renderCeldaSemaforo(item.precioTalleres, pBD.talleres, costoFacturaIva, 50)}</td>
                    <td class="p-1.5 align-middle">${renderCeldaSemaforo(item.precioMayoreo, pBD.mayoreo, costoFacturaIva, 40)}</td>
                    <td class="p-1.5 align-middle">${renderCeldaSemaforo(item.precioMinimo, pBD.minimo, costoFacturaIva, 30)}</td>
                `;
                tbody.appendChild(row);
            });

            actualizarContadorSeleccionados();
            document.getElementById('tableContainer').classList.remove('hidden');
        }

        function buscarEquivalenciasEnServidor(input) {
            const txt = input.value.trim();
            if (txt.length < 2) return;
            clearTimeout(timerBusquedaEquiv);
            timerBusquedaEquiv = setTimeout(async () => {
                try {
                    const res = await fetch(`/api/buscar-articulos-equivalencia?q=${encodeURIComponent(txt)}`);
                    const items = await res.json();
                    const datalist = document.getElementById('dlEquivalencias');
                    datalist.innerHTML = '';
                    items.forEach(art => {
                        const opt = document.createElement('option');
                        opt.value = art.clave;
                        opt.label = `${art.clave} - ${art.nombre}`;
                        datalist.appendChild(opt);
                    });
                } catch(e) {}
            }, 200);
        }

        document.getElementById('chkSelectAll').addEventListener('change', function() {
            document.querySelectorAll('.item-checkbox').forEach(cb => cb.checked = this.checked);
            actualizarContadorSeleccionados();
        });

        function actualizarContadorSeleccionados() {
            const seleccionados = Array.from(document.querySelectorAll('.item-checkbox')).filter(cb => cb.checked).length;
            const nuevos = parsedItems.filter(i => !i.yaExiste).length;
            const conAumento = parsedItems.filter(i => i.yaExiste && calcularEstadoPrecioItem(i) === 'subida').length;
            const sinCambio = parsedItems.filter(i => i.yaExiste && calcularEstadoPrecioItem(i) !== 'subida').length;
            const totalSimilares = Object.keys(mapaSimilaresCiosaPorCodigo || {}).length;

            let detalle = `<strong class="text-emerald-700">${nuevos} nuevos</strong>, <strong class="text-rose-700">${conAumento} con aumento ▲</strong>, <span class="text-slate-600">${sinCambio} sin aumento</span>`;
            if (totalSimilares > 0) {
                detalle += `, <strong class="text-amber-900 bg-amber-200/90 px-1.5 py-0.5 rounded border border-amber-300">⚡ ${totalSimilares} similares CIOSA</strong>`;
            }

            const elRes = document.getElementById('resumenTotales');
            if (elRes) {
                elRes.innerHTML = `${seleccionados} de ${parsedItems.length} seleccionados (${detalle})`;
            }
            document.getElementById('chkSelectAll').checked = (seleccionados > 0 && seleccionados === parsedItems.length);
        }

        window.seleccionarPorGrupo = function(tipo) {
            parsedItems.forEach((it, idx) => {
                const cb = document.getElementById(`item_check_${idx}`);
                if (!cb) return;
                if (tipo === 'todos') {
                    cb.checked = true;
                } else if (tipo === 'ninguno') {
                    cb.checked = false;
                } else if (tipo === 'nuevos') {
                    cb.checked = !it.yaExiste;
                } else if (tipo === 'subida') {
                    cb.checked = it.yaExiste && (calcularEstadoPrecioItem(it) === 'subida');
                }
            });
            actualizarContadorSeleccionados();
        };

        document.getElementById('chkMoverMarca').addEventListener('change', () => {
            parsedItems.forEach((item, index) => {
                if (item.yaExiste) {
                    const el = document.getElementById(`desc_text_${index}`);
                    if (el) {
                        el.textContent = (item.yaExiste && item.nombreMicrosip) ? item.nombreMicrosip : procesarDescripcionConMarca(item.descripcion);
                    }
                } else {
                    const inp = document.getElementById(`desc_${index}`);
                    if (inp && !item.haSidoEditadoManualmente) {
                        const nuevaDesc = procesarDescripcionConMarca(item.descripcionOriginalXml || item.descripcion);
                        inp.value = nuevaDesc;
                        item.descripcionEditada = nuevaDesc;
                        item.descripcion = nuevaDesc;
                    }
                }
            });
        });

        document.getElementById('btnAplicarGlobal').addEventListener('click', () => {
            const val = document.getElementById('lineaGlobal').value;
            if (!val) { mostrarAlerta('error', 'Selecciona una línea general primero.'); return; }
            parsedItems.forEach((_, index) => {
                const cb = document.getElementById(`item_check_${index}`);
                if (cb && cb.checked) {
                    const s = document.getElementById(`linea_${index}`);
                    if (s) s.value = val;
                }
            });
        });

        document.getElementById('btnExport').addEventListener('click', function() {
            sincronizarDescripcionesEditadas();
            let lineas = [];
            for (let i = 0; i < parsedItems.length; i++) {
                const cb = document.getElementById(`item_check_${i}`);
                if (!cb || !cb.checked) continue;
                const l = document.getElementById(`linea_${i}`).value;
                const item = parsedItems[i];
                if (!l) { mostrarAlerta('error', `Falta línea al artículo: ${item.codigo}`); return; }
                
                let desc = "";
                if (!item.yaExiste) {
                    const inp = document.getElementById(`desc_${i}`);
                    desc = inp ? inp.value.trim() : (item.descripcionEditada || item.descripcion || "");
                } else {
                    desc = (item.yaExiste && item.nombreMicrosip) ? item.nombreMicrosip : procesarDescripcionConMarca(item.descripcion);
                }
                
                lineas.push(`"${item.codigo}","${desc.replace(/"/g, '""')}","S","${l}","${item.unidad || 'PZA'}","${item.unidad || 'PZA'}",1,"${item.claveSat}","2"`);
            }
            if (!lineas.length) { mostrarAlerta('error', 'Selecciona al menos un artículo.'); return; }
            const blob = new Blob([lineas.join('\r\n')], { type: 'text/plain;charset=utf-8' });
            const link = document.createElement("a");
            link.href = URL.createObjectURL(blob);
            link.download = `importacion_articulos.txt`;
            link.click();
            mostrarAlerta('success', `Archivo TXT generado exitosamente con ${lineas.length} artículos.`);
        });

        document.getElementById('btnSyncPreciosBD').addEventListener('click', async function() {
            const items = [];
            parsedItems.forEach((it, idx) => {
                const cb = document.getElementById(`item_check_${idx}`);
                if (cb && cb.checked) {
                    items.push({ clave: it.codigo, precioPublico: it.precioPublico, precioTalleres: it.precioTalleres, precioMayoreo: it.precioMayoreo, precioMinimo: it.precioMinimo });
                }
            });
            if (!items.length) { mostrarAlerta('error', 'Selecciona artículos para sincronizar.'); return; }
            if (!confirm(`¿Sincronizar precios de ${items.length} artículos? Solo subirán los que aumenten.`)) return;

            actualizarProgreso(50, 'Actualizando en Microsip...', '', 'bg-emerald-600');
            const res = await fetch('/api/actualizar-precios', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ articulos: items }) });
            const d = await res.json();
            actualizarProgreso(100, 'Listo', '', 'bg-emerald-600');
            mostrarAlerta('success', `Precios sincronizados: ${d.actualizados || 0} actualizados, ${d.insertados || 0} nuevos creados.`);
            setTimeout(ocultarProgreso, 2000);
        });

        document.getElementById('btnSyncEquivalenciasBD').addEventListener('click', async function() {
            const eq = [];
            parsedItems.forEach((it, idx) => {
                const cb = document.getElementById(`item_check_${idx}`);
                const inp = document.getElementById(`equiv_${idx}`);
                if (cb && cb.checked && inp && inp.value.trim()) {
                    eq.push({ clave: it.codigo, equivalencia: inp.value.trim().toUpperCase() });
                }
            });
            if (!eq.length) { mostrarAlerta('error', 'No hay artículos seleccionados con código equivalente.'); return; }
            const res = await fetch('/api/actualizar-equivalencias', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ articulos: eq }) });
            const d = await res.json();
            mostrarAlerta('success', `Equivalencias guardadas: ${d.actualizados || 0} actualizadas en Microsip.`);
        });

        document.getElementById('btnExportExcelNuevos').addEventListener('click', async function() {
            sincronizarDescripcionesEditadas();
            const itemsNuevos = parsedItems.filter(i => !i.yaExiste);
            if (!itemsNuevos.length) { mostrarAlerta('error', 'No hay artículos nuevos en esta factura.'); return; }
            const selectProv = document.getElementById('selectProveedor');
            const nomProv = selectProv.selectedIndex >= 0 ? selectProv.options[selectProv.selectedIndex].text.replace(/\[.*?\]\s*/g, '').trim() : "NIKKO";

            actualizarProgreso(50, 'Generando archivo Excel...', '', 'bg-blue-600');
            const payload = itemsNuevos.map(i => {
                const descFinal = (i.descripcionEditada !== undefined && i.descripcionEditada.trim()) 
                    ? i.descripcionEditada.trim() 
                    : (procesarDescripcionConMarca(i.descripcion) || i.descripcion);
                return { 
                    codigo: i.codigo, 
                    descripcion: descFinal, 
                    costo: i.costo 
                };
            });
            const res = await fetch('/api/exportar-excel-nuevos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ articulos: payload, proveedor: nomProv }) });
            const blob = await res.blob();
            const a = document.createElement('a');
            a.href = window.URL.createObjectURL(blob);
            a.download = `PRECIOS_NUEVOS_${nomProv.replace(/\s+/g, '_')}.xlsx`;
            a.click();
            ocultarProgreso();
            mostrarAlerta('success', `Archivo Excel descargado con ${itemsNuevos.length} artículos nuevos y fórmulas vivas.`);
        });

        // ================= EXPORTACIÓN MANUAL A EXCEL DE FACTURA (E:\) =================
        let callbackConfirmacionSobreescritura = null;

        function preguntarSobreescrituraExcel(datosArchivo) {
            return new Promise((resolve) => {
                const modal = document.getElementById('modalConfirmarSobreescritura');
                const txt = document.getElementById('modalSobreescrituraTexto');
                const det = document.getElementById('modalSobreescrituraDetalles');

                if (txt) {
                    txt.innerHTML = `<strong>${datosArchivo.ruta_e}</strong> ya existe.<br><br>¿Desea reemplazarlo?`;
                }
                if (det) {
                    det.innerHTML = `
                        <div>• Fecha en disco: <strong>${datosArchivo.fecha_mod || 'Previamente creado'}</strong></div>
                        <div>• Tamaño: <strong>${datosArchivo.tamano_kb || 0} KB</strong></div>
                    `;
                }

                callbackConfirmacionSobreescritura = (acepta) => {
                    if (modal) modal.classList.add('hidden');
                    callbackConfirmacionSobreescritura = null;
                    resolve(acepta);
                };

                if (modal) {
                    modal.classList.remove('hidden');
                    const btnNo = document.getElementById('btnModalNoSobreescribir');
                    if (btnNo) setTimeout(() => btnNo.focus(), 100);
                } else {
                    const r = window.confirm(`${datosArchivo.ruta_e} ya existe.\n\n¿Desea reemplazarlo?`);
                    resolve(r);
                }
            });
        }

        window.resolverSobreescritura = function(acepta) {
            if (callbackConfirmacionSobreescritura) {
                callbackConfirmacionSobreescritura(acepta);
            }
        };

        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                const modalSob = document.getElementById('modalConfirmarSobreescritura');
                if (modalSob && !modalSob.classList.contains('hidden')) {
                    resolverSobreescritura(false);
                }
            }
        });

        async function verificarSiExcelExisteEnE(folio) {
            if (!folio) return;
            try {
                const res = await fetch(`/api/compras/verificar-excel-factura?folio=${encodeURIComponent(folio)}`);
                const data = await res.json();
                const avisoBox = document.getElementById('avisoExcelGuardadoE');
                const txtAviso = document.getElementById('txtAvisoExcelE');
                const linkDesc = document.getElementById('linkDescargarExcelE');

                if (data.existe) {
                    if (avisoBox && txtAviso) {
                        avisoBox.className = "p-1.5 px-2.5 bg-amber-50 border border-amber-200 rounded-xl text-[10px] font-bold text-amber-900 flex items-center justify-between";
                        txtAviso.innerHTML = `⚠️ <strong>${data.nombre_archivo}</strong> ya existe en E:\\ (${data.fecha_mod || ''})`;
                        if (linkDesc) {
                            linkDesc.href = `/api/compras/descargar-excel-factura/${encodeURIComponent(data.nombre_archivo)}`;
                            linkDesc.className = "ml-2 px-2 py-0.5 bg-amber-600 hover:bg-amber-700 text-white rounded-md text-[9px] font-extrabold transition flex-shrink-0";
                        }
                        avisoBox.classList.remove('hidden');
                    }
                } else {
                    if (avisoBox) avisoBox.classList.add('hidden');
                }
            } catch (e) {
                console.error("Error al verificar archivo en E:\\:", e);
            }
        }

        async function guardarExcelFacturaEnE(folioParam, itemsParam, sobrescribir = false) {
            sincronizarDescripcionesEditadas();
            const folio = folioParam || folioFacturaActual || (nombreArchivoXmlActual ? nombreArchivoXmlActual.split('-')[0].split('.')[0] : '');
            const items = itemsParam || parsedItems || [];

            if (!items.length) {
                mostrarAlerta('error', 'No hay conceptos leídos para exportar a Excel. Carga primero una factura XML.');
                return;
            }

            const partidas = items.map(it => {
                let nombreFinal = it.descripcion || "";
                if (!it.yaExiste && it.descripcionEditada !== undefined && it.descripcionEditada.trim()) {
                    nombreFinal = it.descripcionEditada.trim();
                } else if (it.yaExiste && it.nombreMicrosip) {
                    nombreFinal = it.nombreMicrosip;
                }
                return {
                    clave: it.codigo,
                    nombre: nombreFinal,
                    unidades: it.cantidad || 1,
                    precio: it.costo || 0.0
                };
            });

            try {
                actualizarProgreso(35, 'Generando archivo Excel...', 'Verificando en E:\\...');

                const res = await fetch('/api/compras/generar-excel-factura', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        folio: folio, 
                        partidas: partidas, 
                        sobrescribir: sobrescribir 
                    })
                });
                const data = await res.json();
                ocultarProgreso();

                // Si el archivo ya existe y el usuario aún no había confirmado sobreescribir
                if (data.ya_existe) {
                    const quiereSobreescribir = await preguntarSobreescrituraExcel(data);
                    if (quiereSobreescribir) {
                        return await guardarExcelFacturaEnE(folio, items, true);
                    } else {
                        mostrarAlerta('info', `Operación cancelada. Se conservó el archivo existente en: <strong>${data.ruta_e}</strong> (creado previamente el ${data.fecha_mod}).`, 7000);
                        return;
                    }
                }

                if (!res.ok || !data.success) {
                    throw new Error(data.error || 'Error al generar Excel');
                }

                // Actualizar aviso visual en el widget de resumen fiscal
                const avisoBox = document.getElementById('avisoExcelGuardadoE');
                const txtAviso = document.getElementById('txtAvisoExcelE');
                const linkDesc = document.getElementById('linkDescargarExcelE');
                if (avisoBox && txtAviso) {
                    avisoBox.className = "p-1.5 px-2.5 bg-emerald-50 border border-emerald-200 rounded-xl text-[10px] font-bold text-emerald-800 flex items-center justify-between";
                    avisoBox.classList.remove('hidden');
                    txtAviso.textContent = data.guardado_en_e 
                        ? `${data.sobrescrito ? 'Reemplazado en' : 'Guardado en'} E:\\${data.nombre_archivo} (${data.total_partidas} arts)` 
                        : `${data.mensaje} (${data.total_partidas} arts)`;
                    if (linkDesc) {
                        linkDesc.href = `/api/compras/descargar-excel-factura/${encodeURIComponent(data.nombre_archivo)}`;
                        linkDesc.className = "ml-2 px-2 py-0.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-md text-[9px] font-extrabold transition flex-shrink-0";
                    }
                }

                mostrarAlerta('success', `
                    <div class="flex flex-col sm:flex-row items-center justify-between gap-3">
                        <span>✅ Archivo Excel ${data.sobrescrito ? '<strong>reemplazado / sobrescrito</strong>' : 'guardado'} con éxito en: <strong>${data.ruta_e}</strong> (${data.total_partidas} artículos).</span>
                        <a href="/api/compras/descargar-excel-factura/${encodeURIComponent(data.nombre_archivo)}" download class="px-3 py-1 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-xs font-bold transition shadow-xs flex-shrink-0">Descargar copia</a>
                    </div>
                `, 6000);
                return data;
            } catch (err) {
                ocultarProgreso();
                console.error("Error al guardar Excel en E:\\:", err);
                mostrarAlerta('error', `Error al generar Excel en E:\\: ${err.message}`);
            }
        }

        function generarExcelFacturaActual() {
            guardarExcelFacturaEnE(folioFacturaActual, parsedItems, false);
        }

// ================= MÓDULO COMPRAS: VALIDACIÓN Y AUTORIZACIÓN DE TRASPASOS (PV) =================

let _solicitudesComprasData = [];
let _filtroActualSolicitudes = 'PENDIENTE_COMPRAS';

async function comprasActualizarContadorPendientes() {
    try {
        const res = await fetch('/api/compras/solicitudes-traspasos/conteo-pendientes');
        const data = await res.json();
        if (data.success) {
            const cnt = data.pendientes || 0;
            const badgeSidebar = document.getElementById('badgeComprasSolicitudesPendientes');
            const badgeCard = document.getElementById('badgeCardComprasSolPendientes');
            const cntEl = document.getElementById('cntComprasSolPendientes');

            if (badgeSidebar) {
                badgeSidebar.textContent = cnt;
                if (cnt > 0) badgeSidebar.classList.remove('hidden');
                else badgeSidebar.classList.add('hidden');
            }
            if (badgeCard) {
                badgeCard.textContent = `${cnt} Pendiente${cnt === 1 ? '' : 's'}`;
                if (cnt > 0) {
                    badgeCard.className = "text-[10px] font-black text-amber-800 bg-amber-100 px-2.5 py-0.5 rounded-full border border-amber-200 animate-pulse";
                } else {
                    badgeCard.className = "text-[10px] font-bold text-slate-500 bg-slate-100 px-2.5 py-0.5 rounded-full border border-slate-200";
                }
            }
            if (cntEl) cntEl.textContent = cnt;
        }
    } catch (e) {
        console.error("Error al obtener conteo de solicitudes pendientes:", e);
    }
}

async function comprasCargarSolicitudesTraspasos() {
    const tbody = document.getElementById('tbodyComprasSolicitudesTraspasos');
    if (tbody) {
        tbody.innerHTML = '<tr><td colspan="9" class="p-8 text-center text-slate-400 italic">Cargando solicitudes desde el servidor...</td></tr>';
    }

    try {
        const res = await fetch('/api/compras/solicitudes-traspasos?estatus=TODAS');
        const data = await res.json();
        if (data.success) {
            _solicitudesComprasData = data.solicitudes || [];
            comprasActualizarResumenConteos();
            comprasRenderizarTablaSolicitudes();
        } else {
            if (tbody) tbody.innerHTML = `<tr><td colspan="9" class="p-6 text-center text-rose-500 font-bold">${data.error || 'Error al cargar solicitudes'}</td></tr>`;
        }
    } catch (e) {
        if (tbody) tbody.innerHTML = `<tr><td colspan="9" class="p-6 text-center text-rose-500 font-bold">Error de conexión: ${e.message}</td></tr>`;
    }
}

function comprasActualizarResumenConteos() {
    const pend = _solicitudesComprasData.filter(s => s.estatus === 'PENDIENTE_COMPRAS').length;
    const aprob = _solicitudesComprasData.filter(s => s.estatus === 'APROBADA').length;
    const rech = _solicitudesComprasData.filter(s => s.estatus === 'RECHAZADA').length;

    const elP = document.getElementById('cntComprasSolPendientes');
    const elA = document.getElementById('cntComprasSolAprobadas');
    const elR = document.getElementById('cntComprasSolRechazadas');
    if (elP) elP.textContent = pend;
    if (elA) elA.textContent = aprob;
    if (elR) elR.textContent = rech;

    const badgeSidebar = document.getElementById('badgeComprasSolicitudesPendientes');
    if (badgeSidebar) {
        badgeSidebar.textContent = pend;
        if (pend > 0) badgeSidebar.classList.remove('hidden');
        else badgeSidebar.classList.add('hidden');
    }
    const badgeCard = document.getElementById('badgeCardComprasSolPendientes');
    if (badgeCard) {
        badgeCard.textContent = `${pend} Pendiente${pend === 1 ? '' : 's'}`;
    }
}

function comprasFiltrarSolicitudes(filtro) {
    _filtroActualSolicitudes = filtro;
    const btns = {
        'PENDIENTE_COMPRAS': document.getElementById('btnFiltroSolPendientes'),
        'APROBADA': document.getElementById('btnFiltroSolAprobadas'),
        'RECHAZADA': document.getElementById('btnFiltroSolRechazadas'),
        'TODAS': document.getElementById('btnFiltroSolTodas')
    };

    for (const [k, b] of Object.entries(btns)) {
        if (b) {
            if (k === filtro) {
                b.className = "px-3.5 py-1.5 rounded-xl text-xs font-black transition cursor-pointer bg-amber-500 text-white shadow-xs";
            } else {
                b.className = "px-3.5 py-1.5 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 transition cursor-pointer";
            }
        }
    }
    comprasRenderizarTablaSolicitudes();
}

function comprasRenderizarTablaSolicitudes() {
    const tbody = document.getElementById('tbodyComprasSolicitudesTraspasos');
    if (!tbody) return;

    let filtradas = _solicitudesComprasData;
    if (_filtroActualSolicitudes !== 'TODAS') {
        filtradas = _solicitudesComprasData.filter(s => s.estatus === _filtroActualSolicitudes);
    }

    if (filtradas.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" class="p-8 text-center text-slate-400 italic">No hay solicitudes registradas con este filtro.</td></tr>`;
        return;
    }

    tbody.innerHTML = filtradas.map(s => {
        let estatusBadge = '';
        if (s.estatus === 'PENDIENTE_COMPRAS') {
            estatusBadge = '<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black bg-amber-100 text-amber-800 border border-amber-200">⏳ Pendiente</span>';
        } else if (s.estatus === 'APROBADA') {
            estatusBadge = '<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-800 border border-emerald-200">✓ Aprobada</span>';
        } else if (s.estatus === 'RECHAZADA') {
            estatusBadge = '<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black bg-rose-100 text-rose-800 border border-rose-200">✕ Rechazada</span>';
        }

        const stockCedisClass = s.stock_suficiente_cedis ? 'text-emerald-700 bg-emerald-50 border-emerald-200' : 'text-rose-700 bg-rose-50 border-rose-200';

        let accionesHtml = '';
        if (s.estatus === 'PENDIENTE_COMPRAS') {
            accionesHtml = `
                <div class="flex items-center justify-end gap-1.5">
                    <button type="button" onclick="comprasAutorizarSolicitud(${s.id}, '${s.folio}')"
                            class="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-bold text-xs rounded-xl shadow-xs transition cursor-pointer flex items-center gap-1"
                            title="Autorizar solicitud para traspaso">
                        <span>✓</span>
                        <span>Aprobar</span>
                    </button>
                    <button type="button" onclick="comprasRechazarSolicitud(${s.id}, '${s.folio}')"
                            class="px-2.5 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-bold text-xs rounded-xl transition cursor-pointer"
                            title="Rechazar solicitud">
                        <span>✕</span>
                        <span>Rechazar</span>
                    </button>
                </div>
            `;
        } else if (s.estatus === 'APROBADA') {
            accionesHtml = `
                <div class="text-right text-[10px] text-slate-500 font-medium">
                    <div class="font-bold text-emerald-700">Autorizado por: ${s.autorizado_por || 'Compras'}</div>
                    <div class="text-[9px] text-slate-400">${s.fecha_autorizacion || ''}</div>
                </div>
            `;
        } else {
            accionesHtml = `
                <div class="text-right text-[10px] text-slate-500 font-medium max-w-xs ml-auto">
                    <div class="font-bold text-rose-700">Rechazado: ${s.autorizado_por || 'Compras'}</div>
                    <div class="text-[9px] text-rose-600 italic truncate" title="${s.motivo_rechazo}">${s.motivo_rechazo || ''}</div>
                </div>
            `;
        }

        return `
            <tr class="hover:bg-slate-50/80 transition">
                <td class="py-3 px-3">
                    <div class="font-mono font-black text-indigo-700 text-xs">${s.folio}</div>
                    <div class="text-[10px] text-slate-400 font-medium mt-0.5">${s.fecha}</div>
                </td>
                <td class="py-3 px-3">
                    <div class="font-bold text-slate-900">${s.sucursal_destino}</div>
                    <div class="text-[10px] text-slate-500">${s.vendedor || s.solicitado_por}</div>
                </td>
                <td class="py-3 px-3">
                    <div class="font-mono font-bold text-slate-800">${s.clave}</div>
                    <div class="text-[11px] text-slate-600 line-clamp-1" title="${s.nombre}">${s.nombre}</div>
                </td>
                <td class="py-3 px-3 text-center">
                    <span class="inline-block text-sm font-black text-slate-900 bg-slate-100 px-2 py-0.5 rounded-lg border border-slate-200">${s.cantidad}</span>
                </td>
                <td class="py-3 px-3 text-center">
                    <span class="inline-block px-2 py-0.5 rounded-lg text-xs font-black border ${stockCedisClass}" title="Existencia actual en CEDIS">
                        ${s.stock_cedis_actual} pzas
                    </span>
                </td>
                <td class="py-3 px-3 text-center">
                    <span class="text-xs font-bold text-slate-600">${s.stock_destino_actual} pzas</span>
                </td>
                <td class="py-3 px-3">
                    ${s.cliente ? `<div class="font-semibold text-slate-800 text-[11px]">👤 ${s.cliente}</div>` : ''}
                    ${s.notas ? `<div class="text-[10px] text-slate-500 italic line-clamp-1" title="${s.notas}">📝 ${s.notas}</div>` : '<span class="text-slate-300">-</span>'}
                </td>
                <td class="py-3 px-3 text-center">
                    ${estatusBadge}
                </td>
                <td class="py-3 px-3 text-right">
                    ${accionesHtml}
                </td>
            </tr>
        `;
    }).join('');
}

async function comprasAutorizarSolicitud(id, folio) {
    if (!confirm(`¿Confirmas autorizar el traspaso para la solicitud ${folio}? Se marcará como autorizada para su preparación y surtido.`)) {
        return;
    }

    try {
        const res = await fetch(`/api/compras/solicitudes-traspasos/${id}/autorizar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        const data = await res.json();
        if (data.success) {
            alert(`✓ ${data.mensaje}`);
            comprasCargarSolicitudesTraspasos();
        } else {
            alert(`Error: ${data.error || 'No se pudo autorizar'}`);
        }
    } catch (e) {
        alert(`Error al procesar: ${e.message}`);
    }
}

async function comprasRechazarSolicitud(id, folio) {
    const motivo = prompt(`Ingresa el motivo de rechazo para la solicitud ${folio}:`);
    if (!motivo || !motivo.trim()) {
        return;
    }

    try {
        const res = await fetch(`/api/compras/solicitudes-traspasos/${id}/rechazar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ motivo: motivo.trim() })
        });
        const data = await res.json();
        if (data.success) {
            alert(`✓ ${data.mensaje}`);
            comprasCargarSolicitudesTraspasos();
        } else {
            alert(`Error: ${data.error || 'No se pudo rechazar'}`);
        }
    } catch (e) {
        alert(`Error al procesar: ${e.message}`);
    }
}

// Al cargar compras, actualizar contador de solicitudes pendientes
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(comprasActualizarContadorPendientes, 1500);
});

window.comprasActualizarContadorPendientes = comprasActualizarContadorPendientes;
window.comprasCargarSolicitudesTraspasos = comprasCargarSolicitudesTraspasos;
window.comprasFiltrarSolicitudes = comprasFiltrarSolicitudes;
window.comprasAutorizarSolicitud = comprasAutorizarSolicitud;
window.comprasRechazarSolicitud = comprasRechazarSolicitud;

// ================= REPORTE DE VENTAS PERDIDAS (DEMANDA INSATISFECHA) =================
let listaVentasPerdidasMemoria = [];

async function abrirReporteVentasPerdidasCompras() {
    const modal = document.getElementById('modalReporteVentasPerdidasCompras');
    if (modal) {
        modal.classList.remove('hidden');
        await cargarReporteVentasPerdidasCompras();
    }
}

function cerrarReporteVentasPerdidasCompras() {
    const modal = document.getElementById('modalReporteVentasPerdidasCompras');
    if (modal) modal.classList.add('hidden');
}

async function cargarReporteVentasPerdidasCompras() {
    const tbody = document.getElementById('tbodyReporteVentasPerdidas');
    if (tbody) tbody.innerHTML = '<tr><td colspan="8" class="p-8 text-center text-slate-400 font-medium">Cargando reporte de ventas perdidas...</td></tr>';

    try {
        const res = await fetch('/api/compras/ventas-perdidas');
        const data = await res.json();
        if (!data.success) {
            if (tbody) tbody.innerHTML = `<tr><td colspan="8" class="p-8 text-center text-rose-500 font-medium">Error: ${data.error || 'No se pudo cargar'}</td></tr>`;
            return;
        }

        listaVentasPerdidasMemoria = data.ventas_perdidas || [];

        // Actualizar KPIs
        const resumen = data.resumen || {};
        const kpiRegs = document.getElementById('vpKpiTotalRegistros');
        const kpiPzas = document.getElementById('vpKpiTotalPzas');
        const kpiImp = document.getElementById('vpKpiTotalImporte');
        const kpiMot = document.getElementById('vpKpiMotivoTop');

        if (kpiRegs) kpiRegs.textContent = Number(resumen.total_registros || 0).toLocaleString('es-MX');
        if (kpiPzas) kpiPzas.textContent = `${Number(resumen.total_piezas || 0).toLocaleString('es-MX')} pzas`;
        if (kpiImp) kpiImp.textContent = `$${Number(resumen.total_importe || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })}`;
        
        // Determinar motivo top
        const motivosMap = resumen.por_motivo || {};
        const topMotivo = Object.entries(motivosMap).sort((a,b) => b[1] - a[1])[0];
        if (kpiMot) kpiMot.textContent = topMotivo ? `${topMotivo[0]} (${topMotivo[1]})` : 'Sin registros';

        filtrarTablaVentasPerdidas();
    } catch (e) {
        if (tbody) tbody.innerHTML = `<tr><td colspan="8" class="p-8 text-center text-rose-500 font-medium">Error de conexión: ${e.message}</td></tr>`;
    }
}

function filtrarTablaVentasPerdidas() {
    const q = (document.getElementById('vpFiltroBusqueda')?.value || '').trim().toLowerCase();
    const motivoFiltro = (document.getElementById('vpFiltroMotivo')?.value || '').trim().toLowerCase();

    const filtrados = listaVentasPerdidasMemoria.filter(v => {
        const matchQ = !q || (v.clave_articulo || '').toLowerCase().includes(q)
            || (v.articulo_nombre || '').toLowerCase().includes(q)
            || (v.sucursal_id || '').toLowerCase().includes(q)
            || (v.vendedor_id || '').toLowerCase().includes(q);
        
        const matchMotivo = !motivoFiltro || (v.motivo || '').toLowerCase().includes(motivoFiltro);
        return matchQ && matchMotivo;
    });

    renderizarTablaVentasPerdidas(filtrados);
}

function renderizarTablaVentasPerdidas(items) {
    const tbody = document.getElementById('tbodyReporteVentasPerdidas');
    const conteo = document.getElementById('vpConteoFiltrados');
    if (conteo) conteo.textContent = `${items.length} registros mostrados`;

    if (!tbody) return;
    if (items.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="p-8 text-center text-slate-400 font-medium">No hay ventas perdidas registradas con los criterios seleccionados.</td></tr>';
        return;
    }

    tbody.innerHTML = items.map(it => {
        const pz = Number(it.cantidad || 1);
        const precio = Number(it.precio_estimado || 0);
        return `
            <tr class="hover:bg-slate-50 transition border-b border-slate-100">
                <td class="p-3 text-[11px] font-medium text-slate-500 whitespace-nowrap">${(it.fecha || '').slice(0, 16)}</td>
                <td class="p-3 font-bold text-slate-800">${it.sucursal_id || 'TIENDA'}</td>
                <td class="p-3 font-mono font-black text-rose-700">${it.clave_articulo || '--'}</td>
                <td class="p-3 font-semibold text-slate-900">${it.articulo_nombre || '--'}</td>
                <td class="p-3 text-right font-black text-slate-900">${pz.toLocaleString('es-MX')}</td>
                <td class="p-3 text-right font-black text-emerald-700">${precio > 0 ? '$' + precio.toLocaleString('es-MX', {minimumFractionDigits: 2}) : '--'}</td>
                <td class="p-3 font-bold text-slate-700 text-[11px]"><span class="bg-amber-100 text-amber-800 px-2 py-0.5 rounded-md">${it.motivo || 'No especificado'}</span></td>
                <td class="p-3 text-slate-500 text-[11px] italic">${it.notas || '--'}</td>
            </tr>
        `;
    }).join('');
}

window.abrirReporteVentasPerdidasCompras = abrirReporteVentasPerdidasCompras;
window.cerrarReporteVentasPerdidasCompras = cerrarReporteVentasPerdidasCompras;
window.cargarReporteVentasPerdidasCompras = cargarReporteVentasPerdidasCompras;
window.filtrarTablaVentasPerdidas = filtrarTablaVentasPerdidas;

