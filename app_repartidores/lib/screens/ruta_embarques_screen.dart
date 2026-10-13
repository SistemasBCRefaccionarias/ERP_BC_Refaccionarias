import 'package:flutter/material.dart';
import '../models/embarque.dart';
import '../models/caja.dart';
import '../services/api_service.dart';
import '../theme/app_theme.dart';
import 'entrega_confirmacion_screen.dart';

class RutaEmbarquesScreen extends StatefulWidget {
  final List<Embarque> embarques;

  const RutaEmbarquesScreen({Key? key, required this.embarques}) : super(key: key);

  @override
  State<RutaEmbarquesScreen> createState() => _RutaEmbarquesScreenState();
}

class _RutaEmbarquesScreenState extends State<RutaEmbarquesScreen> {
  late List<Embarque> _embarques;
  bool _cargando = false;
  final Map<int, List<Caja>> _cajasPorEmbarque = {};
  final Set<int> _expandidos = {};

  @override
  void initState() {
    super.initState();
    _embarques = widget.embarques;
    _cargarDetalles();
  }

  Future<void> _cargarDetalles() async {
    setState(() => _cargando = true);
    final res = await ApiService.listarEmbarques();
    if (res.success && res.data != null) {
      if (mounted) {
        setState(() {
          _embarques = res.data!;
        });
      }
    }

    // Para cada embarque, cargar sus cajas si aún no se tienen
    for (var e in _embarques) {
      final detRes = await ApiService.obtenerDetalle(e.id);
      if (detRes.success && detRes.data != null) {
        if (mounted) {
          setState(() {
            _cajasPorEmbarque[e.id] = detRes.data!.cajas;
          });
        }
      }
    }

    if (mounted) {
      setState(() => _cargando = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: const Text('RUTA DE ENTREGAS'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh_rounded),
            tooltip: 'Actualizar ruta',
            onPressed: _cargarDetalles,
          ),
        ],
      ),
      body: _cargando && _embarques.isEmpty
          ? const Center(child: CircularProgressIndicator(color: AppColors.primary))
          : _embarques.isEmpty
              ? Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: const [
                      Icon(Icons.map_outlined, size: 56, color: AppColors.textSecondary),
                      SizedBox(height: 12),
                      Text(
                        'No hay embarques asignados en ruta',
                        style: TextStyle(color: AppColors.textSecondary, fontSize: 15),
                      ),
                    ],
                  ),
                )
              : ListView.separated(
                  padding: const EdgeInsets.all(16),
                  itemCount: _embarques.length,
                  separatorBuilder: (_, __) => const SizedBox(height: 14),
                  itemBuilder: (ctx, idx) {
                    final embarque = _embarques[idx];
                    final cajas = _cajasPorEmbarque[embarque.id] ?? embarque.cajas;
                    final isExpanded = _expandidos.contains(embarque.id);

                    int recibidas = cajas.where((c) => c.estaRecibida).length;
                    int enTransito = cajas.where((c) => c.estaEnTransito).length;
                    int total = cajas.isNotEmpty ? cajas.length : embarque.totalCajas;

                    double progreso = total > 0 ? (recibidas / total) : 0.0;

                    return Container(
                      decoration: BoxDecoration(
                        color: AppColors.card,
                        borderRadius: BorderRadius.circular(16),
                        border: Border.all(
                          color: progreso >= 1.0 ? AppColors.success.withOpacity(0.4) : AppColors.border,
                        ),
                      ),
                      child: Column(
                        children: [
                          // Cabecera de la parada / destino
                          InkWell(
                            onTap: () {
                              setState(() {
                                if (isExpanded) {
                                  _expandidos.remove(embarque.id);
                                } else {
                                  _expandidos.add(embarque.id);
                                }
                              });
                            },
                            borderRadius: BorderRadius.circular(16),
                            child: Padding(
                              padding: const EdgeInsets.all(16),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Row(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Container(
                                        padding: const EdgeInsets.all(10),
                                        decoration: BoxDecoration(
                                          color: embarque.esParaSucursal
                                              ? AppColors.primary.withOpacity(0.15)
                                              : AppColors.secondary.withOpacity(0.15),
                                          borderRadius: BorderRadius.circular(10),
                                        ),
                                        child: Icon(
                                          embarque.esParaSucursal
                                              ? Icons.storefront_rounded
                                              : Icons.person_pin_circle_rounded,
                                          color: embarque.esParaSucursal ? AppColors.primary : AppColors.secondary,
                                          size: 24,
                                        ),
                                      ),
                                      const SizedBox(width: 14),
                                      Expanded(
                                        child: Column(
                                          crossAxisAlignment: CrossAxisAlignment.start,
                                          children: [
                                            Text(
                                              embarque.destinoPrincipal,
                                              style: const TextStyle(
                                                fontSize: 16,
                                                fontWeight: FontWeight.bold,
                                                color: AppColors.textPrimary,
                                              ),
                                            ),
                                            const SizedBox(height: 2),
                                            Text(
                                              'Folio: ${embarque.folio}  •  ${embarque.tipoOrigen}: ${embarque.documentoReferencia}',
                                              style: const TextStyle(
                                                fontSize: 12,
                                                color: AppColors.textSecondary,
                                              ),
                                            ),
                                          ],
                                        ),
                                      ),
                                      Icon(
                                        isExpanded ? Icons.keyboard_arrow_up : Icons.keyboard_arrow_down,
                                        color: AppColors.textSecondary,
                                      ),
                                    ],
                                  ),
                                  const SizedBox(height: 12),

                                  // Barra de progreso de entrega
                                  Row(
                                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                    children: [
                                      Text(
                                        'Entregadas: $recibidas de $total ($enTransito en ruta)',
                                        style: TextStyle(
                                          fontSize: 12,
                                          fontWeight: FontWeight.w600,
                                          color: progreso >= 1.0 ? AppColors.success : AppColors.textPrimary,
                                        ),
                                      ),
                                      Text(
                                        '${(progreso * 100).toInt()}%',
                                        style: TextStyle(
                                          fontSize: 12,
                                          fontWeight: FontWeight.bold,
                                          color: progreso >= 1.0 ? AppColors.success : AppColors.primary,
                                        ),
                                      ),
                                    ],
                                  ),
                                  const SizedBox(height: 6),
                                  ClipRRect(
                                    borderRadius: BorderRadius.circular(4),
                                    child: LinearProgressIndicator(
                                      value: progreso,
                                      backgroundColor: AppColors.background,
                                      valueColor: AlwaysStoppedAnimation<Color>(
                                        progreso >= 1.0 ? AppColors.success : AppColors.primary,
                                      ),
                                      minHeight: 6,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ),

                          // Cajas Desplegables
                          if (isExpanded) ...[
                            const Divider(height: 1, color: AppColors.border),
                            Padding(
                              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                              child: Row(
                                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                children: [
                                  const Text(
                                    'Cajas de esta parada:',
                                    style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: AppColors.textSecondary),
                                  ),
                                  TextButton.icon(
                                    onPressed: () async {
                                      await Navigator.push(
                                        context,
                                        MaterialPageRoute(
                                          builder: (_) => const EntregaConfirmacionScreen(),
                                        ),
                                      );
                                      _cargarDetalles();
                                    },
                                    icon: const Icon(Icons.qr_code_scanner, size: 16, color: AppColors.success),
                                    label: const Text('Escanear entrega', style: TextStyle(fontSize: 12, color: AppColors.success)),
                                  ),
                                ],
                              ),
                            ),
                            if (cajas.isEmpty)
                              const Padding(
                                padding: EdgeInsets.all(12),
                                child: Text('No hay cajas registradas aún', style: TextStyle(color: AppColors.textSecondary, fontSize: 12)),
                              )
                            else
                              ListView.separated(
                                shrinkWrap: true,
                                physics: const NeverScrollableScrollPhysics(),
                                itemCount: cajas.length,
                                separatorBuilder: (_, __) => const Divider(height: 1, color: AppColors.border),
                                itemBuilder: (cCtx, cIdx) {
                                  final caja = cajas[cIdx];
                                  Color badgeColor = AppColors.warning;
                                  if (caja.estaRecibida) badgeColor = AppColors.success;
                                  if (caja.estaEnTransito) badgeColor = AppColors.primary;

                                  return ListTile(
                                    dense: true,
                                    leading: Icon(
                                      caja.estaRecibida
                                          ? Icons.check_circle_rounded
                                          : caja.estaEnTransito
                                              ? Icons.local_shipping_rounded
                                              : Icons.inventory_2_outlined,
                                      color: badgeColor,
                                      size: 20,
                                    ),
                                    title: Text(
                                      caja.folioCaja,
                                      style: const TextStyle(color: AppColors.textPrimary, fontWeight: FontWeight.bold),
                                    ),
                                    subtitle: Text(
                                      '${caja.piezasEnCaja} pzas  •  Caja #${caja.numeroCaja}',
                                      style: const TextStyle(color: AppColors.textSecondary, fontSize: 11),
                                    ),
                                    trailing: Container(
                                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                                      decoration: BoxDecoration(
                                        color: badgeColor.withOpacity(0.15),
                                        borderRadius: BorderRadius.circular(6),
                                        border: Border.all(color: badgeColor.withOpacity(0.4)),
                                      ),
                                      child: Text(
                                        caja.estatus,
                                        style: TextStyle(
                                          fontSize: 10,
                                          fontWeight: FontWeight.bold,
                                          color: badgeColor,
                                        ),
                                      ),
                                    ),
                                  );
                                },
                              ),
                            const SizedBox(height: 8),
                          ],
                        ],
                      ),
                    );
                  },
                ),
    );
  }
}

