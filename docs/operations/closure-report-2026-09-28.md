# Informe de cierre funcional — 28-09-2026

Rama: `feature/holded-v2-clients`. No se ha fusionado con `main`. El dump ajeno `antes-de-pruebas.sql` se conservó y quedó excluido de Git y del contexto Docker.

## Bugs y causas raíz

| Problema | Causa | Resolución |
|---|---|---|
| Cinco materiales importados con coste total 5.749,38 € y venta 0 € | El flujo de IA omitía venta y el backend persistía regla fija de cero | La importación es atómica y la regla automática usa bruto de proveedor, o neto reconstruible/confirmado; datos insuficientes se rechazan. |
| 40 % + 10 % tratado como 50 % | Descuentos sin modelo secuencial común | Multiplicador `PRODUCT(1 − d/100)`: 1.000 € → coste 540 €, descuento efectivo 46 %, venta base bruta 1.000 €. |
| Modal confundía coste con precio y distribuía dinero en React | Estado económico no derivaba de cálculo final | Preview backend por línea y selección, con coste, venta, beneficio, márgenes y redondeo; apply persiste operación auditable. |
| Cliente local editado sin reflejo remoto | PUT parcial en un endpoint de reemplazo | GET → merge de campos controlados → PUT completo → GET de verificación; `client_record` del GET se convierte a código numérico. |
| Cliente remoto borrado seguía activo | Sin reconciliación de ausencias | Paginación completa, confirmación por GET y archivado local; worker periódico y botón manual. Históricos conservados. |
| Exportación de Estimate fallaba | Flujo anterior no respetaba v2, impuesto de cuenta y formato real de respuesta | Bearer v2, impuestos IGIC por key real, ID persistido antes del GET y normalización de coma decimal observada en Holded. |
| Error 500 después de crear Estimate | GET real devolvía `"6049,38"`; Decimal exigía punto | Normalización estricta en adaptador Holded, antes de comparar totales; el ID ya guardado impidió duplicado. |
| Editor avanzado sin plegado | Secciones estáticas | Secciones accesibles con `aria-expanded`, estado de formulario conservado. |
| Preview avanzado emitía 400 al abrir | Se enviaba descripción vacía antes de cargar el formulario | La consulta se inicia cuando el formulario contiene una descripción válida. |
| MCP reiniciaba el contenedor | Dependencia CommonJS requería módulo nativo en paquete ESM | Bundle Node con `createRequire`; transporte real comprobado con bearer y 31 herramientas. |
| Ediciones web bloqueadas por Docker | Origin se comparaba con la URL interna de Next (`:3000`) en vez del Host público (`:3300`) | Comprobación contra autoridad pública recibida y rechazo de origen externo. |
| Catálogos permitían campos ajenos y suplementos sin propietario | Schemas abiertos y tabla sin instalación | Schemas cerrados, referencias scoped y migración de instalación para suplementos. |

## Arquitectura y cálculos

Web y MCP → API → Application → Domain → PostgreSQL; Holded es una salida. `decimal.js` y `numeric` son las representaciones económicas; JSON usa strings decimales. Descuentos de proveedor: `costMultiplier = ∏(1−dᵢ/100)`; `effectiveDiscount = (1−costMultiplier)×100`. Venta automática: tarifa bruta si la opción está activa, coste neto en caso contrario, seguida de `add_percentage`, `add_euros_per_unit`, `unit_price` o `fixed_line_total`. Beneficio = venta sin IGIC − coste; rentabilidad sobre coste = beneficio/coste; margen sobre venta = beneficio/venta. El IGIC se calcula por línea y no cuenta como beneficio.

Los ajustes `amount`, `percentage`, `target_total` en línea, selección o presupuesto son operaciones separadas, previsualizadas por el motor. El último céntimo se reparte de forma determinista; la revisión evita aplicar una previsualización obsoleta. Los campos económicos del editor solo muestran respuestas del backend.

## Clientes y Estimates

