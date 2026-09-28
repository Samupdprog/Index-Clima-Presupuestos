# Cierre funcional: interfaz, seguridad y operación

Fecha: 2026-09-24. Complementa las specs de precios, Holded y MCP.

## Contratos

- API interna exige Bearer de servicio, salvo health. Web adjunta el token solo desde su proxy servidor. MCP adjunta actor y scopes autenticados; la API vuelve a limitar las rutas de IA. La instalación procede del servidor.
- El editor avanzado permite contraer cada grupo de campos mediante controles nativos accesibles. Los importes y previews proceden del backend; el navegador no importa el motor económico.
- El diálogo de ajustes muestra coste, venta, beneficio y margen antes/después por línea y para la selección. No aplica un borrador distinto del último preview válido.
- Borrado de clientes es lógico y conserva snapshots históricos. La interfaz diferencia borrado local y remoto vinculado.
- Reset requiere `ALLOW_DATA_RESET=true`, actor usuario, frase exacta `BORRAR DATOS` y confirmación explícita. El backend lo rechaza por defecto. El borrado es transaccional, limitado a la instalación, conserva instalación/configuración/usuarios y crea auditoría. Nunca llama a Holded. No es una herramienta MCP.
- La desconexión de Holded deshabilita también el fallback del entorno hasta conexión explícita. La clave permanece cifrada con AES-GCM y no aparece en respuestas/logs.

## Verificación

Regresión de importación de cinco máquinas, descuentos múltiples, ajustes y revisiones; integración PostgreSQL aislada; navegador con datos TEST; Holded real solo sobre datos TEST creados por esta ejecución. Una prueba bloqueada o no ejecutada se documenta como tal, nunca como aprobada.
# Catálogos y webhook

Los contratos de catálogo rechazan campos desconocidos, identidades y cambios de instalación. Los suplementos tienen propietario explícito; la migración recupera su instalación desde el empleado o desde la única instalación existente y falla ante una atribución ambigua. Las referencias a empleados/proveedores se validan dentro de la instalación. El reset incluye los suplementos globales de esa instalación.

El webhook público `/api/holded-webhook` reenvía los bytes y cabeceras de firma al API, con límite de 2 MB; nunca añade credenciales internas. El API verifica HMAC antes de aceptar el evento. La reconciliación periódica proporciona recuperación si faltan eventos.
