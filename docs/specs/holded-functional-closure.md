# Clientes y Estimates Holded v2

Estado: implementación y verificación. Contrato oficial comprobado el 24-09-2026 y respuesta real comprobada el 25-09-2026.

## Clientes

Crear conserva un cliente local recuperable si falla Holded. Editar usa GET, merge de campos locales y PUT completo; `client_record`/`supplier_record` del GET son objetos, pero el PUT necesita su `num`. Se relee el resultado canónico. Campos remotos ajenos al generador se conservan. Cada operación tiene revisión optimista, aislamiento de instalación y bloqueo de sincronización por cliente.

Eliminar requiere confirmación explícita `deleteFromHolded=true` para vinculados. Se elimina el contacto remoto y se archiva localmente (`deletedAt`, `deletionSource`), manteniendo snapshots e histórico. Un 404 remoto es una eliminación ya realizada. No se ocultan errores remotos.

La reconciliación obtiene todas las páginas antes de detectar ausencias. Nunca archiva por un timeout, 403, 429, JSON inválido o listado incompleto. Las ausencias se confirman por GET individual. Una búsqueda no sirve para detectar eliminaciones. Los cambios locales pendientes no se reemplazan silenciosamente. Un cambio remoto a proveedor/acreedor inactiva el cliente local. No hay match automático por nombre.

## Estimates

Solo v2 y Bearer. Se requiere un cliente local activo con ID Holded real. Las líneas provienen del cálculo final persistido del motor, después de descuentos y ajustes, y conservan cantidades. El precio unitario se deriva con Decimal del total final y cantidad. Se valida el redondeo al céntimo antes de enviar y se verifican subtotal, IGIC y total mediante GET posterior.

Se consultan impuestos reales de la cuenta; solo impuestos activos de ventas cuyo nombre/grupo/clave identifica IGIC y cuyo porcentaje coincide. Una asignación explícita por tasa puede resolver ambigüedad, pero debe señalar un impuesto real compatible. Nunca se sustituye IGIC por IVA.

La cuenta de prueba devuelve más de un IGIC al 7 % (normal, bienes usados, arte, criterio de caja, agencias). Se fijaron en Configuración los códigos normales `s_igic_0`, `s_igic_3`, `s_igic_7`, `s_igic_15` tras contrastarlos con `/taxes`. La primera ejecución falló con `accounting:taxes.read` ausente; el usuario actualizó el permiso. Holded devuelve importes con coma decimal en el GET real de Estimates, aunque la referencia indica decimal string: el adaptador normaliza coma a punto antes de verificar, sin cálculo en JavaScript `number`.

El primer POST se reserva de forma persistente. El ID recibido se guarda antes de verificar totales; los siguientes envíos usan PUT sobre ese ID. Un resultado ambiguo de creación se reconcilia por etiqueta estable del presupuesto; nunca se repite el POST a ciegas. Ediciones concurrentes no se marcan como sincronizadas por un resultado antiguo. La exportación conserva errores útiles y no cambia el presupuesto a finalizado hasta verificarlo.

## Documentación oficial

- [API y OpenAPI](https://www.holded.com/developers/api-reference), [OpenAPI JSON](https://api.holded.com/openapi/api2.json).
- [Actualización contacto completa](https://www.holded.com/developers/api-reference/contact/update-a-contact): `contacts:contacts.read/write`, GET/POST `/api/v2/contacts`, GET/PUT/DELETE `/api/v2/contacts/{contactId}`, búsqueda `/contacts/search?name=`; listas `{items,cursor,has_more}`.
- [Crear Estimate](https://www.holded.com/developers/api-reference/estimates/create-an-estimate): `sales:estimates.read/write`, GET/POST `/api/v2/estimates`, GET/PUT/DELETE `/api/v2/estimates/{estimateId}`, PDF GET `/{estimateId}/pdf`. POST retorna `{id}`; GET usa `lines`, escritura `items`, `contact_id`, ISO date, `tax_included:false`, `discount:0`, `taxes:[key]`.
- [Impuestos](https://www.holded.com/developers/api-reference/tax/list-all-taxes): GET `/api/v2/taxes`, `accounting:taxes.read`, `{items:[{id,key,name,amount,scope,group,type,status}]}`. Se utiliza `key` de ventas para líneas, según schema de Estimates.
- [Paginación](https://www.holded.com/developers/pagination): cursor opaco; se usa límite conservador 100 (la descripción limita a 100 aunque OpenAPI muestra máximo 200).
- [Límites](https://www.holded.com/developers/rate-limiting): 429 y `Retry-After`; el adaptador expone plazo y no reintenta POST automáticamente.
- [Webhooks contactos](https://www.holded.com/developers/webhooks/contact), [Estimates](https://www.holded.com/developers/webhooks/estimate): eventos reales `contact.create`, `contact.update`, `contact.delete`, `estimate.create/update/delete`; firma HMAC-SHA256 y evento ID. Requieren URL pública/secret configurados; la reconciliación funciona también en local sin webhook público.
- [MCP Holded](https://www.holded.com/developers/mcp): OAuth 2.1 y Streamable HTTP. No sustituye al MCP del generador ni interviene en nuestros cálculos.

## Validación

Tests: merge contable, preservación campos, CRUD y cursores, archivado seguro, errores, revisión, impuestos ambiguos/incompatibles, cantidades/redondeo, POST/PUT mismo ID y recuperación de creación ambigua. La validación real requiere credenciales y crea únicamente entidades identificadas TEST; su resultado debe registrarse por separado, sin confundir mocks con pruebas reales.
