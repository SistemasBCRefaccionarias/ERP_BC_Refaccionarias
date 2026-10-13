        let currentUser = null;
        let lineasMicrosip = [];
        let proveedoresMicrosip = [];
        let parsedItems = [];
        let parsedExcelItems = [];
        let rawXmlString = null;
        let nombreArchivoXmlActual = '';
        let folioFacturaActual = '';
        let serieFacturaActual = '';
        let timerBusquedaEquiv = null;

        // Variables Módulo 3: Traspasos
        let catalogoAlmacenes = [];
        let articuloActualBuscado = null;
        let partidasTraspaso = [];

        const renderYield = () => new Promise(r => setTimeout(r, 10));

        function aplicarTema(theme) {
            const root = document.documentElement;
            const nuevoTema = (theme === 'rt' || (typeof theme === 'string' && theme.toLowerCase().includes('rt'))) ? 'rt' : 'bc';
            root.setAttribute('data-theme', nuevoTema);
            try {
                localStorage.setItem('erp_theme', nuevoTema);
            } catch(e) {}

            // Sincronizar logotipo de login si está presente
            const loginImg = document.getElementById('loginLogoImg');
            if (loginImg) {
                loginImg.src = `/api/logo/${encodeURIComponent(nuevoTema === 'rt' ? 'logo rt' : 'logo bc')}`;
            }
        }

        // Aplicar tema guardado inmediatamente
        try {
            const savedTheme = localStorage.getItem('erp_theme') || 'bc';
            aplicarTema(savedTheme);
        } catch(e) {}

        function actualizarLogos(logoTag, nombreEmpresa) {
            const tag = logoTag || 'logo bc';
            const esRT = tag.toLowerCase().includes('rt') || (nombreEmpresa && nombreEmpresa.toUpperCase().includes('RT'));
            const theme = esRT ? 'rt' : 'bc';
            aplicarTema(theme);

            const rutaLogo = `/api/logo/${encodeURIComponent(tag)}`;
            const loginImg = document.getElementById('loginLogoImg');
            if (loginImg) loginImg.src = rutaLogo;
            const sidebarImg = document.getElementById('sidebarLogoImg');
            if (sidebarImg) sidebarImg.src = rutaLogo;
            const headerTag = document.getElementById('headerEmpresaTag');
            if (headerTag && nombreEmpresa) {
                headerTag.textContent = nombreEmpresa;
                if (esRT) {
                    headerTag.className = 'px-2 py-0.5 rounded-md bg-amber-50 text-amber-800 border border-amber-300 font-black text-[11px] tracking-wide';
                } else {
                    headerTag.className = 'px-2 py-0.5 rounded-md bg-red-50 text-red-700 border border-red-200 font-black text-[11px] tracking-wide';
                }
            }
        }

        // ================= SESIÓN Y LOGIN =================
        async function verificarSesion() {
            try {
                await cargarEstructuraMenuGlobal();
                const res = await fetch('/api/session');
                const data = await res.json();
                if (data.authenticated) {
                    mostrarApp(data);
                } else {
                    document.getElementById('loginScreen').classList.remove('hidden');
                    document.getElementById('mainApp').classList.add('hidden');
                }
            } catch (err) {
                console.error(err);
            }
        }

        // ================= PERMISOLOGÍA Y CONTROL DE ACCESO =================
        // Jerarquía de módulos -> submódulos (actualizable dinámicamente)
        let MAPA_SUBMODULOS = {
            ventas: ['ventas_pv', 'ventas_tickets', 'vendedores_comisiones'],
            almacen: ['almacen_traspasos', 'almacen_stock', 'almacen_recepcion', 'almacen_cascos', 'almacen_embarques'],
            compras: ['modulo1', 'modulo2', 'modulo3', 'modulo4', 'resurtidos', 'compras_solicitudes'],
            sucursales: ['sucursales_recepcion'],
            nominas: ['nominas_reloj'],
            configuracion: ['bot_whatsapp', 'config_usuarios', 'config_empresas', 'config_modulos', 'config_comisiones']
        };
        let PADRE_DE = {};
        function reconstruirIndicesJerarquia() {
            for (const k in PADRE_DE) delete PADRE_DE[k];
            Object.keys(MAPA_SUBMODULOS).forEach(p => {
                (MAPA_SUBMODULOS[p] || []).forEach(s => {
                    PADRE_DE[s] = p;
                });
            });
            PADRE_DE['puntoventa'] = PADRE_DE['ventas_pv'] || 'ventas';
            PADRE_DE['ventas_pv'] = PADRE_DE['puntoventa'] || 'ventas';
        }
        reconstruirIndicesJerarquia();

        function permisosDe(user) {
            const p = Array.isArray(user && user.permisos) ? user.permisos : [];
            return p;
        }

        // ¿Tiene acceso a un submódulo concreto? (permiso directo o módulo completo)
        function tieneSub(permisos, subId) {
            if (subId === 'puntoventa') subId = 'ventas_pv';
            const padre = PADRE_DE[subId];
            return permisos.includes(subId) || (padre && permisos.includes(padre)) || (padre === 'configuracion' && permisos.includes('admin'));
        }

        function tienePermiso(moduloId) {
            if (!currentUser) return false;
            if (currentUser.rol === 'ADMIN') return true;
            const permisos = permisosDe(currentUser);
            if (permisos.includes('*')) return true;

            if (moduloId === 'dashboard') return permisos.includes('dashboard');
            if (MAPA_SUBMODULOS[moduloId]) {
                return permisos.includes(moduloId) || MAPA_SUBMODULOS[moduloId].some(s => permisos.includes(s));
            }
            if (PADRE_DE[moduloId] || moduloId === 'puntoventa') return tieneSub(permisos, moduloId);
            if (moduloId === 'administracion') return permisos.includes('administracion') || permisos.includes('admin');
            if (moduloId === 'configuracion' || moduloId === 'config_usuarios' || moduloId === 'config_empresas' || moduloId === 'config_modulos' || moduloId === 'config_comisiones') {
                return permisos.includes('configuracion') || permisos.includes('admin') || permisos.includes(moduloId);
            }
            if (moduloId === 'bot_whatsapp') {
                const padre = PADRE_DE['bot_whatsapp'] || 'configuracion';
                return permisos.includes('bot_whatsapp') || permisos.includes(padre) || permisos.includes('admin') || permisos.includes('ventas');
            }
            return permisos.includes(moduloId);
        }

        function obtenerPrimerModuloPermitido() {
            if (!currentUser) return 'dashboard';
            const permisos = permisosDe(currentUser);
            const esAdmin = currentUser.rol === 'ADMIN' || permisos.includes('*');

            // 1. Si es Administrador o tiene permisos a todo o tiene dashboard explícito -> Inicio
            if (esAdmin || permisos.includes('dashboard')) {
                return 'dashboard';
            }

            // 2. Si es vendedor o sucursal de ventas -> Punto de Venta
            if (currentUser.rol === 'VENDEDOR_SUCURSAL' || tienePermiso('puntoventa') || tienePermiso('ventas_pv') || tienePermiso('ventas')) {
                if (tienePermiso('puntoventa') || tienePermiso('ventas_pv')) return 'puntoventa';
                if (tienePermiso('ventas_tickets')) return 'ventas_tickets';
                if (tienePermiso('vendedores_comisiones')) return 'vendedores_comisiones';
                return 'puntoventa';
            }

            // 3. Si es usuario de compras -> Compras
            if (tienePermiso('compras') || tienePermiso('modulo1') || tienePermiso('resurtidos') || tienePermiso('modulo2') || tienePermiso('modulo3') || tienePermiso('modulo4')) {
                if (tienePermiso('compras')) return 'compras';
                const ordenCompras = ['modulo1', 'resurtidos', 'modulo2', 'modulo3', 'modulo4', 'compras_solicitudes'];
                return ordenCompras.find(s => tienePermiso(s)) || 'compras';
            }

            // 4. Si es usuario de almacén -> Almacén
            if (tienePermiso('almacen') || tienePermiso('almacen_traspasos') || tienePermiso('almacen_stock') || tienePermiso('almacen_recepcion') || tienePermiso('almacen_embarques')) {
                const ordenAlm = ['almacen_traspasos', 'almacen_stock', 'almacen_recepcion', 'almacen_embarques', 'almacen_cascos'];
                return ordenAlm.find(s => tienePermiso(s)) || 'almacen_traspasos';
            }

            // 5. Si tiene sucursales (recepción en tienda) -> Recepción de Embarques
            if (tienePermiso('sucursales') || tienePermiso('sucursales_recepcion')) {
                return 'sucursales_recepcion';
            }

            // 6. Administración
            if (tienePermiso('administracion')) return 'administracion';

            // 7. Configuración
            if (tienePermiso('configuracion') || tienePermiso('config_usuarios')) {
                return primerSubPermitido('configuracion') || 'config_usuarios';
            }

            // Fallback genérico por orden
            const orden = ['dashboard', 'ventas', 'compras', 'almacen', 'sucursales', 'administracion', 'configuracion'];
            for (const m of orden) {
                if (tienePermiso(m)) {
                    if (MAPA_SUBMODULOS[m]) {
                        return primerSubPermitido(m) || m;
                    }
                    return m;
                }
            }
            return 'dashboard';
        }

        function aplicarPermisologia(userData) {
            if (!userData) return;
            const permisos = permisosDe(userData);
            const esAdmin = userData.rol === 'ADMIN' || permisos.includes('*');
            const sub = (id) => esAdmin || tieneSub(permisos, id);
            const mostrar = (ids, visible) => ids.forEach(id => {
                const el = document.getElementById(id);
                if (el) {
                    el.style.display = visible ? '' : 'none';
                    if (visible) {
                        el.classList.remove('hidden');
                    } else {
                        el.classList.add('hidden');
                    }
                }
            });

            // Submódulos -> elementos de UI que controlan
            const UI_SUB = {
                ventas_pv: ['sidebarItemPuntoVenta'],
                puntoventa: ['sidebarItemPuntoVenta'],
                ventas_tickets: ['sidebarItemVentasTickets'],
                vendedores_comisiones: ['sidebarItemVendedoresComisiones'],
                bot_whatsapp: ['sidebarItemBotWhatsapp'],
                almacen_traspasos: ['sidebarItemAlmEscaner', 'tabSubAlmEscaner'],
                almacen_stock: ['sidebarItemAlmCatalogo', 'tabSubAlmCatalogo'],
                almacen_recepcion: ['sidebarItemAlmRecepcion', 'tabSubAlmRecepcion'],
                almacen_cascos: ['sidebarItemAlmCascos', 'tabSubAlmCascos'],
                almacen_embarques: ['sidebarItemAlmEmbarques', 'tabSubAlmEmbarques'],
                modulo1: ['sidebarItemM1', 'cardLaunchpadM1'],
                modulo2: ['sidebarItemM2', 'cardLaunchpadM2'],
                modulo3: ['sidebarItemM3', 'cardLaunchpadM3'],
                modulo4: ['sidebarItemM4', 'cardLaunchpadM4'],
                resurtidos: ['sidebarItemResurtidos', 'cardLaunchpadResurtidos'],
                compras_solicitudes: ['sidebarItemComprasSolicitudes', 'cardLaunchpadSolicitudesTraspasos'],
                sucursales_recepcion: ['sidebarItemSucRecepcion', 'tabSubSucRecepcion'],
                nominas_reloj: ['sidebarItemNominasReloj'],
                config_usuarios: ['sidebarItemConfigUsuarios'],
                config_empresas: ['sidebarItemConfigEmpresas'],
                config_modulos: ['sidebarItemConfigModulos'],
                config_comisiones: ['sidebarItemConfigComisiones']
            };
            Object.keys(UI_SUB).forEach(s => mostrar(UI_SUB[s], sub(s)));

            // Módulos contenedores: visibles si tiene al menos un submódulo
            const UI_MOD = { 
                ventas: 'sidebarItemVentas', 
                almacen: 'sidebarItemAlmacen', 
                compras: 'sidebarItemCompras',
                sucursales: 'sidebarItemSucursales',
                nominas: 'sidebarItemNominas',
                configuracion: 'sidebarItemConfiguracion'
            };
            Object.keys(UI_MOD).forEach(m => {
                const subs = MAPA_SUBMODULOS[m] || [];
                mostrar([UI_MOD[m]], esAdmin || subs.some(s => tieneSub(permisos, s)));
            });

            // Módulos directos
            mostrar(['sidebarItemDashboard'], esAdmin || permisos.includes('dashboard'));
            mostrar(['sidebarItemAdministracion'], esAdmin || permisos.includes('administracion') || permisos.includes('admin'));

            // Respetar visibilidad desactivada en el gestor de menús por el admin
            if (Array.isArray(menuModulosCache)) {
                menuModulosCache.forEach(m => {
                    if (m.tipo === 'agrupador' && Array.isArray(m.submodulos)) {
                        if (m.visible === false && UI_MOD[m.id]) {
                            mostrar([UI_MOD[m.id]], false);
                        }
                        m.submodulos.forEach(s => {
                            if (s.visible === false) {
                                const sIds = UI_SUB[s.id] || ['sidebarItemCustom_' + s.id];
                                mostrar(sIds, false);
                            }
                        });
                    } else if (m.visible === false) {
                        const rId = m.id === 'dashboard' ? 'sidebarItemDashboard' : (m.id === 'sucursales' ? 'sidebarItemSucursales' : (m.id === 'administracion' ? 'sidebarItemAdministracion' : 'sidebarItemCustom_' + m.id));
                        mostrar([rId], false);
                    }
                });
            }
        }

        // Primer submódulo permitido de un módulo contenedor (para el clic en el grupo)
        function primerSubPermitido(modulo) {
            const subs = MAPA_SUBMODULOS[modulo] || [];
            const s = subs.find(x => tienePermiso(x));
            if (s === 'ventas_pv') return 'puntoventa';
            return s || null;
        }

        async function mostrarApp(userData) {
            currentUser = userData;
            document.getElementById('loginScreen').classList.add('hidden');
            document.getElementById('mainApp').classList.remove('hidden');
            const inicial = (userData.nombre || userData.usuario || 'A').charAt(0).toUpperCase();
            document.getElementById('userAvatar').textContent = inicial;
            document.getElementById('userBadgeName').textContent = userData.nombre || userData.usuario;
            
            // Garantizar que todos los menús desplegables comiencen cerrados
            abrirAcordeonSubmenu('none');

            if (!menuModulosCache || menuModulosCache.length === 0) {
                await cargarEstructuraMenuGlobal();
            } else {
                aplicarEstructuraMenuEnSidebar(menuModulosCache);
            }
            aplicarPermisologia(userData);

            // Determinar módulo inicial según permisos y rol
            const primerTab = obtenerPrimerModuloPermitido() || 'dashboard';
            currentActiveTabId = primerTab;

            // Activar automáticamente el módulo correspondiente de inmediato
            activarTab(primerTab);
            abrirAcordeonSubmenu('none');

            cargarEmpresas();

            if (typeof pvCargarSucursalYVendedor === 'function') {
                pvCargarSucursalYVendedor();
            }
        }

        document.getElementById('loginForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const usr = document.getElementById('loginUser').value.trim();
            const pwd = document.getElementById('loginPassword').value.trim();
            const errBox = document.getElementById('loginError');
            const submitBtn = document.getElementById('btnLoginSubmit');
            const originalBtnHtml = submitBtn ? submitBtn.innerHTML : '';
            
            errBox.classList.add('hidden');
            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.innerHTML = `
                    <svg class="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
                    </svg>
                    <span>Validando acceso...</span>
                `;
            }

            try {
                const res = await fetch('/api/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ usuario: usr, password: pwd })
                });
                const data = await res.json();
                if (res.ok && data.success) {
                    mostrarApp(data);
                } else {
                    errBox.textContent = data.error || 'Credenciales inválidas.';
                    errBox.classList.remove('hidden');
                }
            } catch (err) {
                errBox.textContent = 'Error al comunicar con el servidor.';
                errBox.classList.remove('hidden');
            } finally {
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = originalBtnHtml;
                }
            }
        });

        const btnTogglePwd = document.getElementById('btnToggleLoginPassword');
        if (btnTogglePwd) {
            btnTogglePwd.addEventListener('click', () => {
                const pwdInput = document.getElementById('loginPassword');
                const eyeIcon = document.getElementById('eyeIcon');
                if (!pwdInput) return;
                if (pwdInput.type === 'password') {
                    pwdInput.type = 'text';
                    if (eyeIcon) {
                        eyeIcon.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18"/>`;
                    }
                } else {
                    pwdInput.type = 'password';
                    if (eyeIcon) {
                        eyeIcon.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>`;
                    }
                }
            });
        }

        document.getElementById('btnLogout').addEventListener('click', async () => {
            await fetch('/api/logout', { method: 'POST' });
            location.reload();
        });

        // ================= CONTROL DE SIDEBAR / NAVEGACIÓN Y ACORDEÓN =================
        let currentActiveTabId = 'dashboard';

        function posicionarPanelDentroVentana(panel) {
            if (!panel) return;
            const rect = panel.getBoundingClientRect();
            const separacion = 8;
            if (rect.right > window.innerWidth - separacion) {
                const delta = (window.innerWidth - rect.width - separacion) - rect.left;
                panel.style.left = Math.min(0, delta) + 'px';
            } else {
                panel.style.left = '';
            }
        }

        function abrirAcordeonSubmenu(moduloPadre) {
            const acordeones = {
                ventas: { sub: document.getElementById('sidebarSubmenuVentas'), chev: document.getElementById('chevronVentas') },
                almacen: { sub: document.getElementById('sidebarSubmenuAlmacen'), chev: document.getElementById('chevronAlmacen') },
                compras: { sub: document.getElementById('sidebarSubmenuCompras'), chev: document.getElementById('chevronCompras') },
                sucursales: { sub: document.getElementById('sidebarSubmenuSucursales'), chev: document.getElementById('chevronSucursales') },
                nominas: { sub: document.getElementById('sidebarSubmenuNominas'), chev: document.getElementById('chevronNominas') },
                configuracion: { sub: document.getElementById('sidebarSubmenuConfiguracion'), chev: document.getElementById('chevronConfiguracion') },
            };

            Object.keys(acordeones).forEach(key => {
                const item = acordeones[key];
                const isOpen = (key === moduloPadre);
                if (item.sub) {
                    if (isOpen) {
                        item.sub.classList.remove('closed');
                        item.sub.classList.add('open');
                    } else {
                        item.sub.classList.add('closed');
                        item.sub.classList.remove('open');
                    }
                }
                if (item.chev) {
                    if (isOpen) item.chev.classList.add('rotate-180');
                    else item.chev.classList.remove('rotate-180');
                }
                if (isOpen && item.sub) {
                    posicionarPanelDentroVentana(item.sub);
                }
            });

            // Si es 'none', asegurar que ningún acordeón en el DOM quede abierto
            if (moduloPadre === 'none' || !moduloPadre) {
                document.querySelectorAll('.submenu-accordion').forEach(el => {
                    el.classList.add('closed');
                    el.classList.remove('open');
                });
                document.querySelectorAll('.rotate-180').forEach(el => {
                    if (el.id && el.id.startsWith('chevron')) el.classList.remove('rotate-180');
                });
            }
        }

        // Cerrar cualquier submenú desplegado al hacer clic fuera
        document.addEventListener('click', (e) => {
            const esItemMenu = e.target.closest('#sidebarNavScroll') || e.target.closest('nav') || e.target.closest('.submenu-accordion') || e.target.closest('.nav-tab') || e.target.closest('.sidebar-item');
            if (!esItemMenu) {
                abrirAcordeonSubmenu('none');
            }
        });

        const tabBtnDash = document.getElementById('tabBtnDashboard');
        const tabBtnVentas = document.getElementById('tabBtnVentas');
        const tabBtnPV = document.getElementById('tabBtnPuntoVenta');
        const tabBtnVentasTickets = document.getElementById('tabBtnVentasTickets');
        const tabBtnVendedoresComisiones = document.getElementById('tabBtnVendedoresComisiones');
        const tabBtnAlm = document.getElementById('tabBtnAlmacen');
        const tabBtnAlmEscaner = document.getElementById('tabBtnAlmEscaner');
        const tabBtnAlmCatalogo = document.getElementById('tabBtnAlmCatalogo');
        const tabBtnAlmRecepcion = document.getElementById('tabBtnAlmRecepcion');
        const tabBtnAlmCascos = document.getElementById('tabBtnAlmCascos');
        const tabBtnAlmEmbarques = document.getElementById('tabBtnAlmEmbarques');
        const tabBtnComp = document.getElementById('tabBtnCompras');
        const tabBtnM1 = document.getElementById('tabBtnModulo1');
        const tabBtnM2 = document.getElementById('tabBtnModulo2');
        const tabBtnM3 = document.getElementById('tabBtnModulo3');
        const tabBtnM4 = document.getElementById('tabBtnModulo4');
        const tabBtnResurtidos = document.getElementById('tabBtnResurtidos');
        const tabBtnComprasSolicitudes = document.getElementById('tabBtnComprasSolicitudes');
        const tabBtnSuc = document.getElementById('tabBtnSucursales');
        const tabBtnSucRecepcion = document.getElementById('tabBtnSucRecepcion');
        const tabBtnNominas = document.getElementById('tabBtnNominas');
        const tabBtnNominasReloj = document.getElementById('tabBtnNominasReloj');
        const tabBtnAdmin = document.getElementById('tabBtnAdministracion');
        const tabBtnConfig = document.getElementById('tabBtnConfiguracion');
        const tabBtnConfigUsuarios = document.getElementById('tabBtnConfigUsuarios');
        const tabBtnConfigEmpresas = document.getElementById('tabBtnConfigEmpresas');
        const tabBtnConfigModulos = document.getElementById('tabBtnConfigModulos');
        const tabBtnConfigComisiones = document.getElementById('tabBtnConfigComisiones');
        const tabBtnBotWhatsapp = document.getElementById('tabBtnBotWhatsapp');

        const modDash = document.getElementById('moduloDashboardContent');
        const modPV = document.getElementById('moduloPuntoVentaContent');
        const modVentas = document.getElementById('moduloVentasContent');
        const modVendedoresComisiones = document.getElementById('moduloVendedoresComisionesContent');
        const modAlm = document.getElementById('moduloAlmacenContent');
        const modComp = document.getElementById('moduloComprasContent');
        const mod1 = document.getElementById('modulo1Content');
        const mod2 = document.getElementById('modulo2Content');
        const mod3 = document.getElementById('modulo3Content');
        const mod4 = document.getElementById('modulo4Content');
        const modResurtidos = document.getElementById('moduloResurtidosContent');
        const modComprasSolicitudes = document.getElementById('moduloComprasSolicitudesContent');
        const modSuc = document.getElementById('moduloSucursalesContent');
        const modNominas = document.getElementById('moduloNominasContent');
        const modAdmin = document.getElementById('moduloAdministracionContent');
        const modConfig = document.getElementById('moduloConfiguracionContent');
        const modBotWhatsapp = document.getElementById('moduloBotWhatsappContent');
        const modCustom = document.getElementById('moduloCustomContent');
        const modCatalogoMaestro = document.getElementById('moduloCatalogoMaestroContent');

        const breadcrumbParent = document.getElementById('breadcrumbParent');
        const breadcrumbParentSep = document.getElementById('breadcrumbParentSep');
        const breadcrumb = document.getElementById('breadcrumbCurrent');

        const NOMBRES_MODULOS = {
            dashboard: 'Inicio / Tablero',
            ventas: 'Ventas',
            puntoventa: 'Punto de Venta',
            ventas_pv: 'Punto de Venta',
            ventas_tickets: 'Historial / Tickets',
            vendedores_comisiones: 'Vendedores y Comisiones',
            bot_whatsapp: 'Bot WhatsApp',
            almacen: 'Almacén',
            almacen_traspasos: 'Control de Traspasos',
            almacen_stock: 'Catálogo y Stock',
            almacen_recepcion: 'Recepción de Compra (OC)',
            almacen_cascos: 'Control de Cascos',
            almacen_embarques: 'Embarques y Empaque',
            compras: 'Compras',
            resurtidos: 'Resurtidos',
            modulo1: 'Recepción de Compra',
            modulo2: 'Listas de Precios',
            modulo3: 'Traspasos',
            modulo4: 'Buscador de Artículos',
            compras_solicitudes: 'Validar Traspasos PV',
            catalogo_maestro: 'Catálogo Maestro',
            sucursales: 'Sucursales',
            sucursales_recepcion: 'Recepción de Embarques',
            nominas: 'Nóminas',
            nominas_reloj: 'Reloj Checador',
            administracion: 'Administración del Negocio',
            configuracion: 'Configuración',
            config_usuarios: 'Usuarios y Permisos',
            config_empresas: 'Empresas del Sistema',
            config_modulos: 'Gestor de Menús y Módulos',
            config_comisiones: 'Políticas y Comisiones'
        };

        function actualizarBreadcrumbsParaTab(tabId) {
            const padre = PADRE_DE[tabId];
            if (padre) {
                if (breadcrumbParent) {
                    breadcrumbParent.classList.remove('hidden');
                    breadcrumbParent.textContent = NOMBRES_MODULOS[padre] || padre;
                    breadcrumbParent.onclick = () => {
                        const prim = primerSubPermitido(padre) || padre;
                        activarTab(prim);
                    };
                }
                if (breadcrumbParentSep) breadcrumbParentSep.classList.remove('hidden');
            } else {
                if (breadcrumbParent) breadcrumbParent.classList.add('hidden');
                if (breadcrumbParentSep) breadcrumbParentSep.classList.add('hidden');
            }
            if (breadcrumb) {
                breadcrumb.textContent = NOMBRES_MODULOS[tabId] || tabId;
            }
        }

        const allTabBtns = [
            { id: 'dashboard', btn: tabBtnDash, mod: modDash, isGroup: false, activeClass: 'text-white bg-blue-600 shadow-md shadow-blue-600/20' },
            { id: 'ventas', btn: tabBtnVentas, mod: modPV, isGroup: true, activeClass: 'text-white bg-slate-800 shadow-md shadow-slate-900/30' },
            { id: 'puntoventa', btn: tabBtnPV, mod: modPV, isGroup: false, activeClass: 'text-white bg-indigo-600 shadow-md shadow-indigo-600/20' },
            { id: 'ventas_pv', btn: tabBtnPV, mod: modPV, isGroup: false, activeClass: 'text-white bg-indigo-600 shadow-md shadow-indigo-600/20' },
            { id: 'ventas_tickets', btn: tabBtnVentasTickets, mod: modVentas, isGroup: false, activeClass: 'text-white bg-emerald-600 shadow-md shadow-emerald-600/20' },
            { id: 'vendedores_comisiones', btn: tabBtnVendedoresComisiones, mod: modVendedoresComisiones, isGroup: false, activeClass: 'text-white bg-emerald-600 shadow-md shadow-emerald-600/20' },
            { id: 'bot_whatsapp', btn: tabBtnBotWhatsapp, mod: modBotWhatsapp, isGroup: false, activeClass: 'text-white bg-emerald-600 shadow-md shadow-emerald-600/20' },
            { id: 'almacen', btn: tabBtnAlm, mod: modAlm, isGroup: true, activeClass: 'text-white bg-slate-800 shadow-md shadow-slate-900/30' },
            { id: 'almacen_traspasos', btn: tabBtnAlmEscaner, mod: modAlm, isGroup: false, activeClass: 'text-white bg-amber-600 shadow-md shadow-amber-600/20' },
            { id: 'almacen_stock', btn: tabBtnAlmCatalogo, mod: modAlm, isGroup: false, activeClass: 'text-white bg-slate-700 shadow-md shadow-slate-700/20' },
            { id: 'almacen_recepcion', btn: tabBtnAlmRecepcion, mod: modAlm, isGroup: false, activeClass: 'text-white bg-emerald-600 shadow-md shadow-emerald-600/20' },
            { id: 'almacen_cascos', btn: tabBtnAlmCascos, mod: modAlm, isGroup: false, activeClass: 'text-white bg-cyan-600 shadow-md shadow-cyan-600/20' },
            { id: 'almacen_embarques', btn: tabBtnAlmEmbarques, mod: modAlm, isGroup: false, activeClass: 'text-white bg-blue-600 shadow-md shadow-blue-600/20' },
            { id: 'compras', btn: tabBtnComp, mod: modComp, isGroup: true, activeClass: 'text-white bg-red-600 shadow-md shadow-red-600/20' },
            { id: 'modulo1', btn: tabBtnM1, mod: mod1, isGroup: false, activeClass: 'text-white bg-red-600 shadow-md shadow-red-600/20' },
            { id: 'modulo2', btn: tabBtnM2, mod: mod2, isGroup: false, activeClass: 'text-white bg-emerald-600 shadow-md shadow-emerald-600/20' },
            { id: 'modulo3', btn: tabBtnM3, mod: mod3, isGroup: false, activeClass: 'text-white bg-blue-600 shadow-md shadow-blue-600/20' },
            { id: 'modulo4', btn: tabBtnM4, mod: mod4, isGroup: false, activeClass: 'text-white bg-indigo-600 shadow-md shadow-indigo-600/20' },
            { id: 'resurtidos', btn: tabBtnResurtidos, mod: modResurtidos, isGroup: false, activeClass: 'text-white bg-amber-600 shadow-md shadow-amber-600/20' },
            { id: 'compras_solicitudes', btn: tabBtnComprasSolicitudes, mod: modComprasSolicitudes, isGroup: false, activeClass: 'text-white bg-amber-600 shadow-md shadow-amber-600/20' },
            { id: 'catalogo_maestro', btn: null, mod: modCatalogoMaestro, isGroup: false, activeClass: 'text-white bg-indigo-600 shadow-md shadow-indigo-600/20' },
            { id: 'sucursales', btn: tabBtnSuc, mod: modSuc, isGroup: true, activeClass: 'text-white bg-indigo-600 shadow-md shadow-indigo-600/20' },
            { id: 'sucursales_recepcion', btn: tabBtnSucRecepcion, mod: modSuc, isGroup: false, activeClass: 'text-white bg-indigo-600 shadow-md shadow-indigo-600/20' },
            { id: 'nominas', btn: tabBtnNominas, mod: modNominas, isGroup: true, activeClass: 'text-white bg-teal-600 shadow-md shadow-teal-600/20' },
            { id: 'nominas_reloj', btn: tabBtnNominasReloj, mod: modNominas, isGroup: false, activeClass: 'text-white bg-teal-600 shadow-md shadow-teal-600/20' },
            { id: 'administracion', btn: tabBtnAdmin, mod: modAdmin, isGroup: false, activeClass: 'text-white bg-slate-900 shadow-md shadow-slate-900/30' },
            { id: 'configuracion', btn: tabBtnConfig, mod: modConfig, isGroup: true, activeClass: 'text-white bg-purple-700 shadow-md shadow-purple-700/20' },
            { id: 'config_usuarios', btn: tabBtnConfigUsuarios, mod: modConfig, isGroup: false, activeClass: 'text-white bg-purple-700 shadow-md shadow-purple-700/20' },
            { id: 'config_empresas', btn: tabBtnConfigEmpresas, mod: modConfig, isGroup: false, activeClass: 'text-white bg-blue-600 shadow-md shadow-blue-600/20' },
            { id: 'config_modulos', btn: tabBtnConfigModulos, mod: modConfig, isGroup: false, activeClass: 'text-white bg-amber-600 shadow-md shadow-amber-600/20' },
            { id: 'config_comisiones', btn: tabBtnConfigComisiones, mod: modConfig, isGroup: false, activeClass: 'text-white bg-emerald-600 shadow-md shadow-emerald-600/20' },
        ];

        function activarTab(tabId) {
            ocultarAlerta();

            // Verificación de permiso
            if (!tienePermiso(tabId)) {
                mostrarAlerta('error', 'No tienes permiso asignado para acceder a este módulo.');
                const fallback = obtenerPrimerModuloPermitido();
                if (fallback && fallback !== tabId) activarTab(fallback);
                return;
            }

            currentActiveTabId = tabId;

            // Gestión de acordeón de submenús dinámico
            abrirAcordeonSubmenu('none');

            // Ocultar primero todos los contenedores de módulos principales
            [modDash, modPV, modVentas, modVendedoresComisiones, modAlm, modComp, mod1, mod2, mod3, mod4, modResurtidos, modComprasSolicitudes, modSuc, modNominas, modAdmin, modConfig, modBotWhatsapp, modCustom, modCatalogoMaestro].forEach(m => {
                if (m) m.classList.add('hidden');
            });

            // Quitar clase activa previa de botones de submódulos custom
            document.querySelectorAll('[id^="sidebarItemCustom_"] button').forEach(b => {
                b.className = "sidebar-item dropdown-item flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-bold text-slate-300 hover:text-white hover:bg-white/10 transition cursor-pointer";
            });

            // Resaltar botón activo y mostrar contenedor correspondiente
            let tabConfigEncontrado = false;
            const botonVisto = {};   // Evita sobrescribir el estado cuando 2 IDs comparten el mismo botón
            allTabBtns.forEach(t => {
                if (!t.btn) {
                    if (t.id === tabId) {
                        tabConfigEncontrado = true;
                        if (t.mod) t.mod.classList.remove('hidden');
                        const customBtn = document.querySelector(`#sidebarItemCustom_${tabId} button`);
                        if (customBtn) {
                            customBtn.className = "sidebar-item dropdown-item tab-activo flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-bold transition cursor-pointer";
                        }
                    }
                    return;
                }
                if (botonVisto[t.btn.id]) return;
                botonVisto[t.btn.id] = true;
                const esAlias = (tabId === 'ventas_pv' && t.id === 'puntoventa') ||
                                (tabId === 'puntoventa' && t.id === 'ventas_pv');
                const isTarget = t.id === tabId || esAlias;
                const enDropdown = !!(t.btn.closest && t.btn.closest('.submenu-accordion'));
                if (isTarget) {
                    tabConfigEncontrado = true;
                    if (enDropdown) {
                        t.btn.className = "sidebar-item dropdown-item tab-activo flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-bold transition cursor-pointer";
                    } else if (t.isGroup) {
                        t.btn.className = "sidebar-item nav-tab tab-activo flex items-center justify-between gap-2 px-3 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition cursor-pointer";
                    } else {
                        t.btn.className = "sidebar-item nav-tab tab-activo flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition cursor-pointer";
                    }
                    t.btn.querySelectorAll('svg').forEach(s => s.className = "w-4 h-4 text-white");
                    if (t.mod) t.mod.classList.remove('hidden');
                } else {
                    if (enDropdown) {
                        t.btn.className = "sidebar-item dropdown-item flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-bold text-slate-300 hover:text-white hover:bg-white/10 transition cursor-pointer";
                    } else if (t.isGroup) {
                        t.btn.className = "sidebar-item nav-tab flex items-center justify-between gap-2 px-3 py-2 rounded-xl text-xs font-bold text-slate-300 hover:text-white hover:bg-white/10 whitespace-nowrap transition cursor-pointer";
                    } else {
                        t.btn.className = "sidebar-item nav-tab flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold text-slate-300 hover:text-white hover:bg-white/10 whitespace-nowrap transition cursor-pointer";
                    }
                    t.btn.querySelectorAll('svg').forEach(s => s.className = "w-4 h-4 text-slate-400");
                }
            });

            // Resaltar también el grupo contenedor cuando el submódulo activo vive dentro de él
            const grupoDelActivo = PADRE_DE[tabId] || (MAPA_SUBMODULOS[tabId] ? tabId : null);
            if (grupoDelActivo) {
                const grp = allTabBtns.find(t => t.isGroup && t.id === grupoDelActivo && t.btn);
                if (grp && grp.btn && !grp.btn.classList.contains('tab-activo')) {
                    grp.btn.className = "sidebar-item nav-tab tab-activo flex items-center justify-between gap-2 px-3 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition cursor-pointer";
                    grp.btn.querySelectorAll('svg').forEach(s => s.className = "w-4 h-4 text-white");
                }
            }

            // Si es un módulo custom creado dinámicamente
            if (!tabConfigEncontrado && modCustom) {
                modCustom.classList.remove('hidden');
                mostrarVistaModuloCustom(tabId);
            }

            // Actualizar breadcrumbs dinámicamente
            actualizarBreadcrumbsParaTab(tabId);

            // Inicialización de vista correspondiente al tab
            if (tabId === 'dashboard') {
                if (typeof cargarDashboard === 'function') {
                    const selP = document.getElementById('selectPeriodoDashboard');
                    cargarDashboard(selP ? selP.value : 'mes_actual');
                }
            } else if (tabId === 'ventas' || tabId === 'puntoventa' || tabId === 'ventas_pv') {
                if (typeof inicializarModuloPuntoVenta === 'function') {
                    inicializarModuloPuntoVenta();
                }
            } else if (tabId === 'ventas_tickets') {
                if (typeof cargarModuloVentas === 'function') {
                    cargarModuloVentas();
                }
            } else if (tabId === 'vendedores_comisiones') {
                if (typeof inicializarModuloVendedoresComisiones === 'function') {
                    inicializarModuloVendedoresComisiones();
                }
            } else if (tabId === 'bot_whatsapp') {
                if (typeof inicializarModuloBotWhatsapp === 'function') {
                    inicializarModuloBotWhatsapp();
                }
            } else if (tabId === 'almacen' || tabId === 'almacen_traspasos') {
                if (typeof cambiarSubTabAlmacen === 'function') {
                    cambiarSubTabAlmacen('escaner');
                }
            } else if (tabId === 'almacen_stock') {
                if (typeof cambiarSubTabAlmacen === 'function') {
                    cambiarSubTabAlmacen('catalogo');
                }
            } else if (tabId === 'almacen_recepcion') {
                if (typeof cambiarSubTabAlmacen === 'function') {
                    cambiarSubTabAlmacen('recepcion_compra');
                }
            } else if (tabId === 'almacen_cascos') {
                if (typeof cambiarSubTabAlmacen === 'function') {
                    cambiarSubTabAlmacen('cascos');
                }
            } else if (tabId === 'almacen_embarques') {
                if (typeof cambiarSubTabAlmacen === 'function') {
                    cambiarSubTabAlmacen('embarques');
                }
            } else if (tabId === 'compras') {
                cargarComprasDashboard();
            } else if (tabId === 'sucursales' || tabId === 'sucursales_recepcion') {
                if (typeof cambiarSubTabSucursales === 'function') {
                    cambiarSubTabSucursales('recepcion');
                }
            } else if (tabId === 'administracion') {
                if (typeof cargarModuloAdministracion === 'function') {
                    cargarModuloAdministracion();
                }
            } else if (tabId === 'configuracion' || tabId === 'config_usuarios') {
                irASubTabConfiguracion('usuarios');
            } else if (tabId === 'config_empresas') {
                irASubTabConfiguracion('empresas');
            } else if (tabId === 'config_modulos') {
                irASubTabConfiguracion('modulos');
            } else if (tabId === 'config_comisiones') {
                irASubTabConfiguracion('comisiones');
            } else if (tabId === 'config_visibilidad') {
                irASubTabConfiguracion('visibilidad');
            } else if (tabId === 'modulo1') {
                // Modulo 1
            } else if (tabId === 'modulo2') {
                // Modulo 2
            } else if (tabId === 'modulo3') {
                cargarCatalogosTraspaso();
            } else if (tabId === 'modulo4') {
                const inputBusq = document.getElementById('inputBusquedaArticulo');
                if (inputBusq) setTimeout(() => inputBusq.focus(), 100);
            } else if (tabId === 'resurtidos') {
                if (typeof inicializarModuloResurtidos === 'function') {
                    inicializarModuloResurtidos();
                }
            } else if (tabId === 'compras_solicitudes') {
                if (typeof comprasCargarSolicitudesTraspasos === 'function') {
                    comprasCargarSolicitudesTraspasos();
                }
            } else if (tabId === 'catalogo_maestro') {
                if (typeof inicializarModuloCatalogoMaestro === 'function') {
                    inicializarModuloCatalogoMaestro();
                }
            } else if (tabId === 'nominas' || tabId === 'nominas_reloj') {
                inicializarModuloNominas();
            }
        }

        if (tabBtnDash) tabBtnDash.addEventListener('click', () => activarTab('dashboard'));
        if (tabBtnVentas) {
            tabBtnVentas.addEventListener('click', () => {
                const subV = document.getElementById('sidebarSubmenuVentas');
                const isOpen = subV && subV.classList.contains('open');
                if (isOpen) {
                    abrirAcordeonSubmenu('none');
                } else {
                    abrirAcordeonSubmenu('ventas');
                }
            });
        }
        if (tabBtnPV) tabBtnPV.addEventListener('click', () => activarTab('puntoventa'));
        if (tabBtnVentasTickets) tabBtnVentasTickets.addEventListener('click', () => activarTab('ventas_tickets'));
        if (tabBtnVendedoresComisiones) tabBtnVendedoresComisiones.addEventListener('click', () => activarTab('vendedores_comisiones'));
        if (tabBtnBotWhatsapp) tabBtnBotWhatsapp.addEventListener('click', () => activarTab('bot_whatsapp'));
        if (tabBtnAdmin) tabBtnAdmin.addEventListener('click', () => activarTab('administracion'));
        
        if (tabBtnConfig) {
            tabBtnConfig.addEventListener('click', () => {
                const subConf = document.getElementById('sidebarSubmenuConfiguracion');
                const isOpen = subConf && subConf.classList.contains('open');
                if (isOpen) {
                    abrirAcordeonSubmenu('none');
                } else {
                    abrirAcordeonSubmenu('configuracion');
                }
            });
        }
        if (tabBtnConfigUsuarios) tabBtnConfigUsuarios.addEventListener('click', () => activarTab('config_usuarios'));
        if (tabBtnConfigEmpresas) tabBtnConfigEmpresas.addEventListener('click', () => activarTab('config_empresas'));
        if (tabBtnConfigModulos) tabBtnConfigModulos.addEventListener('click', () => activarTab('config_modulos'));
        if (tabBtnConfigComisiones) tabBtnConfigComisiones.addEventListener('click', () => activarTab('config_comisiones'));

        if (tabBtnAlm) {
            tabBtnAlm.addEventListener('click', () => {
                const subAlm = document.getElementById('sidebarSubmenuAlmacen');
                const isOpen = subAlm && subAlm.classList.contains('open');
                if (isOpen) {
                    abrirAcordeonSubmenu('none');
                } else {
                    abrirAcordeonSubmenu('almacen');
                }
            });
        }
        if (tabBtnAlmEscaner) tabBtnAlmEscaner.addEventListener('click', () => activarTab('almacen_traspasos'));
        if (tabBtnAlmCatalogo) tabBtnAlmCatalogo.addEventListener('click', () => activarTab('almacen_stock'));
        if (tabBtnAlmRecepcion) tabBtnAlmRecepcion.addEventListener('click', () => activarTab('almacen_recepcion'));
        if (tabBtnAlmCascos) tabBtnAlmCascos.addEventListener('click', () => activarTab('almacen_cascos'));
        if (tabBtnAlmEmbarques) tabBtnAlmEmbarques.addEventListener('click', () => activarTab('almacen_embarques'));
        if (tabBtnComp) {
            tabBtnComp.addEventListener('click', () => {
                const subComp = document.getElementById('sidebarSubmenuCompras');
                const isOpen = subComp && subComp.classList.contains('open');
                if (isOpen) {
                    abrirAcordeonSubmenu('none');
                } else {
                    abrirAcordeonSubmenu('compras');
                }
            });
        }
        if (tabBtnM1) tabBtnM1.addEventListener('click', () => activarTab('modulo1'));
        if (tabBtnM2) tabBtnM2.addEventListener('click', () => activarTab('modulo2'));
        if (tabBtnM3) tabBtnM3.addEventListener('click', () => activarTab('modulo3'));
        if (tabBtnM4) tabBtnM4.addEventListener('click', () => activarTab('modulo4'));
        if (tabBtnResurtidos) tabBtnResurtidos.addEventListener('click', () => activarTab('resurtidos'));
        if (tabBtnComprasSolicitudes) tabBtnComprasSolicitudes.addEventListener('click', () => activarTab('compras_solicitudes'));
        if (tabBtnSuc) {
            tabBtnSuc.addEventListener('click', () => {
                const subSuc = document.getElementById('sidebarSubmenuSucursales');
                const isOpen = subSuc && subSuc.classList.contains('open');
                if (isOpen) {
                    abrirAcordeonSubmenu('none');
                } else {
                    abrirAcordeonSubmenu('sucursales');
                }
            });
        }
        if (tabBtnSucRecepcion) tabBtnSucRecepcion.addEventListener('click', () => activarTab('sucursales_recepcion'));

        if (tabBtnNominas) {
            tabBtnNominas.addEventListener('click', () => {
                const subNom = document.getElementById('sidebarSubmenuNominas');
                const isOpen = subNom && subNom.classList.contains('open');
                if (isOpen) {
                    abrirAcordeonSubmenu('none');
                } else {
                    abrirAcordeonSubmenu('nominas');
                }
            });
        }
        if (tabBtnNominasReloj) tabBtnNominasReloj.addEventListener('click', () => activarTab('nominas_reloj'));



        // ================= GESTIÓN MÓDULO CONFIGURACIÓN Y USUARIOS =================
        let listaUsuariosCache = [];
        let urlRedLocalActual = 'http://192.168.1.12:5000';
        let subTabConfiguracionActual = 'usuarios';

        async function cargarModuloConfiguracion(subtab = null) {
            try {
                const resRed = await fetch('/api/info-red');
                const dataRed = await resRed.json();
                if (dataRed.url) {
                    urlRedLocalActual = dataRed.url;
                    const txt = document.getElementById('txtUrlRedLocal');
                    if (txt) txt.textContent = dataRed.url;
                }
            } catch (err) {
                console.error("Error al cargar módulo configuración:", err);
            }

            if (subtab) {
                irASubTabConfiguracion(subtab);
            } else {
                irASubTabConfiguracion(subTabConfiguracionActual || 'usuarios');
            }
        }

        function irASubTabConfiguracion(tab) {
            subTabConfiguracionActual = tab;
            const subUsuarios = document.getElementById('subtabContentConfigUsuarios');
            const subEmpresas = document.getElementById('subtabContentConfigEmpresas');
            const subModulos = document.getElementById('subtabContentConfigModulos');
            const subComisiones = document.getElementById('subtabContentConfigComisiones');
            const subVisibilidad = document.getElementById('subtabContentConfigVisibilidad');

            const btnUsuarios = document.getElementById('subtabBtnConfigUsuarios');
            const btnEmpresas = document.getElementById('subtabBtnConfigEmpresas');
            const btnModulos = document.getElementById('subtabBtnConfigModulos');
            const btnComisiones = document.getElementById('subtabBtnConfigComisiones');
            const btnVisibilidad = document.getElementById('subtabBtnConfigVisibilidad');

            const aplicarEstiloTab = (btn, activo, colorActivo = 'bg-purple-700 text-white shadow-sm') => {
                if (!btn) return;
                if (activo) {
                    btn.className = `subtab-btn-cfg px-4 py-2.5 rounded-xl text-xs font-black transition flex items-center gap-2 ${colorActivo} cursor-pointer`;
                } else {
                    btn.className = `subtab-btn-cfg px-4 py-2.5 rounded-xl text-xs font-bold transition flex items-center gap-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 cursor-pointer`;
                }
            };

            if (subUsuarios) subUsuarios.classList.toggle('hidden', tab !== 'usuarios');
            if (subEmpresas) subEmpresas.classList.toggle('hidden', tab !== 'empresas');
            if (subModulos) subModulos.classList.toggle('hidden', tab !== 'modulos');
            if (subComisiones) subComisiones.classList.toggle('hidden', tab !== 'comisiones');
            if (subVisibilidad) subVisibilidad.classList.toggle('hidden', tab !== 'visibilidad');

            aplicarEstiloTab(btnUsuarios, tab === 'usuarios', 'bg-purple-700 text-white shadow-sm');
            aplicarEstiloTab(btnEmpresas, tab === 'empresas', 'bg-blue-600 text-white shadow-sm shadow-blue-600/20');
            aplicarEstiloTab(btnModulos, tab === 'modulos', 'bg-amber-600 text-white shadow-sm shadow-amber-600/20');
            aplicarEstiloTab(btnComisiones, tab === 'comisiones', 'bg-emerald-600 text-white shadow-sm shadow-emerald-600/20');
            aplicarEstiloTab(btnVisibilidad, tab === 'visibilidad', 'bg-indigo-600 text-white shadow-sm shadow-indigo-600/20');

            if (tab === 'usuarios') {
                cargarListaUsuarios();
            } else if (tab === 'empresas') {
                cargarEmpresasConfigAdmin();
            } else if (tab === 'modulos') {
                cargarMenuModulosAdmin();
            } else if (tab === 'comisiones') {
                if (typeof cargarConfigComisionesAdmin === 'function') {
                    cargarConfigComisionesAdmin();
                }
            } else if (tab === 'visibilidad') {
                if (typeof cargarModuloVisibilidad === 'function') {
                    cargarModuloVisibilidad();
                }
            }
        }

        function irAConfiguracionVisibilidad(subSeccion = 'sucursales') {
            activarTab('configuracion');
            irASubTabConfiguracion('visibilidad');
            if (typeof cambiarSubSeccionVisibilidad === 'function') {
                cambiarSubSeccionVisibilidad(subSeccion);
            }
        }
        window.irAConfiguracionVisibilidad = irAConfiguracionVisibilidad;

        async function cargarListaUsuarios() {
            try {
                const res = await fetch('/api/usuarios');
                const data = await res.json();
                if (!data.success) {
                    if (res.status === 403) {
                        mostrarAlerta('error', 'No tienes permiso para ver o gestionar usuarios.');
                    }
                    return;
                }

                listaUsuariosCache = data.usuarios || [];
                actualizarKpisUsuarios(listaUsuariosCache);
                renderizarTablaUsuarios(listaUsuariosCache);
            } catch (err) {
                console.error("Error al cargar usuarios:", err);
            }
        }

        function actualizarKpisUsuarios(usuarios) {
            const elTotal = document.getElementById('kpiUsuariosTotal');
            const elActivos = document.getElementById('kpiUsuariosActivos');
            const elAdmins = document.getElementById('kpiUsuariosAdmins');
            const elBadge = document.getElementById('badgeContadorUsuarios');

            const total = usuarios.length;
            const activos = usuarios.filter(u => u.activo).length;
            const admins = usuarios.filter(u => u.rol === 'ADMIN').length;

            if (elTotal) elTotal.textContent = total;
            if (elActivos) elActivos.textContent = `${activos} activos`;
            if (elAdmins) elAdmins.textContent = admins;
            if (elBadge) elBadge.textContent = `${total} cuentas`;
        }

        function renderizarTablaUsuarios(usuarios) {
            const tbody = document.getElementById('tbodyUsuarios');
            if (!tbody) return;

            if (!usuarios.length) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="7" class="p-8 text-center text-slate-400 italic">No se encontraron usuarios registrados.</td>
                    </tr>
                `;
                return;
            }

            const nombresPermisos = {
                'almacen': { label: 'Almacén (completo)', icon: '🏬', bg: 'bg-amber-50 text-amber-800 border-amber-200' },
                'almacen_traspasos': { label: 'Alm: Traspasos', icon: '📦', bg: 'bg-amber-50 text-amber-700 border-amber-200' },
                'almacen_stock': { label: 'Alm: Catálogo', icon: '🏢', bg: 'bg-amber-50 text-amber-700 border-amber-200' },
                'almacen_recepcion': { label: 'Alm: Recepción OC', icon: '📥', bg: 'bg-amber-50 text-amber-700 border-amber-200' },
                'almacen_cascos': { label: 'Alm: Control de Cascos', icon: '🪖', bg: 'bg-amber-50 text-amber-700 border-amber-200' },
                'ventas': { label: 'Ventas (completo)', icon: '💵', bg: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
                'ventas_pv': { label: 'Punto de Venta', icon: '🛒', bg: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
                'ventas_tickets': { label: 'Historial Tickets', icon: '🧾', bg: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
                'vendedores_comisiones': { label: 'Vendedores y Comisiones', icon: '👨‍💼', bg: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
                'compras': { label: 'Compras (completo)', icon: '🛍️', bg: 'bg-red-50 text-red-800 border-red-200' },
                'resurtidos': { label: 'Resurtidos', icon: '📊', bg: 'bg-red-50 text-red-700 border-red-200' },
                'compras_solicitudes': { label: 'Validar Traspasos PV', icon: '🚚', bg: 'bg-amber-50 text-amber-700 border-amber-200' },
                'dashboard': { label: 'Tablero', icon: '📊', bg: 'bg-blue-50 text-blue-700 border-blue-200' },
                'administracion': { label: 'Administración', icon: '💼', bg: 'bg-slate-100 text-slate-800 border-slate-200' },
                'modulo1': { label: 'Recepción', icon: '📥', bg: 'bg-red-50 text-red-700 border-red-200' },
                'modulo2': { label: 'Precios', icon: '📈', bg: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
                'modulo3': { label: 'Traspasos', icon: '🚚', bg: 'bg-blue-50 text-blue-700 border-blue-200' },
                'modulo4': { label: 'Buscador', icon: '🔍', bg: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
                'sucursales': { label: 'Sucursales', icon: '🏪', bg: 'bg-cyan-50 text-cyan-700 border-cyan-200' },
                'nominas': { label: 'Nóminas (completo)', icon: '👥', bg: 'bg-teal-50 text-teal-800 border-teal-200' },
                'nominas_reloj': { label: 'Reloj Checador', icon: '⏱️', bg: 'bg-teal-50 text-teal-700 border-teal-200' },
                'bot_whatsapp': { label: 'Bot WhatsApp', icon: '💬', bg: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
                'configuracion': { label: 'Configuración', icon: '⚙️', bg: 'bg-purple-50 text-purple-700 border-purple-200' },
                'config_usuarios': { label: 'Usuarios y Permisos', icon: '👥', bg: 'bg-purple-50 text-purple-700 border-purple-200' },
                'config_empresas': { label: 'Empresas', icon: '🏢', bg: 'bg-purple-50 text-purple-700 border-purple-200' },
                'config_modulos': { label: 'Menús y Módulos', icon: '🧩', bg: 'bg-purple-50 text-purple-700 border-purple-200' },
                'config_comisiones': { label: 'Políticas y Comisiones', icon: '💰', bg: 'bg-emerald-50 text-emerald-700 border-emerald-200' }
            };

            tbody.innerHTML = usuarios.map(u => {
                const inicial = (u.nombre || u.usuario || 'U').charAt(0).toUpperCase();
                const esAdmin = u.rol === 'ADMIN' || (Array.isArray(u.permisos) && u.permisos.includes('*'));

                let pillsHtml = '';
                if (esAdmin) {
                    pillsHtml = `<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-black bg-purple-100 text-purple-800 border border-purple-300">⚡ Todos los Módulos (Acceso Total)</span>`;
                } else {
                    const permisosArr = Array.isArray(u.permisos) ? u.permisos : [];
                    if (!permisosArr.length) {
                        pillsHtml = `<span class="text-[10px] text-slate-400 italic">Sin módulos asignados</span>`;
                    } else {
                        pillsHtml = `<div class="flex flex-wrap items-center gap-1.5">` + permisosArr.map(p => {
                            const info = nombresPermisos[p] || { label: p, icon: '•', bg: 'bg-slate-100 text-slate-700' };
                            return `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold border ${info.bg}">${info.icon} ${info.label}</span>`;
                        }).join('') + `</div>`;
                    }
                }

                const badgeRol = u.rol === 'ADMIN'
                    ? `<span class="px-2 py-0.5 bg-purple-100 text-purple-800 rounded-lg text-[10px] font-black border border-purple-200">ADMIN</span>`
                    : (u.rol === 'VENDEDOR_SUCURSAL'
                        ? `<span class="px-2 py-0.5 bg-indigo-100 text-indigo-800 rounded-lg text-[10px] font-black border border-indigo-200">VENDEDOR SUCURSAL</span>`
                        : `<span class="px-2 py-0.5 bg-slate-100 text-slate-700 rounded-lg text-[10px] font-bold border border-slate-200">USUARIO</span>`);

                const sucursalHtml = u.sucursal_nombre
                    ? `<div class="font-bold text-slate-800 text-[11px] flex items-center gap-1.5"><span class="text-indigo-600">🏪</span> ${u.sucursal_nombre}</div>` +
                      (u.vendedor_nombre ? `<div class="text-[10px] text-slate-400">👤 ${u.vendedor_nombre}</div>` : '')
                    : `<span class="text-[10px] text-slate-400 italic">Todas / Matriz</span>`;

                const badgeActivo = u.activo
                    ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200"><span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> Activo</span>`
                    : `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-400 border border-slate-200"><span class="w-1.5 h-1.5 rounded-full bg-slate-400"></span> Inactivo</span>`;

                const btnToggleTexto = u.activo ? 'Desactivar' : 'Activar';
                const btnToggleColor = u.activo ? 'text-amber-600 hover:bg-amber-50' : 'text-emerald-600 hover:bg-emerald-50';

                const puedeEliminar = u.usuario.toLowerCase() !== 'admin';

                return `
                    <tr class="hover:bg-slate-50/80 transition">
                        <td class="p-3 pl-4">
                            <div class="flex items-center gap-2.5">
                                <div class="w-8 h-8 rounded-full bg-slate-800 text-white flex items-center justify-center font-black text-xs shadow-xs">
                                    ${inicial}
                                </div>
                                <div>
                                    <div class="font-bold text-slate-900 leading-tight">@${u.usuario}</div>
                                    <div class="text-[10px] text-slate-400">ID #${u.id}</div>
                                </div>
                            </div>
                        </td>
                        <td class="p-3 font-semibold text-slate-800">${u.nombre}</td>
                        <td class="p-3">${badgeRol}</td>
                        <td class="p-3">${sucursalHtml}</td>
                        <td class="p-3">${pillsHtml}</td>
                        <td class="p-3 text-center">${badgeActivo}</td>
                        <td class="p-3 text-center text-[10px] text-slate-400 font-medium">
                            ${u.ultimo_login || '<span class="italic text-slate-300">Nunca</span>'}
                        </td>
                        <td class="p-3 pr-4 text-right">
                            <div class="flex items-center justify-end gap-1.5">
                                <button type="button" onclick="abrirModalEditarUsuario(${u.id})" class="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-lg text-xs transition flex items-center gap-1" title="Editar cuenta y permisos">
                                    <span>✏️</span> <span>Permisos</span>
                                </button>
                                ${puedeEliminar ? `
                                    <button type="button" onclick="toggleActivoUsuario(${u.id})" class="px-2 py-1 ${btnToggleColor} font-bold rounded-lg text-xs transition border border-transparent hover:border-current" title="${btnToggleTexto} acceso">
                                        ${u.activo ? '⏸️' : '▶️'}
                                    </button>
                                    <button type="button" onclick="eliminarUsuario(${u.id}, '${u.usuario}')" class="px-2 py-1 text-rose-600 hover:bg-rose-50 font-bold rounded-lg text-xs transition" title="Eliminar usuario">
                                        🗑️
                                    </button>
                                ` : ''}
                            </div>
                        </td>
                    </tr>
                `;
            }).join('');
        }

        function filtrarUsuariosEnTabla() {
            const query = (document.getElementById('filtroBuscarUsuario')?.value || '').trim().toLowerCase();
            const rol = document.getElementById('filtroRolUsuario')?.value || '';

            const filtrados = listaUsuariosCache.filter(u => {
                const coincideTexto = !query || u.nombre.toLowerCase().includes(query) || u.usuario.toLowerCase().includes(query);
                const coincideRol = !rol || u.rol === rol;
                return coincideTexto && coincideRol;
            });
            renderizarTablaUsuarios(filtrados);
        }

        function copiarLigaRed() {
            const url = urlRedLocalActual || window.location.origin || 'http://192.168.1.253:6060';
            if (navigator.clipboard) {
                navigator.clipboard.writeText(url).then(() => {
                    mostrarAlerta('success', `Enlace de red copiado al portapapeles: <strong>${url}</strong> (compártelo con tus compañeros).`, 5000);
                }).catch(() => {
                    window.prompt('Copia este enlace para tus compañeros:', url);
                });
            } else {
                window.prompt('Copia este enlace para tus compañeros:', url);
            }
        }

        let catalogoSucursalesVendedoresCache = null;

        async function cargarCatalogoSucursalesVendedores() {
            if (catalogoSucursalesVendedoresCache) return catalogoSucursalesVendedoresCache;
            try {
                const res = await fetch('/api/catalogos/sucursales-vendedores');
                const data = await res.json();
                if (data.success) {
                    catalogoSucursalesVendedoresCache = data;
                    poblarSelectsSucursalesVendedores(data);
                    return data;
                }
            } catch (e) {
                console.error("Error al cargar sucursales y vendedores:", e);
            }
            return null;
        }

        function poblarSelectsSucursalesVendedores(data) {
            const selSuc = document.getElementById('usuarioSucursal');
            const selVen = document.getElementById('usuarioVendedor');
            if (selSuc && data.sucursales) {
                let optsSuc = '<option value="">-- Sin sucursal (Todas las sucursales) --</option>';
                data.sucursales.forEach(s => {
                    optsSuc += `<option value="${s.id}">${s.nombre}</option>`;
                });
                selSuc.innerHTML = optsSuc;
            }
            if (selVen && data.vendedores) {
                let optsVen = '<option value="">-- Predeterminado de la sucursal --</option>';
                data.vendedores.forEach(v => {
                    optsVen += `<option value="${v.id}">${v.nombre}</option>`;
                });
                selVen.innerHTML = optsVen;
            }
        }

        function alCambiarSucursalUsuario(sucId) {
            if (!sucId || !catalogoSucursalesVendedoresCache) return;
            const selSuc = document.getElementById('usuarioSucursal');
            const selVen = document.getElementById('usuarioVendedor');
            if (!selSuc || !selVen) return;

            const nomSuc = selSuc.options[selSuc.selectedIndex]?.text?.toUpperCase() || '';
            const palabras = nomSuc.replace("SUCURSAL", "").replace("NO UTILIZAR", "").trim().split(/\s+/).filter(w => w.length > 3);

            if (catalogoSucursalesVendedoresCache.vendedores) {
                for (let p of palabras) {
                    const match = catalogoSucursalesVendedoresCache.vendedores.find(v => v.nombre.toUpperCase().includes(p));
                    if (match) {
                        selVen.value = match.id;
                        break;
                    }
                }
            }
        }
        window.alCambiarSucursalUsuario = alCambiarSucursalUsuario;

        async function abrirModalNuevoUsuario() {
            document.getElementById('formUsuario').reset();
            document.getElementById('usuarioEditId').value = '';
            document.getElementById('modalUsuarioTitulo').textContent = 'Crear Nuevo Usuario';
            document.getElementById('labelPasswordRequerido').classList.remove('hidden');
            document.getElementById('usuarioPassword').required = true;
            document.getElementById('txtPasswordAyuda').textContent = 'Mínimo 4 caracteres';
            document.getElementById('usuarioLogin').disabled = false;
            document.getElementById('modalUsuarioError').classList.add('hidden');

            aplicarPerfilRapido('vendedor');

            await cargarCatalogoSucursalesVendedores();
            const selSuc = document.getElementById('usuarioSucursal');
            const selVen = document.getElementById('usuarioVendedor');
            if (selSuc) selSuc.value = '';
            if (selVen) selVen.value = '';

            document.getElementById('modalUsuario').classList.remove('hidden');
        }

        async function abrirModalEditarUsuario(id) {
            const user = listaUsuariosCache.find(u => u.id === id);
            if (!user) return;

            document.getElementById('usuarioEditId').value = user.id;
            document.getElementById('modalUsuarioTitulo').textContent = `Editar Usuario: @${user.usuario}`;
            document.getElementById('usuarioNombre').value = user.nombre;
            document.getElementById('usuarioLogin').value = user.usuario;
            document.getElementById('usuarioLogin').disabled = (user.usuario.toLowerCase() === 'admin');
            
            document.getElementById('usuarioPassword').value = '';
            document.getElementById('usuarioPassword').required = false;
            document.getElementById('labelPasswordRequerido').classList.add('hidden');
            document.getElementById('txtPasswordAyuda').textContent = 'Dejar en blanco para conservar la contraseña actual';

            document.getElementById('usuarioRol').value = user.rol || 'USUARIO';
            document.getElementById('usuarioActivo').checked = !!user.activo;
            document.getElementById('modalUsuarioError').classList.add('hidden');

            await cargarCatalogoSucursalesVendedores();
            const selSuc = document.getElementById('usuarioSucursal');
            const selVen = document.getElementById('usuarioVendedor');
            if (selSuc) selSuc.value = user.sucursal_id || '';
            if (selVen) selVen.value = user.vendedor_id || '';

            const esAdmin = user.rol === 'ADMIN' || (Array.isArray(user.permisos) && user.permisos.includes('*'));
            if (esAdmin) {
                marcarTodosPermisos(true);
            } else {
                cargarPermisosEnModal(Array.isArray(user.permisos) ? user.permisos : []);
            }

            document.getElementById('modalUsuario').classList.remove('hidden');
        }

        function cerrarModalUsuario() {
            document.getElementById('modalUsuario').classList.add('hidden');
        }

        // Marca en el modal los permisos dados; un permiso de módulo completo marca todos sus submódulos
        function cargarPermisosEnModal(perms) {
            document.querySelectorAll('.chk-permiso, .chk-permiso-padre').forEach(chk => {
                chk.checked = perms.includes(chk.value);
            });
            Object.keys(MAPA_SUBMODULOS).forEach(m => {
                if (perms.includes(m)) alCambiarModuloPadre(m, true);
                else alCambiarSubmodulo(m);
            });
        }

        function marcarTodosPermisos(marcar) {
            document.querySelectorAll('.chk-permiso, .chk-permiso-padre').forEach(chk => chk.checked = !!marcar);
        }

        // Al marcar/desmarcar el módulo, se aplican todos sus submódulos
        function alCambiarModuloPadre(modulo, marcado) {
            document.querySelectorAll(`.chk-permiso[data-padre='${modulo}']`).forEach(chk => chk.checked = !!marcado);
            const padre = document.querySelector(`.chk-permiso-padre[data-modulo='${modulo}']`);
            if (padre) { padre.checked = !!marcado; padre.indeterminate = false; }
        }

        // Al cambiar un submódulo: el módulo queda completo, parcial (indeterminado) o vacío
        function alCambiarSubmodulo(modulo) {
            const subs = [...document.querySelectorAll(`.chk-permiso[data-padre='${modulo}']`)];
            const padre = document.querySelector(`.chk-permiso-padre[data-modulo='${modulo}']`);
            if (!padre || !subs.length) return;
            const n = subs.filter(c => c.checked).length;
            padre.checked = n === subs.length;
            padre.indeterminate = n > 0 && n < subs.length;
        }

        function aplicarPerfilRapido(perfil) {
            if (perfil === 'todos') return marcarTodosPermisos(true);
            const PERFILES = {
                ninguno: [],
                vendedor: ['dashboard', 'ventas_pv', 'ventas_tickets', 'modulo4'],
                almacen: ['dashboard', 'almacen_traspasos', 'almacen_stock', 'almacen_recepcion', 'modulo4'],
                atencion: ['dashboard', 'bot_whatsapp', 'sucursales_recepcion', 'modulo4']
            };
            cargarPermisosEnModal(PERFILES[perfil] || []);
        }

        function alCambiarRolUsuario(rol) {
            if (rol === 'ADMIN') {
                marcarTodosPermisos(true);
            } else if (rol === 'VENDEDOR_SUCURSAL') {
                aplicarPerfilRapido('vendedor');
            }
        }

        async function guardarUsuarioSubmit(e) {
            e.preventDefault();
            const editId = document.getElementById('usuarioEditId').value;
            const nombre = document.getElementById('usuarioNombre').value.trim();
            const usuario = document.getElementById('usuarioLogin').value.trim().toLowerCase();
            const password = document.getElementById('usuarioPassword').value.trim();
            const rol = document.getElementById('usuarioRol').value;
            const activo = document.getElementById('usuarioActivo').checked;
            const errBox = document.getElementById('modalUsuarioError');
            errBox.classList.add('hidden');

            const selSuc = document.getElementById('usuarioSucursal');
            const sucursal_id = selSuc && selSuc.value ? parseInt(selSuc.value) : null;
            const sucursal_nombre = selSuc && selSuc.selectedIndex > 0 ? selSuc.options[selSuc.selectedIndex].text : '';

            const selVen = document.getElementById('usuarioVendedor');
            const vendedor_id = selVen && selVen.value ? parseInt(selVen.value) : null;
            const vendedor_nombre = selVen && selVen.selectedIndex > 0 ? selVen.options[selVen.selectedIndex].text : '';

            const permisosSeleccionados = [];
            if (rol === 'ADMIN') {
                permisosSeleccionados.push('*');
            } else {
                document.querySelectorAll('.chk-permiso:checked, .chk-permiso-padre:checked').forEach(chk => {
                    if (!permisosSeleccionados.includes(chk.value)) permisosSeleccionados.push(chk.value);
                });
            }

            const payload = {
                nombre,
                usuario,
                rol,
                permisos: permisosSeleccionados,
                activo,
                sucursal_id,
                sucursal_nombre,
                vendedor_id,
                vendedor_nombre
            };
            if (password) payload.password = password;

            try {
                let res;
                if (editId) {
                    res = await fetch(`/api/usuarios/${editId}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });
                } else {
                    res = await fetch('/api/usuarios', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });
                }

                const data = await res.json();
                if (res.ok && data.success) {
                    cerrarModalUsuario();
                    mostrarAlerta('success', data.mensaje || 'Usuario guardado correctamente.');
                    await cargarListaUsuarios();
                    if (currentUser && currentUser.usuario.toLowerCase() === usuario.toLowerCase()) {
                        verificarSesion();
                    }
                } else {
                    errBox.textContent = data.error || 'Ocurrió un error al guardar el usuario.';
                    errBox.classList.remove('hidden');
                }
            } catch (err) {
                errBox.textContent = 'Error de conexión con el servidor.';
                errBox.classList.remove('hidden');
            }
        }

        async function toggleActivoUsuario(id) {
            try {
                const res = await fetch(`/api/usuarios/${id}/toggle-activo`, { method: 'POST' });
                const data = await res.json();
                if (res.ok && data.success) {
                    mostrarAlerta('success', data.mensaje);
                    await cargarListaUsuarios();
                } else {
                    mostrarAlerta('error', data.error || 'No se pudo cambiar el estado del usuario.');
                }
            } catch (err) {
                mostrarAlerta('error', 'Error al comunicar con el servidor.');
            }
        }

        async function eliminarUsuario(id, username) {
            if (!confirm(`¿Estás seguro de que deseas eliminar permanentemente al usuario '@${username}'?`)) return;
            try {
                const res = await fetch(`/api/usuarios/${id}`, { method: 'DELETE' });
                const data = await res.json();
                if (res.ok && data.success) {
                    mostrarAlerta('success', data.mensaje);
                    await cargarListaUsuarios();
                } else {
                    mostrarAlerta('error', data.error || 'No se pudo eliminar el usuario.');
                }
            } catch (err) {
                mostrarAlerta('error', 'Error al comunicar con el servidor.');
            }
        }


        // ================= GESTIÓN DE SUBMÓDULO EMPRESAS (CONFIGURACIÓN) =================
        let empresasConfigCache = [];

        async function cargarEmpresasConfigAdmin() {
            try {
                const res = await fetch('/api/empresas?todas=true');
                const data = await res.json();
                empresasConfigCache = data.empresas || [];
                actualizarKpisEmpresas(empresasConfigCache);
                renderizarTablaConfigEmpresas(empresasConfigCache, data.activa);
            } catch (err) {
                console.error("Error al cargar configuración de empresas:", err);
                mostrarAlerta('error', 'No se pudo cargar la lista de empresas.');
            }
        }

        function actualizarKpisEmpresas(empresas) {
            const elTotal = document.getElementById('kpiEmpresasTotal');
            const elVisibles = document.getElementById('kpiEmpresasVisibles');
            const elOcultas = document.getElementById('kpiEmpresasOcultas');

            const total = empresas.length;
            const visibles = empresas.filter(e => e.visible !== false).length;
            const ocultas = total - visibles;

            if (elTotal) elTotal.textContent = `${total} bases`;
            if (elVisibles) elVisibles.textContent = `${visibles} activas`;
            if (elOcultas) elOcultas.textContent = `${ocultas} ocultas`;
        }

        function renderizarTablaConfigEmpresas(empresas, activaId) {
            const tbody = document.getElementById('tbodyConfigEmpresas');
            if (!tbody) return;

            if (!empresas.length) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="6" class="p-8 text-center text-slate-400 italic">No hay empresas registradas.</td>
                    </tr>
                `;
                return;
            }

            tbody.innerHTML = empresas.map((emp, idx) => {
                const esActiva = (emp.id === activaId);
                const esVisible = (emp.visible !== false);

                return `
                    <tr class="hover:bg-slate-50 transition border-b border-slate-100">
                        <td class="p-3.5 pl-4">
                            <div class="flex items-center gap-3">
                                <div class="w-8 h-8 rounded-xl bg-slate-100 flex items-center justify-center font-bold text-xs text-slate-700">
                                    🏢
                                </div>
                                <div>
                                    <div class="font-bold text-slate-900">${emp.nombre || emp.id}</div>
                                    <div class="text-[10px] text-slate-400 font-mono">Logo: ${emp.logo || 'logo bc'}</div>
                                </div>
                            </div>
                        </td>
                        <td class="p-3.5">
                            <div class="flex items-center gap-1.5 flex-wrap">
                                <span class="font-mono text-xs font-semibold text-slate-700 bg-slate-100 px-2 py-1 rounded-lg border border-slate-200">${emp.dsn || emp.archivo || emp.id}</span>
                                ${emp.empresa_id ? `<span class="text-[10px] text-blue-700 font-bold bg-blue-50 px-1.5 py-0.5 rounded border border-blue-200" title="ID en Microsip">ID: ${emp.empresa_id}</span>` : ''}
                            </div>
                        </td>
                        <td class="p-3.5 text-center">
                            ${esActiva 
                                ? `<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-100 text-emerald-800 border border-emerald-200">● Conectada Ahora</span>`
                                : `<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold text-slate-400 bg-slate-100 border border-slate-200">En espera</span>`
                            }
                        </td>
                        <td class="p-3.5 text-center">
                            <button type="button" onclick="toggleVisibilidadEmpresa('${emp.id}')" class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition shadow-xs cursor-pointer ${
                                esVisible 
                                    ? 'bg-emerald-500 hover:bg-emerald-600 text-white' 
                                    : 'bg-slate-200 hover:bg-slate-300 text-slate-700'
                            }" title="${esVisible ? 'Clic para ocultar en el sistema' : 'Clic para mostrar en el sistema'}">
                                <span>${esVisible ? '👁️ Visible (Se muestra)' : '🚫 Oculta (No se muestra)'}</span>
                            </button>
                        </td>
                        <td class="p-3.5 text-center">
                            <button type="button" onclick="probarConexionEmpresa('${emp.id}')" id="btnTestConn_${emp.id}" class="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-[11px] rounded-lg transition border border-slate-200 cursor-pointer">
                                🔌 Probar ODBC
                            </button>
                        </td>
                        <td class="p-3.5 pr-4 text-right">
                            <button type="button" onclick="abrirModalNuevaEmpresa(${idx})" class="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition" title="Editar empresa">
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
                            </button>
                        </td>
                    </tr>
                `;
            }).join('');
        }

        function toggleVisibilidadEmpresa(empId) {
            const emp = empresasConfigCache.find(e => e.id === empId);
            if (!emp) return;
            emp.visible = !(emp.visible !== false);
            actualizarKpisEmpresas(empresasConfigCache);
            renderizarTablaConfigEmpresas(empresasConfigCache, document.getElementById('selectEmpresa')?.value);
            
            const btnGuardar = document.getElementById('btnGuardarEmpresasConfig');
            if (btnGuardar) {
                btnGuardar.classList.add('animate-pulse');
            }
        }

        async function sincronizarEmpresasMicrosip() {
            mostrarAlerta('info', 'Consultando empresas registradas en el servidor Microsip...');
            try {
                const res = await fetch('/api/config/empresas/sincronizar-microsip', { method: 'POST' });
                const data = await res.json();
                if (res.ok && data.success) {
                    mostrarAlerta('success', data.mensaje || 'Empresas sincronizadas con éxito desde Microsip.');
                    await cargarEmpresasConfigAdmin();
                    await cargarEmpresas();
                } else {
                    mostrarAlerta('error', data.error || 'No se pudo sincronizar desde Microsip.');
                }
            } catch (err) {
                console.error(err);
                mostrarAlerta('error', 'Error de conexión con el servidor Microsip.');
            }
        }

        async function guardarVisibilidadEmpresas() {
            const btnGuardar = document.getElementById('btnGuardarEmpresasConfig');
            const originalText = btnGuardar ? btnGuardar.innerHTML : '';
            if (btnGuardar) {
                btnGuardar.disabled = true;
                btnGuardar.innerHTML = '<span>Guardando...</span>';
            }

            try {
                const res = await fetch('/api/config/empresas', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ empresas: empresasConfigCache })
                });
                const data = await res.json();
                if (res.ok && data.success) {
                    mostrarAlerta('success', 'Configuración de empresas guardada correctamente.');
                    if (btnGuardar) btnGuardar.classList.remove('animate-pulse');
                    await cargarEmpresas();
                    await cargarEmpresasConfigAdmin();
                } else {
                    mostrarAlerta('error', data.error || 'No se pudo guardar la configuración de empresas.');
                }
            } catch (err) {
                console.error(err);
                mostrarAlerta('error', 'Error al comunicar con el servidor.');
            } finally {
                if (btnGuardar) {
                    btnGuardar.disabled = false;
                    btnGuardar.innerHTML = originalText;
                }
            }
        }

        function abrirModalNuevaEmpresa(index = -1) {
            const form = document.getElementById('formNuevaEmpresa');
            if (form) form.reset();
            const errBox = document.getElementById('modalEmpresaError');
            if (errBox) errBox.classList.add('hidden');

            document.getElementById('empresaEditIndex').value = index;
            if (index >= 0 && empresasConfigCache[index]) {
                const emp = empresasConfigCache[index];
                document.getElementById('modalEmpresaTitulo').textContent = `Editar Empresa: ${emp.nombre || emp.id}`;
                document.getElementById('empresaNombreInput').value = emp.nombre || '';
                document.getElementById('empresaIdInput').value = emp.id || '';
                document.getElementById('empresaIdInput').disabled = true;
                document.getElementById('empresaDsnInput').value = emp.dsn || emp.id || '';
                document.getElementById('empresaLogoInput').value = emp.logo || 'logo bc';
                document.getElementById('empresaVisibleInput').checked = (emp.visible !== false);
            } else {
                document.getElementById('modalEmpresaTitulo').textContent = 'Registrar Nueva Empresa';
                document.getElementById('empresaIdInput').disabled = false;
                document.getElementById('empresaVisibleInput').checked = true;
            }

            document.getElementById('modalNuevaEmpresa').classList.remove('hidden');
        }

        function cerrarModalNuevaEmpresa() {
            document.getElementById('modalNuevaEmpresa').classList.add('hidden');
        }

        async function guardarNuevaEmpresaSubmit(e) {
            e.preventDefault();
            const idx = parseInt(document.getElementById('empresaEditIndex').value, 10);
            const id = document.getElementById('empresaIdInput').value.trim();
            const nombre = document.getElementById('empresaNombreInput').value.trim();
            const dsn = document.getElementById('empresaDsnInput').value.trim();
            const logo = document.getElementById('empresaLogoInput').value.trim() || 'logo bc';
            const visible = document.getElementById('empresaVisibleInput').checked;

            if (!id || !nombre || !dsn) {
                const errBox = document.getElementById('modalEmpresaError');
                if (errBox) {
                    errBox.textContent = 'Por favor completa todos los campos requeridos.';
                    errBox.classList.remove('hidden');
                }
                return;
            }

            if (idx >= 0 && empresasConfigCache[idx]) {
                empresasConfigCache[idx].nombre = nombre;
                empresasConfigCache[idx].dsn = dsn;
                empresasConfigCache[idx].logo = logo;
                empresasConfigCache[idx].visible = visible;
            } else {
                const existe = empresasConfigCache.some(emp => emp.id.toLowerCase() === id.toLowerCase());
                if (existe) {
                    const errBox = document.getElementById('modalEmpresaError');
                    if (errBox) {
                        errBox.textContent = `Ya existe una empresa con el ID '${id}'.`;
                        errBox.classList.remove('hidden');
                    }
                    return;
                }
                empresasConfigCache.push({ id, nombre, dsn, logo, visible });
            }

            cerrarModalNuevaEmpresa();
            await guardarVisibilidadEmpresas();
        }

        async function probarConexionEmpresa(empId) {
            const btn = document.getElementById(`btnTestConn_${empId}`);
            if (btn) btn.textContent = '⏳ Probando...';
            try {
                const res = await fetch('/api/seleccionar-empresa', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ empresa_id: empId })
                });
                const data = await res.json();
                if (res.ok && data.success) {
                    if (btn) {
                        btn.textContent = '✅ Conectó OK';
                        btn.className = "px-2.5 py-1 bg-emerald-100 text-emerald-800 font-bold text-[11px] rounded-lg transition border border-emerald-300";
                    }
                    setTimeout(() => {
                        if (btn) {
                            btn.textContent = '🔌 Probar ODBC';
                            btn.className = "px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-[11px] rounded-lg transition border border-slate-200 cursor-pointer";
                        }
                    }, 4000);
                } else {
                    if (btn) {
                        btn.textContent = '❌ Falló DSN';
                        btn.className = "px-2.5 py-1 bg-rose-100 text-rose-800 font-bold text-[11px] rounded-lg transition border border-rose-300";
                    }
                }
            } catch (err) {
                if (btn) btn.textContent = '❌ Error Red';
            }
        }


        // ================= GESTOR DE MENÚS Y MÓDULOS (CONFIGURACIÓN) =================
        let menuModulosCache = [];
        let modulosCustomInfo = {};
        let arrastrandoSubmodulo = null; // { subId, sourcePadreId }

        function aplicarEstructuraMenuEnSidebar(menu) {
            if (!Array.isArray(menu) || menu.length === 0) return;

            // 1. Reconstruir MAPA_SUBMODULOS y PADRE_DE dinámicamente
            for (const k in MAPA_SUBMODULOS) delete MAPA_SUBMODULOS[k];
            for (const k in PADRE_DE) delete PADRE_DE[k];

            menu.forEach(item => {
                if (item.tipo === 'agrupador' && Array.isArray(item.submodulos)) {
                    MAPA_SUBMODULOS[item.id] = item.submodulos.map(s => s.id);
                    item.submodulos.forEach(s => {
                        PADRE_DE[s.id] = item.id;
                    });
                }
            });

            // Aliases de submódulos conocidos
            PADRE_DE['ventas_pv'] = PADRE_DE['puntoventa'] || 'ventas';
            PADRE_DE['puntoventa'] = PADRE_DE['puntoventa'] || PADRE_DE['ventas_pv'] || 'ventas';

            // 2. Mapeos de IDs de elementos del DOM
            const MAPA_DOM_SUBMODULOS = {
                puntoventa: 'sidebarItemPuntoVenta',
                ventas_pv: 'sidebarItemPuntoVenta',
                ventas_tickets: 'sidebarItemVentasTickets',
                vendedores_comisiones: 'sidebarItemVendedoresComisiones',
                bot_whatsapp: 'sidebarItemBotWhatsapp',
                almacen_traspasos: 'sidebarItemAlmEscaner',
                almacen_stock: 'sidebarItemAlmCatalogo',
                almacen_recepcion: 'sidebarItemAlmRecepcion',
                almacen_cascos: 'sidebarItemAlmCascos',
                almacen_embarques: 'sidebarItemAlmEmbarques',
                sucursales_recepcion: 'sidebarItemSucRecepcion',
                resurtidos: 'sidebarItemResurtidos',
                compras_solicitudes: 'sidebarItemComprasSolicitudes',
                catalogo_maestro: 'sidebarItemCustom_catalogo_maestro',
                modulo1: 'sidebarItemM1',
                modulo2: 'sidebarItemM2',
                modulo3: 'sidebarItemM3',
                modulo4: 'sidebarItemM4',
                nominas_reloj: 'sidebarItemNominasReloj',
                config_usuarios: 'sidebarItemConfigUsuarios',
                config_empresas: 'sidebarItemConfigEmpresas',
                config_modulos: 'sidebarItemConfigModulos',
                config_comisiones: 'sidebarItemConfigComisiones'
            };

            const MAPA_DOM_ACORDEONES = {
                ventas: 'sidebarSubmenuVentas',
                almacen: 'sidebarSubmenuAlmacen',
                compras: 'sidebarSubmenuCompras',
                sucursales: 'sidebarSubmenuSucursales',
                nominas: 'sidebarSubmenuNominas',
                configuracion: 'sidebarSubmenuConfiguracion'
            };

            const MAPA_DOM_MODULOS_PADRE = {
                dashboard: 'sidebarItemDashboard',
                ventas: 'sidebarItemVentas',
                almacen: 'sidebarItemAlmacen',
                compras: 'sidebarItemCompras',
                sucursales: 'sidebarItemSucursales',
                nominas: 'sidebarItemNominas',
                administracion: 'sidebarItemAdministracion',
                configuracion: 'sidebarItemConfiguracion'
            };

            // 3. Mover y reordenar submódulos dentro de cada acordeón
            menu.forEach(item => {
                if (item.tipo === 'agrupador') {
                    const subContId = MAPA_DOM_ACORDEONES[item.id];
                    const subCont = subContId ? document.getElementById(subContId) : null;
                    const modPadreEl = document.getElementById(MAPA_DOM_MODULOS_PADRE[item.id]);

                    if (modPadreEl) {
                        if (item.visible === false) {
                            modPadreEl.classList.add('hidden');
                        } else {
                            modPadreEl.classList.remove('hidden');
                        }
                    }

                    if (subCont && Array.isArray(item.submodulos)) {
                        item.submodulos.forEach(sub => {
                            const domSubId = MAPA_DOM_SUBMODULOS[sub.id] || ('sidebarItemCustom_' + sub.id);
                            let subEl = document.getElementById(domSubId);

                            if (!subEl) {
                                subEl = document.createElement('div');
                                subEl.id = domSubId;
                                const titulo = sub.titulo || sub.nombre || sub.id;
                                const icono = sub.icono || '🧩';
                                subEl.innerHTML = `
                                    <button type="button" onclick="activarTab('${sub.id}')" class="sidebar-item dropdown-item flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-bold text-slate-300 hover:text-white hover:bg-white/10 transition cursor-pointer">
                                        <span class="text-base">${icono}</span>
                                        <span>${titulo}</span>
                                    </button>
                                `;
                            }

                            // Mover físicamente el elemento al acordeón padre en orden
                            subCont.appendChild(subEl);

                            if (sub.visible === false) {
                                subEl.classList.add('hidden');
                            } else {
                                subEl.classList.remove('hidden');
                            }
                        });
                    }
                } else {
                    // Módulo de primer nivel
                    const domModId = MAPA_DOM_MODULOS_PADRE[item.id] || ('sidebarItemCustom_' + item.id);
                    let modEl = document.getElementById(domModId);
                    if (modEl) {
                        if (item.visible === false) {
                            modEl.classList.add('hidden');
                        } else {
                            modEl.classList.remove('hidden');
                        }
                    }
                }
            });

            // 4. Reordenar los módulos de nivel raíz en el nav principal
            const mainNav = document.getElementById('sidebarMainNav') || document.querySelector('nav.space-y-3');
            const navScrollHijo = document.getElementById('sidebarNavScroll');
            const contCustom = document.getElementById('sidebarItemsCustom');
            const contenedorReorden = navScrollHijo || mainNav;
            if (mainNav) {
                menu.forEach(item => {
                    const domModId = MAPA_DOM_MODULOS_PADRE[item.id] || ('sidebarItemCustom_' + item.id);
                    const modEl = document.getElementById(domModId);
                    if (modEl && mainNav.contains(modEl)) {
                        if (contCustom) {
                            contenedorReorden.insertBefore(modEl, contCustom);
                        } else {
                            contenedorReorden.appendChild(modEl);
                        }
                    }
                });
            }

            // 5. Actualizar módulos custom extra si existen
            actualizarSidebarCustom(menu);

            // 6. Si el usuario ya está autenticado, re-aplicar sus permisos inmediatamente
            if (currentUser) {
                aplicarPermisologia(currentUser);
            }
        }

        async function cargarEstructuraMenuGlobal() {
            try {
                const res = await fetch('/api/config/menu-modulos');
                const data = await res.json();
                if (data.success && Array.isArray(data.menu) && data.menu.length > 0) {
                    menuModulosCache = data.menu;
                    aplicarEstructuraMenuEnSidebar(menuModulosCache);
                }
            } catch (err) {
                console.error("Error al cargar configuración de menús:", err);
            }
        }

        async function cargarMenuModulosAdmin() {
            try {
                const res = await fetch('/api/config/menu-modulos');
                const data = await res.json();
                menuModulosCache = data.menu || [];
                renderizarArbolModulos(menuModulosCache);
                aplicarEstructuraMenuEnSidebar(menuModulosCache);
            } catch (err) {
                console.error("Error al cargar menú:", err);
                mostrarAlerta('error', 'No se pudo cargar la jerarquía de menús.');
            }
        }

        // ================= DRAG AND DROP HANDLERS =================
        function onDragStartSubmodulo(e, padreId, subId) {
            arrastrandoSubmodulo = { subId, sourcePadreId: padreId };
            e.dataTransfer.setData('text/plain', JSON.stringify(arrastrandoSubmodulo));
            e.dataTransfer.effectAllowed = 'move';
            
            // Estilo visual del elemento que se está arrastrando
            const card = e.currentTarget;
            setTimeout(() => {
                card.classList.add('opacity-40', 'border-dashed', 'border-amber-500', 'bg-amber-50/70');
            }, 0);
        }

        function onDragEndSubmodulo(e) {
            const card = e.currentTarget;
            card.classList.remove('opacity-40', 'border-dashed', 'border-amber-500', 'bg-amber-50/70');
            
            // Limpiar resaltado en todas las dropzones
            document.querySelectorAll('.dropzone-modulo').forEach(dz => {
                dz.classList.remove('bg-emerald-50/90', 'border-emerald-500', 'border-dashed', 'ring-2', 'ring-emerald-400');
            });
            document.querySelectorAll('.submodulo-card').forEach(sc => {
                sc.classList.remove('border-t-4', 'border-t-emerald-500', 'bg-emerald-50/40');
            });
            arrastrandoSubmodulo = null;
        }

        function onDragOverModuloDropzone(e) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            const dz = e.currentTarget;
            dz.classList.add('bg-emerald-50/90', 'border-emerald-500', 'border-dashed', 'ring-2', 'ring-emerald-400');
        }

        function onDragLeaveModuloDropzone(e) {
            const dz = e.currentTarget;
            dz.classList.remove('bg-emerald-50/90', 'border-emerald-500', 'border-dashed', 'ring-2', 'ring-emerald-400');
        }

        function onDropEnModulo(e, targetPadreId) {
            e.preventDefault();
            const dz = e.currentTarget;
            dz.classList.remove('bg-emerald-50/90', 'border-emerald-500', 'border-dashed', 'ring-2', 'ring-emerald-400');

            if (!arrastrandoSubmodulo) {
                try {
                    const raw = e.dataTransfer.getData('text/plain');
                    if (raw) arrastrandoSubmodulo = JSON.parse(raw);
                } catch(err) {}
            }

            if (!arrastrandoSubmodulo || !arrastrandoSubmodulo.subId) return;
            const { subId, sourcePadreId } = arrastrandoSubmodulo;
            arrastrandoSubmodulo = null;

            moverSubmoduloEntreModulos(subId, sourcePadreId, targetPadreId);
        }

        function onDragOverSubmoduloItem(e) {
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = 'move';
            const card = e.currentTarget;
            card.classList.add('border-t-4', 'border-t-emerald-500', 'bg-emerald-50/40');
        }

        function onDragLeaveSubmoduloItem(e) {
            const card = e.currentTarget;
            card.classList.remove('border-t-4', 'border-t-emerald-500', 'bg-emerald-50/40');
        }

        function onDropEnSubmoduloItem(e, targetPadreId, targetSubId) {
            e.preventDefault();
            e.stopPropagation();
            const card = e.currentTarget;
            card.classList.remove('border-t-4', 'border-t-emerald-500', 'bg-emerald-50/40');

            if (!arrastrandoSubmodulo) {
                try {
                    const raw = e.dataTransfer.getData('text/plain');
                    if (raw) arrastrandoSubmodulo = JSON.parse(raw);
                } catch(err) {}
            }

            if (!arrastrandoSubmodulo || !arrastrandoSubmodulo.subId) return;
            const { subId, sourcePadreId } = arrastrandoSubmodulo;
            arrastrandoSubmodulo = null;

            if (subId === targetSubId) return;
            reordenarSubmoduloAntesDe(subId, sourcePadreId, targetPadreId, targetSubId);
        }

        function moverSubmoduloEntreModulos(subId, sourcePadreId, targetPadreId) {
            if (sourcePadreId === targetPadreId) return;

            const sourcePadre = menuModulosCache.find(m => m.id === sourcePadreId);
            const targetPadre = menuModulosCache.find(m => m.id === targetPadreId);

            if (!sourcePadre || !Array.isArray(sourcePadre.submodulos)) return;
            if (!targetPadre) return;

            const sIdx = sourcePadre.submodulos.findIndex(s => s.id === subId);
            if (sIdx === -1) return;

            const [subItem] = sourcePadre.submodulos.splice(sIdx, 1);
            if (!Array.isArray(targetPadre.submodulos)) targetPadre.submodulos = [];
            targetPadre.submodulos.push(subItem);

            renderizarArbolModulos(menuModulosCache);
            aplicarEstructuraMenuEnSidebar(menuModulosCache);
            document.getElementById('btnGuardarMenuConfig')?.classList.add('animate-pulse');
            mostrarAlerta('info', `Submódulo <strong>${subItem.titulo || subItem.nombre || subId}</strong> movido a <strong>${targetPadre.titulo || targetPadre.nombre || targetPadreId}</strong>. Haz clic en "Guardar Estructura" para confirmar.`);
        }

        function reordenarSubmoduloAntesDe(subId, sourcePadreId, targetPadreId, targetSubId) {
            const sourcePadre = menuModulosCache.find(m => m.id === sourcePadreId);
            const targetPadre = menuModulosCache.find(m => m.id === targetPadreId);

            if (!sourcePadre || !Array.isArray(sourcePadre.submodulos)) return;
            if (!targetPadre || !Array.isArray(targetPadre.submodulos)) return;

            const sIdx = sourcePadre.submodulos.findIndex(s => s.id === subId);
            if (sIdx === -1) return;

            const [subItem] = sourcePadre.submodulos.splice(sIdx, 1);
            const tIdx = targetPadre.submodulos.findIndex(s => s.id === targetSubId);
            if (tIdx === -1) {
                targetPadre.submodulos.push(subItem);
            } else {
                targetPadre.submodulos.splice(tIdx, 0, subItem);
            }

            renderizarArbolModulos(menuModulosCache);
            aplicarEstructuraMenuEnSidebar(menuModulosCache);
            document.getElementById('btnGuardarMenuConfig')?.classList.add('animate-pulse');
            mostrarAlerta('info', `Submódulo <strong>${subItem.titulo || subItem.nombre || subId}</strong> reordenado. Haz clic en "Guardar Estructura" para confirmar.`);
        }

        function renderizarArbolModulos(menu) {
            const cont = document.getElementById('contenedorArbolModulos');
            if (!cont) return;

            if (!menu.length) {
                cont.innerHTML = '<div class="p-6 text-center text-slate-400 bg-white rounded-2xl border border-slate-200">No hay módulos configurados.</div>';
                return;
            }

            // Agrupadores posibles a los que un submódulo o módulo puede anidar
            const agrupadoresDisponibles = menu.filter(m => m.tipo === 'agrupador');

            cont.innerHTML = menu.map((item, idx) => {
                const esAgrupador = item.tipo === 'agrupador';
                const tieneSubs = esAgrupador && Array.isArray(item.submodulos) && item.submodulos.length > 0;
                const esVisible = (item.visible !== false);

                let submodulosHtml = '';
                if (esAgrupador) {
                    if (tieneSubs) {
                        submodulosHtml = `
                            <div class="dropzone-modulo mt-3 space-y-2 pl-3 sm:pl-5 border-l-2 border-slate-200 ml-3 rounded-xl transition duration-150 p-1"
                                 ondragover="onDragOverModuloDropzone(event)" 
                                 ondragleave="onDragLeaveModuloDropzone(event)" 
                                 ondrop="onDropEnModulo(event, '${item.id}')">
                                ${item.submodulos.map((sub, sIdx) => {
                                    const subVisible = (sub.visible !== false);
                                    return `
                                        <div class="submodulo-card bg-slate-50 hover:bg-slate-100/90 p-3 rounded-xl border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 transition cursor-move shadow-2xs"
                                             draggable="true"
                                             ondragstart="onDragStartSubmodulo(event, '${item.id}', '${sub.id}')"
                                             ondragend="onDragEndSubmodulo(event)"
                                             ondragover="onDragOverSubmoduloItem(event)"
                                             ondragleave="onDragLeaveSubmoduloItem(event)"
                                             ondrop="onDropEnSubmoduloItem(event, '${item.id}', '${sub.id}')">
                                            
                                            <div class="flex items-center gap-2.5 min-w-0">
                                                <!-- Drag Handle -->
                                                <div class="text-slate-400 hover:text-slate-700 px-1 py-1 select-none text-base cursor-grab active:cursor-grabbing shrink-0" title="Arrastra para mover o reordenar">
                                                    ⋮⋮
                                                </div>
                                                <span class="text-base shrink-0">${sub.icono && sub.icono.length <= 4 ? sub.icono : '📌'}</span>
                                                <div class="min-w-0">
                                                    <div class="text-xs font-black text-slate-800 truncate">${sub.titulo || sub.nombre || sub.id}</div>
                                                    <div class="text-[10px] text-slate-400 font-mono">id: ${sub.id} · arrastra para reordenar o cambiar módulo</div>
                                                </div>
                                            </div>

                                            <div class="flex items-center gap-1.5 flex-shrink-0 justify-end">
                                                <!-- Selector Rápido de Módulo (Alternativa a Drag & Drop) -->
                                                <select onchange="if(this.value) moverSubmoduloEntreModulos('${sub.id}', '${item.id}', this.value)" class="text-[11px] font-bold border border-slate-200 rounded-lg px-2 py-1 bg-white text-slate-600 focus:outline-none cursor-pointer" title="Mover a otro módulo">
                                                    <option value="">➡️ Mover a...</option>
                                                    ${agrupadoresDisponibles.filter(ag => ag.id !== item.id).map(ag => `<option value="${ag.id}">${ag.titulo || ag.nombre || ag.id}</option>`).join('')}
                                                </select>

                                                <!-- Botón Promover a Principal -->
                                                <button type="button" onclick="moverSubmoduloAPrincipal('${sub.id}', '${item.id}')" class="px-2 py-1 text-[11px] font-bold bg-white hover:bg-blue-50 text-blue-700 hover:text-blue-800 rounded-lg border border-slate-200 hover:border-blue-300 transition flex items-center gap-1 cursor-pointer" title="Convertir en módulo principal">
                                                    <span>⬆️ Principal</span>
                                                </button>

                                                <!-- Toggle Visibilidad -->
                                                <button type="button" onclick="toggleVisibilidadModuloEnMenu('${sub.id}')" class="p-1.5 rounded-lg border text-xs transition cursor-pointer ${
                                                    subVisible ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100' : 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100'
                                                }" title="${subVisible ? 'Visible (Clic para ocultar)' : 'Oculto (Clic para mostrar)'}">
                                                    ${subVisible ? '👁️' : '🚫'}
                                                </button>

                                                ${sub.es_custom ? `
                                                    <button type="button" onclick="eliminarModuloCustom('${sub.id}')" class="p-1.5 text-rose-600 hover:bg-rose-50 rounded-lg transition cursor-pointer" title="Eliminar módulo">
                                                        🗑️
                                                    </button>
                                                ` : ''}
                                            </div>
                                        </div>
                                    `;
                                }).join('')}
                            </div>
                        `;
                    } else {
                        // Zona de arrastre vacía
                        submodulosHtml = `
                            <div class="dropzone-modulo mt-2.5 p-4 rounded-xl border-2 border-dashed border-slate-200 bg-slate-50/60 hover:border-emerald-400 hover:bg-emerald-50/60 text-center transition"
                                 ondragover="onDragOverModuloDropzone(event)" 
                                 ondragleave="onDragLeaveModuloDropzone(event)" 
                                 ondrop="onDropEnModulo(event, '${item.id}')">
                                <div class="text-xs font-bold text-slate-500">Arrastra aquí un submódulo para colocarlo en ${item.titulo || item.nombre}</div>
                                <div class="text-[11px] text-slate-400 mt-0.5">O haz clic en "+ Submódulo" para crear uno nuevo</div>
                            </div>
                        `;
                    }
                }

                return `
                    <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs">
                        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                            <div class="flex items-center gap-3 min-w-0">
                                <div class="w-9 h-9 rounded-xl bg-slate-900 text-white flex items-center justify-center font-bold text-base shadow-xs flex-shrink-0">
                                    ${item.icono && item.icono.length <= 4 ? item.icono : '📁'}
                                </div>
                                <div class="min-w-0">
                                    <div class="flex items-center gap-2">
                                        <h4 class="text-xs font-black text-slate-900 truncate">${item.titulo || item.nombre || item.id}</h4>
                                        <span class="text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md ${
                                            esAgrupador ? 'bg-purple-100 text-purple-800 border border-purple-200' : 'bg-slate-100 text-slate-700 border border-slate-200'
                                        }">${esAgrupador ? 'Grupo / Acordeón' : 'Módulo Principal'}</span>
                                    </div>
                                    <div class="text-[10px] text-slate-400 font-mono mt-0.5">id: ${item.id}</div>
                                </div>
                            </div>

                            <div class="flex flex-wrap items-center gap-2 justify-end">
                                <!-- Botón + Agregar Submódulo en este Padre -->
                                ${esAgrupador ? `
                                    <button type="button" onclick="abrirModalNuevoSubmodulo('${item.id}', '${item.titulo || item.nombre || item.id}')" class="px-2.5 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 text-xs font-black rounded-lg transition flex items-center gap-1 cursor-pointer shadow-2xs" title="Crear nuevo submódulo aquí">
                                        <span>➕ Submódulo</span>
                                    </button>
                                ` : ''}

                                ${(!esAgrupador && agrupadoresDisponibles.length > 0) ? `
                                    <div class="flex items-center gap-1 text-xs">
                                        <label class="text-[10px] font-bold text-slate-400 uppercase hidden sm:inline">Anidar:</label>
                                        <select onchange="if(this.value) moverPrincipalASubmodulo('${item.id}', this.value)" class="text-[11px] font-bold border border-slate-200 rounded-lg px-2 py-1 bg-white text-slate-700 focus:outline-none cursor-pointer">
                                            <option value="">⬇️ Mover a submódulo...</option>
                                            ${agrupadoresDisponibles.map(ag => `<option value="${ag.id}">En: ${ag.titulo || ag.nombre || ag.id}</option>`).join('')}
                                        </select>
                                    </div>
                                ` : ''}

                                <button type="button" onclick="toggleVisibilidadModuloEnMenu('${item.id}')" class="px-2.5 py-1 rounded-lg border text-xs font-bold transition cursor-pointer flex items-center gap-1 ${
                                    esVisible ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100' : 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100'
                                }">
                                    <span>${esVisible ? '👁️ Visible' : '🚫 Oculto'}</span>
                                </button>

                                ${item.es_custom ? `
                                    <button type="button" onclick="eliminarModuloCustom('${item.id}')" class="p-1 text-rose-600 hover:bg-rose-50 rounded-lg transition cursor-pointer" title="Eliminar módulo">
                                        🗑️
                                    </button>
                                ` : ''}
                            </div>
                        </div>

                        ${submodulosHtml}
                    </div>
                `;
            }).join('');
        }

        function moverSubmoduloAPrincipal(subId, padreId) {
            const padre = menuModulosCache.find(m => m.id === padreId);
            if (!padre || !Array.isArray(padre.submodulos)) return;

            const subIndex = padre.submodulos.findIndex(s => s.id === subId);
            if (subIndex === -1) return;

            const [subItem] = padre.submodulos.splice(subIndex, 1);
            subItem.tipo = 'modulo';

            // Insertar después del padre en la raíz
            const padreIndex = menuModulosCache.findIndex(m => m.id === padreId);
            menuModulosCache.splice(padreIndex + 1, 0, subItem);

            renderizarArbolModulos(menuModulosCache);
            aplicarEstructuraMenuEnSidebar(menuModulosCache);
            document.getElementById('btnGuardarMenuConfig')?.classList.add('animate-pulse');
        }

        function moverPrincipalASubmodulo(modId, nuevoPadreId) {
            const modIndex = menuModulosCache.findIndex(m => m.id === modId);
            if (modIndex === -1) return;

            const nuevoPadre = menuModulosCache.find(m => m.id === nuevoPadreId);
            if (!nuevoPadre) return;

            if (!Array.isArray(nuevoPadre.submodulos)) {
                nuevoPadre.submodulos = [];
            }

            const [modItem] = menuModulosCache.splice(modIndex, 1);
            modItem.tipo = 'submodulo';
            nuevoPadre.submodulos.push(modItem);

            renderizarArbolModulos(menuModulosCache);
            aplicarEstructuraMenuEnSidebar(menuModulosCache);
            document.getElementById('btnGuardarMenuConfig')?.classList.add('animate-pulse');
        }

        function toggleVisibilidadModuloEnMenu(itemId) {
            for (const item of menuModulosCache) {
                if (item.id === itemId) {
                    item.visible = !(item.visible !== false);
                    renderizarArbolModulos(menuModulosCache);
                    aplicarEstructuraMenuEnSidebar(menuModulosCache);
                    document.getElementById('btnGuardarMenuConfig')?.classList.add('animate-pulse');
                    return;
                }
                if (Array.isArray(item.submodulos)) {
                    for (const sub of item.submodulos) {
                        if (sub.id === itemId) {
                            sub.visible = !(sub.visible !== false);
                            renderizarArbolModulos(menuModulosCache);
                            aplicarEstructuraMenuEnSidebar(menuModulosCache);
                            document.getElementById('btnGuardarMenuConfig')?.classList.add('animate-pulse');
                            return;
                        }
                    }
                }
            }
        }

        async function guardarMenuModulosAdmin() {
            const btn = document.getElementById('btnGuardarMenuConfig');
            const originalText = btn ? btn.innerHTML : '';
            if (btn) {
                btn.disabled = true;
                btn.innerHTML = '<span>Guardando...</span>';
            }

            try {
                const res = await fetch('/api/config/menu-modulos', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ menu: menuModulosCache })
                });
                const data = await res.json();
                if (res.ok && data.success) {
                    mostrarAlerta('success', 'Estructura de menús guardada correctamente.');
                    if (btn) btn.classList.remove('animate-pulse');
                    if (Array.isArray(data.menu)) menuModulosCache = data.menu;
                    aplicarEstructuraMenuEnSidebar(menuModulosCache);
                    if (currentUser) aplicarPermisologia(currentUser);
                } else {
                    mostrarAlerta('error', data.error || 'No se pudo guardar la estructura.');
                }
            } catch (err) {
                mostrarAlerta('error', 'Error al comunicar con el servidor.');
            } finally {
                if (btn) {
                    btn.disabled = false;
                    btn.innerHTML = originalText;
                }
            }
        }

        async function restaurarMenuPredeterminado() {
            if (!confirm('¿Deseas restaurar la estructura y menús a su configuración predeterminada de fábrica?')) return;
            try {
                const res = await fetch('/api/config/menu-modulos', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ menu: [] }) // envía vacío para que use DEFAULT_MENU_ESTRUCTURA
                });
                await cargarMenuModulosAdmin();
                if (currentUser) aplicarPermisologia(currentUser);
                mostrarAlerta('success', 'Menús restaurados a los valores predeterminados.');
            } catch (err) {
                mostrarAlerta('error', 'Error al restaurar los menús.');
            }
        }

        // ================= GESTIÓN DE NUEVOS SUBMÓDULOS =================
        function abrirModalNuevoSubmodulo(padreId = '', padreNombre = '') {
            const form = document.getElementById('formNuevoSubmodulo');
            if (form) form.reset();

            const selPadre = document.getElementById('nuevoSubmoduloPadre');
            if (selPadre) {
                selPadre.innerHTML = '';
                const agrupadores = menuModulosCache.filter(m => m.tipo === 'agrupador');
                agrupadores.forEach(ag => {
                    const opt = document.createElement('option');
                    opt.value = ag.id;
                    opt.textContent = `${ag.titulo || ag.nombre || ag.id} (${ag.icono || '📁'})`;
                    if (ag.id === padreId) opt.selected = true;
                    selPadre.appendChild(opt);
                });
            }

            document.getElementById('nuevoSubmoduloIcono').value = '📌';
            const titModal = document.getElementById('modalNuevoSubmoduloTitulo');
            if (titModal) {
                titModal.textContent = padreNombre ? `Agregar Submódulo en: ${padreNombre}` : 'Agregar Nuevo Submódulo';
            }
            document.getElementById('modalNuevoSubmoduloError')?.classList.add('hidden');
            document.getElementById('modalNuevoSubmodulo')?.classList.remove('hidden');
        }

        function cerrarModalNuevoSubmodulo() {
            document.getElementById('modalNuevoSubmodulo')?.classList.add('hidden');
        }

        function generarSlugSubmodulo(titulo) {
            const idInput = document.getElementById('nuevoSubmoduloId');
            if (!idInput) return;
            const slug = titulo.toLowerCase()
                .normalize('NFD').replace(/[\u0300-\u036f]/g, "")
                .replace(/[^a-z0-9]+/g, '_')
                .replace(/^_+|_+$/g, '');
            idInput.value = slug || 'nuevo_submodulo';
        }

        async function guardarNuevoSubmoduloSubmit(e) {
            e.preventDefault();
            const padreId = document.getElementById('nuevoSubmoduloPadre').value;
            const titulo = document.getElementById('nuevoSubmoduloTitulo').value.trim();
            const id = document.getElementById('nuevoSubmoduloId').value.trim().toLowerCase();
            const icono = document.getElementById('nuevoSubmoduloIcono').value.trim() || '📌';
            const descripcion = document.getElementById('nuevoSubmoduloDescripcion').value.trim();

            if (!titulo || !id || !padreId) {
                const errBox = document.getElementById('modalNuevoSubmoduloError');
                if (errBox) {
                    errBox.textContent = 'Por favor completa todos los campos requeridos.';
                    errBox.classList.remove('hidden');
                }
                return;
            }

            const nuevoItem = {
                id,
                nombre: titulo,
                titulo,
                icono,
                tipo: 'submodulo',
                visible: true,
                es_custom: true,
                descripcion
            };

            modulosCustomInfo[id] = nuevoItem;

            const padre = menuModulosCache.find(m => m.id === padreId);
            if (padre) {
                if (!Array.isArray(padre.submodulos)) padre.submodulos = [];
                padre.submodulos.push(nuevoItem);
            } else {
                menuModulosCache.push(nuevoItem);
            }

            cerrarModalNuevoSubmodulo();
            await guardarMenuModulosAdmin();
            renderizarArbolModulos(menuModulosCache);
            mostrarAlerta('success', `Submódulo <strong>${titulo}</strong> creado exitosamente.`);
        }

        function abrirModalNuevoModulo() {
            const form = document.getElementById('formNuevoModulo');
            if (form) form.reset();
            document.getElementById('nuevoModuloIcono').value = '📋';
            document.getElementById('modalNuevoModuloError')?.classList.add('hidden');
            document.getElementById('modalNuevoModulo')?.classList.remove('hidden');
        }

        function cerrarModalNuevoModulo() {
            document.getElementById('modalNuevoModulo')?.classList.add('hidden');
        }

        function generarSlugModulo(titulo) {
            const idInput = document.getElementById('nuevoModuloId');
            if (!idInput) return;
            const slug = titulo.toLowerCase()
                .normalize('NFD').replace(/[\u0300-\u036f]/g, "")
                .replace(/[^a-z0-9]+/g, '_')
                .replace(/^_+|_+$/g, '');
            idInput.value = slug || 'nuevo_modulo';
        }

        async function crearNuevoModuloSubmit(e) {
            e.preventDefault();
            const titulo = document.getElementById('nuevoModuloTitulo').value.trim();
            const id = document.getElementById('nuevoModuloId').value.trim().toLowerCase();
            const icono = document.getElementById('nuevoModuloIcono').value.trim() || '📋';
            const ubicacion = document.getElementById('nuevoModuloUbicacion').value;
            const descripcion = document.getElementById('nuevoModuloDescripcion').value.trim();

            if (!titulo || !id) {
                const errBox = document.getElementById('modalNuevoModuloError');
                if (errBox) {
                    errBox.textContent = 'Por favor completa título e ID del módulo.';
                    errBox.classList.remove('hidden');
                }
                return;
            }

            const nuevoItem = {
                id,
                titulo,
                icono,
                tipo: (ubicacion === 'principal' ? 'modulo' : 'submodulo'),
                visible: true,
                es_custom: true,
                descripcion
            };

            modulosCustomInfo[id] = nuevoItem;

            if (ubicacion === 'principal') {
                menuModulosCache.push(nuevoItem);
            } else {
                const padre = menuModulosCache.find(m => m.id === ubicacion);
                if (padre) {
                    if (!Array.isArray(padre.submodulos)) padre.submodulos = [];
                    padre.submodulos.push(nuevoItem);
                } else {
                    menuModulosCache.push(nuevoItem);
                }
            }

            cerrarModalNuevoModulo();
            await guardarMenuModulosAdmin();
            activarTab(id);
        }

        function eliminarModuloCustom(modId) {
            if (!confirm(`¿Eliminar el módulo con ID '${modId}'?`)) return;
            const idx = menuModulosCache.findIndex(m => m.id === modId);
            if (idx !== -1) {
                menuModulosCache.splice(idx, 1);
            } else {
                for (const item of menuModulosCache) {
                    if (Array.isArray(item.submodulos)) {
                        const sIdx = item.submodulos.findIndex(s => s.id === modId);
                        if (sIdx !== -1) {
                            item.submodulos.splice(sIdx, 1);
                            break;
                        }
                    }
                }
            }
            renderizarArbolModulos(menuModulosCache);
            guardarMenuModulosAdmin();
        }

        function actualizarSidebarCustom(menu) {
            const contCustom = document.getElementById('sidebarItemsCustom');
            if (!contCustom) return;

            // Extraer módulos custom en la raíz que no estén ya en el HTML nativo
            const customRaiz = menu.filter(m => m.es_custom && m.tipo === 'modulo' && m.visible !== false);
            contCustom.innerHTML = customRaiz.map(m => `
                <div id="sidebarItemCustom_${m.id}" class="flex-shrink-0">
                    <button type="button" onclick="activarTab('${m.id}')" class="sidebar-item nav-tab flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold text-slate-300 hover:text-white hover:bg-white/10 whitespace-nowrap transition cursor-pointer">
                        <span class="text-base">${m.icono || '🧩'}</span>
                        <span>${m.titulo}</span>
                    </button>
                </div>
            `).join('');
        }

        function mostrarVistaModuloCustom(modId) {
            let info = modulosCustomInfo[modId];
            if (!info) {
                for (const item of menuModulosCache) {
                    if (item.id === modId) { info = item; break; }
                    if (Array.isArray(item.submodulos)) {
                        const s = item.submodulos.find(x => x.id === modId);
                        if (s) { info = s; break; }
                    }
                }
            }

            const titulo = info ? info.titulo : modId;
            const icono = info ? info.icono : '🧩';
            const desc = info ? (info.descripcion || 'Este módulo ha sido registrado y está listo para programar.') : '';

            const elIcono = document.getElementById('customModIcono');
            const elTitulo = document.getElementById('customModTitulo');
            const elDesc = document.getElementById('customModDescripcion');
            const elIdRef = document.getElementById('customModIdRef');
            const elIdVal = document.getElementById('customModIdVal');
            const elPadreVal = document.getElementById('customModPadreVal');
            const elJsVal = document.getElementById('customModJsVal');

            if (elIcono) elIcono.textContent = icono;
            if (elTitulo) elTitulo.textContent = titulo;
            if (elDesc) elDesc.textContent = desc;
            if (elIdRef) elIdRef.textContent = modId;
            if (elIdVal) elIdVal.textContent = modId;
            if (elPadreVal) elPadreVal.textContent = info && info.tipo === 'submodulo' ? 'Submódulo' : 'Módulo Principal';
            if (elJsVal) elJsVal.textContent = `static/js/modulo_${modId}.js`;

            if (breadcrumbParent) breadcrumbParent.classList.add('hidden');
            if (breadcrumbParentSep) breadcrumbParentSep.classList.add('hidden');
            if (breadcrumb) breadcrumb.textContent = titulo;
        }


        // ================= ALERTAS Y PROGRESO =================
        let timerAlertaGlobal = null;

        function mostrarAlerta(tipo, mensaje, duracionMs = 5500) {
            const box = document.getElementById('alertBox');
            if (!box) return;

            if (timerAlertaGlobal) {
                clearTimeout(timerAlertaGlobal);
                timerAlertaGlobal = null;
            }

            box.classList.remove(
                'hidden', 
                'bg-emerald-50', 'text-emerald-800', 'border-emerald-200', 
                'bg-rose-50', 'text-rose-800', 'border-rose-200', 
                'bg-blue-50', 'text-blue-800', 'border-blue-200'
            );
            box.classList.add('border');

            let icon = 'ℹ️';
            let btnHover = 'hover:bg-blue-200/60 text-blue-700';
            if (tipo === 'success') {
                box.classList.add('bg-emerald-50', 'text-emerald-800', 'border-emerald-200');
                icon = '✅';
                btnHover = 'hover:bg-emerald-200/60 text-emerald-700';
            } else if (tipo === 'error') {
                box.classList.add('bg-rose-50', 'text-rose-800', 'border-rose-200');
                icon = '⚠️';
                btnHover = 'hover:bg-rose-200/60 text-rose-700';
            } else {
                box.classList.add('bg-blue-50', 'text-blue-800', 'border-blue-200');
                icon = 'ℹ️';
                btnHover = 'hover:bg-blue-200/60 text-blue-700';
            }

            box.innerHTML = `
                <div class="flex items-start justify-between gap-3">
                    <div class="flex items-start gap-2.5 flex-1 min-w-0">
                        <span class="text-sm select-none shrink-0 mt-0.5">${icon}</span>
                        <div class="flex-1 text-xs font-medium leading-relaxed">${mensaje}</div>
                    </div>
                    <button type="button" onclick="ocultarAlerta()" class="shrink-0 w-6 h-6 flex items-center justify-center rounded-lg ${btnHover} transition text-xs font-bold leading-none select-none" title="Cerrar aviso">
                        ✕
                    </button>
                </div>
            `;
            box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

            if (duracionMs > 0) {
                timerAlertaGlobal = setTimeout(() => {
                    ocultarAlerta();
                }, duracionMs);
            }
        }

        function ocultarAlerta() {
            if (timerAlertaGlobal) {
                clearTimeout(timerAlertaGlobal);
                timerAlertaGlobal = null;
            }
            const box = document.getElementById('alertBox');
            if (box) {
                box.classList.add('hidden');
                box.innerHTML = '';
            }
        }

        function actualizarProgreso(porcentaje, titulo, detalle = '', colorClass = 'bg-red-600') {
            const container = document.getElementById('progressContainer');
            const bar = document.getElementById('progressBar');
            container.classList.remove('hidden');
            bar.className = `${colorClass} h-2 rounded-full transition-all duration-150`;
            const valorClamp = Math.min(Math.max(porcentaje, 0), 100);
            bar.style.width = `${valorClamp}%`;
            document.getElementById('progressPercent').textContent = `${valorClamp}%`;
            document.getElementById('progressText').textContent = titulo;
            if (detalle) document.getElementById('progressDetail').textContent = detalle;
        }

        function ocultarProgreso() {
            document.getElementById('progressContainer').classList.add('hidden');
        }

        function renderizarEstado(estado, titulo) {
            const dot = document.getElementById('connStatusDot');
            const ping = document.getElementById('connStatusPing');
            const txt = document.getElementById('connStatusText');
            const empNombre = document.getElementById('empresaNombreOficial');
            if (empNombre) {
                empNombre.textContent = titulo;
                empNombre.title = titulo;
            }
            const xmlInput = document.getElementById('xmlFile');
            const xlsInput = document.getElementById('excelFile');

            if (estado === 'ok') {
                if (dot) dot.className = 'relative w-3.5 h-3.5 rounded-full bg-emerald-500 ring-2 ring-white shadow-xs';
                if (ping) {
                    ping.className = 'absolute w-3.5 h-3.5 rounded-full bg-emerald-400 opacity-75 animate-ping';
                    ping.classList.remove('hidden');
                }
                if (txt) {
                    txt.textContent = 'En línea';
                    txt.className = 'font-black text-[11px] text-emerald-700 tracking-wide';
                }
                if (xmlInput) {
                    xmlInput.disabled = false;
                    xmlInput.classList.remove('cursor-not-allowed', 'opacity-50');
                }
                if (xlsInput) {
                    xlsInput.disabled = false;
                    xlsInput.classList.remove('cursor-not-allowed', 'opacity-50');
                }
                const aviso = document.getElementById('xmlAvisoBloqueo');
                if (aviso) aviso.classList.add('hidden');
            } else if (estado === 'error') {
                if (dot) dot.className = 'relative w-3.5 h-3.5 rounded-full bg-rose-500 ring-2 ring-white shadow-xs';
                if (ping) ping.classList.add('hidden');
                if (txt) {
                    txt.textContent = 'Desconectado';
                    txt.className = 'font-black text-[11px] text-rose-700 tracking-wide';
                }
                if (xmlInput) {
                    xmlInput.disabled = true;
                    xmlInput.classList.add('cursor-not-allowed', 'opacity-50');
                }
                if (xlsInput) {
                    xlsInput.disabled = true;
                    xlsInput.classList.add('cursor-not-allowed', 'opacity-50');
                }
                const aviso = document.getElementById('xmlAvisoBloqueo');
                if (aviso) aviso.classList.remove('hidden');
            } else {
                if (dot) dot.className = 'relative w-3.5 h-3.5 rounded-full bg-amber-500 ring-2 ring-white animate-pulse shadow-xs';
                if (ping) ping.classList.add('hidden');
                if (txt) {
                    txt.textContent = 'Conectando...';
                    txt.className = 'font-black text-[11px] text-amber-700 tracking-wide';
                }
            }
        }


        // ================= CONEXIONES Y EMPRESAS =================
        async function cargarEmpresas() {
            try {
                const res = await fetch('/api/empresas');
                const data = await res.json();
                const select = document.getElementById('selectEmpresa');
                if (!select) return;
                select.innerHTML = '';
                const empresasVisibles = data.empresas || [];
                if (!empresasVisibles.length) {
                    select.innerHTML = '<option value="">(Sin empresas visibles)</option>';
                    renderizarEstado('error', 'Sin empresas visibles');
                    return;
                }

                let empresaElegida = data.activa;
                const existeActiva = empresasVisibles.some(e => e.id === data.activa);
                if (!existeActiva) {
                    empresaElegida = empresasVisibles[0].id;
                }

                empresasVisibles.forEach(emp => {
                    const opt = document.createElement('option');
                    opt.value = emp.id;
                    opt.textContent = emp.nombre;
                    opt.dataset.logo = emp.logo || 'logo bc';
                    if (emp.id === empresaElegida) opt.selected = true;
                    select.appendChild(opt);
                });
                await cambiarEmpresa(empresaElegida);
            } catch (err) {
                renderizarEstado('error', 'Servidor no disponible');
            }
        }

        async function cambiarEmpresa(empresaId) {
            renderizarEstado('loading', 'Conectando...');
            actualizarProgreso(20, 'Cambiando empresa...', `Conectando base de datos a ${empresaId}`);
            try {
                const res = await fetch('/api/seleccionar-empresa', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ empresa_id: empresaId })
                });
                const data = await res.json();
                if (!res.ok || !data.success) throw new Error(data.error || 'Error al conectar.');
                
                const nomOficial = data.nombre_oficial || empresaId;
                renderizarEstado('ok', nomOficial);
                actualizarLogos(data.logo_tag, nomOficial);
                
                const headerTag = document.getElementById('headerEmpresaTag');
                if (headerTag) headerTag.textContent = nomOficial;

                const selectEmp = document.getElementById('selectEmpresa');
                if (selectEmp && selectEmp.value !== empresaId) selectEmp.value = empresaId;

                // 1. Limpiar caches de frontend de todos los módulos
                if (typeof dashboardDataCache !== 'undefined') dashboardDataCache = null;
                if (typeof ventasDataCache !== 'undefined') ventasDataCache = null;
                if (typeof catalogoResurtidosCargado !== 'undefined') catalogoResurtidosCargado = false;
                if (typeof listaAlmacenesCache !== 'undefined') listaAlmacenesCache = [];
                if (typeof listaSucursalesCache !== 'undefined') listaSucursalesCache = [];

                actualizarProgreso(50, 'Actualizando catálogos...', 'Líneas, proveedores y almacenes...');
                // 2. Recargar catálogos transversales
                await Promise.allSettled([
                    cargarLineasEmpresa(),
                    cargarProveedoresEmpresa(),
                    (typeof cargarSelectAlmacenesVentas === 'function' ? cargarSelectAlmacenesVentas() : Promise.resolve()),
                    (typeof cargarCatalogosTraspaso === 'function' ? cargarCatalogosTraspaso(true) : Promise.resolve()),
                    (typeof inicializarModuloResurtidos === 'function' ? inicializarModuloResurtidos(true) : Promise.resolve())
                ]);

                // 3. Si hay XML en compras, re-parsear contra las nuevas líneas
                if (rawXmlString) {
                    try { await parseXML(rawXmlString, nombreArchivoXmlActual); } catch(e) {}
                }

                // 4. Si el punto de venta está inicializado o activo, resetear cliente y recargar catálogo
                if (typeof inicializarModuloPuntoVenta === 'function') {
                    inicializarModuloPuntoVenta(true);
                }

                actualizarProgreso(80, 'Sincronizando vistas...', 'Recargando datos del módulo...');
                // 5. Recargar la vista activa inmediatamente
                const tabARecargar = currentActiveTabId || (typeof obtenerPrimerModuloPermitido === 'function' ? obtenerPrimerModuloPermitido() : 'dashboard');
                activarTab(tabARecargar);
                abrirAcordeonSubmenu('none');

                // 6. Si el módulo activo no es el dashboard, refrescar el dashboard en segundo plano
                if (currentActiveTabId !== 'dashboard' && typeof cargarDashboard === 'function') {
                    const selP = document.getElementById('selectPeriodoDashboard');
                    cargarDashboard(selP ? selP.value : 'mes_actual');
                }

                actualizarProgreso(100, 'Empresa Sincronizada', nomOficial);
                setTimeout(ocultarProgreso, 800);
                // Mensaje de alerta en banner ocultado por preferencia del usuario
            } catch (err) {
                ocultarProgreso();
                renderizarEstado('error', 'Error al conectar');
                mostrarAlerta('error', `Error al cambiar empresa: ${err.message}`);
                const tabFallback = currentActiveTabId || (typeof obtenerPrimerModuloPermitido === 'function' ? obtenerPrimerModuloPermitido() : 'dashboard');
                activarTab(tabFallback);
                abrirAcordeonSubmenu('none');
            }
        }

        // ================= MÓDULO NÓMINAS: RELOJ CHECADOR =================
        let timerRelojDigital = null;

        function actualizarRelojDigital() {
            const elHora = document.getElementById('relojChecadorHora');
            const elFecha = document.getElementById('relojChecadorFecha');
            if (!elHora && !elFecha) return;

            const ahora = new Date();
            if (elHora) {
                const horas = String(ahora.getHours()).padStart(2, '0');
                const mins = String(ahora.getMinutes()).padStart(2, '0');
                const segs = String(ahora.getSeconds()).padStart(2, '0');
                elHora.textContent = `${horas}:${mins}:${segs}`;
            }
            if (elFecha) {
                const opciones = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
                const fechaStr = ahora.toLocaleDateString('es-MX', opciones);
                elFecha.textContent = fechaStr.charAt(0).toUpperCase() + fechaStr.slice(1);
            }
        }

        async function inicializarModuloNominas() {
            if (!timerRelojDigital) {
                actualizarRelojDigital();
                timerRelojDigital = setInterval(actualizarRelojDigital, 1000);
            }

            // Poblar select de sucursales si aún no tiene opciones
            const selSuc = document.getElementById('relojSucursalSelect');
            if (selSuc && selSuc.options.length <= 1) {
                try {
                    const data = await cargarCatalogoSucursalesVendedores();
                    if (data && Array.isArray(data.sucursales)) {
                        let opts = '<option value="">-- Seleccionar Sucursal --</option>';
                        data.sucursales.forEach(s => {
                            opts += `<option value="${s.id}">${s.nombre}</option>`;
                        });
                        selSuc.innerHTML = opts;
                    }
                } catch(e) {}
            }

            // Si el usuario actual tiene sucursal asignada, pre-seleccionarla
            if (currentUser && currentUser.sucursal_id && selSuc) {
                selSuc.value = currentUser.sucursal_id;
            }

            // Pre-llenar nombre de empleado si está vacío
            const inputEmp = document.getElementById('relojEmpleadoInput');
            if (inputEmp && !inputEmp.value && currentUser) {
                inputEmp.value = currentUser.nombre || currentUser.usuario || '';
            }

            // Cargar checadas registradas el día de hoy
            await cargarChecadasHoy();
        }
        window.inicializarModuloNominas = inicializarModuloNominas;

        function seleccionarTipoChecada(tipo) {
            const inputVal = document.getElementById('relojTipoChecadaVal');
            if (inputVal) inputVal.value = tipo;

            const btnEntrada = document.getElementById('btnTipoEntrada');
            const btnSalida = document.getElementById('btnTipoSalida');
            const btnComer = document.getElementById('btnTipoComer');
            const btnRegreso = document.getElementById('btnTipoRegreso');

            const resetBtn = (btn) => {
                if (!btn) return;
                btn.className = "btn-tipo-checada p-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-bold text-xs flex items-center justify-center gap-1.5 transition";
            };

            [btnEntrada, btnSalida, btnComer, btnRegreso].forEach(resetBtn);

            if (tipo === 'ENTRADA' && btnEntrada) {
                btnEntrada.className = "btn-tipo-checada p-2.5 rounded-xl border border-emerald-500 bg-emerald-50 text-emerald-800 font-black text-xs flex items-center justify-center gap-1.5 transition";
            } else if (tipo === 'SALIDA' && btnSalida) {
                btnSalida.className = "btn-tipo-checada p-2.5 rounded-xl border border-rose-500 bg-rose-50 text-rose-800 font-black text-xs flex items-center justify-center gap-1.5 transition";
            } else if (tipo === 'SALIDA_COMER' && btnComer) {
                btnComer.className = "btn-tipo-checada p-2.5 rounded-xl border border-amber-500 bg-amber-50 text-amber-800 font-black text-xs flex items-center justify-center gap-1.5 transition";
            } else if (tipo === 'REGRESO_COMER' && btnRegreso) {
                btnRegreso.className = "btn-tipo-checada p-2.5 rounded-xl border border-blue-500 bg-blue-50 text-blue-800 font-black text-xs flex items-center justify-center gap-1.5 transition";
            }
        }
        window.seleccionarTipoChecada = seleccionarTipoChecada;

        async function registrarChecadaPersonal(e) {
            e.preventDefault();
            const selSuc = document.getElementById('relojSucursalSelect');
            const inputEmp = document.getElementById('relojEmpleadoInput');
            const inputTipo = document.getElementById('relojTipoChecadaVal');
            const inputNotas = document.getElementById('relojNotasInput');
            const alerta = document.getElementById('alertaRelojChecador');
            const btnSubmit = document.getElementById('btnConfirmarChecada');

            if (alerta) alerta.classList.add('hidden');

            const colaborador = inputEmp ? inputEmp.value.trim() : '';
            const tipo = inputTipo ? inputTipo.value : 'ENTRADA';
            const sucursal_id = selSuc && selSuc.value ? parseInt(selSuc.value) : null;
            const sucursal_nombre = selSuc && selSuc.selectedIndex > 0 ? selSuc.options[selSuc.selectedIndex].text : '';
            const notas = inputNotas ? inputNotas.value.trim() : '';

            if (!colaborador) {
                if (alerta) {
                    alerta.textContent = 'Ingresa el nombre o clave del colaborador.';
                    alerta.className = 'text-xs p-2.5 rounded-xl font-bold bg-rose-50 text-rose-700 border border-rose-200 block';
                }
                return;
            }

            const origHtml = btnSubmit ? btnSubmit.innerHTML : '';
            if (btnSubmit) {
                btnSubmit.disabled = true;
                btnSubmit.innerHTML = `<span>⏳</span> Registrando checada...`;
            }

            try {
                const res = await fetch('/api/nominas/reloj/checar', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        colaborador_nombre: colaborador,
                        tipo: tipo,
                        sucursal_id: sucursal_id,
                        sucursal_nombre: sucursal_nombre,
                        notas: notas
                    })
                });
                const data = await res.json();
                if (res.ok && data.success) {
                    if (alerta) {
                        alerta.textContent = `✅ ${data.mensaje}`;
                        alerta.className = 'text-xs p-2.5 rounded-xl font-bold bg-emerald-50 text-emerald-800 border border-emerald-200 block';
                    }
                    if (inputNotas) inputNotas.value = '';
                    await cargarChecadasHoy();
                    setTimeout(() => {
                        if (alerta) alerta.classList.add('hidden');
                    }, 4000);
                } else {
                    if (alerta) {
                        alerta.textContent = data.error || 'No fue posible registrar la checada.';
                        alerta.className = 'text-xs p-2.5 rounded-xl font-bold bg-rose-50 text-rose-700 border border-rose-200 block';
                    }
                }
            } catch(err) {
                if (alerta) {
                    alerta.textContent = 'Error de conexión con el servidor al registrar.';
                    alerta.className = 'text-xs p-2.5 rounded-xl font-bold bg-rose-50 text-rose-700 border border-rose-200 block';
                }
            } finally {
                if (btnSubmit) {
                    btnSubmit.disabled = false;
                    btnSubmit.innerHTML = origHtml;
                }
            }
        }
        window.registrarChecadaPersonal = registrarChecadaPersonal;

        async function cargarChecadasHoy() {
            const tbody = document.getElementById('tbodyChecadasHoy');
            const kpiTotal = document.getElementById('kpiTotalChecadas');
            const kpiEntradas = document.getElementById('kpiEntradasHoy');
            const kpiSalidas = document.getElementById('kpiSalidasHoy');

            try {
                const res = await fetch('/api/nominas/reloj/hoy');
                const data = await res.json();
                if (!res.ok || !data.success) return;

                if (kpiTotal) kpiTotal.textContent = data.total || 0;
                if (kpiEntradas) kpiEntradas.textContent = data.entradas || 0;
                if (kpiSalidas) kpiSalidas.textContent = data.salidas || 0;

                if (!tbody) return;
                const registros = data.registros || [];
                if (!registros.length) {
                    tbody.innerHTML = `<tr><td colspan="4" class="py-6 text-center text-slate-400 text-xs italic">Sin checadas registradas el día de hoy</td></tr>`;
                    return;
                }

                const badgeTipo = (tipo) => {
                    if (tipo === 'ENTRADA') return `<span class="px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-800 border border-emerald-200">🟢 ENTRADA</span>`;
                    if (tipo === 'SALIDA') return `<span class="px-2 py-0.5 rounded-full text-[10px] font-black bg-rose-100 text-rose-800 border border-rose-200">🔴 SALIDA</span>`;
                    if (tipo === 'SALIDA_COMER') return `<span class="px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-100 text-amber-800 border border-amber-200">🥪 A COMER</span>`;
                    if (tipo === 'REGRESO_COMER') return `<span class="px-2 py-0.5 rounded-full text-[10px] font-black bg-blue-100 text-blue-800 border border-blue-200">🔙 REGRESO</span>`;
                    return `<span class="px-2 py-0.5 rounded-full text-[10px] font-black bg-slate-100 text-slate-700">${tipo}</span>`;
                };

                tbody.innerHTML = registros.map(r => `
                    <tr class="hover:bg-slate-50 transition border-b border-slate-100">
                        <td class="py-2.5 px-3 font-mono font-bold text-slate-800">${r.hora}</td>
                        <td class="py-2.5 px-3 font-bold text-slate-900">
                            <div>${r.colaborador}</div>
                            ${r.notas ? `<div class="text-[10px] text-slate-400 font-normal italic">${r.notas}</div>` : ''}
                        </td>
                        <td class="py-2.5 px-3 text-slate-600 font-medium">${r.sucursal_nombre || 'Matriz / General'}</td>
                        <td class="py-2.5 px-3">${badgeTipo(r.tipo)}</td>
                    </tr>
                `).join('');
            } catch(e) {
                console.error("Error al cargar checadas hoy:", e);
            }
        }
        window.cargarChecadasHoy = cargarChecadasHoy;



// ================= INICIALIZACIÓN GLOBAL =================
document.addEventListener('DOMContentLoaded', () => {
    if (typeof initProveedorAutocomplete === 'function') initProveedorAutocomplete();
    if (typeof initBuscadorArticulos === 'function') initBuscadorArticulos();
    verificarSesion();
});

