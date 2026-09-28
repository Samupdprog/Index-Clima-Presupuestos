import { HoldedEstimateQueryError } from "@quotes/application";
import { HoldedApiError } from "@quotes/holded";

const HOLDED_READ_ERRORS: Record<string, [number, string]> = {
  unauthorized: [502, "holded_unauthorized"],
  forbidden: [502, "holded_forbidden"],
  not_found: [404, "holded_estimate_not_found"],
  rate_limited: [429, "holded_rate_limited"],
  timeout: [504, "holded_unavailable"],
  network_error: [504, "holded_unavailable"],
  server_error: [502, "holded_unavailable"],
  invalid_response: [502, "holded_invalid_response"],
};

/**
 * Respuesta HTTP para un fallo al LEER Estimates de Holded: códigos estables,
 * sin cuerpos remotos (no confiables) ni credenciales. 401/403 de Holded no se
 * devuelven como 401/403 para no confundirlos con permisos del llamante.
 * `null` si el error no procede de Holded (lo gestiona el mapeo general).
 */
export function holdedReadErrorResponse(error: unknown): { status: number; body: { error: string; retryAfterSeconds?: number } } | null {
  if (error instanceof HoldedEstimateQueryError) return { status: 502, body: { error: "holded_invalid_response" } };
  if (!(error instanceof HoldedApiError)) return null;
  const [status, code] = HOLDED_READ_ERRORS[error.code] ?? [502, "holded_request_failed"];
  return { status, body: { error: code, ...(error.retryAfterSeconds !== null ? { retryAfterSeconds: error.retryAfterSeconds } : {}) } };
}
