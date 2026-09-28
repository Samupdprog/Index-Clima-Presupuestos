import type { McpPrincipal } from "./auth.js";

export type ApiMethod = "GET" | "POST" | "PATCH" | "DELETE";
export const TOOL_ERROR_CODES = ["invalid_input", "forbidden", "revision_conflict", "not_found", "validation_failed", "holded_failed", "rate_limited", "api_unavailable", "api_error", "invalid_api_response"] as const;
export type ToolErrorCode = typeof TOOL_ERROR_CODES[number];
export interface ToolError {
  code: ToolErrorCode;
  message: string;
  status?: number;
  backendCode?: string;
  /** Código seguro del adaptador Holded (p. ej. unauthorized, unprocessable), nunca el cuerpo remoto. */
  holdedCode?: string;
  retryAfterSeconds?: number;
  retryable: boolean;
}

export class GeneratorApiError extends Error {
  constructor(readonly detail: ToolError) { super(detail.message); }
}

const messages: Record<ToolErrorCode, string> = {
  invalid_input: "Entrada inválida; revisa el schema de la herramienta.",
  forbidden: "El token no tiene permisos para esta operación.",
  revision_conflict: "La entidad ha cambiado. Vuelve a leerla, revisa los cambios y usa la nueva revision; no repitas a ciegas.",
  not_found: "El recurso no existe en esta instalación.",
  validation_failed: "El backend rechazó la operación. Revisa datos, estado e información de precios pendientes.",
  holded_failed: "Holded devolvió un error o no está configurado. Consulta get_holded_status y explica el problema al usuario; no reintentes en bucle.",
  rate_limited: "Holded está limitando las peticiones. Espera retryAfterSeconds (o un minuto) antes de UNA nueva consulta; no reintentes en bucle.",
  api_unavailable: "La API no respondió. Comprueba el estado del recurso antes de repetir una escritura.",
  api_error: "La API no pudo completar la operación.",
  invalid_api_response: "La API devolvió una respuesta que no cumple el contrato esperado.",
};

function safeCode(value: unknown) {
  return typeof value === "string" && /^[a-z][a-z0-9_]{0,79}$/.test(value) ? value : undefined;
}

export function toolError(code: ToolErrorCode, extra: Partial<Omit<ToolError, "code" | "message">> = {}): ToolError {
  return { code, message: messages[code], retryable: false, ...extra };
}

export interface GeneratorApi {
  request(method: ApiMethod, path: string, principal: McpPrincipal, body?: unknown): Promise<unknown>;
}

export function createGeneratorApi(options: { baseUrl: string; serviceToken: string; fetch?: typeof fetch; timeoutMs?: number }): GeneratorApi {
  const base = new URL(options.baseUrl);
  if (!["http:", "https:"].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new Error("invalid_internal_api_url");
  const requestFetch = options.fetch ?? fetch;
  if (options.serviceToken.length < 32) throw new Error("internal_service_token_must_have_at_least_32_characters");
  return {
    async request(method, path, principal, body) {
      // Paths are generated only by registered tool handlers, never accepted from user input.
      if (!path.startsWith("/") || path.startsWith("//")) throw new Error("invalid_internal_api_path");
      let response: Response;
      try {
        response = await requestFetch(new URL(path, base), {
          method,
          redirect: "error",
          signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
          headers: {
            authorization: `Bearer ${options.serviceToken}`,
            "content-type": "application/json",
            "x-actor-type": "ai",
            "x-actor-id": principal.subject,
            "x-installation-id": principal.installationId,
            "x-mcp-scopes": principal.scopes.join(" "),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
      } catch {
        throw new GeneratorApiError(toolError("api_unavailable"));
      }
      let payload: unknown;
      try { payload = await response.json(); } catch { throw new GeneratorApiError(toolError("invalid_api_response", { status: response.status })); }
      if (!response.ok) {
        const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
        const details = record.details && typeof record.details === "object" ? record.details as Record<string, unknown> : {};
        // Backend codes are safe identifiers; never forward arbitrary messages, stack traces, remote bodies or secrets.
        const backendCode = safeCode(record.error);
        const holdedCode = safeCode(details.code);
        const retryAfterSeconds = typeof record.retryAfterSeconds === "number" && Number.isInteger(record.retryAfterSeconds) && record.retryAfterSeconds >= 0 ? record.retryAfterSeconds : undefined;
        const code: ToolErrorCode = response.status === 409 ? "revision_conflict" : response.status === 429 ? "rate_limited" : response.status === 403 || response.status === 401 ? "forbidden" : response.status === 404 ? "not_found" : backendCode?.startsWith("holded_") ? "holded_failed" : response.status === 400 ? "invalid_input" : response.status === 422 ? "validation_failed" : response.status === 503 ? "api_unavailable" : "api_error";
        throw new GeneratorApiError(toolError(code, { status: response.status, ...(backendCode ? { backendCode } : {}), ...(holdedCode ? { holdedCode } : {}), ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}), ...(code === "rate_limited" ? { retryable: true } : {}) }));
      }
      return payload;
    },
  };
}
