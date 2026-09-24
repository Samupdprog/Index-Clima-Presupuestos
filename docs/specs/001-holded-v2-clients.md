# SPEC-001 — Holded API v2 + clientes bidireccionales

Estado: implementada

## Problema

La gestión de clientes debe ser fiable en ambos sentidos entre Index Clima
(Generador) y Holded, usando la API v2 de Holded. La integración previa usaba
la API legacy v1 y sólo cubría la exportación de presupuestos, no los contactos.

## Alcance

- Cliente HTTP único hacia Holded v2 (`packages/holded`).
- Vinculación local ↔ Holded por `holdedContactId` estable.
- Crear/editar cliente en el Generador → crear/actualizar contacto en Holded.
- Buscar desde el Generador → local + Holded, con upsert y refresco local.
- Degradación segura si Holded no responde.
- Config de Holded desde la UI (clave cifrada) e instalación robusta.

## Fuera de alcance

MCP, IA, importación de documentos, webhooks, worker real, productos/materiales/
empleados en Holded, y la exportación de presupuestos (Estimates v2, sigue en v1).

## Contrato Holded v2 (verificado contra la API REAL, no solo docs)

- Base URL: `https://api.holded.com`, prefijo `/api/v2`.
- Auth: `Authorization: Bearer <api-key>`.
- Contactos:
  - `GET /api/v2/contacts` — listado. **Envelope real: `{ items, cursor, has_more }`**.
  - `GET /api/v2/contacts/search?name=<q>` — búsqueda por nombre (mismo envelope).
  - `GET /api/v2/contacts/{id}`
  - `POST /api/v2/contacts`
  - `PUT /api/v2/contacts/{id}` — **reemplazo completo**.
- Paginación por **cursor** (`cursor` + `has_more`), no por número de página.
- Campos del contacto en **snake_case**: `id`, `name`, `code`, `vat_number`,
  `email`, `mobile`, `phone`, `type`, `is_person`, `updated_at`,
  `bill_address { address, city, postal_code, province, country, country_code }`.

> Corrección importante respecto a la primera iteración: se asumió el objeto de
> contacto en camelCase (`billAddress`, `code`) y `normalizeContactList` sólo
> aceptaba array o `{ data }`. La API real devuelve `{ items }` con campos
> snake_case, por lo que `GET /clients?q=` devolvía `[]`. Corregido y verificado
> contra Holded real (ver "Prueba real").

## Mapeo Holded v2 ↔ local (decisiones)

- `taxId` ← `code` (en cuentas ES el NIF/CIF vive en `code`, suele estar
  poblado) y, si vacío, `vat_number`. Al escribir → `code`; `vat_number` se
  conserva intacto.
- `phone` ← `phone` y, si vacío, `mobile`. Al escribir → `phone` (se conserva `mobile`).
- `address` ⇆ `bill_address.address` (1:1). Ciudad/CP/provincia/país se
  conservan en Holded pero no se editan desde Index Clima, para no corromper la
  dirección estructurada en el PUT completo.
- No se cambia `type` (un proveedor no se convierte en cliente).
- Campos desconocidos (iban, tags, contact_persons, defaults, …) se preservan
  en el merge previo al PUT.

## Comportamiento

- **Crear:** local (`pending`) → si Holded activo, crea contacto y enlaza
  (`synced`). Si Holded falla, el cliente queda guardado con `error`+`syncError`.
- **Editar:** update local con optimistic locking; si enlazado, `GET → merge →
  PUT`. Si el remoto falla, el cambio local persiste y se marca `error`.
- **Buscar:** local + `search`; upsert de remotos válidos; degrada a local con
  cabecera `x-holded-search: degraded` (aviso no bloqueante en la UI).
- **Editado en Holded:** al buscar/refrescar, se detecta el cambio por hash de
  snapshot y se actualizan los campos sincronizados (revisión local +1).

### Resolución de coincidencias (conservadora)

1. `holdedContactId`. 2. NIF/CIF exacto si es inequívoco. 3. email exacto si es
inequívoco. Ante ambigüedad no se mezcla ni se crea. Nunca por nombre.

### Política de conflicto

Edición local: el Generador manda (optimistic locking). Refresco desde búsqueda:
Holded manda sobre los campos sincronizados; hash de snapshot evita reescrituras.

