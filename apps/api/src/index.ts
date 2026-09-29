import { createHash, createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  archiveQuote,
  applyMaterialImport,
  MaterialImportError,
  previewMaterialImport,
  type MaterialImportRepository,
  changeQuoteReference,
  deleteQuotePermanently,
  restoreQuote,
  trashQuote,
  addLaborEntry,
  addLaborLine,
  addMaterialLine,
  addOtherLine,
  addPriceAdjustment,
  addQuoteText,
  addSupplierDiscount,
  addTravelLine,
  executeQuoteCommand,
  getCatalog,
  type QuoteWorkflowRepository,
  type HoldedContactGateway,
  createClientWithHolded,
  createQuote,
  duplicateQuote,
  getClient,
  getHoldedEstimate,
  getQuote,
  listHoldedEstimates,
  searchHoldedEstimates,
  type HoldedEstimateQueryDeps,
  getQuoteReview,
  previewPriceAdjustment,
  previewQuoteLine,
  searchClientsWithHolded,
  searchQuotes,
  updateClientWithHolded,
  deleteClientWithHolded,
  syncClientWithHolded,
  syncClientsWithHolded,
  syncQuoteToHolded,
  QuoteExportError,
  updateQuote,
} from "@quotes/application";
import {
  createClientRequestSchema,
  createQuoteRequestSchema,
  revisionGuardSchema,
  searchClientsRequestSchema,
  searchQuotesRequestSchema,
  updateClientRequestSchema,
  quoteCommandSchema,
  catalogMutationSchema,
  materialImportRequestSchema,
  previewPriceAdjustmentRequestSchema,
  holdedIdSchema,
  listHoldedEstimatesQuerySchema,
  searchHoldedEstimatesQuerySchema,
} from "@quotes/contracts";
import {
  createClientRepository,
  createDb,
  createQuoteRepository,
  createQuoteWorkflowRepository,
  createCatalogRepository,
  createInstallationRepository,
  createDataResetRepository,
  createWebhookRepository,
  createQuoteExportRepository,
  withAuditActor,
  InstallationNotFoundError,
  QuoteNotFoundError,
  ReadOnlyQuoteError,
  RevisionConflictError,
} from "@quotes/db";
import { createHoldedClient, HoldedApiError, maskApiKey, type HoldedHealthResult } from "@quotes/holded";
import { createHoldedContactGateway } from "./holded-gateway.js";
import { createHoldedEstimateGateway } from "./holded-estimate-gateway.js";
import { createHoldedEstimateReader } from "./holded-estimate-reader.js";
import { holdedReadErrorResponse } from "./holded-read-errors.js";
import { authenticateService, allowedAiRequest, dataResetAllowed } from "./access.js";
import { verifyHoldedWebhook } from "./webhooks.js";

const host = process.env.HOST ?? "0.0.0.0";
const port = Number(process.env.PORT ?? "4000");
const installationId = process.env.INSTALLATION_ID;
const databaseUrl = process.env.DATABASE_URL;
const database = databaseUrl ? createDb(databaseUrl) : null;
const clients = database ? createClientRepository(database.db) : null;
const quotes = database ? createQuoteRepository(database.db) : null;
const quoteWorkflow = database ? createQuoteWorkflowRepository(database.db) as unknown as QuoteWorkflowRepository : null;
const catalog = database ? createCatalogRepository(database.db) : null;
const installationsRepo = database ? createInstallationRepository(database.db) : null;
const DEFAULT_HOLD_HEALTH_INTERVAL_MINUTES = 5;
let holdedHealthCheckPromise: Promise<HoldedHealthResult> | null = null;

function normalizeCheckIntervalMinutes(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value ?? DEFAULT_HOLD_HEALTH_INTERVAL_MINUTES);
  if (!Number.isFinite(parsed)) return DEFAULT_HOLD_HEALTH_INTERVAL_MINUTES;
  const options = [1, 5, 10, 15, 30, 60];
  return options.includes(Math.round(parsed)) ? Math.round(parsed) : DEFAULT_HOLD_HEALTH_INTERVAL_MINUTES;
}

function getHoldedSettingsConfig(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") return {};
  const config = value as Record<string, unknown>;
  const holded = config.holded && typeof config.holded === "object" ? config.holded as Record<string, unknown> : {};
  return holded;
}

function deriveHoldedEncryptionKey() {
  // `||` + trim: una variable vacía ("") NO debe usarse como material (rompería
  // el cifrado y sería débil). Orden: clave explícita → token de servicio →
  // DATABASE_URL → INSTALLATION_ID → constante de desarrollo.
  const material =
    process.env.HOLDED_ENCRYPTION_KEY?.trim() ||
    process.env.INTERNAL_SERVICE_TOKEN?.trim() ||
    process.env.DATABASE_URL?.trim() ||
    process.env.INSTALLATION_ID?.trim() ||
    "index-clima-local-dev";
  return createHash("sha256").update(material).digest();
}

