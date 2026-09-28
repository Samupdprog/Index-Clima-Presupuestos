import { createDb, createOAuthArtifactRepository } from "@quotes/db";
import { loadOAuthConfig } from "./config.js";
import { createOAuthHttpServer } from "./server.js";

const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? "4003");
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

// Un error de configuración detiene el servicio con un código claro, sin mostrar valores.
let config;
try { config = loadOAuthConfig(); } catch (error) {
  console.error(JSON.stringify({ level: "error", msg: "oauth_configuration_invalid", error: error instanceof Error ? error.message : "unknown" }));
  process.exit(1);
}
const { db, pool } = createDb(databaseUrl);
const store = createOAuthArtifactRepository(db);
const { server } = createOAuthHttpServer(config, store);
const purge = setInterval(() => { void store.purgeExpired().catch(() => undefined); }, 60 * 60_000);
purge.unref();

server.listen(port, host, () => console.log(`[oauth] listening on ${host}:${port} issuer=${config.issuer}`));
function stop() { clearInterval(purge); server.close(() => { void pool.end().finally(() => process.exit(0)); }); }
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
