import type { McpScope } from "./auth.js";

/**
 * Esquema de seguridad por tool (OpenAI Apps SDK). Se deriva siempre de
 * `tool.scopes`, la única fuente de verdad que también aplica el servidor.
 */
export function securitySchemesFor(scopes: readonly McpScope[]) {
  return [{ type: "oauth2" as const, scopes: [...scopes] }];
}

function quote(value: string) {
  return `"${value.replace(/["\\]/g, "")}"`;
}

/** Reto RFC 6750 `insufficient_scope` con el metadata del recurso (RFC 9728). */
export function insufficientScopeChallenge(requiredScopes: readonly string[], grantedScopes: readonly string[], resourceMetadataUrl: string) {
  // Se piden también los scopes ya concedidos para no perderlos en la re-autorización (MCP 2025-11-25, step-up).
  const scope = [...new Set([...grantedScopes, ...requiredScopes])].join(" ");
  return `Bearer error="insufficient_scope", error_description=${quote("Este permiso no está concedido a la conexión")}, scope=${quote(scope)}, resource_metadata=${quote(resourceMetadataUrl)}`;
}

/** `_meta` que ChatGPT usa para ofrecer re-vincular la cuenta desde un resultado de tool. */
export function wwwAuthenticateMeta(challenge: string) {
  return { "mcp/www_authenticate": [challenge] };
}
