import { createDb } from "./client.js";
import { createInstallationRepository } from "./repositories/installations.js";

// Seed de infraestructura: crea/actualiza ÚNICAMENTE la installation necesaria.
// No inserta clientes, presupuestos, materiales ni ningún dato de prueba.
// Es idempotente. El registro de installation NO es un "dato demo": es la
// infraestructura mínima que la API necesita para arrancar.

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

// El id debe coincidir con INSTALLATION_ID que usa la API para leer/escribir
// config; si no coinciden, los UPDATE por id afectarían a cero filas.
const id = process.env.INSTALLATION_ID?.trim() || undefined;
const slug = (process.env.INSTALLATION_SLUG ?? process.env.INSTANCE_SLUG ?? "index-clima").trim();
const displayName = (process.env.INSTALLATION_NAME ?? "Index Clima").trim();

const { db, pool } = createDb(databaseUrl);
const installations = createInstallationRepository(db);
const installation = await installations.ensure({ id, slug, displayName });
console.log(JSON.stringify({ seeded: "installation", ...installation }));
await pool.end();
