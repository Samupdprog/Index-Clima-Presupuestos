import { describe, expect, it, vi } from "vitest";
import { createHoldedClient, type HoldedLogEvent } from "./client.js";
import { HoldedApiError } from "./errors.js";

const API_KEY = "super-secret-read-key-9876";
const BASE = "https://api.holded.com/api/v2";
const ID = "6aba7b1deb4469c5fc0d28ca";

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}
function setup(handler: (url: string, init?: RequestInit) => Promise<Response>, timeoutMs?: number) {
  const fetcher = vi.fn(handler);
  const logs: HoldedLogEvent[] = [];
  const client = createHoldedClient({ apiKey: API_KEY, fetch: fetcher as unknown as typeof fetch, logger: (event) => logs.push(event), ...(timeoutMs ? { timeoutMs } : {}) });
  return { client, fetcher, logs };
}
async function failure(promise: Promise<unknown>) {
  try { await promise; } catch (error) { return error as HoldedApiError; }
  throw new Error("expected failure");
}

describe("Holded v2 estimate reads", () => {
  it("paginates with cursor, clamps limit and filters by contact", async () => {
    const { client, fetcher } = setup(async () => json({ items: [{ id: ID, lines: [] }], cursor: "page:2", has_more: true }));
    const page = await client.listEstimatesPage({ cursor: "page:1", contactId: "c".repeat(24), limit: 500 });
    expect(page).toEqual({ items: [{ id: ID, lines: [] }], cursor: "page:2", has_more: true });
    const url = new URL(fetcher.mock.calls[0]![0]);
    expect(`${url.origin}${url.pathname}`).toBe(`${BASE}/estimates`);
    expect(Object.fromEntries(url.searchParams)).toEqual({ limit: "100", cursor: "page:1", contact_id: "c".repeat(24) });
    await client.listEstimatesPage({ limit: 20 });
    expect(new URL(fetcher.mock.calls[1]![0]).searchParams.get("limit")).toBe("20");
    await client.listEstimatesPage();
    expect(new URL(fetcher.mock.calls[2]![0]).searchParams.get("limit")).toBe("100");
  });
  it("treats a missing cursor on the last page as null", async () => {
    const { client } = setup(async () => json({ items: [], has_more: false }));
    await expect(client.listEstimatesPage()).resolves.toEqual({ items: [], cursor: null, has_more: false });
  });
  it.each([
    ["no items array", { data: [] }],
    ["item without id", { items: [{ number: "P-1" }], cursor: null, has_more: false }],
    ["non-string cursor", { items: [], cursor: 5, has_more: true }],
  ])("rejects an invalid list response (%s)", async (_label, body) => {
    const { client } = setup(async () => json(body));
    expect((await failure(client.listEstimatesPage())).code).toBe("invalid_response");
  });
  it("rejects non-JSON responses", async () => {
    const { client } = setup(async () => new Response("<html>", { status: 200 }));
    expect((await failure(client.listEstimatesPage())).code).toBe("invalid_response");
  });
  it("reads one estimate, including the read-only body, with Bearer auth", async () => {
    const { client, fetcher } = setup(async () => json({ id: ID, body: "<p>texto</p>", lines: [] }));
    await expect(client.getEstimate(ID)).resolves.toMatchObject({ id: ID, body: "<p>texto</p>" });
    expect(fetcher.mock.calls[0]![0]).toBe(`${BASE}/estimates/${ID}`);
    expect(fetcher.mock.calls[0]![1]).toMatchObject({ method: "GET", headers: { authorization: `Bearer ${API_KEY}` } });
  });
  it.each([
    [401, "unauthorized", false],
    [403, "forbidden", false],
    [404, "not_found", false],
    [429, "rate_limited", true],
    [503, "server_error", true],
  ])("maps HTTP %s to %s", async (status, code, retryable) => {
    const { client } = setup(async () => json({ title: "error", detail: `echo ${API_KEY}` }, status, status === 429 ? { "retry-after": "30" } : {}));
    const error = await failure(client.getEstimate(ID));
    expect(error).toBeInstanceOf(HoldedApiError);
    expect(error).toMatchObject({ code, status, retryable });
    if (status === 429) expect(error.retryAfterSeconds).toBe(30);
    expect(error.message).not.toContain(API_KEY);
  });
  it("times out a slow read", async () => {
    const { client } = setup((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    }), 5);
    expect((await failure(client.listEstimatesPage())).code).toBe("timeout");
  });
  it("never logs the API key, authorization header or query string", async () => {
    const { client, logs } = setup(async () => json({ items: [], cursor: null, has_more: false }));
    await client.listEstimatesPage({ cursor: "secret-cursor", contactId: "c".repeat(24) });
    const rejected = setup(async () => json({}, 401));
    await failure(rejected.client.getEstimate(ID));
    expect(logs).toEqual([expect.objectContaining({ method: "GET", path: "/estimates", ok: true })]);
    expect(rejected.logs).toEqual([expect.objectContaining({ path: `/estimates/${ID}`, status: 401, code: "unauthorized", ok: false })]);
    expect(JSON.stringify([...logs, ...rejected.logs])).not.toMatch(new RegExp(`${API_KEY}|authorization|secret-cursor`, "i"));
  });
});
