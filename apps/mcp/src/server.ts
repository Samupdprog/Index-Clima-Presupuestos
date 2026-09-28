import { createHash } from "node:crypto";
import { createMcpExpressApp, requireBearerAuth } from "@modelcontextprotocol/express";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler, McpServer, type OAuthTokenVerifier } from "@modelcontextprotocol/server";
import type { RequestHandler } from "express";
import type { JWTVerifyGetKey } from "jose";
import { z } from "zod/v4";
import { assertSecureUrl, createJwtTokenVerifier, createLocalTokenVerifier, createModeTokenVerifier, parseAuthMode, parseScopes, principalFromAuth, type McpAuthMode, type McpPrincipal, type McpScope } from "./auth.js";
import { createGeneratorApi, type GeneratorApi } from "./api-client.js";
import { GENERATOR_GUIDE } from "./guide.js";
import { insufficientScopeChallenge, securitySchemesFor, wwwAuthenticateMeta } from "./security.js";
import { callGeneratorTool, envelopeOutput, generatorTools } from "./tools.js";

export const INSTALLATION_NAME = "Index Clima";

export interface McpAppOptions {
  enabled: boolean;
  host?: string;
  publicUrl: string;
  installationId: string;
  apiUrl: string;
  serviceToken: string;
  /** bearer (por defecto) | oauth | hybrid. */
  authMode?: string;
  authToken?: string;
  subject?: string;
  /** Scopes del token estático y techo de scopes de cualquier token OAuth. */
  scopes?: string;
  /** Issuer del Authorization Server (modo oauth/hybrid). */
  authIssuerUrl?: string;
  /** JWKS del Authorization Server (modo oauth/hybrid). */
  authJwksUrl?: string;
  /** Lista opcional de `sub` OAuth autorizados. */
  authAllowedSubjects?: string;
  /** Solo tests: resolvedor de claves en lugar de un JWKS remoto. */
  authJwks?: JWTVerifyGetKey;
  /** Solo tests: verificador completo inyectado. */
  verifier?: OAuthTokenVerifier;
  api?: GeneratorApi;
}

interface ServerContext {
  authMode: McpAuthMode;
  resourceMetadataUrl: string;
}

const profileOutput = z.strictObject({ id: z.string().min(1).regex(/\S/), name: z.string(), nickname: z.string() });

/** Perfil estable y seguro de la conexión: nunca tokens ni secretos. */
export function profileFor(principal: McpPrincipal) {
  const id = createHash("sha256").update(`${principal.installationId}\n${principal.subject}`).digest("hex").slice(0, 32);
  return { id, name: INSTALLATION_NAME, nickname: principal.subject };
}

export function createGeneratorServer(api: GeneratorApi, principal: McpPrincipal, context: ServerContext = { authMode: "bearer", resourceMetadataUrl: "" }) {
  const server = new McpServer({ name: "index-clima-presupuestos", version: "0.3.0" }, { instructions: GENERATOR_GUIDE });
  const oauth = context.authMode !== "bearer";
  const schemes = new Map<string, ReturnType<typeof securitySchemesFor>>();
  for (const tool of generatorTools) {
    const securitySchemes = securitySchemesFor(tool.scopes);
    schemes.set(tool.name, securitySchemes);
    server.registerTool(tool.name, {
      description: tool.description,
      inputSchema: tool.input,
      outputSchema: envelopeOutput(tool.output),
      annotations: { readOnlyHint: tool.readOnly, destructiveHint: tool.destructive ?? false, idempotentHint: tool.readOnly, openWorldHint: tool.scopes.some((scope) => scope.startsWith("holded:")) },
      ...(oauth ? { _meta: { securitySchemes } } : {}),
    }, async (args) => callGeneratorTool(tool, api, principal, args, { resourceMetadataUrl: context.resourceMetadataUrl }));
  }
  const profileSchemes = securitySchemesFor([]);
  schemes.set("get_mcp_profile", profileSchemes);
  server.registerTool("get_mcp_profile", {
    description: "Perfil de la conexión autenticada: instalación (Index Clima) e identidad del usuario conectado. SOLO LECTURA. Los scopes efectivos se indican en el texto. Nunca devuelve tokens ni secretos.",
    outputSchema: profileOutput,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    _meta: { "openai/profile": true, ...(oauth ? { securitySchemes: profileSchemes } : {}) },
  }, async () => {
    const profile = profileFor(principal);
    return {
      structuredContent: profile,
      content: [
        { type: "text" as const, text: JSON.stringify(profile) },
        { type: "text" as const, text: `Scopes efectivos: ${principal.scopes.join(" ") || "(ninguno)"}` },
      ],
    };
  });
  if (oauth) exposeTopLevelSecuritySchemes(server, schemes);
  server.registerResource("generator_guide", "generator://guide", { title: "Guía operativa del Generador", mimeType: "text/plain", description: "Flujo IA, precios, revisiones, errores y sincronización segura" }, async (uri) => ({ contents: [{ uri: uri.href, text: GENERATOR_GUIDE }] }));
  server.registerPrompt("prepare_quote", { description: "Prepara o modifica un presupuesto usando el backend y revisiones; la IA extrae, nunca calcula.", argsSchema: z.strictObject({ request: z.string().min(1) }) }, ({ request }) => ({ messages: [{ role: "user", content: { type: "text", text: `${GENERATOR_GUIDE}\n\nPetición del usuario:\n${request}` } }] }));
  return server;
}

