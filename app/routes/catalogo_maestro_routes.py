from flask import Blueprint, jsonify, request
from app.services.catalogo_maestro_service import (
    obtener_opciones_clasificacion,
    crear_categoria, actualizar_categoria, eliminar_categoria,
    crear_linea, actualizar_linea, eliminar_linea,
    crear_sublinea, actualizar_sublinea, eliminar_sublinea,
    crear_marca, actualizar_marca, eliminar_marca,
    listar_articulos_maestro, obtener_detalle_articulo_maestro,
    guardar_articulo_maestro
)

catalogo_maestro_bp = Blueprint('catalogo_maestro', __name__)

# =========================================================================
# OPCIONES (CATEGORÍAS, LÍNEAS, SUBLÍNEAS, MARCAS)
# =========================================================================

@catalogo_maestro_bp.route('/api/catalogo-maestro/opciones', methods=['GET'])
def get_opciones():
    try:
        data = obtener_opciones_clasificacion()
        return jsonify({"success": True, **data})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

# --- Categorías ---
@catalogo_maestro_bp.route('/api/catalogo-maestro/categorias', methods=['POST'])
def post_categoria():
    try:
        body = request.get_json() or {}
        res = crear_categoria(body.get("nombre"), body.get("descripcion", ""))
        return jsonify({"success": True, "categoria": res})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 400

@catalogo_maestro_bp.route('/api/catalogo-maestro/categorias/<int:cat_id>', methods=['PUT'])
def put_categoria(cat_id):
    try:
        body = request.get_json() or {}
        res = actualizar_categoria(cat_id, body.get("nombre"), body.get("descripcion", ""))
        return jsonify({"success": True, "categoria": res})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 400

@catalogo_maestro_bp.route('/api/catalogo-maestro/categorias/<int:cat_id>', methods=['DELETE'])
def del_categoria(cat_id):
    try:
        eliminar_categoria(cat_id)
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 400

# --- Líneas ---
@catalogo_maestro_bp.route('/api/catalogo-maestro/lineas', methods=['POST'])
def post_linea():
    try:
        body = request.get_json() or {}
        res = crear_linea(body.get("nombre"), body.get("categoria_id"), body.get("descripcion", ""))
        return jsonify({"success": True, "linea": res})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 400

@catalogo_maestro_bp.route('/api/catalogo-maestro/lineas/<int:linea_id>', methods=['PUT'])
def put_linea(linea_id):
    try:
        body = request.get_json() or {}
        res = actualizar_linea(linea_id, body.get("nombre"), body.get("categoria_id"), body.get("descripcion", ""))
        return jsonify({"success": True, "linea": res})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 400

@catalogo_maestro_bp.route('/api/catalogo-maestro/lineas/<int:linea_id>', methods=['DELETE'])
def del_linea(linea_id):
    try:
        eliminar_linea(linea_id)
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 400

# --- Sublíneas ---
@catalogo_maestro_bp.route('/api/catalogo-maestro/sublineas', methods=['POST'])
def post_sublinea():
    try:
        body = request.get_json() or {}
        res = crear_sublinea(body.get("nombre"), body.get("linea_id"), body.get("descripcion", ""))
        return jsonify({"success": True, "sublinea": res})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 400

@catalogo_maestro_bp.route('/api/catalogo-maestro/sublineas/<int:sub_id>', methods=['PUT'])
def put_sublinea(sub_id):
    try:
        body = request.get_json() or {}
        res = actualizar_sublinea(sub_id, body.get("nombre"), body.get("linea_id"), body.get("descripcion", ""))
        return jsonify({"success": True, "sublinea": res})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 400

@catalogo_maestro_bp.route('/api/catalogo-maestro/sublineas/<int:sub_id>', methods=['DELETE'])
def del_sublinea(sub_id):
    try:
        eliminar_sublinea(sub_id)
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 400

# --- Marcas ---
@catalogo_maestro_bp.route('/api/catalogo-maestro/marcas', methods=['POST'])
def post_marca():
    try:
        body = request.get_json() or {}
        res = crear_marca(body.get("nombre"), body.get("descripcion", ""))
        return jsonify({"success": True, "marca": res})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 400

@catalogo_maestro_bp.route('/api/catalogo-maestro/marcas/<int:marca_id>', methods=['PUT'])
def put_marca(marca_id):
    try:
        body = request.get_json() or {}
        res = actualizar_marca(marca_id, body.get("nombre"), body.get("descripcion", ""))
        return jsonify({"success": True, "marca": res})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 400

@catalogo_maestro_bp.route('/api/catalogo-maestro/marcas/<int:marca_id>', methods=['DELETE'])
def del_marca(marca_id):
    try:
        eliminar_marca(marca_id)
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 400

# =========================================================================
# ARTÍCULOS EN CATÁLOGO MAESTRO
# =========================================================================

@catalogo_maestro_bp.route('/api/catalogo-maestro/articulos', methods=['GET'])
def get_articulos_maestro():
    try:
        busqueda = request.args.get("busqueda", "")
        categoria_id = request.args.get("categoria_id")
        linea_id = request.args.get("linea_id")
        sublinea_id = request.args.get("sublinea_id")
        marca_id = request.args.get("marca_id")
        pagina = int(request.args.get("pagina", 1))
        limite = int(request.args.get("limite", 50))

        data = listar_articulos_maestro(
            busqueda=busqueda,
            categoria_id=categoria_id,
            linea_id=linea_id,
            sublinea_id=sublinea_id,
            marca_id=marca_id,
            pagina=pagina,
            limite=limite
        )
        return jsonify({"success": True, **data})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@catalogo_maestro_bp.route('/api/catalogo-maestro/articulos/<int:art_id>', methods=['GET'])
def get_articulo_detalle(art_id):
    try:
        data = obtener_detalle_articulo_maestro(art_id)
        return jsonify({"success": True, "articulo": data})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 404

@catalogo_maestro_bp.route('/api/catalogo-maestro/articulos/<int:art_id>', methods=['POST'])
def post_guardar_articulo(art_id):
    try:
        body = request.get_json() or {}
        res = guardar_articulo_maestro(art_id, body)
        return jsonify(res)
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 400