## Configuración e instalación (robustez)

- La API key se gestiona desde la UI, se cifra (AES-256-GCM) y se guarda en
  `installations.config.holded.apiKeyEncrypted`. Nunca vuelve al navegador
  (solo máscara). `HOLDED_API_KEY` es fallback opcional.
- **Causa raíz corregida:** el seed creaba la installation con id aleatorio por
  slug, mientras la API lee/escribe por `INSTALLATION_ID` (UUID fijo) → los
  UPDATE afectaban a **cero filas en silencio** (la config "se guardaba" sin
  persistir). Ahora:
  - `db:seed` hace upsert por `INSTALLATION_ID` (idempotente, sólo infra).
  - `writeConfig` (repo de installations) lanza `InstallationNotFoundError` si
    el UPDATE no afecta a ninguna fila; la API responde 503 con mensaje claro.
  - El servicio `migrate` de Docker ejecuta migraciones **y** seed con
    `INSTALLATION_ID`/slug/nombre correctos.
- Guardar sólo el intervalo NO borra la clave; el campo vacío NO borra la clave;
  la desconexión es explícita (`removeApiKey: true`).
- Clave de cifrado: derivación empty-safe (`||`+trim); `HOLDED_ENCRYPTION_KEY`
  recomendado y estable en producción (documentado en `.env.example`).

## Health check

Prueba representativa: leer contactos v2 (`GET /contacts`). Estados: ok / 401
`invalid_api_key` / **403 `insufficient_permissions`** / 429 `rate_limit` /
red|timeout `network_error` / no configurado. Guardar dispara comprobación
inmediata. UI con LED (verde/amarillo/rojo/gris), texto, última comprobación y
botón "Comprobar conexión".

## Observabilidad

El cliente Holded emite un log seguro por operación (`method`, `path` sin query,
`status`, `code`, `ms`). Nunca registra la API key, `Authorization` ni cuerpos.

## Datos

Sin migración nueva: `clients` ya tenía `holded_contact_id` (único por
instalación), `sync_status`, `last_synced_at`, `holded_payload_hash`,
`holded_snapshot`, `sync_error`, `revision`.

## Reset de desarrollo

`npm run db:reset:dev` (`scripts/dev-reset.mjs`): borra datos de negocio y
**conserva** installation + config (clave cifrada). Requiere `ALLOW_DEV_RESET=true`
y se niega en `NODE_ENV=production`. Idempotente.

## Criterios de aceptación

- [x] Holded usa API v2 + Bearer; parseo correcto de `{ items, cursor, has_more }`.
- [x] Vinculación por `holdedContactId`; búsqueda encuentra y persiste remotos.
- [x] Búsqueda degradada segura si Holded cae.
- [x] `GET → merge → PUT` no destruye campos remotos (test + verificación real).
- [x] Optimistic locking intacto; aislamiento por `installationId`.
- [x] Config persiste; UPDATE de 0 filas lanza error (no guardado silencioso).
- [x] Tests unitarios (adapter/mapping/orquestación) + integración PostgreSQL (docker).
- [x] **Prueba real contra Holded**: READ/CREATE/UPDATE/REMOTE-UPDATE (ver abajo).

## Prueba real (contra Holded real, clave temporal)

PROBADA (2026-09-24):
- READ: `GET /clients?q=Andrea` → 200, `x-holded-search: ok`, Andrea con
  `holdedContactId` real y `syncStatus: synced`; 2ª búsqueda sin duplicar.
- CREATE: contacto "TEST INDEX CLIMA - <ts>" creado en Holded, enlazado, synced.
- UPDATE: email editado desde el Generador; verificado en Holded que el email
  cambió y `name`/`code`/`type`/`bill_address` se conservaron.
- REMOTE UPDATE: renombrado en Holded → al buscar desde el Generador, el nombre
  local se refrescó y la revisión subió (+1), sin duplicar.

## Deuda / siguiente fase

- La exportación de presupuestos sigue sobre v1 (`saveEstimate`, aislada y
  `@deprecated`). Migrarla es la fase **Estimates v2**.
- Faltan tests unitarios del handler HTTP de la API (el entrypoint se
  autoarranca); cubierto por application + integración + prueba real e2e.
