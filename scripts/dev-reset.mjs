// Reset de datos de DESARROLLO.
//
// Borra TODOS los datos de negocio (clientes, presupuestos, catálogos, etc.)
// pero CONSERVA la installation y su configuración (incluida la API key de
// Holded cifrada) y los usuarios. Pensado para dejar el entorno limpio antes
// de pruebas reales.
//
// Salvaguardas:
//   - Requiere ALLOW_DEV_RESET=true (para dificultar su uso accidental).
//   - Se niega si NODE_ENV === "production" salvo que además se pase
//     I_UNDERSTAND_THIS_IS_DESTRUCTIVE=true.
//   - NO borra la tabla `installations` (la config sobrevive).
//
// Uso:
//   ALLOW_DEV_RESET=true node scripts/dev-reset.mjs
//
// Es idempotente (ejecutarlo de nuevo sobre una base ya limpia es seguro).

import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL es obligatorio.");
  process.exit(1);
}
if (process.env.ALLOW_DEV_RESET !== "true") {
  console.error("Reset bloqueado. Ejecuta con ALLOW_DEV_RESET=true si de verdad quieres borrar los datos de negocio.");
  process.exit(1);
}
if (process.env.NODE_ENV === "production" && process.env.I_UNDERSTAND_THIS_IS_DESTRUCTIVE !== "true") {
  console.error("NODE_ENV=production: reset bloqueado. Este script es solo para desarrollo.");
  process.exit(1);
}

// Tablas raíz de datos de negocio; CASCADE limpia sus dependientes.
// NO se incluye `installations` (se conserva la config) ni `users`.
const BUSINESS_TABLES = [
  "clients",
  "suppliers",
  "catalog_materials",
  "catalog_travels",
  "employees",
  "text_templates",
  "quotes",
  "reference_counters",
  "audit_events",
  "holded_entity_snapshots",
  "holded_operations",
  "holded_sync_cursors",
  "holded_webhook_events",
  "idempotency_keys",
  "jobs",
];

const pool = new Pool({ connectionString: databaseUrl });
try {
  const list = BUSINESS_TABLES.map((t) => `"${t}"`).join(", ");
  await pool.query(`TRUNCATE ${list} RESTART IDENTITY CASCADE;`);
  const { rows } = await pool.query("SELECT count(*)::int AS n FROM installations;");
  console.log(`Reset de desarrollo completado. Datos de negocio borrados. Instalaciones conservadas: ${rows[0].n}.`);
} finally {
  await pool.end();
}
