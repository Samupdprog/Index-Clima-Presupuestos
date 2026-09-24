import { createHash, createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { eq } from "drizzle-orm";
import {
  archiveQuote,
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
  createClient,
  createQuote,
  duplicateQuote,
  getClient,
  getQuote,
  searchClients,
  searchQuotes,
  updateClient,
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
  catalogUpdateSchema,
  materialImportRequestSchema,
} from "@quotes/contracts";
import {
  createClientRepository,
  createDb,
  createQuoteRepository,
  createQuoteWorkflowRepository,
  createCatalogRepository,
  installations,
  QuoteNotFoundError,
  ReadOnlyQuoteError,
  RevisionConflictError,
} from "@quotes/db";
import { createHoldedClient, HoldedApiError, maskApiKey, type HoldedHealthResult } from "@quotes/holded";

const host = process.env.HOST ?? "0.0.0.0";
const port = Number(process.env.PORT ?? "4000");
const installationId = process.env.INSTALLATION_ID;
const databaseUrl = process.env.DATABASE_URL;
const database = databaseUrl ? createDb(databaseUrl) : null;
const clients = database ? createClientRepository(database.db) : null;
const quotes = database ? createQuoteRepository(database.db) : null;
const quoteWorkflow = database ? createQuoteWorkflowRepository(database.db) as unknown as QuoteWorkflowRepository : null;
const catalog = database ? createCatalogRepository(database.db) : null;
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
  const material = process.env.HOLDED_ENCRYPTION_KEY ?? process.env.INTERNAL_SERVICE_TOKEN ?? process.env.DATABASE_URL ?? process.env.INSTALLATION_ID ?? "index-clima-local-dev";
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
  if (!database || !installationId) return {};
  const [row] = await database.db.select({ config: installations.config }).from(installations).where(eq(installations.id, installationId)).limit(1);
  return (row?.config as Record<string, unknown>) ?? {};
}

async function writeInstallationConfig(nextConfig: Record<string, unknown>) {
  if (!database || !installationId) return;
  await database.db.update(installations).set({ config: nextConfig, updatedAt: new Date() }).where(eq(installations.id, installationId));
}

async function getHoldedSettingsFromDatabase() {
  const config = await readInstallationConfig();
  const holded = getHoldedSettingsConfig(config);
  return { config, holded };
}

function getConfiguredHoldedApiKey(config: Record<string, unknown>) {
  const holded = getHoldedSettingsConfig(config);
  const encrypted = typeof holded.apiKeyEncrypted === "string" ? holded.apiKeyEncrypted : undefined;
  if (encrypted) {
    try { return decryptHoldedSecret(encrypted); } catch { return undefined; }
  }
  return typeof process.env.HOLDED_API_KEY === "string" && process.env.HOLDED_API_KEY.trim() ? process.env.HOLDED_API_KEY.trim() : undefined;
}

async function persistHoldedHealth(result: HoldedHealthResult) {
  if (!database || !installationId) return result;
  const config = await readInstallationConfig();
  const holded = getHoldedSettingsConfig(config);
  const nextConfig = { ...config, holded: { ...holded, health: result, checkIntervalMinutes: normalizeCheckIntervalMinutes(holded.checkIntervalMinutes ?? process.env.HOLDED_HEALTH_CHECK_INTERVAL_MINUTES ?? DEFAULT_HOLD_HEALTH_INTERVAL_MINUTES) } };
  await writeInstallationConfig(nextConfig);
  return result;
}

async function runHoldedHealthCheck(force = false): Promise<HoldedHealthResult> {
  if (!database || !installationId) {
    return { status: "unknown", code: "not_configured", message: "Holded no está configurado en este servicio.", lastCheckedAt: null };
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

    const result = await createHoldedClient(resolvedKey).checkHealth();
    await persistHoldedHealth(result);
    return result;
  })();

  try {
    return await holdedHealthCheckPromise;
  } finally {
    holdedHealthCheckPromise = null;
  }
}

