# SPEC-001 — Holded API v2 + clientes bidireccionales

Estado: implementada

## Problema

La gestión de clientes debe ser fiable en ambos sentidos entre Index Clima
(Generador) y Holded, usando la API v2 de Holded. La integración previa usaba
la API legacy v1 (`/api/invoicing/v1`, cabecera `key:`) y sólo cubría la
exportación de presupuestos, no los contactos.

## Alcance

- Cliente HTTP único hacia Holded v2 (`packages/holded`).
- Vinculación local ↔ Holded por `holdedContactId` estable.
- Crear/editar cliente en el Generador → crear/actualizar contacto en Holded.
- Buscar desde el Generador → consulta local + Holded, con upsert del contacto
  remoto y refresco de datos locales.
- Degradación segura si Holded no responde.

## Fuera de alcance

MCP, IA, importación de documentos, webhooks, worker real, productos/materiales/
empleados en Holded, y la reescritura de la exportación de presupuestos
(Estimates v2). La exportación de presupuestos sigue temporalmente sobre v1.

## Contrato Holded v2 (verificado en holded.com/developers/api-reference)

- Base URL: `https://api.holded.com`, prefijo `/api/v2`.
- Auth: `Authorization: Bearer <api-key>`. (v1 con cabecera `key:` está deprecated.)
- Contactos:
  - `GET /api/v2/contacts` (listado, paginado por `page`)
  - `GET /api/v2/contacts/search?name=<q>` (búsqueda por nombre)
  - `GET /api/v2/contacts/{id}`
  - `POST /api/v2/contacts`
  - `PUT /api/v2/contacts/{id}` — **reemplazo completo**: los campos omitidos
    pueden volver a sus valores por defecto.
- Scopes: `contacts:contacts.read`, `contacts:contacts.write`.

> Discrepancia registrada: el portal antiguo `developers.holded.com` redirige
> hoy a marketing y varias fuentes externas (YepCode, Rollout) siguen
> documentando la API v1 (`key:`). La fuente de verdad es
> `holded.com/developers/api-reference`.

## Comportamiento

- **Crear (Generador → Holded):** se inserta el cliente local (`syncStatus`
  `pending`); si Holded está activo se crea el contacto y se enlaza
  (`holdedContactId`, `synced`). Si Holded falla, el cliente queda guardado con
  `syncStatus = error` y `syncError` (recuperable, sin duplicar en Holded).
- **Editar (Generador → Holded):** update local con optimistic locking
  (`expectedRevision`). Si está enlazado: `GET` remoto → merge de campos
  controlados → `PUT` completo. Si el remoto falla, el cambio local persiste y
  se marca `error`.
- **Buscar:** resultados locales + `GET /contacts/search`; cada contacto remoto
  válido como cliente se hace upsert y se fusiona. Si Holded cae, se devuelven
  sólo los locales con la cabecera `x-holded-search: degraded` (aviso no
  bloqueante en la UI).
- **Creado/editado en Holded:** al buscarlo desde el Generador aparece, se
  vincula y se refresca localmente.

### Resolución de coincidencias (upsert, conservadora)

1. `holdedContactId`.
2. NIF/CIF exacto **si es inequívoco** (un solo cliente local sin otro enlace).
3. email exacto **si es inequívoco**.

Ante ambigüedad no se mezcla ni se crea: se prioriza la integridad sobre evitar
duplicados. Nunca se hace merge sólo por nombre. No se cambia el `type` del
contacto (un proveedor no se convierte en cliente).

### Política de conflicto (quién gana)

- Edición local: **optimistic locking** local; el Generador manda y empuja a
  Holded.
- Refresco desde búsqueda: **Holded manda** sobre los campos sincronizados
  (`name`, `code/taxId`, `email`, `phone`, `billAddress.address`); se sube la
  revisión local. Se usa un hash del snapshot remoto para no reescribir cuando
  no hay cambios.

## Datos

Sin migración nueva: la tabla `clients` ya disponía de `holded_contact_id`
(único por instalación), `sync_status`, `last_synced_at`, `holded_payload_hash`,
`holded_snapshot`, `sync_error` y `revision`.

## Invariantes

- La Web nunca habla con Holded ni recibe la API key (sólo máscara).
- La relación con Holded se basa en `holdedContactId`, no en nombre/email/tel.
- Separación por `installationId` en todas las consultas.
- El `PUT` parte del contacto remoto completo (no destruye campos no gestionados).

## Seguridad

La API key se cifra en DB (AES-256-GCM, `HOLDED_ENCRYPTION_KEY`), nunca se
devuelve al navegador ni aparece en logs ni en errores (`HoldedApiError` sólo
lleva código, status y el cuerpo de error de Holded).

## Criterios de aceptación

- [x] Holded usa API v2 + Bearer en el flujo de clientes.
- [x] Vinculación por `holdedContactId`; búsqueda encuentra contactos remotos.
- [x] Búsqueda degradada segura si Holded cae.
- [x] `PUT` con GET→merge→PUT no destruye campos remotos (test).
- [x] Optimistic locking intacto; separación por instalación.
- [x] Tests unitarios (adapter, mapping, orquestación) + integración PostgreSQL.
- [ ] Prueba real contra Holded: pendiente (sin credenciales en el entorno).
- [ ] Tests HTTP de la API: pendiente (el entrypoint se autoarranca; cubierto
      indirectamente por application + integración).

## Deuda / siguiente fase

La exportación de presupuestos sigue sobre la API v1 (`saveEstimate`, aislada y
marcada `@deprecated`). Migrarla es la fase **Estimates v2**.
