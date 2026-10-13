import 'package:flutter/material.dart';
import 'package:flutter_spinkit/flutter_spinkit.dart';
import '../models/embarque.dart';
import '../services/api_service.dart';
import '../services/storage_service.dart';
import '../theme/app_theme.dart';
import 'escanear_carga_screen.dart';
import 'ruta_embarques_screen.dart';
import 'entrega_confirmacion_screen.dart';
import 'login_screen.dart';
import 'config_servidor_screen.dart';

class DashboardScreen extends StatefulWidget {
  const DashboardScreen({Key? key}) : super(key: key);

  @override
  State<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends State<DashboardScreen> {
  String _nombreChofer = 'Chofer';
  bool _cargando = true;
  int _colaOfflineCount = 0;
  bool _sincronizando = false;

  int _enTransito = 0;
  int _pendientes = 0;
  int _entregadas = 0;
  List<Embarque> _embarquesActivos = [];

  @override
  void initState() {
    super.initState();
    _cargarDatos();
  }

  Future<void> _cargarDatos() async {
    setState(() => _cargando = true);
    final nombre = await StorageService.getNombreChofer();
    final cola = await StorageService.obtenerColaOffline();

    if (mounted) {
      setState(() {
        _nombreChofer = nombre ?? 'Chofer';
        _colaOfflineCount = cola.length;
      });
    }

    // Consultar dashboard y lista de embarques
    final res = await ApiService.listarEmbarques();
    if (res.success && res.data != null) {
      final list = res.data!;
      int transito = 0;
      int pend = 0;
      int entreg = 0;

      for (var e in list) {
        if (e.cajas.isNotEmpty) {
          transito += e.cajas.where((c) => c.estaEnTransito).length;
          pend += e.cajas.where((c) => !c.estaEnTransito && !c.estaRecibida).length;
          entreg += e.cajas.where((c) => c.estaRecibida).length;
        } else {
          if (e.estatus == 'EN_TRANSITO') {
            transito += e.totalCajas;
          } else if (e.estatus == 'PREPARANDO' || e.estatus == 'SURTIDO') {
            pend += e.totalCajas;
          } else if (e.estatus == 'RECIBIDO' || e.estatus == 'ENTREGADO') {
            entreg += e.totalCajas;
          }
        }
      }

      // Si el servidor provee KPIs consolidados exactos de cajas, usarlos
      try {
        final dashRes = await ApiService.obtenerDashboard();
        if (dashRes.success && dashRes.data != null) {
          final kpis = dashRes.data!['kpis'] as Map<String, dynamic>?;
          if (kpis != null) {
            final cTrans = (kpis['cajas_en_transito'] as num?)?.toInt();
            final cPend = (kpis['cajas_pendientes'] as num?)?.toInt();
            final cEntreg = (kpis['cajas_recibidas'] as num?)?.toInt();
            if (cTrans != null) transito = cTrans;
            if (cPend != null) pend = cPend;
            if (cEntreg != null) entreg = cEntreg;
          }
        }
      } catch (_) {}

      if (mounted) {
        setState(() {
          _enTransito = transito;
          _pendientes = pend;
          _entregadas = entreg;
          _embarquesActivos = list;
          _cargando = false;
        });
      }
    } else {
      if (mounted) {
        setState(() => _cargando = false);
      }
    }
  }

  Future<void> _sincronizarColaOffline() async {
    setState(() => _sincronizando = true);
    final count = await ApiService.sincronizarColaOffline();
    final cola = await StorageService.obtenerColaOffline();

    if (!mounted) return;
    setState(() {
      _colaOfflineCount = cola.length;
      _sincronizando = false;
    });

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('Sincronizados $count registros offline.'),
        backgroundColor: AppColors.success,
      ),
    );
    _cargarDatos();
  }

  Future<void> _cerrarSesion() async {
    final confirmar = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppColors.card,
        title: const Text('Cerrar Sesión', style: TextStyle(color: AppColors.textPrimary)),
        content: const Text('¿Deseas salir del portal de choferes?', style: TextStyle(color: AppColors.textSecondary)),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancelar', style: TextStyle(color: AppColors.textSecondary)),
          ),
          ElevatedButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: ElevatedButton.styleFrom(backgroundColor: AppColors.danger),
            child: const Text('Salir', style: TextStyle(color: Colors.white)),
          ),
        ],
      ),
    );

    if (confirmar == true) {
      await StorageService.cerrarSesion();
      if (!mounted) return;
      Navigator.pushAndRemoveUntil(
        context,
        MaterialPageRoute(builder: (_) => const LoginScreen()),
        (route) => false,
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'PANEL DE RUTA',
              style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, letterSpacing: 1),
            ),
            Text(
              'Chofer: $_nombreChofer',
              style: const TextStyle(fontSize: 12, color: AppColors.textSecondary),
            ),
          ],
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.settings_outlined),
            tooltip: 'Configurar servidor',
            onPressed: () => Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => const ConfigServidorScreen()),
            ),
          ),
          IconButton(
            icon: const Icon(Icons.logout_rounded),
            tooltip: 'Cerrar sesión',
            onPressed: _cerrarSesion,
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _cargarDatos,
        color: AppColors.primary,
        child: Column(
          children: [
            if (_cargando)
              const LinearProgressIndicator(
                minHeight: 2.5,
                backgroundColor: AppColors.card,
                color: AppColors.primary,
              ),
            Expanded(
              child: SingleChildScrollView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.all(16),
                child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // Barra de aviso Offline si hay scans pendientes
              if (_colaOfflineCount > 0)
                Container(
                  margin: const EdgeInsets.only(bottom: 16),
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                  decoration: BoxDecoration(
                    color: AppColors.warning.withOpacity(0.15),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: AppColors.warning),
                  ),
                  child: Row(
                    children: [
                      const Icon(Icons.cloud_off_rounded, color: AppColors.warning),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Text(
                          '$_colaOfflineCount escaneos pendientes por sincronizar.',
                          style: const TextStyle(color: AppColors.textPrimary, fontWeight: FontWeight.w500),
                        ),
                      ),
                      ElevatedButton(
                        onPressed: _sincronizando ? null : _sincronizarColaOffline,
                        style: ElevatedButton.styleFrom(
                          backgroundColor: AppColors.warning,
                          foregroundColor: Colors.black,
                          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                        ),
                        child: _sincronizando
                            ? const SpinKitRing(color: Colors.black, size: 16, lineWidth: 2)
                            : const Text('SUBIR AHORA', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
                      ),
                    ],
                  ),
                ),

              // Tarjetas Grandes de Dashboard (KPIs táctiles)
              Row(
                children: [
                  Expanded(
                    child: _buildKpiCard(
                      titulo: 'EN TRÁNSITO',
                      valor: '$_enTransito',
                      subtitulo: 'Cajas en tu camión',
                      icono: Icons.local_shipping_rounded,
                      color: AppColors.primary,
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: _buildKpiCard(
                      titulo: 'POR CARGAR',
                      valor: '$_pendientes',
                      subtitulo: 'Cajas en Almacén',
                      icono: Icons.inventory_2_rounded,
                      color: AppColors.warning,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              _buildKpiCard(
                titulo: 'ENTREGAS COMPLETADAS',
                valor: '$_entregadas',
                subtitulo: 'Cajas recibidas en sucursales o clientes',
                icono: Icons.check_circle_rounded,
                color: AppColors.success,
                esHorizontal: true,
              ),

              const SizedBox(height: 24),
              const Text(
                'ACCIONES RÁPIDAS',
                style: TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.bold,
                  letterSpacing: 1.2,
                  color: AppColors.textSecondary,
                ),
              ),
              const SizedBox(height: 12),

              // Botón 1: Subir Cajas al Camión (Escaneo de carga)
              _buildActionButton(
                titulo: 'SUBIR CAJAS AL CAMIÓN',
                subtitulo: 'Escanea código de barras de cada caja al subirla',
                icono: Icons.qr_code_scanner_rounded,
                colorFondo: AppColors.primary,
                iconoColor: Colors.white,
                onTap: () async {
                  await Navigator.push(
                    context,
                    MaterialPageRoute(builder: (_) => const EscanearCargaScreen()),
                  );
                  _cargarDatos();
                },
              ),
              const SizedBox(height: 12),

              // Botón 2: Ruta de Entregas (Destinos y Paradas)
              _buildActionButton(
                titulo: 'RUTA DE ENTREGAS',
                subtitulo: 'Ver paradas, cajas por destino y progreso',
                icono: Icons.alt_route_rounded,
                colorFondo: AppColors.card,
                iconoColor: AppColors.primary,
                onTap: () async {
                  await Navigator.push(
                    context,
                    MaterialPageRoute(
                      builder: (_) => RutaEmbarquesScreen(embarques: _embarquesActivos),
                    ),
                  );
                  _cargarDatos();
                },
              ),
              const SizedBox(height: 12),

              // Botón 3: Entregar en Destino
              _buildActionButton(
                titulo: 'ENTREGAR EN DESTINO',
                subtitulo: 'Escanear al entregar en sucursal o con cliente',
                icono: Icons.domain_verification_rounded,
                colorFondo: AppColors.card,
                iconoColor: AppColors.success,
                onTap: () async {
                  await Navigator.push(
                    context,
                    MaterialPageRoute(builder: (_) => const EntregaConfirmacionScreen()),
                  );
                  _cargarDatos();
                },
              ),

              const SizedBox(height: 30),
            ],
          ),
        ),
      ),
    ],
  ),
),
);
  }

  Widget _buildKpiCard({
    required String titulo,
    required String valor,
    required String subtitulo,
    required IconData icono,
    required Color color,
    bool esHorizontal = false,
  }) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.card,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: color.withOpacity(0.35)),
        boxShadow: [
          BoxShadow(
            color: color.withOpacity(0.08),
            blurRadius: 10,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: esHorizontal
          ? Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: color.withOpacity(0.15),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Icon(icono, color: color, size: 28),
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(titulo, style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: color)),
                      Text(subtitulo, style: const TextStyle(fontSize: 12, color: AppColors.textSecondary)),
                    ],
                  ),
                ),
                Text(
                  valor,
                  style: TextStyle(fontSize: 28, fontWeight: FontWeight.bold, color: color),
                ),
              ],
            )
          : Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(titulo, style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: color)),
                    Icon(icono, color: color, size: 20),
                  ],
                ),
                const SizedBox(height: 10),
                Text(
                  valor,
                  style: TextStyle(fontSize: 32, fontWeight: FontWeight.bold, color: color),
                ),
                const SizedBox(height: 4),
                Text(
                  subtitulo,
                  style: const TextStyle(fontSize: 11, color: AppColors.textSecondary),
                ),
              ],
            ),
    );
  }

  Widget _buildActionButton({
    required String titulo,
    required String subtitulo,
    required IconData icono,
    required Color colorFondo,
    required Color iconoColor,
    required VoidCallback onTap,
  }) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(16),
        child: Container(
          padding: const EdgeInsets.all(18),
          decoration: BoxDecoration(
            color: colorFondo,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: AppColors.border),
          ),
          child: Row(
            children: [
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: Colors.black.withOpacity(0.2),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Icon(icono, color: iconoColor, size: 28),
              ),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      titulo,
                      style: const TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.bold,
                        color: AppColors.textPrimary,
                        letterSpacing: 0.5,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      subtitulo,
                      style: TextStyle(
                        fontSize: 12,
                        color: colorFondo == AppColors.primary ? Colors.white70 : AppColors.textSecondary,
                      ),
                    ),
                  ],
                ),
              ),
              const Icon(Icons.arrow_forward_ios_rounded, color: AppColors.textSecondary, size: 16),
            ],
          ),
        ),
      ),
    );
  }
}

