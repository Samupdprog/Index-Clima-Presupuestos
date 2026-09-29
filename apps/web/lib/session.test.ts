import { describe, expect, it } from "vitest";
import { accessConfig, createSessionToken, credentialsMatch, requestIsAuthorized, safeNextPath, SESSION_COOKIE, SESSION_MAX_AGE_SECONDS, verifySessionToken } from "./session";

const config = accessConfig({ APP_ACCESS_PASSWORD: "TEST-password-1234", APP_ACCESS_USERNAME: "index-clima", INTERNAL_SERVICE_TOKEN: "x".repeat(40) })!;

describe("web session", () => {
  it("is disabled without a password", () => expect(accessConfig({})).toBeNull());
  it("issues 30-day tokens that verify until they expire", async () => {
    const now = 1_800_000_000;
    const token = await createSessionToken(config, now);
    expect(await verifySessionToken(config, token, now + 60)).toBe(now + SESSION_MAX_AGE_SECONDS);
    expect(await verifySessionToken(config, token, now + SESSION_MAX_AGE_SECONDS + 1)).toBeNull();
  });
  it("rejects malformed, tampered or foreign tokens", async () => {
    const token = await createSessionToken(config);
    const other = accessConfig({ APP_ACCESS_PASSWORD: "otra-password-9999" })!;
    for (const value of [undefined, "", "v1.1.2", `${token}x`, token.replace("v1.", "v2."), token.replace(/\.[^.]+$/, ".AAAA")]) expect(await verifySessionToken(config, value)).toBeNull();
    expect(await verifySessionToken(other, token)).toBeNull();
    expect(token).not.toContain("TEST-password");
  });
  it("checks credentials exactly and only redirects to internal paths", () => {
    expect(credentialsMatch(config, "index-clima", "TEST-password-1234")).toBe(true);
    expect(credentialsMatch(config, "index-clima", "TEST-password-123")).toBe(false);
    expect(credentialsMatch(config, "otro", "TEST-password-1234")).toBe(false);
    for (const [input, expected] of [["/presupuestos/1", "/presupuestos/1"], ["//evil.com", "/presupuestos"], ["https://evil.com", "/presupuestos"], ["/\\evil", "/presupuestos"], ["/login", "/presupuestos"], [null, "/presupuestos"]] as const) expect(safeNextPath(input)).toBe(expected);
  });
  it("authorizes server routes only with a valid session or Basic credentials", async () => {
    const env = { APP_ACCESS_PASSWORD: "TEST-password-1234", APP_ACCESS_USERNAME: "index-clima", INTERNAL_SERVICE_TOKEN: "x".repeat(40) };
    const request = (cookie?: string, authorization?: string) => ({
      headers: new Headers(authorization ? { authorization } : {}),
      cookies: { get: (name: string) => (name === SESSION_COOKIE && cookie ? { value: cookie } : undefined) },
    });
    expect(await requestIsAuthorized(request(), {})).toBe(true);
    expect(await requestIsAuthorized(request(), env)).toBe(false);
    expect(await requestIsAuthorized(request("v1.9999999999.forged.sig"), env)).toBe(false);
    expect(await requestIsAuthorized(request(await createSessionToken(config)), env)).toBe(true);
    expect(await requestIsAuthorized(request(undefined, `Basic ${btoa("index-clima:TEST-password-1234")}`), env)).toBe(true);
    expect(await requestIsAuthorized(request(undefined, `Basic ${btoa("index-clima:wrong")}`), env)).toBe(false);
    expect(await requestIsAuthorized(request(undefined, "Basic %%%"), env)).toBe(false);
  });
});
