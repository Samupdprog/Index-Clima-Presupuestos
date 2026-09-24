export interface HoldedEstimateItem {
  name: string;
  desc?: string;
  units: number;
  price: number;
  tax: number;
}

export interface HoldedEstimateInput {
  documentId?: string | null;
  reference: string;
  title: string;
  date: number;
  contactCode?: string;
  contactName: string;
  contactEmail?: string;
  contactAddress?: string;
  notes?: string;
  items: HoldedEstimateItem[];
}

export class HoldedApiError extends Error {
  constructor(public status: number, public responseBody: unknown) {
    super("holded_api_error");
    this.name = "HoldedApiError";
  }
}

export type HoldedHealthStatus = "unknown" | "checking" | "healthy" | "unhealthy";
export type HoldedHealthCode = "ok" | "invalid_api_key" | "network_error" | "rate_limit" | "unexpected_error" | "not_configured" | "unknown";

export interface HoldedHealthResult {
  status: HoldedHealthStatus;
  code: HoldedHealthCode;
  message: string;
  lastCheckedAt: string | null;
}

export function maskApiKey(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (trimmed.length <= 4) return `${"•".repeat(Math.max(trimmed.length, 4))}`;
  return `••••••••••••${trimmed.slice(-4)}`;
}

type Fetch = typeof fetch;

export function createHoldedClient(apiKey: string, fetcher: Fetch = fetch) {
  const baseUrl = "https://api.holded.com/api/invoicing/v1";

  return {
    async saveEstimate(input: HoldedEstimateInput) {
      const path = input.documentId
        ? `/documents/estimate/${encodeURIComponent(input.documentId)}`
        : "/documents/estimate";
      const payload = {
        desc: `${input.reference} · ${input.title}`,
        date: input.date,
        notes: input.notes,
        items: input.items,
        ...(!input.documentId ? {
          contactName: input.contactName,
          ...(input.contactCode ? { contactCode: input.contactCode } : {}),
          ...(input.contactEmail ? { contactEmail: input.contactEmail } : {}),
          ...(input.contactAddress ? { contactAddress: input.contactAddress } : {}),
        } : {}),
      };
      const response = await fetcher(`${baseUrl}${path}`, {
        method: input.documentId ? "PUT" : "POST",
        headers: { "content-type": "application/json", key: apiKey },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => null) as unknown;
      if (!response.ok) throw new HoldedApiError(response.status, body);
      if (input.documentId) return { id: input.documentId, response: body };
      const id = extractDocumentId(body);
      if (!id) throw new HoldedApiError(response.status, body);
      return { id, response: body };
    },

    async checkHealth(): Promise<HoldedHealthResult> {
      const checkedAt = new Date().toISOString();
      try {
        const response = await fetcher(`${baseUrl}/contacts?limit=1`, {
          method: "GET",
          headers: { "content-type": "application/json", key: apiKey },
        });
        const body = await response.json().catch(() => null) as unknown;
        if (response.ok) return { status: "healthy", code: "ok", message: "Holded responde correctamente.", lastCheckedAt: checkedAt };
        if (response.status === 401 || response.status === 403) return { status: "unhealthy", code: "invalid_api_key", message: "La clave de Holded no es válida.", lastCheckedAt: checkedAt };
        if (response.status === 429) return { status: "unhealthy", code: "rate_limit", message: "Holded está limitando las peticiones.", lastCheckedAt: checkedAt };
        return { status: "unhealthy", code: "unexpected_error", message: "Holded respondió con un error inesperado.", lastCheckedAt: checkedAt };
      } catch (error) {
        return {
          status: "unhealthy",
          code: "network_error",
          message: "No se pudo contactar con Holded.",
          lastCheckedAt: checkedAt,
        };
      }
    },
  };
}

function extractDocumentId(body: unknown) {
  if (typeof body === "string" && body.trim()) return body;
  if (!body || typeof body !== "object") return null;
  const value = body as Record<string, unknown>;
  for (const key of ["id", "_id", "documentId"]) {
    if (typeof value[key] === "string" && value[key]) return value[key] as string;
  }
  return null;
}
