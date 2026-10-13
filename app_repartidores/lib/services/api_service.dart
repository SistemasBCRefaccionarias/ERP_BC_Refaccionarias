import 'dart:convert';
import 'package:http/http.dart' as http;
import '../models/embarque.dart';
import 'storage_service.dart';

class ApiResult<T> {
  final bool success;
  final T? data;
  final String? error;

  ApiResult({required this.success, this.data, this.error});
}

class ApiService {
  static Map<String, String> _headers(String? cookie) {
    final headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
    if (cookie != null && cookie.isNotEmpty) {
      headers['Cookie'] = cookie;
    }
    return headers;
  }

  // 1. Probar conectividad con el servidor Flask
  static Future<ApiResult<String>> probarConexion(String baseUrl) async {
    try {
      final url = Uri.parse('$baseUrl/api/session');
      final res = await http.get(url).timeout(const Duration(seconds: 4));
      if (res.statusCode == 200) {
        return ApiResult(success: true, data: 'Servidor ERP alcanzable');
      }
      return ApiResult(success: false, error: 'Código HTTP ${res.statusCode}');
    } catch (e) {
      return ApiResult(success: false, error: 'Sin conexión: $e');
    }
  }

  // 2. Iniciar sesión de chofer o repartidor
  static Future<ApiResult<Map<String, dynamic>>> login({
    required String usuario,
    required String password,
  }) async {
    try {
      final baseUrl = await StorageService.getServerUrl();
      final url = Uri.parse('$baseUrl/api/login');
      final res = await http.post(
        url,
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({'usuario': usuario, 'password': password}),
      ).timeout(const Duration(seconds: 6));

      final data = jsonDecode(res.body);
      if (res.statusCode == 200 && data['success'] == true) {
        String? rawCookie = res.headers['set-cookie'];
        String sessionCookie = '';
        if (rawCookie != null) {
          sessionCookie = rawCookie.split(';')[0];
        }

        await StorageService.guardarSesion(
          usuario: usuario,
          nombre: data['nombre'] ?? usuario,
          sessionCookie: sessionCookie,
        );

        return ApiResult(success: true, data: data);
      } else {
        return ApiResult(success: false, error: data['error'] ?? 'Credenciales inválidas');
      }
    } catch (e) {
      return ApiResult(success: false, error: 'Error al contactar servidor: $e');
    }
  }

  // 3. Resumen y KPIs de Embarques para el chofer
  static Future<ApiResult<Map<String, dynamic>>> obtenerDashboard() async {
    try {
      final baseUrl = await StorageService.getServerUrl();
      final cookie = await StorageService.getSessionCookie();
      final url = Uri.parse('$baseUrl/api/embarques/dashboard');
      final res = await http.get(url, headers: _headers(cookie)).timeout(const Duration(seconds: 6));

      if (res.statusCode == 200) {
        final data = jsonDecode(res.body);
        return ApiResult(success: true, data: data);
      }
      return ApiResult(success: false, error: 'Error del servidor (${res.statusCode})');
    } catch (e) {
      return ApiResult(success: false, error: 'Error de red: $e');
    }
  }

  // 4. Listar embarques asignados o en tránsito
  static Future<ApiResult<List<Embarque>>> listarEmbarques({String? estatus}) async {
    try {
      final baseUrl = await StorageService.getServerUrl();
      final cookie = await StorageService.getSessionCookie();
      var uriString = '$baseUrl/api/embarques/listar';
      if (estatus != null) {
        uriString += '?estatus=$estatus';
      }
      final url = Uri.parse(uriString);
      final res = await http.get(url, headers: _headers(cookie)).timeout(const Duration(seconds: 6));

      if (res.statusCode == 200) {
        final data = jsonDecode(res.body);
        final list = (data['embarques'] as List? ?? [])
            .map((e) => Embarque.fromJson(e))
            .toList();
        return ApiResult(success: true, data: list);
      }
      return ApiResult(success: false, error: 'Error ${res.statusCode}');
    } catch (e) {
      return ApiResult(success: false, error: 'Error de red: $e');
    }
  }

  // 5. Detalle completo de un embarque y sus cajas
  static Future<ApiResult<Embarque>> obtenerDetalle(int embarqueId) async {
    try {
      final baseUrl = await StorageService.getServerUrl();
      final cookie = await StorageService.getSessionCookie();
      final url = Uri.parse('$baseUrl/api/embarques/detalle/$embarqueId');
      final res = await http.get(url, headers: _headers(cookie)).timeout(const Duration(seconds: 6));

      if (res.statusCode == 200) {
        final data = jsonDecode(res.body);
        if (data['embarque'] != null) {
          return ApiResult(success: true, data: Embarque.fromJson(data['embarque']));
        }
      }
      return ApiResult(success: false, error: 'Embarque no encontrado');
    } catch (e) {
      return ApiResult(success: false, error: 'Error de conexión: $e');
    }
  }

