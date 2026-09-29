# MCP operativo del Generador

Fecha: 2026-09-24. Estado: implementación y validación.

## Objetivo

Una IA opera los mismos casos de uso que la web mediante herramientas tipadas. El adaptador MCP no importa DB, Application, Domain ni Holded, no calcula dinero y no acepta SQL, URLs arbitrarias, instalación ni identidad elegidas por el modelo.

## Transporte y seguridad

SDK oficial TypeScript v2, Streamable HTTP `/mcp`, solicitudes independientes sin estado de negocio en memoria. Compatible con protocolo 2026-07-28 y clientes 2025 mediante fallback stateless del SDK. Host y Origin validados. Cada petición requiere bearer; el token externo del cliente nunca se reenvía a la API ni a Holded. El modo local usa `MCP_AUTH_TOKEN` separado de `INTERNAL_SERVICE_TOKEN`, identidad `MCP_SUBJECT`, scopes explícitos `MCP_SCOPES` e instalación fija `INSTALLATION_ID`. El modo remoto puede inyectar un verificador OAuth/OIDC que entregue identidad, scopes, audiencia y expiración verificadas.

Scopes: `clients:read`, `clients:write`, `quotes:read`, `quotes:write`, `holded:read`, `holded:write`. Los tools que sincronizan requieren permisos del recurso y Holded. La API valida de nuevo las credenciales del servicio y audita actor `ai`. La instalación nunca procede de argumentos MCP. Feature desactivada mantiene proceso y health sano, sin herramientas accesibles. Configuración incompleta habilitada informa health 503 sin restart loop.

## Contratos

Entradas JSON Schema cerradas. Dinero como decimal string. Escrituras sobre entidades existentes requieren `expectedRevision`; conflictos 409 se devuelven como error tipado y obligan a releer. Se publican schemas de salida y errores estructurados, propagando códigos de API/Holded sin secretos ni cuerpos de error arbitrarios. No hay reintentos automáticos de mutaciones ambiguas.

Líneas compuestas conservan lista ordenada de descuentos y entradas de trabajo. Ajuste público `operation` se traduce al `mode` contractual de la API sin cálculo. Preview y apply se ejecutan en backend. El review también procede del backend. Ninguna herramienta modifica catálogo como efecto secundario ni expone reset.

## Ayuda a la IA

Instrucciones de servidor, recurso `generator://guide` y prompt de flujo de presupuesto explican descubrimiento, revisión, datos incompletos, extracción frente a cálculo, revisiones, preview, conflictos y exportación. Borrado y exportación solo ante petición del usuario. Añadir una línea nunca modifica el catálogo; el catálogo solo cambia con sus herramientas explícitas (`create_*`, `update_*`, `archive_catalog_item`, `restore_catalog_item`) y la actualización masiva en dos fases `preview_material_import` → aprobación del usuario → `apply_material_import`. El número, la papelera y el borrado definitivo (`confirm: true`) se describen en [SPEC-013](013-v1.1-ux-catalog-lifecycle.md).

## Consulta de Holded

Los Estimates existentes en Holded se consultan con `list_holded_estimates`, `search_holded_estimates` y `get_holded_estimate` (solo `holded:read`). Ver [SPEC-011](011-mcp-holded-estimates.md). La única escritura de Estimates sigue siendo `sync_quote_to_holded`; `retry_holded_sync` se eliminó por duplicar el mismo endpoint.

## Aceptación

Pruebas de listado y schemas, auth/forbidden/aislamiento, denegación por scope, forwarding tool→API, errores 409/Holded/red, ausencia de secretos, y workflow con cliente MCP real. Live Holded usa ejecución explícita y datos TEST; la suite normal no depende de Holded real.

Referencias oficiales verificadas: [SDK TypeScript](https://github.com/modelcontextprotocol/typescript-sdk), [Streamable HTTP 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http), [autorización](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization). MCP oficial de Holded es únicamente referencia documental, nunca ruta de ejecución del Generador.
