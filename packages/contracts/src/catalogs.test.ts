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

describe("material import rows", () => {
  it("accepts only catalog IGIC rates and keeps unit and IGIC optional", async () => {
    const { materialImportRowSchema } = await import("./catalogs.js");
    for (const igicRate of ["0", "3", "7", "15", "7.00", "15,0"]) expect(materialImportRowSchema.safeParse({ name: "Tubo", igicRate }).success).toBe(true);
    for (const igicRate of ["21", "0.07", "7%", "-7"]) expect(materialImportRowSchema.safeParse({ name: "Tubo", igicRate }).success).toBe(false);
    expect(materialImportRowSchema.parse({ name: "Tubo" })).toEqual({ name: "Tubo" });
  });
});
