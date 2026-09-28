# SPEC-011 — Consulta de Estimates de Holded desde MCP

Estado: implementada (2026-09-28)

## Problema

La IA solo veía los presupuestos del Generador. En Holded existen Estimates creados a mano o por otros flujos y la IA no podía consultarlos, ni comprobar si un presupuesto remoto corresponde a uno local, sin recibir credenciales o acceso HTTP genérico.

## Alcance

- Listar Estimates de Holded con cursor.
- Buscar por número, cliente, descripción, tags y texto de líneas.
- Leer un Estimate completo (cabecera, cliente, líneas, importes, notas, `body`, tags y estado).
- Enlazar cada Estimate con el presupuesto local que lo exportó (`generatorQuote`).

## Fuera de alcance

- Crear, modificar o borrar Estimates por herramientas nuevas: la única escritura sigue siendo `sync_quote_to_holded`.
- Escribir `body` (texto enriquecido). La API v2 lo devuelve en GET, pero el PUT probado no lo actualiza. Es solo lectura y la exportación no lo compara (no existe `holded_body_mismatch`).
- PDF por MCP: `getEstimatePdf` sigue disponible en backend para la exportación. No se envían binarios por MCP.
- Búsqueda de contactos adicional: el listado v2 ya incluye `contact_name`.

## Comportamiento

```text
IA → MCP (holded:read) → API interna → Application (consultas) → adaptador Holded → Holded API v2
```

- `list_holded_estimates` → `GET /holded/estimates?cursor&limit(1-50)&contactId`. Devuelve resúmenes, `hasMore` y `nextCursor`.
- `search_holded_estimates` → `GET /holded/estimates/search?q&contactId&cursor&limit(1-25)&maxPages(1-10)`. Holded v2 no ofrece búsqueda de Estimates, así que el backend recorre como máximo `maxPages` páginas de 100 (5 por defecto), secuenciales y sin reintentos. Tokens sin acentos ni signos (`P-15` → `p15`); todas las palabras deben aparecer en algún campo real. El número exacto puntúa primero. Devuelve `totalMatches`, páginas y Estimates revisados, `truncated`, `truncatedReason` (`max_pages`, `rate_limited`, `holded_unavailable`) y `resumeCursor` para continuar.
- `get_holded_estimate` → `GET /holded/estimates/:id` (24 hex). Detalle completo tipado y `dataNotice`.

Un cursor ausente o repetido con `has_more=true` se trata como respuesta inválida (sin bucles). Un fallo transitorio después de la primera página devuelve resultados parciales marcados como truncados. Un fallo en la primera página o uno no transitorio (401/403) se propaga.

## Contratos

`packages/contracts/src/holded-estimates.ts` (Zod): `holdedEstimateSummarySchema`, `holdedEstimateDetailSchema`, `holdedEstimateListSchema`, `holdedEstimateSearchSchema` y las queries. Solo campos del OpenAPI v2 oficial y de respuestas reales: `document_number`, `contact_id`, `contact_name`, `description`, `date`, `due_date`, `status`, `draft`, `currency`, `subtotal`, `discount`, `tax`, `total`, `tags`, `lines[]` (`line_id`, `name`, `description`, `units`, `price`, `discount`, `tax`, `taxes`, `unit_type`, `sku`, `product_id`, `service_id`, `supplied`), `notes`, `body`, `language`, `approved_at`, `custom_fields`, `from`.

Importes: strings decimales con punto. El adaptador (`apps/api/src/holded-estimate-reader.ts`) solo cambia el formato: coma → punto, `number` → string. Un valor irreconocible queda como `null`, sin aritmética. Los campos desconocidos no se reenvían.

Puerto de aplicación de solo lectura: `HoldedEstimateReader` (`listPage`, `get`) y `GeneratorQuoteLinkLookup` (`quotes.holded_estimate_id`, filtrado por instalación).

Errores API de lectura: `holded_unauthorized`/`holded_forbidden` (502, para no confundirlos con permisos del llamante), `holded_estimate_not_found` (404), `holded_rate_limited` (429, `retryAfterSeconds` y `Retry-After`), `holded_unavailable` (504/502), `holded_invalid_response` (502) y `holded_not_configured` (503). Nunca incluyen el cuerpo remoto. MCP los traduce a `holded_failed`, `not_found` o `rate_limited` (`retryable: true`, `retryAfterSeconds`). Los fallos de exportación propagan también `holdedCode` (código del adaptador), sin cuerpo remoto.

## Datos

Sin migración. Nueva lectura `findByHoldedEstimateIds` sobre el índice único existente `(installation_id, holded_estimate_id)`.

## Invariantes

- La API key vive solo en backend: cifrada en `installations.config` o `HOLDED_API_KEY`. MCP nunca la ve ni acepta URL, cabeceras, rutas o identidad del modelo.
- Los IDs y cursores se validan con patrones cerrados antes de construir la URL.
- Ningún endpoint o tool nuevo escribe en Holded ni en la base de datos.
- `get_holded_estimate` (remoto) y `get_quote` (local) no se mezclan. `generatorQuote` y `holdedEstimateId` son el único enlace.
- `notes`, `body`, descripciones y líneas son datos no confiables. La guía y `dataNotice` lo indican.

## Seguridad y auditoría

Las tres herramientas requieren solo `holded:read`. La API vuelve a exigir `holded:read` a actores `ai` en `GET /holded/*` y bloquea `holded/settings`. Con solo `holded:read` no se puede exportar (`POST /quotes/:id/holded` exige `quotes:write` y `holded:write`). El logging del cliente Holded registra método, ruta sin query, estado y duración, nunca claves ni cabeceras. Las lecturas no generan eventos de auditoría porque no cambian estado.

## Revisión del MCP existente

- Eliminado `retry_holded_sync`: llamaba al mismo endpoint idempotente que `sync_quote_to_holded`. Un único camino de exportación evita ambigüedad.
- El mensaje `holded_failed` ya no habla de "sincronización" para errores de lectura. 429 se expone como `rate_limited` en lugar de `api_error`.
- Aclaradas las descripciones de `sync_quote_to_holded`, `apply_price_adjustment` (el id del ajuste se obtiene con `get_quote`) y `search_clients` (scopes).
- Guía reescrita: reglas fijas, local frente a remoto, solo lectura, datos no confiables, scopes y reintentos sin bucles.

## Criterios de aceptación

- [x] Paginación, cursor repetido/ausente, respuesta inválida, 401/403/404/429, timeout (`packages/holded`, `packages/application`, `apps/api`).
- [x] Búsqueda por número, sin resultados, múltiples resultados, truncado y parcial por rate limit.
- [x] MCP sin scope, con `holded:read`, sin escrituras con solo `holded:read`, sin secretos en respuestas y `body` solo de lectura.
- [x] Herramientas existentes y exportación intactas (suite previa + smoke real).
- [x] Prueba real con Holded: listado, búsqueda `P-15`, detalle y re-exportación idempotente del Estimate de prueba P-15 (mismo ID, totales y `body` conservados).