async function buildHoldedSettingsPayload() {
  const config = await readInstallationConfig();
  const holded = getHoldedSettingsConfig(config);
  const featureEnabled = process.env.FEATURE_HOLDED === "true";
  const resolvedKey = getConfiguredHoldedApiKey(config);
  const intervalMinutes = normalizeCheckIntervalMinutes(holded.checkIntervalMinutes ?? process.env.HOLDED_HEALTH_CHECK_INTERVAL_MINUTES ?? DEFAULT_HOLD_HEALTH_INTERVAL_MINUTES);
  const health = await runHoldedHealthCheck(false);

  return {
    featureEnabled,
    isConfigured: featureEnabled && Boolean(resolvedKey),
    keyMasked: resolvedKey ? maskApiKey(resolvedKey) : null,
    checkIntervalMinutes: intervalMinutes,
    health,
  };
}

async function updateHoldedSettings(payload: Record<string, unknown>) {
  if (!database || !installationId) return buildHoldedSettingsPayload();
  const currentConfig = await readInstallationConfig();
  const holded = getHoldedSettingsConfig(currentConfig);
  const nextHolded = { ...holded };

  const incomingKey = payload.apiKey;
  if (typeof incomingKey === "string") {
    const trimmed = incomingKey.trim();
    if (trimmed.length > 0) nextHolded.apiKeyEncrypted = encryptHoldedSecret(trimmed);
    else delete nextHolded.apiKeyEncrypted;
  }

  if (payload.checkIntervalMinutes !== undefined) {
    nextHolded.checkIntervalMinutes = normalizeCheckIntervalMinutes(payload.checkIntervalMinutes);
  }

  const nextConfig = { ...currentConfig, holded: nextHolded };
  await writeInstallationConfig(nextConfig);

  return buildHoldedSettingsPayload();
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk: Buffer) => { data += chunk.toString(); });
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
  if (error instanceof RevisionConflictError) return sendJson(res, 409, { error: "revision_conflict" });
  if (error instanceof QuoteNotFoundError) return sendJson(res, 404, { error: "quote_not_found" });
  if (error instanceof ReadOnlyQuoteError) return sendJson(res, 422, { error: "quote_read_only" });
  if (error instanceof Error && error.message === "invalid_json") return sendJson(res, 400, { error: "invalid_json" });
  if (error instanceof HoldedApiError) return sendJson(res, 502, { error: "holded_sync_failed", details: { status: error.status } });
  if (error && typeof error === "object" && "code" in error && error.code === "23505") return sendJson(res, 409, { error: "conflict" });
  console.error(error);
  return sendJson(res, 500, { error: "internal_error" });
}

