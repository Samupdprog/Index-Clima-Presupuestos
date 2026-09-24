# Spec 002 — Interfaz web Index Clima V1

Estado: implementada.

## Objetivo

Construir la primera interfaz operativa de Index Clima sobre `apps/web`, con
Next.js App Router, una capa visual propia y movimiento funcional inspirado en
Animate UI. La interfaz cubre presupuestos, editor, revisión, clientes y
catálogos sin introducir Holded, MCP ni IA.

## Alcance funcional

- Listar, buscar, crear, duplicar y archivar presupuestos.
- Crear y editar clientes.
- Añadir, editar, ordenar y eliminar líneas de material, mano de obra,
  desplazamiento y otros conceptos.
- Gestionar empleados por línea, descuentos de proveedor, ajustes de precio y
  textos del presupuesto.
- Mostrar el cálculo económico recibido del backend y una revisión sin datos
  internos.
- Gestionar materiales, empleados, desplazamientos, proveedores y plantillas
  de texto mediante los endpoints de catálogo existentes.
- Soportar temas claro, oscuro y sistema, navegación colapsable y estados de
  carga, vacío, error, solo lectura y conflicto de revisión.

## Límites

- La UI nunca calcula precios, reparto de ajustes ni métricas económicas.
- Toda mutación de presupuesto utiliza commands con `expectedRevision`.
- Un `409` abre un conflicto explícito y exige recargar o cancelar.
- El navegador solo habla con un proxy same-origin de Next.js; la URL interna
  de la API no se expone mediante variables públicas.
- No se añaden datos de ejemplo permanentes ni migraciones.

## Diseño

- Tokens CSS semánticos para ambos temas.
- Motion breve y reducible mediante `prefers-reduced-motion`.
- Primitivas locales editables basadas en los patrones abiertos de Animate UI:
  ripple button y sheet/dialog animado sobre Radix UI y Motion.
- Lucide para iconografía.
- Desktop y portátil son prioritarios; tablet y móvil conservan las operaciones
  principales.

## Contratos

La capa `apps/web/lib/api` centraliza transporte, errores y commands. Reutiliza
los tipos de request exportados por `@quotes/contracts` y tipa las respuestas
actuales de la API sin redefinir reglas del dominio.

## Criterios de aceptación

- El flujo crear cliente → crear presupuesto → añadir conceptos → ajustar
  precio → añadir texto → revisar → reabrir conserva los datos en PostgreSQL.
- Los totales visibles proceden del último cálculo del backend.
- La aplicación es navegable por teclado, restaura/captura foco en capas Radix
  y respeta reducción de movimiento.
- `npm run typecheck`, `npm test`, `npm run build` y la configuración Compose
  son válidos.

## Limitaciones detectadas en el backend actual

- La lectura persistida de un presupuesto no expone `profitOnCostPct` ni
  `marginOnSalePct`, aunque el motor los calcula. La UI no los deriva por su
  cuenta y muestra “No disponible”.
- `duplicateQuote` copia las filas principales, pero no sus empleados,
  descuentos, ajustes, textos ni un cálculo actualizado. La UI llama al
  endpoint real y no intenta reconstruir la copia en el navegador.
- Al crear una línea desde un material de catálogo, el repositorio rellena a la
  vez `directUnitCost` y `supplierUnitPrice`. Como el motor prioriza el coste
  directo, los descuentos de proveedor añadidos después no afectan al coste.