function encryptHoldedSecret(secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveHoldedEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

function decryptHoldedSecret(serialized: string) {
  const raw = Buffer.from(serialized, "base64");
  if (raw.length <= 28) throw new Error("invalid_holded_secret");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const ciphertext = raw.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", deriveHoldedEncryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

async function readInstallationConfig(): Promise<Record<string, unknown>> {
  if (!installationsRepo || !installationId) return {};
  return installationsRepo.getConfig(installationId);
}

/**
 * Persiste la config de la installation. Lanza `InstallationNotFoundError` si
 * no existe la fila (INSTALLATION_ID sin instalación): así un "guardar" nunca
 * parece correcto cuando en realidad no persistió nada.
 */
async function writeInstallationConfig(nextConfig: Record<string, unknown>) {
  if (!installationsRepo || !installationId) return;
  await installationsRepo.writeConfig(installationId, nextConfig);
}

async function getHoldedSettingsFromDatabase() {
  const config = await readInstallationConfig();
  const holded = getHoldedSettingsConfig(config);
  return { config, holded };
}

function getConfiguredHoldedApiKey(config: Record<string, unknown>) {
  const holded = getHoldedSettingsConfig(config);
  if (holded.disconnected === true) return undefined;
  const encrypted = typeof holded.apiKeyEncrypted === "string" ? holded.apiKeyEncrypted : undefined;
  if (encrypted) {
    try { return decryptHoldedSecret(encrypted); } catch { return undefined; }
  }
  return typeof process.env.HOLDED_API_KEY === "string" && process.env.HOLDED_API_KEY.trim() ? process.env.HOLDED_API_KEY.trim() : undefined;
}

async function persistHoldedHealth(result: HoldedHealthResult) {
  if (!database || !installationId) return result;
  try {
    const config = await readInstallationConfig();
    const holded = getHoldedSettingsConfig(config);
    const nextConfig = { ...config, holded: { ...holded, health: result, checkIntervalMinutes: normalizeCheckIntervalMinutes(holded.checkIntervalMinutes ?? process.env.HOLDED_HEALTH_CHECK_INTERVAL_MINUTES ?? DEFAULT_HOLD_HEALTH_INTERVAL_MINUTES) } };
    await writeInstallationConfig(nextConfig);
  } catch (error) {
    // El health no debe romperse por persistencia; el estado en vivo se devuelve igual.
    if (!(error instanceof InstallationNotFoundError)) throw error;
  }
  return result;
}

const INSTALLATION_MISSING_HEALTH: HoldedHealthResult = {
  status: "unknown",
  code: "not_configured",
  message: "No existe la instalación configurada (INSTALLATION_ID). Ejecuta la inicialización de la base de datos.",
  lastCheckedAt: null,
};

async function runHoldedHealthCheck(force = false): Promise<HoldedHealthResult> {
  if (!database || !installationId) {
    return { status: "unknown", code: "not_configured", message: "Holded no está configurado en este servicio.", lastCheckedAt: null };
  }
  // Si falta la installation, no intentamos escribir (evita 500 al cargar ajustes).
  if (installationsRepo && !(await installationsRepo.exists(installationId))) {
    return INSTALLATION_MISSING_HEALTH;
  }

  const config = await readInstallationConfig();
  const holded = getHoldedSettingsConfig(config);
  const featureEnabled = process.env.FEATURE_HOLDED === "true";
  const resolvedKey = getConfiguredHoldedApiKey(config);
  const intervalMinutes = normalizeCheckIntervalMinutes(holded.checkIntervalMinutes ?? process.env.HOLDED_HEALTH_CHECK_INTERVAL_MINUTES ?? DEFAULT_HOLD_HEALTH_INTERVAL_MINUTES);

  const currentStatus = typeof holded.health === "object" && holded.health ? holded.health as HoldedHealthResult : null;
  const currentTimestamp = currentStatus?.lastCheckedAt ? Date.parse(currentStatus.lastCheckedAt) : Number.NaN;
  if (!force && currentStatus && Number.isFinite(currentTimestamp) && Date.now() - currentTimestamp < intervalMinutes * 60_000) {
    return currentStatus;
  }
  if (holdedHealthCheckPromise) return holdedHealthCheckPromise;

  const checkingResult: HoldedHealthResult = {
    status: "checking",
    code: "unknown",
    message: "Comprobando conexión con Holded…",
    lastCheckedAt: null,
  };

  holdedHealthCheckPromise = (async () => {
    const writing = { ...config, holded: { ...holded, health: checkingResult, checkIntervalMinutes: intervalMinutes } };
    await writeInstallationConfig(writing);

    if (!featureEnabled) {
      const result = { status: "unknown", code: "not_configured", message: "Holded no está habilitado en el servidor.", lastCheckedAt: new Date().toISOString() } satisfies HoldedHealthResult;
      await persistHoldedHealth(result);
      return result;
    }
    if (!resolvedKey) {
      const result = { status: "unknown", code: "not_configured", message: "Falta la API Key de Holded.", lastCheckedAt: new Date().toISOString() } satisfies HoldedHealthResult;
      await persistHoldedHealth(result);
      return result;
    }

    const result = await newHoldedClient(resolvedKey).checkHealth();
    await persistHoldedHealth(result);
    return result;
  })();

  try {
    return await holdedHealthCheckPromise;
  } finally {
    holdedHealthCheckPromise = null;
  }
}

async function buildHoldedSettingsPayload(forceHealth = false) {
  const config = await readInstallationConfig();
  const holded = getHoldedSettingsConfig(config);
  const featureEnabled = process.env.FEATURE_HOLDED === "true";
  const resolvedKey = getConfiguredHoldedApiKey(config);
  const intervalMinutes = normalizeCheckIntervalMinutes(holded.checkIntervalMinutes ?? process.env.HOLDED_HEALTH_CHECK_INTERVAL_MINUTES ?? DEFAULT_HOLD_HEALTH_INTERVAL_MINUTES);
  const health = await runHoldedHealthCheck(forceHealth);

  return {
    featureEnabled,
    isConfigured: featureEnabled && Boolean(resolvedKey),
    keyMasked: resolvedKey ? maskApiKey(resolvedKey) : null,
    checkIntervalMinutes: intervalMinutes,
    health,
    taxMapping: holded.taxMapping ?? {},
  };
}

async function updateHoldedSettings(payload: Record<string, unknown>) {
  if (!database || !installationId) return buildHoldedSettingsPayload();
  const currentConfig = await readInstallationConfig();
  const holded = getHoldedSettingsConfig(currentConfig);
  const nextHolded = { ...holded };

  // Desconexión EXPLÍCITA: sólo con removeApiKey === true se borra la clave.
  if (payload.removeApiKey === true) {
    delete nextHolded.apiKeyEncrypted;
    nextHolded.disconnected = true;
  } else {
    const incomingKey = payload.apiKey;
    // Un campo vacío NO borra la clave (evita perderla al cambiar solo el intervalo).
    if (typeof incomingKey === "string" && incomingKey.trim().length > 0) {
      nextHolded.apiKeyEncrypted = encryptHoldedSecret(incomingKey.trim());
      nextHolded.disconnected = false;
    }
  }

  if (payload.checkIntervalMinutes !== undefined) {
    nextHolded.checkIntervalMinutes = normalizeCheckIntervalMinutes(payload.checkIntervalMinutes);
  }

  if (payload.taxMapping && typeof payload.taxMapping === "object") {
    const entries = Object.entries(payload.taxMapping as Record<string, unknown>);
    if (entries.some(([rate, key]) => !["0", "3", "7", "15"].includes(rate) || typeof key !== "string" || key.length > 100)) throw new Error("invalid_json");
    nextHolded.taxMapping = Object.fromEntries(entries.filter(([, key]) => key));
  }
  const nextConfig = { ...currentConfig, holded: nextHolded };
  await writeInstallationConfig(nextConfig);

  // Comprobación inmediata tras guardar (no esperar al intervalo).
  return buildHoldedSettingsPayload(true);
}

/**
 * Construye el gateway de contactos de Holded si la integración está activa y
 * hay clave configurada; en caso contrario devuelve null (modo degradado).
 */
/** Log seguro de operaciones Holded: metadatos, nunca clave/cabeceras/cuerpos. */
function holdedLogger(event: { method: string; path: string; status: number | null; code?: string; ok: boolean; durationMs: number }) {
  const line = { level: event.ok ? "info" : "warn", msg: "holded_request", method: event.method, path: event.path, status: event.status, code: event.code, ms: event.durationMs };
  console[event.ok ? "log" : "warn"](JSON.stringify(line));
}

function newHoldedClient(apiKey: string) {
  return createHoldedClient({ apiKey, logger: holdedLogger });
}

async function buildHoldedGateway(): Promise<HoldedContactGateway | null> {
  const config = await readInstallationConfig();
  const featureEnabled = process.env.FEATURE_HOLDED === "true";
  const resolvedKey = getConfiguredHoldedApiKey(config);
  if (!featureEnabled || !resolvedKey) return null;
  return createHoldedContactGateway(newHoldedClient(resolvedKey));
}

/** Lectura de Estimates remotos: null si Holded no está activo o no hay clave. */
async function buildHoldedEstimateQueryDeps(): Promise<HoldedEstimateQueryDeps | null> {
  const resolvedKey = getConfiguredHoldedApiKey(await readInstallationConfig());
  if (process.env.FEATURE_HOLDED !== "true" || !resolvedKey || !quotes) return null;
  return { reader: createHoldedEstimateReader(newHoldedClient(resolvedKey)), links: quotes };
}

function mapHoldedReadError(res: ServerResponse, error: unknown) {
  const mapped = holdedReadErrorResponse(error);
  if (!mapped) return mapError(res, error);
  if (mapped.body.retryAfterSeconds !== undefined) res.setHeader("retry-after", String(mapped.body.retryAfterSeconds));
  return sendJson(res, mapped.status, mapped.body);
}

async function readHoldedEstimates(res: ServerResponse, read: (deps: HoldedEstimateQueryDeps) => Promise<unknown>) {
  const deps = await buildHoldedEstimateQueryDeps();
  if (!deps) return sendJson(res, 503, { error: "holded_not_configured" });
  try {
    const result = await read(deps);
    return result === null ? sendJson(res, 404, { error: "holded_estimate_not_found" }) : sendJson(res, 200, result);
  } catch (error) {
    return mapHoldedReadError(res, error);
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = "";
    let bytes = 0;
    req.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 2_000_000) { reject(new Error("payload_too_large")); return; }
      data += chunk.toString();
    });
    req.on("end", () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch { reject(new Error("invalid_json")); }
    });
    req.on("error", reject);
  });
}

