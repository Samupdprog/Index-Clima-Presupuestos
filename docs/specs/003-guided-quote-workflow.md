# Spec 003 — Flujo guiado de presupuestos

Estado: implementada.

## Objetivo

Convertir la creación y edición de presupuestos en un recorrido visible por
pasos, conservando la densidad profesional y el movimiento funcional de la UI
actual. El usuario debe saber en todo momento qué está preparando, qué falta y
cuál es la siguiente acción recomendada.

## Recorrido

1. Al crear un presupuesto se elige entre preparar datos con IA o empezar de
   forma manual.
2. Se selecciona o crea el cliente y se identifica el trabajo antes de abrir
   el editor.
3. El editor muestra un progreso estable: cliente, preparación, conceptos,
   precio y revisión.
4. La preparación con IA usa el flujo gratuito de copiar instrucciones,
   procesar documentos fuera de la aplicación, pegar JSON y revisar el
   resultado antes de importarlo.
5. La edición de conceptos, el ajuste de precio y la revisión se presentan
   como espacios consecutivos, con acciones explícitas para avanzar o volver.

## Importación asistida

- La interfaz acepta un array JSON de materiales, desplazamientos u otros
  conceptos con importes expresados como cadenas decimales.
- Antes de escribir se valida la estructura y se muestra una tabla de revisión.
- La importación no calcula importes ni escribe directamente en persistencia:
  traduce cada fila confirmada a los commands tipados existentes.
- Cada command conserva `expectedRevision`; los cálculos visibles se recargan
  desde el backend después de las mutaciones.
- Al eliminar una línea se retiran antes sus cálculos derivados y referencias
  auxiliares, y después se recalcula el presupuesto en la misma transacción.
- Este flujo es una importación iniciada y confirmada por una persona, no una
  integración autónoma con un proveedor de IA ni una llamada de pago.

## Estado y navegación

- El paso activo es estado de interfaz; los datos terminados se infieren del
  presupuesto persistido (cliente, líneas y cálculo).
- Todos los pasos anteriores siguen siendo accesibles para corregir datos.
- Un presupuesto existente puede usar la importación asistida en cualquier
  momento, no solo durante su creación.
- En solo lectura se puede recorrer y revisar, pero no importar ni modificar.

## Accesibilidad y movimiento

- El progreso usa semántica de lista y `aria-current="step"`.
- Los cambios de paso mantienen títulos claros y regiones identificables.
- El movimiento explica el cambio de contexto y respeta
  `prefers-reduced-motion`.

## Fuera de alcance

- Llamadas directas a OpenAI u otro proveedor.
- Subida y lectura de PDF en el navegador.
- Cambiar el cliente de un presupuesto ya creado (el contrato actual no lo
  permite).
- Nuevas reglas económicas o cálculos en la UI.

## Criterios de aceptación

- La creación obliga a elegir un camino y facilita seleccionar o crear cliente.
- El editor permite recorrer los cinco pasos sin abandonar el presupuesto.
- Un JSON válido puede revisarse e importarse mediante commands del backend.
- Un JSON inválido muestra un error accionable sin escribir datos.
- La revisión comercial no expone costes, beneficios ni datos internos.
- `npm run typecheck`, `npm test` y `npm run build` son válidos.
