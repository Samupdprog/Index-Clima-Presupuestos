# Editor de conceptos y línea avanzada

## Alcance

El paso 3 presenta un compositor permanente con cuatro tipos y una lista económica editable. Los datos del catálogo se copian como valores iniciales de la línea; nunca se actualiza el catálogo al editar un presupuesto. La mano de obra agrupa varios empleados en una sola línea comercial.

## Persistencia y cálculo

`createQuoteLine` crea línea, descuentos y empleados iniciales en una transacción y una revisión. `updateQuoteLineDetails` guarda línea, descuentos y empleados en una transacción y una revisión. Ambos respetan `expectedRevision`, acceso de solo lectura y presupuesto archivado. El servidor calcula y confirma todos los importes.

`baseUnitPrice` sigue siendo la fuente canónica para `add_percentage` y `add_euros_per_unit`, por compatibilidad con presupuestos existentes. `saleBaseMode` describe la base elegida en la interfaz; en los comandos compuestos nuevos el servidor sincroniza `baseUnitPrice` mediante el motor compartido con el coste neto o PVP proveedor aplicable. Los comandos antiguos conservan su semántica histórica. Los descuentos permanecen separados y consecutivos. Un coste neto manual prevalece sobre los descuentos para el coste de esa línea. Las vistas previas reutilizan el motor de dominio, pero no sustituyen el cálculo persistido del servidor.

## Interacción

Descripción, cantidad, precio unitario y tipo de IGIC se pueden editar en la lista con clic, Enter o desenfoque; Escape cancela. El asa es la única zona de arrastre y el menú ofrece subir/bajar. El editor avanzado agrupa concepto, proveedor/coste o equipo, precio cliente y más información; guarda todo junto. En móvil cada línea se presenta compacta en una columna y el resumen pasa debajo. Todos los controles admiten teclado, foco visible y movimiento reducido.
