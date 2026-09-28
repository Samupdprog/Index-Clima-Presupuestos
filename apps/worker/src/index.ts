import { createServer } from "node:http";

const host = process.env.HOST ?? "0.0.0.0";
const port = Number(process.env.PORT ?? "4002");
let running = false;
let lastSyncAt: string | null = null;
let syncStatus = "idle";
async function reconcile() {
  if (running || process.env.FEATURE_HOLDED !== "true") return;
  running = true;
  try {
    const response = await fetch(`${process.env.INTERNAL_API_URL ?? "http://api:4000"}/clients/sync`, { method: "POST", headers: { authorization: `Bearer ${process.env.INTERNAL_SERVICE_TOKEN ?? ""}`, "x-actor-type": "worker", "x-actor-id": "contact-reconciliation", "content-type": "application/json" }, body: "{}", signal: AbortSignal.timeout(120_000) });
    syncStatus = response.ok ? "ok" : `http_${response.status}`;
    if (response.ok) lastSyncAt = new Date().toISOString();
  } catch { syncStatus = "unavailable"; }
  finally { running = false; }
}
const interval = setInterval(() => void reconcile(), 300_000);
const initial = setTimeout(() => void reconcile(), 15_000);

const health = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      status: "ok",
      service: "worker",
      reconciliation: { status: syncStatus, lastSyncAt, running },
      timestamp: new Date().toISOString()
    }));
    return;
  }

  res.writeHead(404).end();
});

health.listen(port, host, () => {
  console.log(`[worker] health endpoint on ${host}:${port}`);
  console.log("[worker] contact reconciliation scheduled every five minutes");
});

function stop() {
  clearInterval(interval); clearTimeout(initial);
  health.close(() => process.exit(0));
}

process.on("SIGTERM", stop);
process.on("SIGINT", stop);
