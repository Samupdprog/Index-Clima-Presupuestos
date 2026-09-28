#!/usr/bin/env node
// Desarrollo con hot reload fuera de Docker: carga `.env`, traduce los hosts
// internos de Compose (postgres:5432, api:4000) a los puertos publicados en
// 127.0.0.1 y arranca el workspace indicado con `npm run dev`.
// Nunca imprime valores de variables.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

const services = { api: "@quotes/api", mcp: "@quotes/mcp", worker: "@quotes/worker", web: "@quotes/web", oauth: "@quotes/oauth" };
const service = process.argv[2];
if (!(service in services)) {
  console.error(`Uso: node scripts/dev-local.mjs <${Object.keys(services).join("|")}>`);
  process.exit(1);
}

function parseEnv(path) {
  const values = {};
  for (const line of readFileSync(path, "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    let value = match[2];
    if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
    values[match[1]] = value;
  }
  return values;
}

const file = parseEnv(".env");
// Las variables ya exportadas en la shell tienen prioridad sobre `.env`.
const env = { ...file, ...process.env };
const ports = { web: env.WEB_PORT || "3000", api: env.API_PORT || "4000", mcp: env.MCP_PORT || "4001", worker: env.WORKER_HEALTH_PORT || "4002", oauth: env.OAUTH_PORT || "4003", postgres: env.POSTGRES_PORT || "5432" };

if (env.DATABASE_URL) {
  const url = new URL(env.DATABASE_URL);
  if (url.hostname === "postgres") { url.hostname = "127.0.0.1"; url.port = ports.postgres; }
  env.DATABASE_URL = url.toString();
}
if (!process.env.INTERNAL_API_URL) env.INTERNAL_API_URL = `http://127.0.0.1:${ports.api}`;
// OAuth en desarrollo: el Authorization Server integrado corre en localhost (issuer local),
// salvo que la shell indique otro issuer/JWKS (IdP externo).
if (!process.env.AUTH_ISSUER_URL) env.AUTH_ISSUER_URL = `http://localhost:${ports.oauth}`;
if (!process.env.AUTH_JWKS_URL) env.AUTH_JWKS_URL = `http://127.0.0.1:${ports.oauth}/oauth/jwks`;
if (service !== "web") { env.HOST = process.env.HOST || "127.0.0.1"; env.PORT = process.env.PORT || ports[service]; }
else env.PORT = process.env.PORT || ports.web;
env.NODE_ENV = process.env.NODE_ENV || "development";

console.log(`[dev-local] ${service} → puerto ${env.PORT} (API interna ${env.INTERNAL_API_URL})`);
const child = spawn("npm", ["run", "dev", "--workspace", services[service]], { env, stdio: "inherit", shell: process.platform === "win32" });
child.on("exit", (code) => process.exit(code ?? 0));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
