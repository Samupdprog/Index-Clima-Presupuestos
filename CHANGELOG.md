# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/); versiones [SemVer](https://semver.org/lang/es/).

## [1.2.0] — 2026-09-30

### Añadido

- Importar materiales desde Excel explica la estructura del fichero (columnas, qué poner, ejemplos y nombres alternativos) y ofrece una **plantilla .xlsx** descargable con ejemplos y una hoja de instrucciones.
- Tras elegir el fichero se muestran las **columnas detectadas** (con aviso si faltan coste, precio de venta o IGIC) y **cómo se ha leído** cada fila antes de comparar con el catálogo. Los materiales nuevos muestran todos sus datos: coste, venta, IGIC, unidad, proveedor y código.

### Corregido

- Muchas más cabeceras reconocidas («Precio de coste (€)», «PVP cliente», «% IGIC», «Artículo», «Referencia»…) y detección de la fila de cabeceras aunque haya títulos encima: antes una cabecera distinta se ignoraba sin avisar y solo se importaba el nombre.
- IGIC con formato de porcentaje en Excel (0,07 → 7 %) y validación de los tipos admitidos (0, 3, 7, 15) también en el servidor.
- Una celda vacía de Unidad o IGIC ya no sobrescribe el material existente con «ud» y 7 %: conserva el valor actual (los materiales nuevos siguen usando ud y 7 %).

## [1.1.2] — 2026-09-30

### Corregido

- MCP compatible con el action discovery actual de ChatGPT (`Authentication succeeded, action discovery failed`): todas las herramientas publican `title`, y los catálogos usan schemas de salida cerrados y explícitos (material, empleado, suplemento, desplazamiento, proveedor y texto) en lugar de `z.record(z.string(), z.json())`, que generaba `propertyNames`, `additionalProperties: {}` y `$ref` recursivos. Se mantienen las 52 herramientas.
- El input MCP ya no acepta `metadata` libre en `create_material`, `update_material` e `import_quote_lines` (la API interna no cambia). Las respuestas de catálogo ya no incluyen `installationId` ni `metadata`.
- Test que falla si `tools/list` publica una herramienta sin `title` o schemas con `propertyNames`, `additionalProperties: {}` o `$ref`.

## [1.1.1] — 2026-09-29

### Corregido

- Editar en la tabla de conceptos un solo dato (coste por unidad, coste total, precio cliente, descripción o IGIC) reseteaba la cantidad a 1 y el IGIC a 7 %, cambiando la línea entera. Causa: en Zod 4 `.partial()` conserva los valores por defecto del esquema, así que la edición parcial rellenaba campos no enviados. Ahora solo cambia el dato editado.
- Editar el precio cliente total de una línea ya no la convierte en «total fijo»: el servidor deriva el precio por unidad y, si después cambia la cantidad, la venta escala con ella (igual que el coste total).

## [1.1.0] — 2026-09-29

Detalle funcional y técnico en [SPEC-013](docs/specs/013-v1.1-ux-catalog-lifecycle.md).

### Añadido

- Pantalla de inicio de sesión con el logo de Index Clima; el dispositivo se recuerda 30 días con una cookie segura (`HttpOnly`, `Secure`, `SameSite=Lax`) y se renueva sola. Botón «Cerrar sesión».
- Icono de la app (favicon, pantalla de inicio de iOS/Android) y manifiesto instalable.
- Coste de una línea editable por unidad o por total; el servidor calcula el otro.
- Revisión: tarjeta «Resultado interno» (coste, venta sin IGIC, beneficio y margen) y conmutador Cliente / Interna con tabla interna por concepto. Nada de esto aparece en el documento del cliente.
- Número de presupuesto editable y único; si ya está en Holded se actualiza el mismo Estimate.
- Papelera: mover, restaurar y eliminar definitivamente (solo desde la papelera o borradores nunca enviados). Nunca borra en Holded.
- Catálogo de materiales: «Actualizar desde Excel» con previsualización en servidor (sin cambios / actualizaciones / nuevos) antes de aplicar; reactivar registros desactivados.
- MCP 0.4.0: gestión de catálogos (materiales, empleados, desplazamientos, proveedores y textos), actualización masiva de materiales con previsualización y aprobación, cambio de número, papelera y borrado definitivo con confirmación explícita.

### Cambiado

- Los importes y cantidades se muestran sin ceros inútiles y en formato español (`0`, `5`, `13,96`, `1.234,50`); los campos aceptan coma o punto.
- Fila de mano de obra rediseñada y tabla de conceptos en tarjetas en pantallas estrechas; panel de edición de `680 px` en 2 columnas y a pantalla completa en móvil. Sin scroll horizontal.
- La ruta `/api/backend` comprueba la sesión además de `proxy.ts`.

### Migraciones

- `0007_quote_reference_and_trash`: añade `quotes.holded_synced_reference` y `quotes.deleted_at` (aditiva; se aplica sola al desplegar).

### Configuración

- Nueva variable opcional `APP_SESSION_SECRET`. Sin ella, la firma de sesión se deriva de `APP_ACCESS_PASSWORD` e `INTERNAL_SERVICE_TOKEN`.

## [1.0.0]

Versión inicial en producción: generador de presupuestos, integración con Holded, MCP con OAuth 2.1 para ChatGPT y Claude.
