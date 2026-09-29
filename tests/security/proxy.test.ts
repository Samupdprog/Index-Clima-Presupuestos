import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "../../apps/web/proxy.js";
import { accessConfig, createSessionToken, SESSION_COOKIE } from "../../apps/web/lib/session.js";

const previous = { password: process.env.APP_ACCESS_PASSWORD, secret: process.env.APP_SESSION_SECRET };
afterEach(() => {
  if (previous.password === undefined) delete process.env.APP_ACCESS_PASSWORD; else process.env.APP_ACCESS_PASSWORD = previous.password;
  if (previous.secret === undefined) delete process.env.APP_SESSION_SECRET; else process.env.APP_SESSION_SECRET = previous.secret;
});
const url = (path: string) => `https://quotes.example.test${path}`;

describe("public web access", () => {
  it("redirects pages to the login and rejects the API without a session", async () => {
    process.env.APP_ACCESS_PASSWORD = "TEST-long-secret-password";
    const api = await proxy(new NextRequest(url("/api/backend/quotes")));
    expect(api.status).toBe(401);
    expect(api.headers.get("www-authenticate")).toBeNull();
    const page = await proxy(new NextRequest(url("/presupuestos/abc?paso=3")));
    expect(page.status).toBe(307);
    expect(new URL(page.headers.get("location")!).pathname).toBe("/login");
    expect(new URL(page.headers.get("location")!).searchParams.get("next")).toBe("/presupuestos/abc?paso=3");
  });
  it("accepts a valid signed session and still accepts Basic auth for tools", async () => {
    process.env.APP_ACCESS_PASSWORD = "TEST-long-secret-password";
    const token = await createSessionToken(accessConfig()!);
    expect((await proxy(new NextRequest(url("/api/backend/quotes"), { headers: { cookie: `${SESSION_COOKIE}=${token}` } }))).status).toBe(200);
    const basic = Buffer.from("index-clima:TEST-long-secret-password").toString("base64");
    expect((await proxy(new NextRequest(url("/api/backend/quotes"), { headers: { authorization: `Basic ${basic}` } }))).status).toBe(200);
  });
  it("rejects tampered sessions and sessions signed before a password change", async () => {
    process.env.APP_ACCESS_PASSWORD = "TEST-long-secret-password";
    const token = await createSessionToken(accessConfig()!);
    const tampered = token.replace(/\.(\d+)\./, (_m, exp: string) => `.${Number(exp) + 1000}.`);
    expect((await proxy(new NextRequest(url("/api/backend/quotes"), { headers: { cookie: `${SESSION_COOKIE}=${tampered}` } }))).status).toBe(401);
    process.env.APP_ACCESS_PASSWORD = "TEST-a-different-password";
    expect((await proxy(new NextRequest(url("/api/backend/quotes"), { headers: { cookie: `${SESSION_COOKIE}=${token}` } }))).status).toBe(401);
  });
  it("keeps login, health, webhook and app icons reachable", async () => {
    process.env.APP_ACCESS_PASSWORD = "TEST-long-secret-password";
    for (const path of ["/login", "/api/auth/login", "/api/health", "/api/holded-webhook", "/manifest.webmanifest", "/icon.png", "/apple-icon.png"]) {
      expect((await proxy(new NextRequest(url(path)))).status).toBe(200);
    }
  });
  it("does not require a session when no password is configured (local development)", async () => {
    delete process.env.APP_ACCESS_PASSWORD;
    expect((await proxy(new NextRequest(url("/presupuestos")))).status).toBe(200);
  });
});
