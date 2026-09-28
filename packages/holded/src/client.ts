import {
  type HoldedContact,
  type HoldedEstimate,
  type HoldedEstimateInput,
  type HoldedTax,
  type HoldedContactListResponse,
  type HoldedContactMutationResult,
  type HoldedCreateContactInput,
  type HoldedHealthCode,
  type HoldedHealthResult,
  type HoldedUpdateContactInput,
} from "./contracts.js";
import { HoldedApiError, mapStatusToErrorCode } from "./errors.js";

type Fetch = typeof fetch;

const DEFAULT_BASE_URL = "https://api.holded.com/api/v2";
const DEFAULT_TIMEOUT_MS = 10_000;

export interface HoldedLogEvent {
  method: string;
  /** Ruta lógica sin query (nunca incluye la API key ni cabeceras). */
  path: string;
  status: number | null;
  code?: string;
  ok: boolean;
  durationMs: number;
}

export interface HoldedClientOptions {
  apiKey: string;
  /** Permite apuntar a otro entorno o sandbox sin tocar el resto del código. */
  baseUrl?: string;
  fetch?: Fetch;
  timeoutMs?: number;
  /** Hook de observabilidad. Recibe metadatos seguros, jamás secretos. */
  logger?: (event: HoldedLogEvent) => void;
}

const INVALID_JSON = Symbol("invalid_json");

function parseJson(raw: string): unknown | typeof INVALID_JSON {
  try {
    return JSON.parse(raw);
  } catch {
    return INVALID_JSON;
  }
}

function extractId(body: unknown): string | null {
  if (typeof body === "string" && body.trim()) return body.trim();
  if (!body || typeof body !== "object") return null;
  const value = body as Record<string, unknown>;
  for (const key of ["id", "_id", "contactId"]) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate) return candidate;
  }
  return null;
}

/**
 * Normaliza la respuesta de listados de Holded v2. El contrato canónico es
 * `{ items, cursor, has_more }`; se toleran, por compatibilidad defensiva, un
 * array directo o `{ data }`.
 */
function normalizeContactList(body: HoldedContactListResponse | unknown): HoldedContact[] {
  if (Array.isArray(body)) return body as HoldedContact[];
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    if (Array.isArray(record.items)) return record.items as HoldedContact[];
    if (Array.isArray(record.data)) return record.data as HoldedContact[];
  }
  throw new HoldedApiError("invalid_response");
}