type ListHandler = (request: unknown, context: unknown) => Promise<{ tools: Array<Record<string, unknown>> }>;

/**
 * El Apps SDK de OpenAI lee `securitySchemes` como campo del descriptor de tool
 * (y `_meta.securitySchemes` como espejo). McpServer solo publica `_meta`, así
 * que se envuelve su `tools/list` para añadir el campo con el mismo valor.
 */
function exposeTopLevelSecuritySchemes(server: McpServer, schemes: Map<string, unknown>) {
  const low = server.server as unknown as { _getRequestHandler(method: string): ListHandler | undefined; setRequestHandler(method: "tools/list", handler: ListHandler): void };
  const original = low._getRequestHandler("tools/list");
  if (!original) return;
  low.setRequestHandler("tools/list", async (request, context) => {
    const result = await original(request, context);
    return { ...result, tools: result.tools.map((tool) => ({ ...tool, securitySchemes: schemes.get(String(tool.name)) })) };
  });
}

function buildVerifier(options: McpAppOptions, mode: McpAuthMode, publicUrl: URL, scopes: McpScope[]) {
  if (options.verifier) return options.verifier;
  const bearer = mode !== "oauth"
    ? createLocalTokenVerifier({ token: options.authToken ?? "", resourceUrl: publicUrl.href, principal: { subject: options.subject ?? "local-ai", installationId: options.installationId, scopes } })
    : undefined;
  let oauth: OAuthTokenVerifier | undefined;
  if (mode !== "bearer") {
    if (!options.authIssuerUrl?.trim()) throw new Error("auth_issuer_url_required");
    if (!options.authJwks && !options.authJwksUrl?.trim()) throw new Error("auth_jwks_url_required");
    const allowedSubjects = options.authAllowedSubjects?.split(/[\s,]+/).filter(Boolean) ?? [];
    oauth = createJwtTokenVerifier({
      issuer: options.authIssuerUrl,
      resourceUrl: publicUrl.href,
      jwks: options.authJwks ?? assertSecureUrl(options.authJwksUrl!.trim(), "auth_jwks_url"),
      installationId: options.installationId,
      allowedScopes: scopes,
      allowedSubjects,
    });
  }
  return createModeTokenVerifier(mode, { ...(bearer ? { bearer } : {}), ...(oauth ? { oauth } : {}) });
}

/** Solo el método `tools/call` de una petición individual se inspecciona antes del SDK. */
function requestedToolName(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return undefined;
  const message = body as { method?: unknown; params?: { name?: unknown } };
  return message.method === "tools/call" && typeof message.params?.name === "string" ? message.params.name : undefined;
}

