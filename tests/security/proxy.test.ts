import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "../../apps/web/proxy.js";

const previous = process.env.APP_ACCESS_PASSWORD;
afterEach(() => { if (previous === undefined) delete process.env.APP_ACCESS_PASSWORD; else process.env.APP_ACCESS_PASSWORD = previous; });
describe("public web access", () => {
  it("requires configured Basic auth before API and pages", () => {
    process.env.APP_ACCESS_PASSWORD = "TEST-long-secret-password";
    const forbidden = proxy(new NextRequest("https://quotes.example.test/api/backend/quotes"));
    expect(forbidden.status).toBe(401);
    expect(forbidden.headers.get("www-authenticate")).toContain("Basic");
    const valid = Buffer.from("index-clima:TEST-long-secret-password").toString("base64");
    expect(proxy(new NextRequest("https://quotes.example.test/api/backend/quotes", { headers: { authorization: `Basic ${valid}` } })).status).toBe(200);
    expect(proxy(new NextRequest("https://quotes.example.test/presupuestos")).status).toBe(401);
  });
  it("keeps health and signed webhook reachable", () => {
    process.env.APP_ACCESS_PASSWORD = "TEST-long-secret-password";
    expect(proxy(new NextRequest("https://quotes.example.test/api/health")).status).toBe(200);
    expect(proxy(new NextRequest("https://quotes.example.test/api/holded-webhook")).status).toBe(200);
  });
});
