import { describe, expect, it } from "vitest";
import { allowedAiRequest, authenticateService, dataResetAllowed } from "./access.js";

describe("internal API access", () => {
  it("fails closed without a strong configured service token", () => {
    expect(authenticateService({}, undefined, "one")).toHaveProperty("status", 503);
    expect(authenticateService({}, "service-secret", "one")).toHaveProperty("status", 401);
    expect(authenticateService({ authorization: "Bearer wrong" }, "service-secret", "one")).toHaveProperty("status", 401);
  });
  it("checks installation and preserves the authenticated AI actor", () => {
    const headers = { authorization: "Bearer service-secret", "x-actor-type": "ai", "x-actor-id": "assistant" };
    expect(authenticateService(headers, "service-secret", "one")).toHaveProperty("actor.actorType", "ai");
    expect(authenticateService({ ...headers, "x-installation-id": "two" }, "service-secret", "one")).toHaveProperty("status", 403);
  });
  it("enforces scopes and excludes settings/reset even with all scopes", () => {
    expect(allowedAiRequest("POST", ["quotes", "id", "holded"], "quotes:write")).toBe(false);
    expect(allowedAiRequest("POST", ["quotes", "id", "adjustments", "preview"], "quotes:read")).toBe(true);
    expect(allowedAiRequest("POST", ["settings", "data-reset"], "quotes:write holded:write")).toBe(false);
    expect(allowedAiRequest("GET", ["holded", "settings"], "holded:read")).toBe(false);
  });
  it("requires server opt-in, user actor and both reset confirmations", () => {
    const input = { confirmation: "BORRAR DATOS", confirmed: true };
    expect(dataResetAllowed({}, "user", input)).toBe(false);
    expect(dataResetAllowed({ ALLOW_DATA_RESET: "true" }, "ai", input)).toBe(false);
    expect(dataResetAllowed({ ALLOW_DATA_RESET: "true" }, "user", { confirmation: "BORRAR DATOS" })).toBe(false);
    expect(dataResetAllowed({ ALLOW_DATA_RESET: "true" }, "user", input)).toBe(true);
  });
});
