import { describe, expect, it, vi } from "vitest";
import { createHoldedClient } from "./client.js";
import { HoldedApiError } from "./errors.js";

const API_KEY = "super-secret-key-1234";
const BASE = "https://api.holded.com/api/v2";

type FetchHandler = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

function mk(handler: FetchHandler) {
  return vi.fn(handler);
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** Envelope v2 real. */
function envelope(items: unknown[], cursor: string | null = null, has_more = false) {
  return jsonResponse({ items, cursor, has_more });
}

function client(fetcher: ReturnType<typeof mk>) {
  return createHoldedClient({ apiKey: API_KEY, fetch: fetcher as unknown as typeof fetch });
}

describe("Holded v2 adapter — auth & transport", () => {
  it("uses Bearer auth against the v2 base URL with JSON accept header", async () => {
    const fetcher = mk(async () => envelope([]));
    await client(fetcher).listContacts();
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe(`${BASE}/contacts`);
    expect(init!.method).toBe("GET");
    const headers = init!.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${API_KEY}`);
    expect(headers.accept).toBe("application/json");
    expect(headers["content-type"]).toBeUndefined();
    expect(init!.body).toBeUndefined();
  });

  it("never leaks the api key in thrown errors", async () => {
    const fetcher = mk(async () => jsonResponse({ error: "nope" }, 401));
    const error = await client(fetcher).listContacts().catch((e) => e);
    expect(error).toBeInstanceOf(HoldedApiError);
    const serialized = JSON.stringify({ message: error.message, body: error.responseBody, code: error.code, stack: error.stack });
    expect(serialized).not.toContain(API_KEY);
  });
});

describe("Holded v2 adapter — list/search envelope { items, cursor, has_more }", () => {
  it("listContacts extracts items from the v2 envelope (not []!)", async () => {
    const fetcher = mk(async () => envelope([{ id: "c1", name: "Andrea", type: "client" }], null, false));
    const result = await client(fetcher).listContacts();
    expect(result).toEqual([{ id: "c1", name: "Andrea", type: "client" }]);
  });

  it("searchContacts hits the search endpoint and extracts items", async () => {
    const fetcher = mk(async () => envelope([{ id: "c1", name: "Andrea", type: "client" }], null, false));
    const result = await client(fetcher).searchContacts("Andrea");
    expect(fetcher.mock.calls[0]![0]).toBe(`${BASE}/contacts/search?name=Andrea`);
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe("Andrea");
  });

  it("listContactsPage returns cursor + has_more for pagination", async () => {
    const fetcher = mk(async () => envelope([{ id: "c1" }], "next-cursor", true));
    const page = await client(fetcher).listContactsPage();
    expect(page.items).toHaveLength(1);
    expect(page.cursor).toBe("next-cursor");
    expect(page.has_more).toBe(true);
  });

  it("passes the cursor when paginating", async () => {
    const fetcher = mk(async () => envelope([]));
    await client(fetcher).listContacts({ cursor: "abc123" });
    expect(fetcher.mock.calls[0]![0]).toBe(`${BASE}/contacts?cursor=abc123`);
  });

  it("tolerates a direct array (defensive compat)", async () => {
    const fetcher = mk(async () => jsonResponse([{ id: "c1" }]));
    expect(await client(fetcher).listContacts()).toHaveLength(1);
  });

  it("tolerates a { data } envelope (defensive compat)", async () => {
    const fetcher = mk(async () => jsonResponse({ data: [{ id: "c1" }] }));
    expect(await client(fetcher).listContacts()).toHaveLength(1);
  });

  it("searchContacts short-circuits on empty query (no request)", async () => {
    const fetcher = mk(async () => envelope([]));
    expect(await client(fetcher).searchContacts("   ")).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("Holded v2 adapter — contacts CRUD", () => {
  it("getContact fetches by id", async () => {
    const fetcher = mk(async () => jsonResponse({ id: "abc", name: "ACME" }));
    const result = await client(fetcher).getContact("abc");
    expect(fetcher.mock.calls[0]![0]).toBe(`${BASE}/contacts/abc`);
    expect(result.name).toBe("ACME");
  });

  it("createContact posts snake_case body and returns the extracted id", async () => {
    const fetcher = mk(async () => jsonResponse({ status: 1, id: "new-1" }, 201));
    const result = await client(fetcher).createContact({ name: "Nuevo", type: "client", code: "B123", bill_address: { address: "Calle 1" } });
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe(`${BASE}/contacts`);
    expect(init!.method).toBe("POST");
    expect(JSON.parse(init!.body as string)).toMatchObject({ name: "Nuevo", type: "client", code: "B123", bill_address: { address: "Calle 1" } });
    expect(result.id).toBe("new-1");
  });

  it("createContact throws when the response has no id", async () => {
    const fetcher = mk(async () => jsonResponse({ status: 0, info: "error" }));
    await expect(client(fetcher).createContact({ name: "X" })).rejects.toBeInstanceOf(HoldedApiError);
  });

  it("updateContact PUTs the full merged body to the contact id", async () => {
    const fetcher = mk(async () => jsonResponse({ status: 1, id: "abc" }));
    const body = { name: "ACME", code: "B1", vat_number: "ESB1", iban: "ES00", custom_id: null };
    const result = await client(fetcher).updateContact("abc", body);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe(`${BASE}/contacts/abc`);
    expect(init!.method).toBe("PUT");
    expect(JSON.parse(init!.body as string)).toEqual(body);
    expect(result.id).toBe("abc");
  });
});

describe("Holded v2 adapter — error mapping", () => {
  const cases: Array<[number, string]> = [
    [401, "unauthorized"],
    [403, "forbidden"],
    [404, "not_found"],
    [422, "unprocessable"],
    [429, "rate_limited"],
    [500, "server_error"],
    [503, "server_error"],
  ];
  for (const [status, code] of cases) {
    it(`maps HTTP ${status} to ${code}`, async () => {
      const fetcher = mk(async () => jsonResponse({ error: "x" }, status));
      const error = await client(fetcher).getContact("id").catch((e) => e);
      expect(error).toBeInstanceOf(HoldedApiError);
      expect(error.code).toBe(code);
      expect(error.status).toBe(status);
    });
  }

  it("maps network failures to network_error", async () => {
    const fetcher = mk(async () => { throw new TypeError("fetch failed"); });
    const error = await client(fetcher).getContact("id").catch((e) => e);
    expect(error).toBeInstanceOf(HoldedApiError);
    expect(error.code).toBe("network_error");
  });

  it("maps aborts to timeout", async () => {
    const fetcher = mk(async () => {
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    });
    const error = await client(fetcher).getContact("id").catch((e) => e);
    expect(error.code).toBe("timeout");
  });

  it("aborts a slow request after the timeout", async () => {
    const fetcher = mk((_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        const err = new Error("aborted");
        err.name = "AbortError";
        reject(err);
      });
    }));
    const slow = createHoldedClient({ apiKey: API_KEY, fetch: fetcher as unknown as typeof fetch, timeoutMs: 5 });
    const error = await slow.getContact("id").catch((e) => e);
    expect(error).toBeInstanceOf(HoldedApiError);
    expect(error.code).toBe("timeout");
  });

  it("maps invalid JSON on a 200 to invalid_response", async () => {
    const fetcher = mk(async () => new Response("<html>oops</html>", { status: 200, headers: { "content-type": "text/html" } }));
    const error = await client(fetcher).getContact("id").catch((e) => e);
    expect(error).toBeInstanceOf(HoldedApiError);
    expect(error.code).toBe("invalid_response");
  });

  it("marks rate_limited / server / network errors as retryable, auth errors as not", async () => {
    expect(new HoldedApiError("rate_limited", 429).retryable).toBe(true);
    expect(new HoldedApiError("server_error", 500).retryable).toBe(true);
    expect(new HoldedApiError("network_error").retryable).toBe(true);
    expect(new HoldedApiError("timeout").retryable).toBe(true);
    expect(new HoldedApiError("unauthorized", 401).retryable).toBe(false);
    expect(new HoldedApiError("forbidden", 403).retryable).toBe(false);
    expect(new HoldedApiError("not_found", 404).retryable).toBe(false);
  });
});

describe("Holded v2 adapter — health", () => {
  it("reads contacts as the representative healthy probe", async () => {
    const fetcher = mk(async (input) => {
      expect(String(input)).toBe(`${BASE}/contacts`);
      return envelope([{ id: "c1" }]);
    });
    await expect(client(fetcher).checkHealth()).resolves.toMatchObject({ status: "healthy", code: "ok" });
  });

  it("maps 401 to invalid_api_key", async () => {
    const fetcher = mk(async () => jsonResponse({ error: "Unauthorized" }, 401));
    await expect(client(fetcher).checkHealth()).resolves.toMatchObject({ status: "unhealthy", code: "invalid_api_key" });
  });

  it("maps 403 to insufficient_permissions with a clear message", async () => {
    const fetcher = mk(async () => jsonResponse({ error: "Forbidden" }, 403));
    const result = await client(fetcher).checkHealth();
    expect(result).toMatchObject({ status: "unhealthy", code: "insufficient_permissions" });
    expect(result.message).toContain("permisos");
  });

  it("maps 429 to rate_limit", async () => {
    const fetcher = mk(async () => jsonResponse({}, 429));
    await expect(client(fetcher).checkHealth()).resolves.toMatchObject({ status: "unhealthy", code: "rate_limit" });
  });

  it("maps network failure to network_error", async () => {
    const fetcher = mk(async () => { throw new Error("down"); });
    await expect(client(fetcher).checkHealth()).resolves.toMatchObject({ status: "unhealthy", code: "network_error" });
  });
});