  // 6. ESCANEAR CAJA PARA SUBIR AL CAMIÓN (Carga en CEDIS / Almacén)
  // Cambia el estatus de la caja y del embarque a EN_TRANSITO
  static Future<ApiResult<Map<String, dynamic>>> escanearCajaCarga({
    required String codigoCaja,
  }) async {
    try {
      final baseUrl = await StorageService.getServerUrl();
      final cookie = await StorageService.getSessionCookie();
      final nombreChofer = await StorageService.getNombreChofer() ?? 'Chofer Repartidor';
      final url = Uri.parse('$baseUrl/api/embarques/escanear-mensajero');

      final body = {
        'codigo': codigoCaja.trim().toUpperCase(),
        'chofer': nombreChofer,
      };

      final res = await http.post(
        url,
        headers: _headers(cookie),
        body: jsonEncode(body),
      ).timeout(const Duration(seconds: 6));

      final data = jsonDecode(res.body);
      if (res.statusCode == 200 && data['success'] == true) {
        return ApiResult(success: true, data: data);
      } else {
        return ApiResult(success: false, error: data['error'] ?? 'Código no válido');
      }
    } catch (e) {
      // Guardar en cola offline para reintentar cuando recupere señal
      await StorageService.agregarAColaOffline({
        'tipo': 'carga',
        'codigo': codigoCaja,
        'fecha': DateTime.now().toIso8601String(),
      });
      return ApiResult(
        success: true,
        data: {
          'folio_caja': codigoCaja,
          'offline': true,
          'mensaje': 'Guardado offline (sin señal). Se sincronizará al conectar.',
        },
      );
    }
  }

  // 7. ENTREGAR CAJA EN DESTINO (Sucursal o Cliente)
  // Cambia el estatus de la caja a RECIBIDA
  static Future<ApiResult<Map<String, dynamic>>> entregarCajaDestino({
    required String codigoCaja,
    String? receptorNombre,
    String? notas,
    String? firmaBase64,
    String? fotoBase64,
  }) async {
    try {
      final baseUrl = await StorageService.getServerUrl();
      final cookie = await StorageService.getSessionCookie();
      final url = Uri.parse('$baseUrl/api/embarques/sucursal/recibir');

      final body = {
        'codigo': codigoCaja.trim().toUpperCase(),
        'receptor': receptorNombre ?? '',
        'notas': notas ?? '',
        'firma': firmaBase64 ?? '',
        'foto': fotoBase64 ?? '',
      };

      final res = await http.post(
        url,
        headers: _headers(cookie),
        body: jsonEncode(body),
      ).timeout(const Duration(seconds: 12));

      final data = jsonDecode(res.body);
      if (res.statusCode == 200 && data['success'] == true) {
        return ApiResult(success: true, data: data);
      } else {
        return ApiResult(success: false, error: data['error'] ?? 'Error al registrar entrega');
      }
    } catch (e) {
      // Guardar en cola offline
      await StorageService.agregarAColaOffline({
        'tipo': 'entrega',
        'codigo': codigoCaja,
        'receptor': receptorNombre,
        'firma': firmaBase64,
        'foto': fotoBase64,
        'fecha': DateTime.now().toIso8601String(),
      });
      return ApiResult(
        success: true,
        data: {
          'folio_caja': codigoCaja,
          'offline': true,
          'mensaje': 'Entrega guardada localmente (sin red). Se sincronizará automáticamente.',
        },
      );
    }
  }

  // 8. Sincronizar cola de escaneos realizados sin internet
  static Future<int> sincronizarColaOffline() async {
    final cola = await StorageService.obtenerColaOffline();
    if (cola.isEmpty) return 0;

    int sincronizados = 0;
    List<Map<String, dynamic>> fallidos = [];

    for (var item in cola) {
      try {
        final tipo = item['tipo'];
        final codigo = item['codigo'];
        if (tipo == 'carga') {
          final res = await escanearCajaCarga(codigoCaja: codigo);
          if (res.success && res.data?['offline'] != true) {
            sincronizados++;
          } else {
            fallidos.add(item);
          }
        } else if (tipo == 'entrega') {
          final res = await entregarCajaDestino(
            codigoCaja: codigo,
            receptorNombre: item['receptor'],
          );
          if (res.success && res.data?['offline'] != true) {
            sincronizados++;
          } else {
            fallidos.add(item);
          }
        }
      } catch (_) {
        fallidos.add(item);
      }
    }

    await StorageService.limpiarColaOffline();
    for (var f in fallidos) {
      await StorageService.agregarAColaOffline(f);
    }

    return sincronizados;
  }
}

