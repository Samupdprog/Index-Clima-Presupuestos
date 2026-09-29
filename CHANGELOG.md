# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/); versiones [SemVer](https://semver.org/lang/es/).

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
