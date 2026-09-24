# Spec 004 — Selectores buscables, importación de materiales y cierre

Estado: implementada.

## Objetivo

Reducir el esfuerzo de búsqueda en catálogos grandes y cerrar el recorrido del
presupuesto con acciones explícitas. El usuario debe poder localizar entidades
escribiendo, importar materiales en lote, guardar un presupuesto con un estado
claro y enviarlo a Holded sin exponer credenciales en el navegador.

## Selectores buscables

- Cliente, material, empleado, desplazamiento y plantilla de texto usan un
  combobox común con búsqueda por nombre y metadatos relevantes.
- El resultado aparece debajo del campo, admite teclado y ratón y evita recorrer
  listas largas con scroll.
- Los selectores de enumeraciones cortas (IGIC, regla de venta y tipo de ajuste)
  permanecen compactos y no necesitan búsqueda.
- Un valor opcional puede limpiarse y volver a la entrada manual.

## Importación de materiales

- El catálogo de materiales acepta ficheros `.xlsx` desde un diálogo dedicado.
- La primera fila contiene cabeceras. `Nombre` es obligatoria; se reconocen
  además `Proveedor`, `Código proveedor`, `Unidad`, `Coste proveedor`,
  `Precio venta`, `IGIC` y `Descripción`.
- La interfaz normaliza cabeceras, muestra una previsualización y señala filas
  inválidas antes de confirmar.
- Los importes viajan como cadenas decimales. El backend valida todas las filas
  y las inserta en una única transacción para evitar importaciones parciales.
- La importación añade registros; no sobrescribe ni fusiona materiales
  existentes de forma implícita.

## Estados y cierre

- Los estados editables son `draft`, `ready_for_review` y `finalized`.
- El encabezado del editor muestra un control pequeño para cambiar rápidamente
  entre esos estados. Un presupuesto finalizado puede volver a borrador.
- `Guardar` en la revisión marca el presupuesto como finalizado.
- `Guardar e importar en Holded` crea un presupuesto (`estimate`) en Holded o
  actualiza el documento ya vinculado, y solo después marca el presupuesto como
  finalizado y guarda su identificador externo.
- Un error de Holded no cambia el estado ni el vínculo local y produce un
  mensaje accionable. La clave API solo se lee en el servicio backend.
- Los presupuestos archivados y los originados en Holded en modo de solo lectura
  no ofrecen cambios de estado ni exportación.

## Integración con Holded

- El adaptador recibe exclusivamente el resultado calculado por el motor; no
  replica reglas de precio.
- Cada línea comercial se envía como una unidad cuyo precio es el total de
  venta calculado de esa línea. Así se conservan los ajustes repartidos por el
  dominio sin dividir ni recalcular importes en la integración.
- Si existe `holdedEstimateId`, se actualiza el documento remoto para evitar
  duplicados. Si no existe, se crea y se persiste el identificador devuelto.
- La petición está protegida por `expectedRevision` para evitar exportar una
  versión obsoleta mientras otro usuario modifica el presupuesto.

## Criterios de aceptación

- Los selectores de entidades filtran mientras se escribe y funcionan con
  flechas, Intro y Escape.
- Un `.xlsx` válido puede revisarse e importarse de forma atómica.
- El estado puede cambiarse desde el encabezado sin ocupar espacio relevante.
- Las dos acciones finales guardan el estado esperado; la acción de Holded
  informa claramente cuando la integración no está configurada.
- `npm run typecheck`, `npm test` y `npm run build` son válidos.
