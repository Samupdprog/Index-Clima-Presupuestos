import { createHmac } from "node:crypto";
import { expect, it } from "vitest";
import { verifyHoldedWebhook } from "./webhooks.js";
it("verifies raw-body HMAC and rejects altered bodies/signatures", () => {
  const raw = Buffer.from('{"id":"TEST"}'); const secret = "test-secret";
  const signature = `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
  expect(verifyHoldedWebhook(raw, signature, secret)).toBe(true);
  expect(verifyHoldedWebhook(Buffer.from('{ "id":"TEST"}'), signature, secret)).toBe(false);
  expect(verifyHoldedWebhook(raw, "sha256=no", secret)).toBe(false);
  expect(verifyHoldedWebhook(raw, signature, undefined)).toBe(false);
});
