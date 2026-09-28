import { createServer } from "node:http";
import type { OAuthArtifactRepository } from "@quotes/db";
import { createAdapterFactory } from "./adapter.js";
import type { OAuthServerConfig } from "./config.js";
import { createInteractionHandler } from "./interactions.js";
import { createOAuthProvider, ROUTE_PREFIX } from "./provider.js";

export type OAuthStore = Pick<OAuthArtifactRepository, "upsert" | "find" | "findByUid" | "findByUserCode" | "consume" | "destroy" | "revokeByGrantId">;

const INTERACTION = new RegExp(`^${ROUTE_PREFIX}/interaction/([A-Za-z0-9_-]{1,64})(?:/(login|confirm|abort))?$`);

/**
 * Authorization Server OAuth 2.1 de la instalación. Sirve solo:
 * - `/.well-known/oauth-authorization-server` (RFC 8414) y `/.well-known/openid-configuration`
 * - `/oauth/*` (authorize, token, jwks, register, revoke, interacción)
 * - `/health`
 */
export function createOAuthHttpServer(config: OAuthServerConfig, store: OAuthStore, options: { fetch?: typeof fetch } = {}) {
  const provider = createOAuthProvider(config, createAdapterFactory(store as OAuthArtifactRepository), options);
  const callback = provider.callback();
  const interaction = createInteractionHandler(provider, config);
  const server = createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://oauth.internal").pathname;
    if (path === "/health" && req.method === "GET") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok", service: "oauth", issuer: config.issuer }));
      return;
    }
    // RFC 8414 para issuers sin path: mismo documento que OpenID Discovery.
    if (path === "/.well-known/oauth-authorization-server") req.url = "/.well-known/openid-configuration";
    const match = INTERACTION.exec(path);
    if (match) { void interaction(req, res, match[1]!, match[2]); return; }
    if (path.startsWith(`${ROUTE_PREFIX}/`) || req.url === "/.well-known/openid-configuration") { callback(req, res); return; }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not_found" }));
  });
  return { server, provider };
}