Clientes: crear local → Holded, editar con GET/merge/PUT, importar cambios remotos, borrar remoto/local y detectar borrado en Holded. Match por ID remoto, NIF único o email único; nunca por nombre. Toda operación se limita a la instalación y las bajas conservan snapshots de presupuestos. La reconciliación completa solo marca ausentes tras una lista paginada íntegra y un GET de confirmación.

Estimates: `POST/GET/PUT/DELETE /api/v2/estimates`, Bearer, `contact_id` real, una línea por concepto facturable, cantidades y precio final sin IGIC del dominio. Impuestos de ventas IGIC activos proceden de `/api/v2/taxes`; la cuenta real tenía varias variantes al 7 % y la configuración eligió la variante estándar. `tax_included=false`. Tras crear, se guarda el ID antes de verificar; un reintento usa PUT sobre el mismo ID. Ante resultado incierto se busca una etiqueta estable, sin repetir POST sin evidencia. El GET de Holded se normaliza y compara por línea y total.

## Seguridad y operación

Reset desactivado por defecto; exige frase y confirmación, actúa sobre una instalación y preserva `installations`, configuración, usuarios y auditoría. No toca Holded. MCP usa HTTP `/mcp`, bearer distinto del token interno, scopes por herramienta, instalación fija, tipos de entrada/salida y guía `generator://guide`; no dispone de SQL. Web pública requiere `APP_ACCESS_PASSWORD` en `docker-compose.prod.yml`, con Basic sobre HTTPS. La instalación local usa puertos solo en loopback. Webhook opcional verifica HMAC crudo; el worker reconcilia contactos aunque el webhook no esté publicado.

## Pruebas ejecutadas

- Unitarias: 6 API, 18 MCP, 28 Application, 5 Contracts, 25 Domain, 50 Holded; 2 pruebas adicionales de protección web.
- PostgreSQL: 25 pruebas de integración, con instalaciones aleatorias, importación de cinco máquinas, previsualización/aplicación, aislamiento y reset preservando configuración.
- Navegador Edge headless: 2/2 pruebas pasan tras reconstruir la web; creación/importación, plegado avanzado, vista previa por línea sin HTTP 400, ajuste y persistencia; configuración, reset denegado, origen externo denegado y autenticación de API.
- MCP real: 31 herramientas, bearer, importación con bruto 1.000 €, descuentos 40 % + 10 %, cantidad 2 → coste 1.080 €, venta 2.000 €, preview/aplicación +300 € y revisión. PostgreSQL registró 4 eventos `ai` para el presupuesto TEST.
- Holded real con entidades `TEST`: crear/editar cliente local→remoto, editar remoto→local, búsqueda sin duplicados, borrar en ambos sentidos; Estimate creado con 5 máquinas y ajuste +300 €: subtotal 6.049,38 €, IGIC 423,47 €, total 6.472,85 €; reenvío conservó el mismo ID. Se borraron los contactos y Estimate de prueba y se archivaron los presupuestos locales `TEST`.
- `npm audit`: 0 vulnerabilidades tras actualizar Vitest/Drizzle y resolver esbuild transitivo. Docker: PostgreSQL, API, web, worker y MCP healthy. Typecheck, tests y build pasan.

## Límites y prueba final

El webhook no puede recibir eventos externos hasta publicar una URL HTTPS y configurar su secret en Holded; la reconciliación periódica ya funciona sin él. Basic en producción es un acceso compartido: si se necesitan usuarios independientes, usar identidad de usuarios en el proxy y OAuth para varios clientes MCP. La prueba con Holded alteró y borró únicamente entidades `TEST`; presupuestos `TEST` archivados locales quedan como rastro auditable. No se hizo merge a `main`.

Prueba manual breve: abre Configuración y comprueba Holded verde; crea/edita/elimina un cliente de prueba; importa cinco conceptos; revisa que la venta automática sea positiva; ajusta precio mirando el antes/después; envía a Holded; comprueba el mismo Estimate al reenviar; llama `get_holded_status` por el MCP autenticado.
