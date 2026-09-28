import { describe, expect, it } from "vitest";
import { createHoldedEstimateGateway } from "./holded-estimate-gateway.js";
import type { HoldedClient } from "@quotes/holded";
describe("live Holded numeric response normalization", () => {
  it("accepts comma decimal strings without using JS arithmetic", async () => {
    const gateway = createHoldedEstimateGateway({ getEstimate: async () => ({ id: "TEST", contact_id: "contact", subtotal: "6049,38", tax: "423,46", total: "6472,84", lines: [{ name: "Machine", price: "1350,93", units: "1,00", discount: "0,00", tax: "0", taxes: ["s_igic_7"] }] }) } as unknown as HoldedClient);
    const result = await gateway.getEstimate("TEST");
    expect(result.subtotal).toBe("6049.38"); expect(result.lines[0]?.price).toBe("1350.93"); expect(result.lines[0]?.taxes).toEqual(["s_igic_7"]);
  });
});
