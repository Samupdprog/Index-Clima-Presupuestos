import { describe, expect, it } from "vitest";
import type { HoldedContact } from "./contracts.js";
import { isClientContact } from "./contracts.js";
import {
  holdedContactToLocalClient,
  localClientToHoldedCreate,
  mergeLocalChangesIntoHoldedContact,
} from "./mapping.js";
import { maskApiKey } from "./index.js";

describe("holdedContactToLocalClient", () => {
  it("maps the controlled fields and falls back to mobile for phone", () => {
    const contact: HoldedContact = {
      id: "c1",
      name: "ACME S.L.",
      code: "B12345678",
      email: "info@acme.test",
      mobile: "+34600111222",
      billAddress: { address: "Calle Mayor 1", city: "Madrid" },
    };
    expect(holdedContactToLocalClient(contact)).toEqual({
      name: "ACME S.L.",
      taxId: "B12345678",
      email: "info@acme.test",
      phone: "+34600111222",
      address: "Calle Mayor 1",
    });
  });
});

describe("localClientToHoldedCreate", () => {
  it("builds a client-typed create body with only defined fields", () => {
    expect(localClientToHoldedCreate({ name: "  Nuevo  ", taxId: "X1", email: "" })).toEqual({
      name: "Nuevo",
      type: "client",
      code: "X1",
    });
  });
});

describe("mergeLocalChangesIntoHoldedContact — full replacement safety", () => {
  const remote: HoldedContact = {
    id: "c1",
    name: "ACME",
    code: "B1",
    email: "old@acme.test",
    phone: "111",
    type: "supplier",
    iban: "ES1234",
    tags: ["vip"],
    contactPersons: [{ name: "Ana" }],
    billAddress: { address: "Old", city: "Madrid", postalCode: "28001" },
  } as HoldedContact;

  it("editing email keeps every unknown remote field intact", () => {
    const merged = mergeLocalChangesIntoHoldedContact(remote, { email: "new@acme.test" });
    // Campo controlado cambiado:
    expect(merged.email).toBe("new@acme.test");
    // Campos desconocidos preservados:
    expect(merged.iban).toBe("ES1234");
    expect(merged.tags).toEqual(["vip"]);
    expect(merged.contactPersons).toEqual([{ name: "Ana" }]);
    // No cambiamos el tipo (no convertir proveedor en cliente):
    expect(merged.type).toBe("supplier");
    // id no viaja en el cuerpo del PUT:
    expect(merged.id).toBeUndefined();
  });

  it("editing address preserves city/postalCode not managed locally", () => {
    const merged = mergeLocalChangesIntoHoldedContact(remote, { address: "Nueva Calle 5" });
    expect(merged.billAddress).toEqual({ address: "Nueva Calle 5", city: "Madrid", postalCode: "28001" });
  });

  it("does not mutate the original remote contact object", () => {
    const snapshot = JSON.parse(JSON.stringify(remote));
    mergeLocalChangesIntoHoldedContact(remote, { name: "Otro", address: "Z" });
    expect(remote).toEqual(snapshot);
  });

  it("clearing a field sends an empty string (explicit), never drops the key", () => {
    const merged = mergeLocalChangesIntoHoldedContact(remote, { taxId: null });
    expect(merged.code).toBe("");
  });
});

describe("isClientContact", () => {
  it("accepts clients, debtors, leads and typeless contacts", () => {
    expect(isClientContact({ type: "client" })).toBe(true);
    expect(isClientContact({ type: "debtor" })).toBe(true);
    expect(isClientContact({ type: "lead" })).toBe(true);
    expect(isClientContact({})).toBe(true);
  });
  it("rejects suppliers and creditors", () => {
    expect(isClientContact({ type: "supplier" })).toBe(false);
    expect(isClientContact({ type: "creditor" })).toBe(false);
  });
});

describe("maskApiKey", () => {
  it("shows only the last 4 characters", () => {
    expect(maskApiKey("abcd1234efgh5678")).toBe("••••••••••••5678");
  });
  it("returns null for empty input", () => {
    expect(maskApiKey("")).toBeNull();
    expect(maskApiKey(null)).toBeNull();
  });
});