export function createMcpApplication(options: McpAppOptions) {
  const publicUrl = new URL(options.publicUrl);
  const app = createMcpExpressApp({
    host: options.host ?? "127.0.0.1",
    allowedHosts: [...new Set([publicUrl.hostname, "localhost", "127.0.0.1", "[::1]", "mcp"])],
    allowedOrigins: [...new Set([publicUrl.hostname, "localhost", "127.0.0.1", "[::1]"])],
    jsonLimit: "1mb",
  });
  let configurationError: string | undefined;
  let api: GeneratorApi | undefined;
  let verifier: OAuthTokenVerifier | undefined;
  let authMode: McpAuthMode = "bearer";
  let scopes: McpScope[] = [];
  try {
    authMode = parseAuthMode(options.authMode);
    scopes = parseScopes(options.scopes ?? "quotes:read clients:read holded:read");
  } catch (error) { configurationError = error instanceof Error ? error.message : "mcp_configuration_invalid"; }
  if (options.enabled && !configurationError) {
    try {
      if (!z.uuid().safeParse(options.installationId).success) throw new Error("installation_id_required");
      if (publicUrl.hash || publicUrl.search) throw new Error("invalid_mcp_public_url");
      if (authMode !== "oauth" && options.authToken === options.serviceToken) throw new Error("mcp_token_must_differ_from_service_token");
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:@-]{0,127}$/.test(options.subject ?? "local-ai")) throw new Error("invalid_mcp_subject");
      api = options.api ?? createGeneratorApi({ baseUrl: options.apiUrl, serviceToken: options.serviceToken });
      verifier = buildVerifier(options, authMode, publicUrl, scopes);
    } catch (error) { configurationError = error instanceof Error ? error.message : "mcp_configuration_invalid"; }
  }
  const ready = options.enabled && !configurationError && Boolean(api && verifier);
  app.get("/health", (_req, res) => {
    res.status(options.enabled && !ready ? 503 : 200).json({ status: options.enabled ? ready ? "ok" : "unconfigured" : "disabled", service: "mcp", toolsEnabled: ready, authMode, ...(configurationError ? { error: configurationError } : {}) });
  });

  // RFC 9728: ruta con el path del recurso (la que se anuncia y los clientes prueban primero) y raíz por compatibilidad.
  const resourcePath = publicUrl.pathname === "/" ? "" : publicUrl.pathname.replace(/\/$/, "");
  const resourceMetadataUrl = new URL(`/.well-known/oauth-protected-resource${resourcePath}`, publicUrl).href;
  const protectedResourceMetadata = {
    resource: publicUrl.href,
    resource_name: `${INSTALLATION_NAME} · Presupuestos`,
    ...(authMode !== "bearer" && options.authIssuerUrl ? { authorization_servers: [options.authIssuerUrl.trim()] } : {}),
    scopes_supported: scopes,
    bearer_methods_supported: ["header"],
  };
  const metadataHandler: RequestHandler = (req, res) => {
    res.set({ "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Cache-Control": "public, max-age=300" });
    if (req.method === "OPTIONS") { res.status(204).end(); return; }
    res.json(protectedResourceMetadata);
  };
  for (const path of new Set([`/.well-known/oauth-protected-resource${resourcePath}`, "/.well-known/oauth-protected-resource"])) {
    app.get(path, metadataHandler);
    app.options(path, metadataHandler);
  }

  const handler = ready
    ? createMcpHandler((context) => createGeneratorServer(api!, principalFromAuth(context.authInfo, options.installationId), { authMode, resourceMetadataUrl }), { legacy: "stateless", responseMode: "json", maxRequestBodySize: 1024 * 1024 })
    : undefined;
  if (handler && verifier) {
    const nodeHandler = toNodeHandler(handler);
    app.all("/mcp", requireBearerAuth({ verifier, resourceMetadataUrl }), (req, res) => {
      if (req.auth?.extra?.installationId !== options.installationId || req.auth.resource?.href !== publicUrl.href) {
        res.status(403).json({ error: "forbidden" });
        return;
      }
      const toolName = requestedToolName(req.body);
      const requestedTool = toolName ? generatorTools.find((tool) => tool.name === toolName) : undefined;
      if (requestedTool && !requestedTool.scopes.every((scope) => req.auth!.scopes.includes(scope))) {
        // HTTP 403 + WWW-Authenticate: step-up según MCP (Claude). El cuerpo es un resultado
        // JSON-RPC con `_meta["mcp/www_authenticate"]`, el formato documentado por OpenAI.
        const challenge = insufficientScopeChallenge(requestedTool.scopes, req.auth.scopes, resourceMetadataUrl);
        res.setHeader("WWW-Authenticate", challenge);
        res.status(403).json({
          jsonrpc: "2.0",
          id: (req.body as { id?: unknown }).id ?? null,
          result: {
            isError: true,
            content: [{ type: "text", text: `Permiso insuficiente (insufficient_scope). Se requiere: ${requestedTool.scopes.join(" ")}` }],
            structuredContent: { ok: false, data: null, error: { code: "forbidden", message: "El token no tiene permisos para esta operación.", status: 403, retryable: false } },
            _meta: wwwAuthenticateMeta(challenge),
          },
        });
        return;
      }
      void nodeHandler(req, res, req.body).catch(() => { if (!res.headersSent) res.status(500).json({ error: "mcp_request_failed" }); });
    });
  } else {
    app.all("/mcp", (_req, res) => { res.status(options.enabled ? 503 : 404).json({ error: options.enabled ? "mcp_not_configured" : "mcp_disabled" }); });
  }
  return { app, close: async () => { await handler?.close(); } };
}
