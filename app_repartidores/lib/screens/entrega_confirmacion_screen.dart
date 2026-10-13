import 'dart:convert';
import 'dart:typed_data';
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:flutter_spinkit/flutter_spinkit.dart';
import 'package:image_picker/image_picker.dart';
import '../services/api_service.dart';
import '../theme/app_theme.dart';

class EntregaConfirmacionScreen extends StatefulWidget {
  final String? initialCodigoCaja;

  const EntregaConfirmacionScreen({Key? key, this.initialCodigoCaja}) : super(key: key);

  @override
  State<EntregaConfirmacionScreen> createState() => _EntregaConfirmacionScreenState();
}

class _EntregaConfirmacionScreenState extends State<EntregaConfirmacionScreen> {
  final MobileScannerController _scannerController = MobileScannerController(
    detectionSpeed: DetectionSpeed.normal,
    facing: CameraFacing.back,
    torchEnabled: false,
  );

  final TextEditingController _codigoController = TextEditingController();
  final TextEditingController _receptorController = TextEditingController();
  final TextEditingController _notasController = TextEditingController();

  bool _procesando = false;
  bool _scannerActivo = false; // Inicia cerrado o abierto según necesidad para dar espacio a firma
  bool _torchOn = false;

  // Evidencias de entrega: Firma y Foto
  final List<Offset?> _puntosFirma = [];
  final GlobalKey _signatureKey = GlobalKey();
  Uint8List? _fotoBytes;

  final List<Map<String, dynamic>> _entregasRealizadas = [];

  @override
  void initState() {
    super.initState();
    if (widget.initialCodigoCaja != null) {
      _codigoController.text = widget.initialCodigoCaja!;
      _scannerActivo = false;
    } else {
      _scannerActivo = true;
    }
  }

  @override
  void dispose() {
    _scannerController.dispose();
    _codigoController.dispose();
    _receptorController.dispose();
    _notasController.dispose();
    super.dispose();
  }

  void _onDetect(BarcodeCapture capture) {
    if (_procesando || !_scannerActivo) return;
    final List<Barcode> barcodes = capture.barcodes;
    if (barcodes.isEmpty) return;

    final String? code = barcodes.first.rawValue;
    if (code != null && code.trim().isNotEmpty) {
      final clean = code.trim().toUpperCase();
      setState(() {
        _codigoController.text = clean;
        _scannerActivo = false; // Minimiza scanner para que el usuario firme y tome foto
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('✓ Caja $clean escaneada. Solicita firma y evidencia.'),
          backgroundColor: AppColors.success,
          duration: const Duration(seconds: 2),
        ),
      );
    }
  }

