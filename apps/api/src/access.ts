import { timingSafeEqual } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";

export function authenticateService(headers: IncomingHttpHeaders, token: string | undefined, installationId: string) {
  if (!token?.trim() || token === "CHANGE_ME") return { error: "service_auth_not_configured", status: 503 } as const;
  const actual = Buffer.from(headers.authorization ?? "");
  const expected = Buffer.from(`Bearer ${token}`);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return { error: "unauthorized", status: 401 } as const;
  if (headers["x-installation-id"] && headers["x-installation-id"] !== installationId) return { error: "installation_mismatch", status: 403 } as const;
  const type = headers["x-actor-type"] === "ai" ? "ai" : headers["x-actor-type"] === "worker" ? "worker" : "user";
  return { actor: { actorType: type, subject: String(headers["x-actor-id"] ?? "local-user").slice(0, 200) } } as const;
}

export function allowedAiRequest(method: string, path: string[], scopesHeader: string | string[] | undefined) {
  const scopes = new Set(String(scopesHeader ?? "").split(/[ ,]+/).filter(Boolean));
  const resource = path[0];
  if (resource === "settings" || (resource === "holded" && path[1] === "settings")) return false;
  if (!["clients", "quotes", "holded", "catalogs"].includes(resource ?? "")) return false;
  const preview = path.includes("preview") || path.includes("preview-line");
  const write = method !== "GET" && !preview;
  const prefix = resource === "catalogs" ? "quotes" : resource;
  if (!scopes.has(`${prefix}:${write ? "write" : "read"}`)) return false;
  if (resource === "quotes" && path[2] === "holded") return scopes.has("holded:write");
  // Client writes may synchronise with Holded; do not grant an indirect bypass.
  if (resource === "clients" && write) return scopes.has(path.length === 2 && path[1] === "sync" ? "holded:read" : "holded:write");
  return true;
}

export function dataResetAllowed(env: NodeJS.ProcessEnv, actorType: string, body: unknown) {
  if (env.ALLOW_DATA_RESET !== "true" || actorType !== "user") return false;
  if (!body || typeof body !== "object") return false;
  const input = body as Record<string, unknown>;
  return input.confirmation === "BORRAR DATOS" && input.confirmed === true;
}
