# ERP BC Refaccionarias - Distribución de Producción

Sistema ERP Centralizado de Alto Rendimiento para **BC Refaccionarias** y **Refaccionaria Total**.

Generado el: **2026-10-14 12:39:02**

---

### 🛡️ Protección de Propiedad Intelectual
Esta distribución contiene los binarios precompilados en **código de máquina C nativo (`app.*.pyd`)**.
- Los módulos de negocio, servicios, algoritmos y rutas del backend están completamente compilados en binarios nativos protegidos.
- **No contiene código fuente editable (`.py`)** del backend.
- Diseñado exclusivamente para su despliegue y ejecución en el servidor central de la empresa (`192.168.1.253`).

---

### 🚀 Despliegue en el Servidor (Windows)

#### Requisitos del Servidor:
1. **Windows Server** o Windows 10/11 (64-bit).
2. **Python 3.12 (64-bit)**.
3. Conectividad en red con la base de datos Microsip / Firebird.

#### 1. Instalación Rápida
Clonar este repositorio en el servidor (ej. `C:\ERP`):
```cmd
git clone https://github.com/SistemasBCRefaccionarias/ERP_BC_Refaccionarias.git C:\ERP
cd /d C:\ERP
pip install -r requirements.txt
```

#### 2. Configurar Arranque Automático 24/7 (Puerto 6060)
Haz clic derecho sobre:
```cmd
instalar_arranque_automatico.bat
```
y selecciona **"Ejecutar como administrador"**. Esto registrará el servicio perpetuo en segundo plano en el puerto 6060.

#### 3. Actualizaciones con 1 Clic
Para actualizar el sistema a la última versión en cualquier momento:
```cmd
actualizar.bat
```
El script detendrá el servidor, descargará la última versión compilada y reiniciará el servicio automáticamente.

---

### 🌐 Acceso al Sistema
- **Enlace de red local:** `http://192.168.1.253:6060`
- **Dominio corporativo:** `http://erp.bcrefaccionarias.com:6060`
