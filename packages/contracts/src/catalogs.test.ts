import { describe, expect, it } from "vitest";
import { catalogMutationSchema } from "./catalogs.js";
describe("catalog inputs", () => {
  it("rejects ownership injection, unknown fields and negative money", () => {
    expect(catalogMutationSchema("materials", true).safeParse({ installationId: "other" }).success).toBe(false);
    expect(catalogMutationSchema("employees").safeParse({ name: "TEST", costRate: "-2" }).success).toBe(false);
  });
  it("accepts text templates without a fake name field", () => {
    expect(catalogMutationSchema("text-templates").safeParse({ title: "Condiciones", body: "Texto" }).success).toBe(true);
  });
});