  // Tomar fotografía de evidencia
  Future<void> _tomarFoto(ImageSource source) async {
    try {
      final picker = ImagePicker();
      final picked = await picker.pickImage(
        source: source,
        maxWidth: 1024,
        maxHeight: 1024,
        imageQuality: 75,
      );
      if (picked != null) {
        final bytes = await picked.readAsBytes();
        if (!mounted) return;
        setState(() {
          _fotoBytes = bytes;
        });
      }
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Error al capturar foto: $e'), backgroundColor: AppColors.danger),
      );
    }
  }

  // Convertir firma táctil a Base64 PNG
  Future<String?> _exportarFirmaBase64() async {
    if (_puntosFirma.where((p) => p != null).length < 5) {
      return null; // Demasiado corto para ser firma
    }

    try {
      final recorder = ui.PictureRecorder();
      final canvas = Canvas(recorder, const Rect.fromLTWH(0, 0, 400, 200));

      // Fondo blanco para que la firma no sea transparente
      final bgPaint = Paint()..color = Colors.white;
      canvas.drawRect(const Rect.fromLTWH(0, 0, 400, 200), bgPaint);

      final paint = Paint()
        ..color = Colors.black
        ..strokeCap = StrokeCap.round
        ..strokeWidth = 3.5;

      for (int i = 0; i < _puntosFirma.length - 1; i++) {
        if (_puntosFirma[i] != null && _puntosFirma[i + 1] != null) {
          canvas.drawLine(_puntosFirma[i]!, _puntosFirma[i + 1]!, paint);
        } else if (_puntosFirma[i] != null && _puntosFirma[i + 1] == null) {
          canvas.drawPoints(ui.PointMode.points, [_puntosFirma[i]!], paint);
        }
      }

      final picture = recorder.endRecording();
      final img = await picture.toImage(400, 200);
      final byteData = await img.toByteData(format: ui.ImageByteFormat.png);
      if (byteData == null) return null;

      final pngBytes = byteData.buffer.asUint8List();
      return base64Encode(pngBytes);
    } catch (e) {
      debugPrint('Error exportando firma: $e');
      return null;
    }
  }

  Future<void> _confirmarEntrega() async {
    final codigo = _codigoController.text.trim().toUpperCase();
    final receptor = _receptorController.text.trim();
    final notas = _notasController.text.trim();

    if (codigo.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Por favor ingresa o escanea el folio de la caja'), backgroundColor: AppColors.warning),
      );
      return;
    }

    if (receptor.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Por favor escribe el nombre de quien recibe'), backgroundColor: AppColors.warning),
      );
      return;
    }

    setState(() => _procesando = true);

    // Preparar firma en Base64
    final firmaB64 = await _exportarFirmaBase64();

    // Preparar foto en Base64
    String? fotoB64;
    if (_fotoBytes != null) {
      fotoB64 = base64Encode(_fotoBytes!);
    }

    final res = await ApiService.entregarCajaDestino(
      codigoCaja: codigo,
      receptorNombre: receptor,
      notas: notas,
      firmaBase64: firmaB64,
      fotoBase64: fotoB64,
    );

    if (!mounted) return;

    if (res.success) {
      final data = res.data ?? {};
      final isOffline = data['offline'] == true;

      setState(() {
        _entregasRealizadas.insert(0, {
          'codigo': codigo,
          'receptor': receptor,
          'offline': isOffline,
          'hora': TimeOfDay.now().format(context),
          'tiene_firma': firmaB64 != null,
          'tiene_foto': fotoB64 != null,
        });
        _codigoController.clear();
        _puntosFirma.clear();
        _fotoBytes = null;
        _notasController.clear();
      });

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('✓ Caja $codigo entregada exitosamente ${isOffline ? "(Guardado Offline)" : ""}'),
          backgroundColor: isOffline ? AppColors.warning : AppColors.success,
        ),
      );
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('✕ Error: ${res.error ?? "No se pudo registrar la entrega"}'),
          backgroundColor: AppColors.danger,
        ),
      );
    }

    setState(() => _procesando = false);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: const Text('ENTREGAR EN DESTINO'),
        actions: [
          IconButton(
            icon: Icon(_scannerActivo ? Icons.videocam_rounded : Icons.videocam_off_rounded),
            tooltip: _scannerActivo ? 'Ocultar cámara' : 'Mostrar cámara',
            onPressed: () => setState(() => _scannerActivo = !_scannerActivo),
          ),
          if (_scannerActivo)
            IconButton(
              icon: Icon(_torchOn ? Icons.flash_on_rounded : Icons.flash_off_rounded),
              tooltip: 'Linterna',
              onPressed: () {
                setState(() => _torchOn = !_torchOn);
                _scannerController.toggleTorch();
              },
            ),
        ],
      ),
      body: SingleChildScrollView(
        child: Column(
          children: [
            // Cámara para escanear caja a entregar
            if (_scannerActivo)
              SizedBox(
                height: 200,
                child: Stack(
                  children: [
                    MobileScanner(
                      controller: _scannerController,
                      onDetect: _onDetect,
                    ),
                    Center(
                      child: Container(
                        width: 240,
                        height: 120,
                        decoration: BoxDecoration(
                          border: Border.all(color: AppColors.success, width: 2),
                          borderRadius: BorderRadius.circular(10),
                        ),
                      ),
                    ),
                    Positioned(
                      bottom: 8,
                      left: 0,
                      right: 0,
                      child: Center(
                        child: Container(
                          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                          decoration: BoxDecoration(
                            color: Colors.black.withOpacity(0.7),
                            borderRadius: BorderRadius.circular(12),
                          ),
                          child: const Text(
                            'Apunta a la etiqueta de la caja para entregar',
                            style: TextStyle(color: Colors.white, fontSize: 11),
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),

            // Formulario de Entrega
            Container(
              padding: const EdgeInsets.all(16),
              margin: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: AppColors.card,
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: AppColors.border),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  TextField(
                    controller: _codigoController,
                    style: const TextStyle(color: AppColors.textPrimary, fontWeight: FontWeight.bold),
                    decoration: InputDecoration(
                      labelText: 'Folio de Caja (ej: 10003-1)',
                      prefixIcon: const Icon(Icons.qr_code_rounded, color: AppColors.success),
                      border: const OutlineInputBorder(),
                      suffixIcon: IconButton(
                        icon: const Icon(Icons.camera_alt_outlined),
                        tooltip: 'Abrir Escáner',
                        onPressed: () => setState(() => _scannerActivo = true),
                      ),
                    ),
                  ),
                  const SizedBox(height: 14),
                  TextField(
                    controller: _receptorController,
                    style: const TextStyle(color: AppColors.textPrimary, fontWeight: FontWeight.bold),
                    decoration: const InputDecoration(
                      labelText: 'Nombre de quien recibe (Obligatorio) *',
                      hintText: 'Ej: Juan Pérez / Encargado de Tienda',
                      prefixIcon: Icon(Icons.badge_outlined, color: AppColors.textSecondary),
                      border: OutlineInputBorder(),
                    ),
                  ),
                  const SizedBox(height: 14),

                  // SECCIÓN: FIRMA DIGITAL TÁCTIL
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Text(
                        'FIRMA DE QUIEN RECIBE',
                        style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: AppColors.textPrimary),
                      ),
                      if (_puntosFirma.isNotEmpty)
                        TextButton.icon(
                          onPressed: () => setState(() => _puntosFirma.clear()),
                          icon: const Icon(Icons.delete_outline, size: 16, color: AppColors.danger),
                          label: const Text('Borrar Firma', style: TextStyle(fontSize: 11, color: AppColors.danger)),
                        ),
                    ],
                  ),
                  const SizedBox(height: 4),
                  Container(
                    height: 140,
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(
                        color: _puntosFirma.isNotEmpty ? AppColors.success : AppColors.border,
                        width: _puntosFirma.isNotEmpty ? 2 : 1,
                      ),
                    ),
                    child: Stack(
                      children: [
                        if (_puntosFirma.isEmpty)
                          const Center(
                            child: Column(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Icon(Icons.draw_rounded, color: Colors.black26, size: 28),
                                SizedBox(height: 4),
                                Text(
                                  'Firme aquí con el dedo',
                                  style: TextStyle(color: Colors.black38, fontSize: 12, fontWeight: FontWeight.w500),
                                ),
                              ],
                            ),
                          ),
                        GestureDetector(
                          key: _signatureKey,
                          onPanUpdate: (details) {
                            final RenderBox? renderBox = context.findRenderObject() as RenderBox?;
                            if (renderBox != null) {
                              final localPos = details.localPosition;
                              setState(() {
                                _puntosFirma.add(localPos);
                              });
                            }
                          },
                          onPanEnd: (_) => setState(() => _puntosFirma.add(null)),
                          child: CustomPaint(
                            size: const Size(double.infinity, 140),
                            painter: _SignaturePainter(puntos: _puntosFirma),
                          ),
                        ),
                      ],
                    ),
                  ),

                  const SizedBox(height: 16),

                  // SECCIÓN: FOTO DE EVIDENCIA
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Text(
                        'FOTOGRAFÍA DE EVIDENCIA',
                        style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: AppColors.textPrimary),
                      ),
                      if (_fotoBytes != null)
                        TextButton.icon(
                          onPressed: () => setState(() {
                            _fotoBytes = null;
                          }),
                          icon: const Icon(Icons.close_rounded, size: 16, color: AppColors.danger),
                          label: const Text('Quitar Foto', style: TextStyle(fontSize: 11, color: AppColors.danger)),
                        ),
                    ],
                  ),
                  const SizedBox(height: 6),
                  if (_fotoBytes == null)
                    Row(
                      children: [
                        Expanded(
                          child: OutlinedButton.icon(
                            onPressed: () => _tomarFoto(ImageSource.camera),
                            icon: const Icon(Icons.camera_alt_rounded, color: AppColors.primary),
                            label: const Text('Tomar Foto', style: TextStyle(color: AppColors.primary, fontWeight: FontWeight.bold)),
                            style: OutlinedButton.styleFrom(
                              padding: const EdgeInsets.symmetric(vertical: 12),
                              side: const BorderSide(color: AppColors.primary),
                              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                            ),
                          ),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: OutlinedButton.icon(
                            onPressed: () => _tomarFoto(ImageSource.gallery),
                            icon: const Icon(Icons.photo_library_outlined, color: AppColors.textSecondary),
                            label: const Text('Galería', style: TextStyle(color: AppColors.textSecondary, fontWeight: FontWeight.bold)),
                            style: OutlinedButton.styleFrom(
                              padding: const EdgeInsets.symmetric(vertical: 12),
                              side: const BorderSide(color: AppColors.border),
                              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                            ),
                          ),
                        ),
                      ],
                    )
                  else
                    ClipRRect(
                      borderRadius: BorderRadius.circular(12),
                      child: Stack(
                        alignment: Alignment.topRight,
                        children: [
                          Image.memory(
                            _fotoBytes!,
                            height: 140,
                            width: double.infinity,
                            fit: BoxFit.cover,
                          ),
                          Container(
                            margin: const EdgeInsets.all(8),
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                            decoration: BoxDecoration(
                              color: Colors.black.withOpacity(0.7),
                              borderRadius: BorderRadius.circular(8),
                            ),
                            child: const Text('✓ Foto capturada', style: TextStyle(color: Colors.white, fontSize: 11)),
                          ),
                        ],
                      ),
                    ),

                  const SizedBox(height: 14),
                  TextField(
                    controller: _notasController,
                    style: const TextStyle(color: AppColors.textPrimary),
                    decoration: const InputDecoration(
                      labelText: 'Notas u Observaciones (Opcional)',
                      hintText: 'Ej: Entregado completo en almacén general',
                      prefixIcon: Icon(Icons.notes_rounded, color: AppColors.textSecondary),
                      border: OutlineInputBorder(),
                    ),
                  ),
                  const SizedBox(height: 18),
                  ElevatedButton(
                    onPressed: _procesando ? null : _confirmarEntrega,
                    style: ElevatedButton.styleFrom(
                      backgroundColor: AppColors.success,
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(vertical: 14),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                    ),
                    child: _procesando
                        ? const SpinKitThreeBounce(color: Colors.white, size: 22)
                        : const Text(
                            'CONFIRMAR ENTREGA CON EVIDENCIA',
                            style: TextStyle(fontSize: 14, fontWeight: FontWeight.bold, letterSpacing: 0.8),
                          ),
                  ),
                ],
              ),
            ),

            // Entregas registradas en esta pantalla
            if (_entregasRealizadas.isNotEmpty) ...[
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: Row(
                  children: [
                    const Text(
                      'Entregas realizadas en este destino:',
                      style: TextStyle(fontSize: 13, fontWeight: FontWeight.bold, color: AppColors.textSecondary),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 8),
              ListView.separated(
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                padding: const EdgeInsets.symmetric(horizontal: 16),
                itemCount: _entregasRealizadas.length,
                separatorBuilder: (_, __) => const SizedBox(height: 8),
                itemBuilder: (ctx, idx) {
                  final e = _entregasRealizadas[idx];
                  return Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: AppColors.card,
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(color: AppColors.border),
                    ),
                    child: Row(
                      children: [
                        const Icon(Icons.check_circle_rounded, color: AppColors.success, size: 24),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(e['codigo'], style: const TextStyle(fontWeight: FontWeight.bold, color: AppColors.textPrimary)),
                              Text('Recibió: ${e['receptor']}', style: const TextStyle(fontSize: 12, color: AppColors.textSecondary)),
                              Row(
                                children: [
                                  if (e['tiene_firma'] == true)
                                    const Padding(
                                      padding: EdgeInsets.only(right: 8, top: 2),
                                      child: Text('✍️ Firma', style: TextStyle(fontSize: 10, color: AppColors.success, fontWeight: FontWeight.bold)),
                                    ),
                                  if (e['tiene_foto'] == true)
                                    const Padding(
                                      padding: EdgeInsets.only(right: 8, top: 2),
                                      child: Text('📷 Foto', style: TextStyle(fontSize: 10, color: AppColors.primary, fontWeight: FontWeight.bold)),
                                    ),
                                ],
                              ),
                            ],
                          ),
                        ),
                        Text(e['hora'], style: const TextStyle(fontSize: 11, color: AppColors.textSecondary)),
                      ],
                    ),
                  );
                },
              ),
              const SizedBox(height: 24),
            ],
          ],
        ),
      ),
    );
  }
}

// Custom Painter para Firma Táctil
class _SignaturePainter extends CustomPainter {
  final List<Offset?> puntos;

  _SignaturePainter({required this.puntos});

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = Colors.black87
      ..strokeCap = StrokeCap.round
      ..strokeWidth = 3.0;

    for (int i = 0; i < puntos.length - 1; i++) {
      if (puntos[i] != null && puntos[i + 1] != null) {
        canvas.drawLine(puntos[i]!, puntos[i + 1]!, paint);
      } else if (puntos[i] != null && puntos[i + 1] == null) {
        canvas.drawPoints(ui.PointMode.points, [puntos[i]!], paint);
      }
    }
  }

  @override
  bool shouldRepaint(covariant _SignaturePainter oldDelegate) => true;
}
