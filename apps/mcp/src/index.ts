import { createMcpApplication } from "./server.js";

const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? "4001");
const application = createMcpApplication({
  enabled: process.env.FEATURE_MCP === "true",
  host,
  publicUrl: process.env.MCP_PUBLIC_URL ?? `http://${process.env.MCP_HOST ?? "localhost"}:${port}/mcp`,
  installationId: process.env.INSTALLATION_ID ?? "",
  apiUrl: process.env.INTERNAL_API_URL ?? "http://api:4000",
  serviceToken: process.env.INTERNAL_SERVICE_TOKEN ?? "",
  ...(process.env.MCP_AUTH_TOKEN ? { authToken: process.env.MCP_AUTH_TOKEN } : {}),
  ...(process.env.MCP_SUBJECT ? { subject: process.env.MCP_SUBJECT } : {}),
  ...(process.env.MCP_SCOPES ? { scopes: process.env.MCP_SCOPES } : {}),
});

const server = application.app.listen(port, host, () => console.log(`[mcp] listening on ${host}:${port}`));
function stop() { server.close(() => { void application.close().finally(() => process.exit(0)); }); }
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