function requireContext(res: ServerResponse) {
  if (!database || !clients || !quotes || !quoteWorkflow || !catalog || !installationId) {
    sendJson(res, 503, { error: "database_not_configured" });
    return false;
  }
  return true;
}

function mapError(res: ServerResponse, error: unknown) {
  if (error instanceof MaterialImportError) return sendJson(res, error.code === "catalog_changed_since_preview" ? 409 : 422, { error: error.code });
  if (error instanceof QuoteExportError) return sendJson(res, error.code === "revision_conflict" ? 409 : error.code.endsWith("not_found") ? 404 : 422, { error: error.code, details: error.details });
  if (error instanceof Error && error.name === "PricingValidationError") return sendJson(res, error.message === "revision_conflict" ? 409 : error.message.endsWith("not_found") ? 404 : 422, { error: error.message });
  if (error instanceof Error && ["client_not_found", "revision_conflict", "holded_not_configured", "holded_delete_confirmation_required", "client_match_ambiguous", "holded_contact_creation_uncertain"].includes(error.message)) return sendJson(res, error.message === "revision_conflict" ? 409 : error.message === "client_not_found" ? 404 : 422, { error: error.message });
  if (error instanceof InstallationNotFoundError) return sendJson(res, 503, { error: "installation_not_found", message: "No existe la instalación configurada (INSTALLATION_ID). Ejecuta la inicialización de la base de datos (db:seed)." });
  if (error instanceof RevisionConflictError) return sendJson(res, 409, { error: "revision_conflict" });
  if (error instanceof QuoteNotFoundError) return sendJson(res, 404, { error: "quote_not_found" });
  if (error instanceof ReadOnlyQuoteError) return sendJson(res, 422, { error: "quote_read_only" });
  if (error instanceof Error && error.message === "invalid_json") return sendJson(res, 400, { error: "invalid_json" });
  if (error instanceof Error && error.message === "payload_too_large") return sendJson(res, 413, { error: "payload_too_large" });
  if (error instanceof HoldedApiError) return sendJson(res, 502, { error: "holded_sync_failed", details: { status: error.status, code: error.code, remote: error.responseBody } });
  if (error && typeof error === "object" && "code" in error && error.code === "23505") return sendJson(res, 409, { error: "conflict" });
  // Driver errors may contain row data or credentials: only log the error class.
  console.error(JSON.stringify({ event: "api_error", type: error instanceof Error ? error.name : "unknown" }));
  return sendJson(res, 500, { error: "internal_error" });
}

