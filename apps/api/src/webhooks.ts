import { createHmac, timingSafeEqual } from "node:crypto";
export function verifyHoldedWebhook(raw: Buffer, signature: string, secret: string | undefined) {
  if (!secret || !/^sha256=[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = createHmac("sha256", secret).update(raw).digest();
  return timingSafeEqual(expected, Buffer.from(signature.slice(7), "hex"));
}
