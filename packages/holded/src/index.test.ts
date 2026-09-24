import { describe, expect, it, vi } from "vitest";
import { createHoldedClient, HoldedApiError, type HoldedEstimateInput } from "./index.js";

const estimate: HoldedEstimateInput = {
  reference: "P-12",
  title: "Climatización",
  date: 1_700_000_000,
  contactName: "Cliente de prueba",
  items: [{ name: "Equipo", units: 1, price: 850.25, tax: 7 }],
};

describe("Holded estimate adapter", () => {
  it("creates an estimate and returns its remote id", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ id: "estimate-1" }), { status: 201, headers: { "content-type": "application/json" } }));
    const result = await createHoldedClient("secret", fetcher).saveEstimate(estimate);
    expect(result.id).toBe("estimate-1");
    expect(fetcher).toHaveBeenCalledWith("https://api.holded.com/api/invoicing/v1/documents/estimate", expect.objectContaining({ method: "POST", headers: expect.objectContaining({ key: "secret" }) }));
  });

  it("updates the linked estimate instead of creating a duplicate", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }));
    const result = await createHoldedClient("secret", fetcher).saveEstimate({ ...estimate, documentId: "estimate-1" });
    expect(result.id).toBe("estimate-1");
    expect(fetcher).toHaveBeenCalledWith("https://api.holded.com/api/invoicing/v1/documents/estimate/estimate-1", expect.objectContaining({ method: "PUT" }));
  });

  it("surfaces remote failures without inventing a document id", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: "invalid" }), { status: 400, headers: { "content-type": "application/json" } }));
    await expect(createHoldedClient("secret", fetcher).saveEstimate(estimate)).rejects.toBeInstanceOf(HoldedApiError);
  });
});