const server = createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/webhooks/holded") {
    try {
      if (!database || !installationId || !process.env.HOLDED_WEBHOOK_SECRET) return sendJson(res, 503, { error: "webhook_not_configured" });
      const chunks: Buffer[] = []; let bytes = 0;
      for await (const chunk of req) { bytes += chunk.length; if (bytes > 2_000_000) return sendJson(res, 413, { error: "payload_too_large" }); chunks.push(Buffer.from(chunk)); }
      const raw = Buffer.concat(chunks);
      if (!verifyHoldedWebhook(raw, String(req.headers["x-holded-webhook-signature"] ?? ""), process.env.HOLDED_WEBHOOK_SECRET)) return sendJson(res, 401, { error: "invalid_signature" });
      if (process.env.HOLDED_ACCOUNT_ID && req.headers["x-holded-webhook-account-id"] !== process.env.HOLDED_ACCOUNT_ID) return sendJson(res, 403, { error: "wrong_account" });
      const event = String(req.headers["x-holded-webhook-event"] ?? "");
      const eventId = String(req.headers["x-holded-webhook-id"] ?? "");
      const payload = JSON.parse(raw.toString("utf8")) as { id?: unknown };
      if (!["contact.create", "contact.update", "contact.delete"].includes(event) || !eventId || eventId.length > 200 || typeof payload.id !== "string") return sendJson(res, 400, { error: "invalid_event" });
      return sendJson(res, 202, await createWebhookRepository(database.db).receive(installationId, eventId, event, payload.id));
    } catch { return sendJson(res, 400, { error: "invalid_webhook" }); }
  }
  if (req.method === "GET" && req.url === "/health") {
    return sendJson(res, 200, {
      status: "ok",
      service: "api",
      timestamp: new Date().toISOString()
    });
  }

  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const path = url.pathname.split("/").filter(Boolean);
  const authentication = authenticateService(req.headers, process.env.INTERNAL_SERVICE_TOKEN, installationId ?? "");
  if (authentication.error) return sendJson(res, authentication.status!, { error: authentication.error });
  if (authentication.actor.actorType === "ai" && !allowedAiRequest(req.method ?? "GET", path, req.headers["x-mcp-scopes"])) return sendJson(res, 403, { error: "insufficient_scope" });
  if (!requireContext(res)) return;

  return withAuditActor(authentication.actor, async () => {
  try {
    if (path[0] === "settings" && path[1] === "data-reset" && path.length === 2) {
      if (req.method === "GET") return sendJson(res, 200, { allowed: process.env.ALLOW_DATA_RESET === "true" && authentication.actor.actorType === "user" });
      if (req.method === "POST") {
        const body = await readBody(req);
        if (!dataResetAllowed(process.env, authentication.actor.actorType, body)) return sendJson(res, 403, { error: "data_reset_forbidden" });
        return sendJson(res, 200, await createDataResetRepository(database!.db).reset(installationId!));
      }
    }
    if (path[0] === "clients" && path.length === 1 && req.method === "POST") {
      const parsed = createClientRequestSchema.safeParse(await readBody(req));
      if (!parsed.success) return sendJson(res, 400, { error: "invalid_input", details: parsed.error.issues });
      const holded = await buildHoldedGateway();
      return sendJson(res, 201, await createClientWithHolded({ clients: clients!, holded })({ installationId: installationId!, ...parsed.data }));
    }
    if (path[0] === "holded" && path.length === 2 && path[1] === "settings" && req.method === "GET") {
      return sendJson(res, 200, await buildHoldedSettingsPayload());
    }
    if (path[0] === "holded" && path.length === 2 && path[1] === "status" && req.method === "GET") {
      const { featureEnabled, isConfigured, health } = await buildHoldedSettingsPayload();
      return sendJson(res, 200, { featureEnabled, isConfigured, health });
    }
    if (path[0] === "holded" && path.length === 2 && path[1] === "settings" && req.method === "PATCH") {
      const body = await readBody(req);
      const payload = body && typeof body === "object" ? body as Record<string, unknown> : {};
      return sendJson(res, 200, await updateHoldedSettings(payload));
    }
    if (path[0] === "holded" && path.length === 2 && path[1] === "health" && (req.method === "GET" || req.method === "POST")) {
      return sendJson(res, 200, await runHoldedHealthCheck(true));
    }
    if (path[0] === "clients" && path.length === 1 && req.method === "GET") {
      const parsed = searchClientsRequestSchema.safeParse(Object.fromEntries(url.searchParams));
      if (!parsed.success) return sendJson(res, 400, { error: "invalid_input" });
      const holded = await buildHoldedGateway();
      const result = await searchClientsWithHolded({ clients: clients!, holded })(installationId!, parsed.data.q);
      res.writeHead(200, { "content-type": "application/json", "x-holded-search": result.holded });
      return res.end(JSON.stringify(result.clients));
    }
    if (path[0] === "clients" && path.length === 2 && path[1] === "sync" && req.method === "POST") {
      const startedAt = new Date();
      const result = await syncClientsWithHolded({ clients: clients!, holded: await buildHoldedGateway() })(installationId!);
      await createWebhookRepository(database!.db).completeReconciliation(installationId!, startedAt);
      return sendJson(res, 200, result);
    }
    if (path[0] === "clients" && path.length === 3 && path[2] === "sync" && req.method === "POST") {
      const parsed = revisionGuardSchema.safeParse(await readBody(req));
      if (!parsed.success) return sendJson(res, 400, { error: "invalid_input" });
      return sendJson(res, 200, await syncClientWithHolded({ clients: clients!, holded: await buildHoldedGateway() })({ installationId: installationId!, id: path[1]!, ...parsed.data }));
    }
    if (path[0] === "clients" && path.length === 2 && req.method === "DELETE") {
      const body = await readBody(req) as Record<string, unknown>;
      const parsed = revisionGuardSchema.safeParse(body);
      if (!parsed.success) return sendJson(res, 400, { error: "invalid_input" });
      return sendJson(res, 200, await deleteClientWithHolded({ clients: clients!, holded: await buildHoldedGateway() })({ installationId: installationId!, id: path[1]!, ...parsed.data, deleteFromHolded: body.deleteFromHolded === true }));
    }
    // Solo lectura de Estimates existentes; escribir sigue siendo exclusivo de POST /quotes/:id/holded.
    if (path[0] === "holded" && path[1] === "estimates" && path.length === 2 && req.method === "GET") {
      const parsed = listHoldedEstimatesQuerySchema.safeParse(Object.fromEntries(url.searchParams));
      if (!parsed.success) return sendJson(res, 400, { error: "invalid_input", details: parsed.error.issues });
      return readHoldedEstimates(res, (deps) => listHoldedEstimates(deps)(installationId!, parsed.data));
    }
    if (path[0] === "holded" && path[1] === "estimates" && path[2] === "search" && path.length === 3 && req.method === "GET") {
      const parsed = searchHoldedEstimatesQuerySchema.safeParse(Object.fromEntries(url.searchParams));
      if (!parsed.success) return sendJson(res, 400, { error: "invalid_input", details: parsed.error.issues });
      return readHoldedEstimates(res, (deps) => searchHoldedEstimates(deps)(installationId!, parsed.data));
    }
    if (path[0] === "holded" && path[1] === "estimates" && path.length === 3 && req.method === "GET") {
      const parsed = holdedIdSchema.safeParse(path[2]);
      if (!parsed.success) return sendJson(res, 400, { error: "invalid_input" });
      return readHoldedEstimates(res, (deps) => getHoldedEstimate(deps)(installationId!, parsed.data));
    }
    if (path[0] === "holded" && path[1] === "taxes" && path.length === 2 && req.method === "GET") {
      const config = await readInstallationConfig();
      const key = getConfiguredHoldedApiKey(config);
      if (!key || process.env.FEATURE_HOLDED !== "true") return sendJson(res, 503, { error: "holded_not_configured" });
      return sendJson(res, 200, await newHoldedClient(key).listTaxes());
    }
    if (path[0] === "clients" && path.length === 2 && req.method === "GET") {
      const result = await getClient(clients!)(installationId!, path[1]!);
      return result ? sendJson(res, 200, result) : sendJson(res, 404, { error: "client_not_found" });
    }
    if (path[0] === "clients" && path.length === 2 && req.method === "PATCH") {
      const parsed = updateClientRequestSchema.safeParse(await readBody(req));
      if (!parsed.success) return sendJson(res, 400, { error: "invalid_input", details: parsed.error.issues });
      const holded = await buildHoldedGateway();
      return sendJson(res, 200, await updateClientWithHolded({ clients: clients!, holded })({ installationId: installationId!, id: path[1]!, ...parsed.data }));
    }
    if (path[0] === "catalogs" && path.length === 2 && req.method === "GET") {
      const kinds = ["materials", "employees", "supplements", "travels", "text-templates", "suppliers"] as const;
      if (!kinds.includes(path[1] as typeof kinds[number])) return sendJson(res, 404, { error: "catalog_not_found" });
      return sendJson(res, 200, await getCatalog(catalog!, path[1] as typeof kinds[number])(installationId!, url.searchParams.get("employeeId") ?? undefined));
    }
    if (path[0] === "catalogs" && path.length === 2 && req.method === "POST") {
      const parsed = catalogMutationSchema(path[1]!).safeParse(await readBody(req));
      if (!parsed.success) return sendJson(res, 400, { error: "invalid_input" });
      const data = { ...parsed.data, installationId: installationId! };
      const created = path[1] === "materials" ? await catalog!.createMaterial(data as never) : path[1] === "employees" ? await catalog!.createEmployee(data as never) : path[1] === "supplements" ? await catalog!.createSupplement(data as never) : path[1] === "travels" ? await catalog!.createTravel(data as never) : path[1] === "text-templates" ? await catalog!.createTextTemplate(data as never) : path[1] === "suppliers" ? await catalog!.createSupplier(data as never) : null;
      return created ? sendJson(res, 201, created[0]) : sendJson(res, 404, { error: "catalog_not_found" });
    }
    // Importación masiva: preview (sin escribir) y apply (solo si el plan no cambió).
    if (path[0] === "catalogs" && path[1] === "materials" && path[2] === "import" && path.length === 4 && ["preview", "apply"].includes(path[3]!) && req.method === "POST") {
      const body = await readBody(req);
      const parsed = materialImportRequestSchema.safeParse(body);
      if (!parsed.success) return sendJson(res, 400, { error: "invalid_input", details: parsed.error.issues });
      const importer = catalog! as unknown as MaterialImportRepository;
      if (path[3] === "preview") return sendJson(res, 200, await previewMaterialImport(importer)(installationId!, parsed.data.rows));
      const planHash = body && typeof body === "object" && typeof (body as { planHash?: unknown }).planHash === "string" ? (body as { planHash: string }).planHash : "";
      if (!/^[0-9a-f]{16}$/.test(planHash)) return sendJson(res, 400, { error: "invalid_input" });
      return sendJson(res, 200, await applyMaterialImport(importer)(installationId!, parsed.data.rows, planHash));
    }
    if (path[0] === "catalogs" && path.length === 3 && req.method === "PATCH") {
      const parsed = catalogMutationSchema(path[1]!, true).safeParse(await readBody(req));
      if (!parsed.success) return sendJson(res, 400, { error: "invalid_input" });
      const kind = path[1];
      const id = path[2]!;
      const updated = kind === "materials" ? await catalog!.updateMaterial(id, installationId!, parsed.data as never) : kind === "employees" ? await catalog!.updateEmployee(id, installationId!, parsed.data as never) : kind === "supplements" ? await catalog!.updateSupplement(id, installationId!, parsed.data as never) : kind === "travels" ? await catalog!.updateTravel(id, installationId!, parsed.data as never) : kind === "text-templates" ? await catalog!.updateTextTemplate(id, installationId!, parsed.data as never) : kind === "suppliers" ? await catalog!.updateSupplier(id, installationId!, parsed.data as never) : [];
      return updated[0] ? sendJson(res, 200, updated[0]) : sendJson(res, 404, { error: "catalog_not_found" });
    }
    if (path[0] === "catalogs" && path.length === 4 && path[3] === "archive" && req.method === "POST") {
      const kind = path[1];
      const id = path[2]!;
      const updated = kind === "materials" ? await catalog!.updateMaterial(id, installationId!, { active: false }) : kind === "employees" ? await catalog!.updateEmployee(id, installationId!, { active: false }) : kind === "supplements" ? await catalog!.updateSupplement(id, installationId!, { active: false }) : kind === "travels" ? await catalog!.updateTravel(id, installationId!, { active: false }) : kind === "text-templates" ? await catalog!.updateTextTemplate(id, installationId!, { active: false }) : kind === "suppliers" ? await catalog!.updateSupplier(id, installationId!, { active: false }) : [];
      return updated[0] ? sendJson(res, 200, updated[0]) : sendJson(res, 404, { error: "catalog_not_found" });
    }
    if (path[0] === "quotes" && path.length === 1 && req.method === "POST") {
      const parsed = createQuoteRequestSchema.safeParse(await readBody(req));
      if (!parsed.success) return sendJson(res, 400, { error: "invalid_input", details: parsed.error.issues });
      return sendJson(res, 201, await createQuote(quotes!)({ installationId: installationId!, ...parsed.data }));
    }
    if (path[0] === "quotes" && path.length === 1 && req.method === "GET") {
      const parsed = searchQuotesRequestSchema.safeParse(Object.fromEntries(url.searchParams));
      if (!parsed.success) return sendJson(res, 400, { error: "invalid_input" });
      return sendJson(res, 200, await searchQuotes(quotes!)(installationId!, parsed.data.q, parsed.data.scope));
    }
    if (path[0] === "quotes" && path.length === 2 && req.method === "GET") {
      const result = await getQuote(quotes!)(installationId!, path[1]!);
      return result ? sendJson(res, 200, result) : sendJson(res, 404, { error: "quote_not_found" });
    }
    if (path[0] === "quotes" && path.length === 3 && path[2] === "duplicate" && req.method === "POST") {
      const input = revisionGuardSchema.safeParse(await readBody(req));
      if (!input.success) return sendJson(res, 400, { error: "invalid_input" });
      const source = await getQuote(quotes!)(installationId!, path[1]!);
      if (!source) return sendJson(res, 404, { error: "quote_not_found" });
      if (source.revision !== input.data.expectedRevision) return sendJson(res, 409, { error: "revision_conflict" });
      return sendJson(res, 201, await duplicateQuote(quotes!)(installationId!, path[1]!));
    }
    if (path[0] === "quotes" && path.length === 3 && path[2] === "review" && req.method === "GET") {
      const review = await getQuoteReview(quotes!)(installationId!, path[1]!);
      return review ? sendJson(res, 200, review) : sendJson(res, 404, { error: "quote_not_found" });
    }
    if (path[0] === "quotes" && path.length === 4 && path[2] === "adjustments" && path[3] === "preview" && req.method === "POST") {
      const parsed = previewPriceAdjustmentRequestSchema.safeParse(await readBody(req));
      if (!parsed.success) return sendJson(res, 400, { error: "invalid_input", details: parsed.error.issues });
      return sendJson(res, 200, await previewPriceAdjustment(quotes!)(installationId!, path[1]!, parsed.data));
    }
    if (path[0] === "quotes" && path.length === 3 && path[2] === "preview-line" && req.method === "POST") {
      const parsed = quoteCommandSchema.safeParse(await readBody(req));
      if (!parsed.success || (parsed.data.type !== "createQuoteLine" && parsed.data.type !== "updateQuoteLineDetails")) return sendJson(res, 400, { error: "invalid_input" });
      return sendJson(res, 200, await previewQuoteLine(quotes!)(installationId!, path[1]!, parsed.data));
    }
    if (path[0] === "quotes" && path.length === 3 && ["recalculate", "client"].includes(path[2]!) && (req.method === "POST" || req.method === "PATCH")) {
      const body = await readBody(req);
      const parsed = quoteCommandSchema.safeParse({ ...(body as object), type: path[2] === "client" ? "selectClient" : "recalculateQuote" });
      if (!parsed.success) return sendJson(res, 400, { error: "invalid_input" });
      if (parsed.data.type === "selectClient") {
        return sendJson(res, 200, await updateQuote(quotes!)({ installationId: installationId!, id: path[1]!, clientId: parsed.data.clientId, expectedRevision: parsed.data.expectedRevision }));
      }
      return sendJson(res, 200, await executeQuoteCommand(quoteWorkflow!, { ...parsed.data, installationId: installationId!, quoteId: path[1]! }));
    }
    if (path[0] === "quotes" && path.length === 3 && path[2] === "commands" && req.method === "POST") {
      const parsed = quoteCommandSchema.safeParse(await readBody(req));
      if (!parsed.success) return sendJson(res, 400, { error: "invalid_input", details: parsed.error.issues });
      const command = parsed.data;
      const context = { ...command, installationId: installationId!, quoteId: path[1]! };
      if (command.type === "selectClient") return sendJson(res, 200, await updateQuote(quotes!)({ installationId: installationId!, id: path[1]!, clientId: command.clientId, expectedRevision: command.expectedRevision }));
      if (command.type === "addMaterialLine") return sendJson(res, 200, await addMaterialLine(quoteWorkflow!)(context as unknown as Record<string, unknown>));
      if (command.type === "addLaborLine") return sendJson(res, 200, await addLaborLine(quoteWorkflow!)(context as unknown as Record<string, unknown>));
      if (command.type === "addTravelLine") return sendJson(res, 200, await addTravelLine(quoteWorkflow!)(context as unknown as Record<string, unknown>));
      if (command.type === "addOtherLine") return sendJson(res, 200, await addOtherLine(quoteWorkflow!)(context as unknown as Record<string, unknown>));
      if (command.type === "addSupplierDiscount") return sendJson(res, 200, await addSupplierDiscount(quoteWorkflow!)(context as never));
      if (command.type === "addLaborEntry") {
        const { type: _type, quoteLineId, expectedRevision, employeeNameSnapshot, hours, costRateSnapshot, saleRateSnapshot, supplementPerHourSnapshot } = command;
        return sendJson(res, 200, await addLaborEntry(quoteWorkflow!)({ installationId: installationId!, quoteId: path[1]!, quoteLineId, expectedRevision, entry: { employeeNameSnapshot, hours, costRateSnapshot, saleRateSnapshot, supplementPerHourSnapshot } }));
      }
      if (command.type === "addPriceAdjustment") {
        const { type: _type, expectedRevision, scope, mode, value, targetLineIds } = command;
        return sendJson(res, 200, await addPriceAdjustment(quoteWorkflow!)({ installationId: installationId!, quoteId: path[1]!, expectedRevision, adjustment: { scope, mode, value, targetLineIds } }));
      }
      if (command.type === "addQuoteText") return sendJson(res, 200, await addQuoteText(quoteWorkflow!)(context as never));
      if (command.type === "changeQuoteStatus") return sendJson(res, 200, await updateQuote(quotes!)({ installationId: installationId!, id: path[1]!, expectedRevision: command.expectedRevision, status: command.status }));
      if (command.type === "archiveQuote") return sendJson(res, 200, await archiveQuote(quotes!)({ installationId: installationId!, id: path[1]!, expectedRevision: command.expectedRevision, status: "archived" }));
      const lifecycle = { installationId: installationId!, id: path[1]!, expectedRevision: command.expectedRevision };
      if (command.type === "changeQuoteReference") return sendJson(res, 200, await changeQuoteReference(quotes!)({ ...lifecycle, reference: command.reference }));
      if (command.type === "trashQuote") return sendJson(res, 200, await trashQuote(quotes!)(lifecycle));
      if (command.type === "restoreQuote") return sendJson(res, 200, await restoreQuote(quotes!)(lifecycle));
      if (command.type === "deleteQuotePermanently") return sendJson(res, 200, await deleteQuotePermanently(quotes!)(lifecycle));
      return sendJson(res, 200, await executeQuoteCommand(quoteWorkflow!, context as unknown as Record<string, unknown>));
    }
    if (path[0] === "quotes" && path.length === 3 && path[2] === "holded" && req.method === "POST") {
      const parsed = revisionGuardSchema.safeParse(await readBody(req));
      if (!parsed.success) return sendJson(res, 400, { error: "invalid_input", details: parsed.error.issues });
      const config = await readInstallationConfig();
      const resolvedKey = getConfiguredHoldedApiKey(config);
      if (process.env.FEATURE_HOLDED !== "true" || !resolvedKey) return sendJson(res, 503, { error: "holded_not_configured" });
      const quote = await getQuote(quotes!)(installationId!, path[1]!);
      if (!quote) return sendJson(res, 404, { error: "quote_not_found" });
      if (quote.revision !== parsed.data.expectedRevision) return sendJson(res, 409, { error: "revision_conflict" });
      if (quote.accessMode === "read_only" || quote.status === "archived" || Boolean(quote.deletedAt)) return sendJson(res, 422, { error: "quote_read_only" });
      if (quote.clientId) {
        const client = await clients!.getById(installationId!, quote.clientId);
        if (client && !client.holdedContactId) await syncClientWithHolded({ clients: clients!, holded: await buildHoldedGateway() })({ installationId: installationId!, id: client.id, expectedRevision: client.revision });
      }
      return sendJson(res, 200, await syncQuoteToHolded({ quotes: quotes!, clients: clients!, exports: createQuoteExportRepository(database!.db), holded: createHoldedEstimateGateway(newHoldedClient(resolvedKey)), taxMapping: (getHoldedSettingsConfig(config).taxMapping ?? {}) as Record<string, string>, logExport: (event) => console[event.status === "synced" ? "log" : "warn"](JSON.stringify({ msg: "holded_estimate_sync", ...event })) })({ installationId: installationId!, quoteId: quote.id, expectedRevision: parsed.data.expectedRevision }));
    }
    if (path[0] === "quotes" && path.length === 2 && req.method === "PATCH") {
      const parsed = revisionGuardSchema.safeParse(await readBody(req));
      if (!parsed.success) return sendJson(res, 400, { error: "invalid_input" });
      return sendJson(res, 200, await archiveQuote(quotes!)({ installationId: installationId!, id: path[1]!, ...parsed.data }));
    }
    return sendJson(res, 404, { error: "not_found" });
  } catch (error) {
    return mapError(res, error);
  }
  });
});

server.listen(port, host, () => {
  console.log(`[api] listening on ${host}:${port}`);
});

function stop() {
  server.close(() => process.exit(0));
}

process.on("SIGTERM", stop);
process.on("SIGINT", stop);