export function createHoldedClient(options: HoldedClientOptions) {
  const apiKey = options.apiKey;
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const fetcher = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const logger = options.logger;

  function log(event: HoldedLogEvent) {
    if (logger) {
      try { logger(event); } catch { /* la observabilidad nunca rompe la operación */ }
    }
  }

  /**
   * Única capa HTTP hacia Holded. Centraliza auth Bearer, cabeceras, timeout,
   * parseo JSON y traducción de errores. Nunca registra la API key.
   */
  async function request<T>(
    method: string,
    path: string,
    body?: unknown,

  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const hasBody = body !== undefined;
    const startedAt = Date.now();
    const pathForLog = path.split("?")[0] ?? path; // sin query (nunca secretos)
    let response: Response;
    try {
      response = await fetcher(`${baseUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${apiKey}`,
          accept: "application/json",
          ...(hasBody ? { "content-type": "application/json" } : {}),
        },
        ...(hasBody ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal,
      });
    } catch (error) {
      const code = error instanceof Error && error.name === "AbortError" ? "timeout" : "network_error";
      log({ method, path: pathForLog, status: null, code, ok: false, durationMs: Date.now() - startedAt });
      throw new HoldedApiError(code);
    } finally {
      clearTimeout(timer);
    }

    const raw = await response.text().catch(() => "");
    const parsed = raw ? parseJson(raw) : null;

    if (!response.ok) {
      const code = mapStatusToErrorCode(response.status);
      log({ method, path: pathForLog, status: response.status, code, ok: false, durationMs: Date.now() - startedAt });
      const errorBody = parsed === INVALID_JSON ? undefined : parsed;
      const retryAfter = response.headers.get("retry-after");
      throw new HoldedApiError(code, response.status, errorBody, retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) : null);
    }
    if (parsed === INVALID_JSON) {
      log({ method, path: pathForLog, status: response.status, code: "invalid_response", ok: false, durationMs: Date.now() - startedAt });
      throw new HoldedApiError("invalid_response", response.status);
    }
    log({ method, path: pathForLog, status: response.status, ok: true, durationMs: Date.now() - startedAt });
    return (parsed ?? null) as T;
  }

  const client = {
    // v2 pagina por cursor (`cursor` + `has_more`), no por número de página.
    async listContacts(params: { cursor?: string } = {}): Promise<HoldedContact[]> {
      const search = new URLSearchParams();
      if (params.cursor) search.set("cursor", params.cursor);
      const suffix = search.toString() ? `?${search.toString()}` : "";
      return normalizeContactList(await request<HoldedContactListResponse>("GET", `/contacts${suffix}`));
    },

    /** Página cruda con cursor, por si se necesita paginar en el futuro. */
    async listContactsPage(params: { cursor?: string; limit?: number } = {}): Promise<HoldedContactListResponse> {
      const search = new URLSearchParams();
      if (params.cursor) search.set("cursor", params.cursor);
      if (params.limit) search.set("limit", String(Math.min(100, Math.max(1, params.limit))));
      const suffix = search.toString() ? `?${search.toString()}` : "";
      const body = await request<HoldedContactListResponse>("GET", `/contacts${suffix}`);
      return {
        items: normalizeContactList(body),
        cursor: (body as HoldedContactListResponse)?.cursor ?? null,
        has_more: Boolean((body as HoldedContactListResponse)?.has_more),
      };
    },

    async searchContacts(query: string): Promise<HoldedContact[]> {
      const trimmed = query.trim();
      if (!trimmed) return [];
      const search = new URLSearchParams({ name: trimmed });
      return normalizeContactList(
        await request<HoldedContactListResponse>("GET", `/contacts/search?${search.toString()}`),
      );
    },

    async getContact(contactId: string): Promise<HoldedContact> {
      const contact = await request<HoldedContact>("GET", `/contacts/${encodeURIComponent(contactId)}`);
      if (!contact || typeof contact !== "object" || !extractId({ id: contact.id })) throw new HoldedApiError("invalid_response");
      return contact;
    },

    async createContact(input: HoldedCreateContactInput): Promise<HoldedContactMutationResult> {
      const raw = await request<unknown>("POST", "/contacts", input);
      const id = extractId(raw);
      if (!id) throw new HoldedApiError("invalid_response");
      return { id, raw };
    },

    /** PUT reemplazo completo: `body` debe ser el contacto ya fusionado. */
    async updateContact(contactId: string, body: HoldedUpdateContactInput): Promise<HoldedContactMutationResult> {
      const raw = await request<unknown>("PUT", `/contacts/${encodeURIComponent(contactId)}`, body);
      const id = extractId(raw) ?? contactId;
      return { id, raw };
    },

    async deleteContact(contactId: string): Promise<void> {
      await request("DELETE", `/contacts/${encodeURIComponent(contactId)}`);
    },

    async listTaxes(): Promise<HoldedTax[]> {
      const body = await request<{ items: HoldedTax[] }>("GET", "/taxes");
      if (!body || !Array.isArray(body.items)) throw new HoldedApiError("invalid_response");
      return body.items;
    },

    async listEstimatesPage(params: { cursor?: string; contactId?: string } = {}) {
      const search = new URLSearchParams({ limit: "100" });
      if (params.cursor) search.set("cursor", params.cursor);
      if (params.contactId) search.set("contact_id", params.contactId);
      const body = await request<{ items: HoldedEstimate[]; cursor: string | null; has_more: boolean }>("GET", `/estimates?${search}`);
      if (!body || !Array.isArray(body.items)) throw new HoldedApiError("invalid_response");
      return body;
    },

    async getEstimate(id: string): Promise<HoldedEstimate> {
      const body = await request<HoldedEstimate>("GET", `/estimates/${encodeURIComponent(id)}`);
      if (!body || typeof body.id !== "string") throw new HoldedApiError("invalid_response");
      return body;
    },

    async approveEstimate(id: string): Promise<void> {
      await request("POST", `/estimates/${encodeURIComponent(id)}/approve`);
    },

    async getEstimatePdf(id: string): Promise<Uint8Array> {
      const path = `/estimates/${encodeURIComponent(id)}/pdf`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const startedAt = Date.now();
      try {
        const response = await fetcher(`${baseUrl}${path}`, { headers: { authorization: `Bearer ${apiKey}`, accept: "application/pdf" }, signal: controller.signal });
        if (!response.ok) {
          log({ method: "GET", path, status: response.status, code: mapStatusToErrorCode(response.status), ok: false, durationMs: Date.now() - startedAt });
          throw new HoldedApiError(mapStatusToErrorCode(response.status), response.status);
        }
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (!response.headers.get("content-type")?.includes("application/pdf") || bytes.length < 5 || new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") throw new HoldedApiError("invalid_response", response.status);
        log({ method: "GET", path, status: response.status, ok: true, durationMs: Date.now() - startedAt });
        return bytes;
      } catch (error) {
        if (error instanceof HoldedApiError) throw error;
        throw new HoldedApiError(error instanceof Error && error.name === "AbortError" ? "timeout" : "network_error");
      } finally { clearTimeout(timer); }
    },

    async saveEstimate(input: HoldedEstimateInput, documentId?: string | null) {
      // Conversion to JSON numbers is only transport encoding; no monetary arithmetic here.
      const encodeDecimal = (value: string) => {
        if (!/^-?\d+(?:\.\d+)?$/.test(value) || !Number.isFinite(Number(value))) throw new HoldedApiError("unprocessable");
        return Number(value);
      };
      const items = input.items.map((item) => item.type === "title" ? item : ({ ...item, units: encodeDecimal(item.units), price: encodeDecimal(item.price), discount: encodeDecimal(item.discount) }));
      let existing: Record<string, unknown> = {};
      if (documentId) {
        existing = { ...await client.getEstimate(documentId) };
        for (const key of ["id", "lines", "subtotal", "tax", "total", "created_at", "updated_at"]) delete existing[key];
      }
      const payload = { ...existing, ...input, discount: encodeDecimal(input.discount), items };
      const raw = await request<unknown>(documentId ? "PUT" : "POST", documentId ? `/estimates/${encodeURIComponent(documentId)}` : "/estimates", payload);
      const id = documentId ?? extractId(raw);
      if (!id) throw new HoldedApiError("invalid_response");
      return { id, response: raw };
    },

    async deleteEstimate(id: string): Promise<void> {
      await request("DELETE", `/estimates/${encodeURIComponent(id)}`);
    },

    async checkHealth(): Promise<HoldedHealthResult> {
      const checkedAt = new Date().toISOString();
      try {
        // Operación representativa: leer contactos v2 (lo que realmente usamos).
        await request<HoldedContactListResponse>("GET", "/contacts");
        return { status: "healthy", code: "ok", message: "Holded responde correctamente.", lastCheckedAt: checkedAt };
      } catch (error) {
        if (error instanceof HoldedApiError) {
          const map: Partial<Record<string, HoldedHealthCode>> = {
            unauthorized: "invalid_api_key",
            forbidden: "insufficient_permissions",
            rate_limited: "rate_limit",
            network_error: "network_error",
            timeout: "network_error",
          };
          const code = map[error.code] ?? "unexpected_error";
          const messages: Record<HoldedHealthCode, string> = {
            ok: "Holded responde correctamente.",
            invalid_api_key: "La clave de Holded no es válida.",
            insufficient_permissions: "La API key no tiene permisos suficientes para consultar contactos.",
            rate_limit: "Holded está limitando las peticiones.",
            network_error: "No se pudo contactar con Holded.",
            unexpected_error: "Holded respondió con un error inesperado.",
            not_configured: "Holded no está configurado.",
            unknown: "Estado de Holded desconocido.",
          };
          return { status: "unhealthy", code, message: messages[code], lastCheckedAt: checkedAt };
        }
        return {
          status: "unhealthy",
          code: "unexpected_error",
          message: "Holded respondió con un error inesperado.",
          lastCheckedAt: checkedAt,
        };
      }
    },

  };

  return client;
}

export type HoldedClient = ReturnType<typeof createHoldedClient>;
