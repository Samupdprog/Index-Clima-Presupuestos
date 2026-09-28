import { createMcpExpressApp, requireBearerAuth } from "@modelcontextprotocol/express";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler, McpServer, type OAuthTokenVerifier } from "@modelcontextprotocol/server";
import { z } from "zod/v4";
import { createLocalTokenVerifier, MCP_SCOPES, parseScopes, principalFromAuth, type McpPrincipal } from "./auth.js";
import { createGeneratorApi, type GeneratorApi } from "./api-client.js";
import { GENERATOR_GUIDE } from "./guide.js";
import { callGeneratorTool, envelopeOutput, generatorTools } from "./tools.js";

export interface McpAppOptions {
  enabled: boolean;
  host?: string;
  publicUrl: string;
  installationId: string;
  apiUrl: string;
  serviceToken: string;
  authToken?: string;
  subject?: string;
  scopes?: string;
  verifier?: OAuthTokenVerifier;
  authorizationServerUrl?: string;
  api?: GeneratorApi;
}

export function createGeneratorServer(api: GeneratorApi, principal: McpPrincipal) {
  const server = new McpServer({ name: "index-clima-presupuestos", version: "0.2.0" }, { instructions: GENERATOR_GUIDE });
  for (const tool of generatorTools) {
    server.registerTool(tool.name, {
      description: tool.description,
      inputSchema: tool.input,
      outputSchema: envelopeOutput(tool.output),
      annotations: { readOnlyHint: tool.readOnly, destructiveHint: tool.destructive ?? false, idempotentHint: tool.readOnly, openWorldHint: tool.scopes.some((scope) => scope.startsWith("holded:")) },
    }, async (args) => callGeneratorTool(tool, api, principal, args));
  }
  server.registerResource("generator_guide", "generator://guide", { title: "Guía operativa del Generador", mimeType: "text/plain", description: "Flujo IA, precios, revisiones, errores y sincronización segura" }, async (uri) => ({ contents: [{ uri: uri.href, text: GENERATOR_GUIDE }] }));
  server.registerPrompt("prepare_quote", { description: "Prepara o modifica un presupuesto usando el backend y revisiones; la IA extrae, nunca calcula.", argsSchema: z.strictObject({ request: z.string().min(1) }) }, ({ request }) => ({ messages: [{ role: "user", content: { type: "text", text: `${GENERATOR_GUIDE}\n\nPetición del usuario:\n${request}` } }] }));
  return server;
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
  if (options.enabled) {
    try {
      if (!z.uuid().safeParse(options.installationId).success) throw new Error("installation_id_required");
      if (options.authToken === options.serviceToken) throw new Error("mcp_token_must_differ_from_service_token");
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:@-]{0,127}$/.test(options.subject ?? "local-ai")) throw new Error("invalid_mcp_subject");
      api = options.api ?? createGeneratorApi({ baseUrl: options.apiUrl, serviceToken: options.serviceToken });
      verifier = options.verifier ?? createLocalTokenVerifier({ token: options.authToken ?? "", resourceUrl: publicUrl.href, principal: { subject: options.subject ?? "local-ai", installationId: options.installationId, scopes: parseScopes(options.scopes ?? "quotes:read clients:read holded:read") } });
    } catch (error) { configurationError = error instanceof Error ? error.message : "mcp_configuration_invalid"; }
  }
  const ready = options.enabled && !configurationError && Boolean(api && verifier);
  app.get("/health", (_req, res) => {
    res.status(options.enabled && !ready ? 503 : 200).json({ status: options.enabled ? ready ? "ok" : "unconfigured" : "disabled", service: "mcp", toolsEnabled: ready, ...(configurationError ? { error: configurationError } : {}) });
  });
  const resourceMetadataUrl = new URL("/.well-known/oauth-protected-resource/mcp", publicUrl).href;
  app.get("/.well-known/oauth-protected-resource/mcp", (_req, res) => {
    res.json({ resource: publicUrl.href, resource_name: "Index Clima Presupuestos", scopes_supported: MCP_SCOPES, bearer_methods_supported: ["header"], ...(options.authorizationServerUrl ? { authorization_servers: [options.authorizationServerUrl] } : {}) });
  });
  const handler = ready ? createMcpHandler((context) => createGeneratorServer(api!, principalFromAuth(context.authInfo, options.installationId)), { legacy: "stateless", responseMode: "json", maxRequestBodySize: 1024 * 1024 }) : undefined;
  if (handler && verifier) {
    const nodeHandler = toNodeHandler(handler);
    app.all("/mcp", requireBearerAuth({ verifier, resourceMetadataUrl }), (req, res) => {
      if (req.auth?.extra?.installationId !== options.installationId || req.auth.resource?.href !== publicUrl.href) {
        res.status(403).json({ error: "forbidden" });
        return;
      }
      const requestedTool = req.body?.method === "tools/call" ? generatorTools.find((tool) => tool.name === req.body?.params?.name) : undefined;
      if (requestedTool && !requestedTool.scopes.every((scope) => req.auth!.scopes.includes(scope))) {
        res.setHeader("WWW-Authenticate", `Bearer error="insufficient_scope", scope="${requestedTool.scopes.join(" ")}", resource_metadata="${resourceMetadataUrl}"`);
        res.status(403).json({ error: "insufficient_scope", required_scopes: requestedTool.scopes });
        return;
      }
      void nodeHandler(req, res, req.body).catch(() => { if (!res.headersSent) res.status(500).json({ error: "mcp_request_failed" }); });
    });
  } else {
    app.all("/mcp", (_req, res) => { res.status(options.enabled ? 503 : 404).json({ error: options.enabled ? "mcp_not_configured" : "mcp_disabled" }); });
  }
  return { app, close: async () => { await handler?.close(); } };
}