const server = createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    return sendJson(res, 200, {
      status: "ok",
      service: "api",
      timestamp: new Date().toISOString()
    });
  }

  if (!requireContext(res)) return;
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const path = url.pathname.split("/").filter(Boolean);

  try {
    if (path[0] === "clients" && path.length === 1 && req.method === "POST") {
      const parsed = createClientRequestSchema.safeParse(await readBody(req));
      if (!parsed.success) return sendJson(res, 400, { error: "invalid_input", details: parsed.error.issues });
      return sendJson(res, 201, await createClient(clients!)({ installationId: installationId!, ...parsed.data }));
    }
    if (path[0] === "holded" && path.length === 2 && path[1] === "settings" && req.method === "GET") {
      return sendJson(res, 200, await buildHoldedSettingsPayload());
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
      return sendJson(res, 200, await searchClients(clients!)(installationId!, parsed.data.q));
    }
    if (path[0] === "clients" && path.length === 2 && req.method === "GET") {
      const result = await getClient(clients!)(installationId!, path[1]!);
      return result ? sendJson(res, 200, result) : sendJson(res, 404, { error: "client_not_found" });
    }
    if (path[0] === "clients" && path.length === 2 && req.method === "PATCH") {
      const parsed = updateClientRequestSchema.safeParse(await readBody(req));
      if (!parsed.success) return sendJson(res, 400, { error: "invalid_input", details: parsed.error.issues });
      return sendJson(res, 200, await updateClient(clients!)({ installationId: installationId!, id: path[1]!, ...parsed.data }));
    }
    if (path[0] === "catalogs" && path.length === 2 && req.method === "GET") {
      const kinds = ["materials", "employees", "supplements", "travels", "text-templates", "suppliers"] as const;
      if (!kinds.includes(path[1] as typeof kinds[number])) return sendJson(res, 404, { error: "catalog_not_found" });
      return sendJson(res, 200, await getCatalog(catalog!, path[1] as typeof kinds[number])(installationId!, url.searchParams.get("employeeId") ?? undefined));
    }
    if (path[0] === "catalogs" && path.length === 2 && req.method === "POST") {
      const parsed = catalogMutationSchema.safeParse(await readBody(req));
      if (!parsed.success) return sendJson(res, 400, { error: "invalid_input" });
      const data = { ...parsed.data, installationId: installationId! };
      const created = path[1] === "materials" ? await catalog!.createMaterial(data as never) : path[1] === "employees" ? await catalog!.createEmployee(data as never) : path[1] === "supplements" ? await catalog!.createSupplement(data as never) : path[1] === "travels" ? await catalog!.createTravel(data as never) : path[1] === "text-templates" ? await catalog!.createTextTemplate(data as never) : path[1] === "suppliers" ? await catalog!.createSupplier(data as never) : null;
      return created ? sendJson(res, 201, created[0]) : sendJson(res, 404, { error: "catalog_not_found" });
    }
    if (path[0] === "catalogs" && path[1] === "materials" && path[2] === "import" && path.length === 3 && req.method === "POST") {
      const parsed = materialImportRequestSchema.safeParse(await readBody(req));
      if (!parsed.success) return sendJson(res, 400, { error: "invalid_input", details: parsed.error.issues });
      const rows = parsed.data.rows.map((row) => ({
        ...row,
        supplierUnitPrice: normalizeDecimal(row.supplierUnitPrice),
        saleUnitPrice: normalizeDecimal(row.saleUnitPrice),
        igicRate: normalizeDecimal(row.igicRate) ?? "7",
      }));
      return sendJson(res, 201, await catalog!.importMaterials(installationId!, rows));
    }
    if (path[0] === "catalogs" && path.length === 3 && req.method === "PATCH") {
      const parsed = catalogUpdateSchema.safeParse(await readBody(req));
      if (!parsed.success) return sendJson(res, 400, { error: "invalid_input" });
      const kind = path[1];
      const id = path[2]!;
      const updated = kind === "materials" ? await catalog!.updateMaterial(id, installationId!, parsed.data as never) : kind === "employees" ? await catalog!.updateEmployee(id, installationId!, parsed.data as never) : kind === "supplements" ? await catalog!.updateSupplement(id, parsed.data as never) : kind === "travels" ? await catalog!.updateTravel(id, installationId!, parsed.data as never) : kind === "text-templates" ? await catalog!.updateTextTemplate(id, installationId!, parsed.data as never) : kind === "suppliers" ? await catalog!.updateSupplier(id, installationId!, parsed.data as never) : [];
      return updated[0] ? sendJson(res, 200, updated[0]) : sendJson(res, 404, { error: "catalog_not_found" });
    }
    if (path[0] === "catalogs" && path.length === 4 && path[3] === "archive" && req.method === "POST") {
      const kind = path[1];
      const id = path[2]!;
      const updated = kind === "materials" ? await catalog!.updateMaterial(id, installationId!, { active: false }) : kind === "employees" ? await catalog!.updateEmployee(id, installationId!, { active: false }) : kind === "supplements" ? await catalog!.updateSupplement(id, { active: false }) : kind === "travels" ? await catalog!.updateTravel(id, installationId!, { active: false }) : kind === "text-templates" ? await catalog!.updateTextTemplate(id, installationId!, { active: false }) : kind === "suppliers" ? await catalog!.updateSupplier(id, installationId!, { active: false }) : [];
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
      return sendJson(res, 200, await searchQuotes(quotes!)(installationId!, parsed.data.q));
    }
    if (path[0] === "quotes" && path.length === 2 && req.method === "GET") {
      const result = await getQuote(quotes!)(installationId!, path[1]!);
      return result ? sendJson(res, 200, result) : sendJson(res, 404, { error: "quote_not_found" });
    }
    if (path[0] === "quotes" && path.length === 3 && path[2] === "duplicate" && req.method === "POST") {
      return sendJson(res, 201, await duplicateQuote(quotes!)(installationId!, path[1]!));
    }
    if (path[0] === "quotes" && path.length === 3 && path[2] === "commands" && req.method === "POST") {
      const parsed = quoteCommandSchema.safeParse(await readBody(req));
      if (!parsed.success) return sendJson(res, 400, { error: "invalid_input", details: parsed.error.issues });
      const command = parsed.data;
      const context = { ...command, installationId: installationId!, quoteId: path[1]! };
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
      if (quote.accessMode === "read_only" || quote.status === "archived") return sendJson(res, 422, { error: "quote_read_only" });
      const holdedInput = buildHoldedEstimate(quote);
      if (!holdedInput) return sendJson(res, 422, { error: "quote_not_calculated" });
      const result = await createHoldedClient(resolvedKey).saveEstimate(holdedInput);
      await updateQuote(quotes!)({ installationId: installationId!, id: quote.id, expectedRevision: quote.revision, status: "finalized", holdedEstimateId: result.id });
      return sendJson(res, 200, await getQuote(quotes!)(installationId!, quote.id));
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

server.listen(port, host, () => {
  console.log(`[api] listening on ${host}:${port}`);
});

function stop() {
  server.close(() => process.exit(0));
}

process.on("SIGTERM", stop);
process.on("SIGINT", stop);

function normalizeDecimal(value: string | undefined) {
  return value?.trim() ? value.trim().replace(",", ".") : undefined;
}

type HoldedQuote = NonNullable<Awaited<ReturnType<ReturnType<typeof getQuote>>>>;

function buildHoldedEstimate(quote: HoldedQuote) {
  const calculation = quote.calculation as { lines?: Array<{ quoteLineId?: string; sale?: string }> } | null | undefined;
  if (!calculation?.lines) return null;
  const sales = new Map(calculation.lines.map((line) => [line.quoteLineId, line.sale]));
  const lines = quote.lines as Array<{ id: string; type: string; description: string; igicRate: string }>;
  const items = lines.filter((line) => !["title", "adjustment"].includes(line.type)).map((line) => ({
    name: line.description.slice(0, 250),
    units: 1,
    price: Number(sales.get(line.id) ?? "0"),
    tax: Number(line.igicRate),
  }));
  if (!items.length || items.some((item) => !Number.isFinite(item.price) || !Number.isFinite(item.tax))) return null;
  const client = (quote.clientSnapshot ?? {}) as Record<string, unknown>;
  return {
    ...(quote.holdedEstimateId ? { documentId: quote.holdedEstimateId } : {}),
    reference: quote.reference,
    title: quote.title,
    date: Math.floor(Date.now() / 1000),
    contactName: typeof client.name === "string" && client.name.trim() ? client.name : "Cliente",
    ...(typeof client.email === "string" && client.email.trim() ? { contactEmail: client.email } : {}),
    ...(typeof client.address === "string" && client.address.trim() ? { contactAddress: client.address } : {}),
    notes: `Presupuesto ${quote.reference} generado desde Index Clima`,
    items,
  };
}
