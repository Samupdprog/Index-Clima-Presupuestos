# Presentación de presupuestos exportados a Holded

Estado: en verificación con GET y PDF reales de Holded.

El presupuesto exportado conserva la referencia local como número de documento. Las partidas facturables mantienen el orden guardado y sus importes proceden del cálculo de dominio. Los bloques de «Textos del presupuesto» se ordenan por `position` y se unen en `notes`: título y cuerpo separados por salto de línea, bloques separados por una línea en blanco. Si se eliminan todos, se envía `notes: ""` también en PUT para borrar el texto anterior. Estos bloques no se convierten en partidas y no alteran los importes.

En esta cuenta y plantilla, el campo `notes` aparece en la sección de texto situada al final del PDF. La documentación pública de API v2 lo describe como nota interna; la comprobación del PDF es necesaria para esta integración. `description` contiene la descripción general de la operación y no sustituye a los textos. El contrato v2 utiliza `contact_id`, `description`, `notes` e `items[].price`; no se copian los nombres camelCase del API anterior.

La respuesta GET se valida contra referencia, cliente, notas, orden de partidas, subtotal, impuesto y total. Una divergencia deja la sincronización como fallida y visible, sin marcarla como completada. Si el Estimate está en borrador se aprueba mediante `/approve` antes de comprobar el PDF: la prueba real mostró que solo así aparece el número local en el PDF. La aprobación no envía correo al cliente. PUT actualiza el mismo ID. Si un Estimate vinculado tiene otro número, la sincronización se bloquea sin crear otro.

Pruebas reales del 28/09/2026 confirmaron que API v2 **suma** IGIC a `items.price` incluso con `tax_included: true`: `price=107`, IGIC 7 %, produce subtotal 107, impuesto 7,49 y total 114,49. Por eso el precio unitario enviado es la base neta de dominio dividida por cantidad. Con `price=100` y `tax_included: true`, GET y PDF dan subtotal 100, IGIC 7 y total 107. `show_total` queda activado. El adaptador no vuelve a sumar ni a quitar IGIC.

La plantilla PDF actual de Holded muestra la columna «PRECIO» sin IGIC y la columna «TOTAL» con IGIC aun con `tax_included: true`. Esta presentación depende de Holded y no se altera con descuentos artificiales. La visualización del precio unitario bruto en esa columna requiere una plantilla de Holded que lo admita. Se omite `unit_type` porque el valor «unidades» se imprimió como `(Docloc_unidades)` en el PDF probado; se omite la descripción de línea duplicada cuando coincide con el nombre.

En la UI, los decimales editables se muestran sin ceros de relleno y se convierten mediante Decimal sin cambiar el dato persistido. Los textos se pueden crear, editar, eliminar y reordenar; los cambios se guardan con revisión optimista. La previsualización de ajustes procede del servidor y considera los ajustes ya aplicados en el precio «antes».
