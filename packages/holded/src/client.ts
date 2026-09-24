import {
  type HoldedContact,
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
/** Base legacy v1, sólo para la exportación de presupuestos aún no migrada. */
const LEGACY_INVOICING_V1_BASE_URL = "https://api.holded.com/api/invoicing/v1";
const DEFAULT_TIMEOUT_MS = 10_000;

export interface HoldedClientOptions {
  apiKey: string;
  /** Permite apuntar a otro entorno o sandbox sin tocar el resto del código. */
  baseUrl?: string;
  fetch?: Fetch;
  timeoutMs?: number;
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

function normalizeContactList(body: HoldedContactListResponse | unknown): HoldedContact[] {
  if (Array.isArray(body)) return body as HoldedContact[];
  if (body && typeof body === "object") {
    const data = (body as { data?: unknown }).data;
    if (Array.isArray(data)) return data as HoldedContact[];
  }
  return [];
}

export function createHoldedClient(options: HoldedClientOptions) {
  const apiKey = options.apiKey;
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const fetcher = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  /**
   * Única capa HTTP hacia Holded. Centraliza auth Bearer, cabeceras, timeout,
   * parseo JSON y traducción de errores. Nunca registra la API key.
   */
  async function request<T>(
    method: string,
    path: string,
    body?: unknown,
    opts?: { baseUrl?: string; legacyKeyAuth?: boolean },
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const hasBody = body !== undefined;
    let response: Response;
    try {
      response = await fetcher(`${opts?.baseUrl ?? baseUrl}${path}`, {
        method,
        headers: {
          // v2 usa Bearer; sólo la exportación legacy v1 usa la cabecera `key:`.
          ...(opts?.legacyKeyAuth ? { key: apiKey } : { authorization: `Bearer ${apiKey}` }),
          accept: "application/json",
          ...(hasBody ? { "content-type": "application/json" } : {}),
        },
        ...(hasBody ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new HoldedApiError("timeout");
      }
      throw new HoldedApiError("network_error");
    } finally {
      clearTimeout(timer);
    }

    const raw = await response.text().catch(() => "");
    const parsed = raw ? parseJson(raw) : null;

    if (!response.ok) {
      const errorBody = parsed === INVALID_JSON ? undefined : parsed;
      throw new HoldedApiError(mapStatusToErrorCode(response.status), response.status, errorBody);
    }
    if (parsed === INVALID_JSON) {
      throw new HoldedApiError("invalid_response", response.status);
    }
    return (parsed ?? null) as T;
  }

  const client = {
    async listContacts(params: { page?: number } = {}): Promise<HoldedContact[]> {
      const search = new URLSearchParams();
      if (params.page) search.set("page", String(params.page));
      const suffix = search.toString() ? `?${search.toString()}` : "";
      return normalizeContactList(await request<HoldedContactListResponse>("GET", `/contacts${suffix}`));
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
      if (!contact || typeof contact !== "object" || !extractId({ id: contact.id })) {
        // Garantizamos que el snapshot tenga id estable.
        return { ...(contact as object), id: contactId } as HoldedContact;
      }
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

    async checkHealth(): Promise<HoldedHealthResult> {
      const checkedAt = new Date().toISOString();
      try {
        await request<HoldedContactListResponse>("GET", "/contacts?page=1");
        return { status: "healthy", code: "ok", message: "Holded responde correctamente.", lastCheckedAt: checkedAt };
      } catch (error) {
        if (error instanceof HoldedApiError) {
          const map: Partial<Record<string, HoldedHealthCode>> = {
            unauthorized: "invalid_api_key",
            forbidden: "invalid_api_key",
            rate_limited: "rate_limit",
            network_error: "network_error",
            timeout: "network_error",
          };
          const code = map[error.code] ?? "unexpected_error";
          const messages: Record<HoldedHealthCode, string> = {
            ok: "Holded responde correctamente.",
            invalid_api_key: "La clave de Holded no es válida.",
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

    /**
     * @deprecated Exportación de presupuestos aún sobre la API legacy v1
     * (`/api/invoicing/v1/documents/estimate`). Se migrará en la fase de
     * Estimates v2; queda aislada aquí y fuera del flujo de clientes.
     */
    async saveEstimate(input: LegacyEstimateInput) {
      const path = input.documentId
        ? `/documents/estimate/${encodeURIComponent(input.documentId)}`
        : "/documents/estimate";
      const payload = {
        desc: `${input.reference} · ${input.title}`,
        date: input.date,
        notes: input.notes,
        items: input.items,
        ...(!input.documentId
          ? {
              contactName: input.contactName,
              ...(input.contactCode ? { contactCode: input.contactCode } : {}),
              ...(input.contactEmail ? { contactEmail: input.contactEmail } : {}),
              ...(input.contactAddress ? { contactAddress: input.contactAddress } : {}),
            }
          : {}),
      };
      const raw = await request<unknown>(
        input.documentId ? "PUT" : "POST",
        path,
        payload,
        { baseUrl: LEGACY_INVOICING_V1_BASE_URL, legacyKeyAuth: true },
      );
      if (input.documentId) return { id: input.documentId, response: raw };
      const id = extractId(raw);
      if (!id) throw new HoldedApiError("invalid_response");
      return { id, response: raw };
    },
  };

  return client;
}

export type HoldedClient = ReturnType<typeof createHoldedClient>;

// ---------------------------------------------------------------------------
// Tipos legacy de la exportación de presupuestos (pendiente de migrar a v2).
// ---------------------------------------------------------------------------
export interface LegacyEstimateItem {
  name: string;
  desc?: string;
  units: number;
  price: number;
  tax: number;
}

export interface LegacyEstimateInput {
  documentId?: string | null;
  reference: string;
  title: string;
  date: number;
  contactCode?: string;
  contactName: string;
  contactEmail?: string;
  contactAddress?: string;
  notes?: string;
  items: LegacyEstimateItem[];
}
