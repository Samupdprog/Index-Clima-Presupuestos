export const runtime = "nodejs";

export async function POST(request: Request) {
  const headers = new Headers({ "content-type": "application/json" });
  for (const name of ["x-holded-webhook-event", "x-holded-webhook-date", "x-holded-webhook-signature", "x-holded-webhook-id", "x-holded-account-id"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const reader = request.body?.getReader();
  if (!reader) return new Response(null, { status: 400 });
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 2_000_000) { await reader.cancel(); return new Response(null, { status: 413 }); }
    chunks.push(value);
  }
  try {
    const response = await fetch(`${process.env.INTERNAL_API_URL ?? "http://localhost:4000"}/webhooks/holded`, { method: "POST", headers, body: Buffer.concat(chunks), signal: AbortSignal.timeout(15_000) });
    return new Response(await response.text(), { status: response.status, headers: { "content-type": "application/json" } });
  } catch { return Response.json({ error: "api_unavailable" }, { status: 503 }); }
}
