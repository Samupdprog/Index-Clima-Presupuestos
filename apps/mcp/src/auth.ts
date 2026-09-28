import { createHash, timingSafeEqual } from "node:crypto";
import { OAuthError, OAuthErrorCode, type AuthInfo, type OAuthTokenVerifier } from "@modelcontextprotocol/server";

export const MCP_SCOPES = ["clients:read", "clients:write", "quotes:read", "quotes:write", "holded:read", "holded:write"] as const;
export type McpScope = typeof MCP_SCOPES[number];

export interface McpPrincipal {
  subject: string;
  installationId: string;
  scopes: McpScope[];
}

export function parseScopes(value: string): McpScope[] {
  const entries = value.split(/[\s,]+/).filter(Boolean);
  if (!entries.length || entries.some((entry) => !MCP_SCOPES.includes(entry as McpScope))) throw new Error("invalid_mcp_scopes");
  return [...new Set(entries)] as McpScope[];
}

export function createLocalTokenVerifier(options: { token: string; principal: McpPrincipal; resourceUrl: string; expiresAt?: number }): OAuthTokenVerifier {
  if (options.token.length < 32) throw new Error("mcp_auth_token_must_have_at_least_32_characters");
  const digest = createHash("sha256").update(options.token).digest();
  return {
    async verifyAccessToken(token): Promise<AuthInfo> {
      const candidate = createHash("sha256").update(token).digest();
      if (!timingSafeEqual(digest, candidate)) throw new OAuthError(OAuthErrorCode.InvalidToken, "Invalid access token");
      return {
        token,
        clientId: options.principal.subject,
        scopes: options.principal.scopes,
        expiresAt: options.expiresAt ?? Math.floor(Date.now() / 1000) + 3600,
        resource: new URL(options.resourceUrl),
        extra: { installationId: options.principal.installationId },
      };
    },
  };
}

/** AuthInfo is supplied only after transport verification; never from tool arguments. */
export function principalFromAuth(auth: AuthInfo | undefined, installationId: string): McpPrincipal {
  if (!auth || auth.extra?.installationId !== installationId) throw new Error("installation_forbidden");
  return { subject: auth.clientId, installationId, scopes: auth.scopes.filter((scope): scope is McpScope => MCP_SCOPES.includes(scope as McpScope)) };
}
