export type HoldedErrorCode =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "unprocessable"
  | "rate_limited"
  | "server_error"
  | "network_error"
  | "timeout"
  | "invalid_response"
  | "unknown";

/**
 * Único tipo de error del adaptador Holded.
 *
 * Nunca contiene la API key ni cabeceras: `message` es sólo el código y
 * `responseBody` es el cuerpo de error devuelto por Holded (que no incluye
 * nuestras credenciales). No serializar cabeceras de petición aquí.
 */
export class HoldedApiError extends Error {
  constructor(
    public readonly code: HoldedErrorCode,
    public readonly status: number | null = null,
    public readonly responseBody: unknown = undefined,
  ) {
    super(`holded_api_error:${code}`);
    this.name = "HoldedApiError";
  }

  /** Errores que tiene sentido reintentar más adelante (no destruyen datos). */
  get retryable(): boolean {
    return (
      this.code === "rate_limited" ||
      this.code === "server_error" ||
      this.code === "network_error" ||
      this.code === "timeout"
    );
  }
}

export function mapStatusToErrorCode(status: number): HoldedErrorCode {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 422) return "unprocessable";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server_error";
  return "unknown";
}
