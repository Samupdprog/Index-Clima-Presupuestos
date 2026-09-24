import { describe, expect, it } from "vitest";
import type { HoldedContact } from "./contracts.js";
import { isClientContact } from "./contracts.js";
import {
  holdedContactToLocalClient,
  localClientToHoldedCreate,
  mergeLocalChangesIntoHoldedContact,
} from "./mapping.js";
import { maskApiKey } from "./index.js";

describe("holdedContactToLocalClient (v2 snake_case)", () => {
  it("maps a realistic v2 contact (code as taxId, mobile fallback, bill_address.address)", () => {
    const contact: HoldedContact = {
      id: "6a0c55d7c3041780a5084e3e",
      name: "Andrea",
      code: "B12345678",
      vat_number: null,
      email: null,
      mobile: "+34600111222",
      phone: null,
      type: "client",
      bill_address: { address: "Chamizo 18", city: "La Victoria", postal_code: "", country: "España - Islas Canarias", country_code: "ES_CANARY" },
    };
    expect(holdedContactToLocalClient(contact)).toEqual({
      name: "Andrea",
      taxId: "B12345678",
      email: null,
      phone: "+34600111222",
      address: "Chamizo 18",
    });
  });

  it("falls back to vat_number only when code is empty", () => {
    const contact: HoldedContact = { id: "c1", name: "X", code: "", vat_number: "ESB999", type: "client" };
    expect(holdedContactToLocalClient(contact).taxId).toBe("ESB999");
  });

  it("prefers phone over mobile when both exist", () => {
    const contact: HoldedContact = { id: "c1", name: "X", phone: "111", mobile: "222", type: "client" };
    expect(holdedContactToLocalClient(contact).phone).toBe("111");
  });
});

describe("localClientToHoldedCreate", () => {
  it("builds a client-typed snake_case body with only defined fields", () => {
    expect(localClientToHoldedCreate({ name: "  Nuevo  ", taxId: "X1", email: "", address: "Calle 2" })).toEqual({
      name: "Nuevo",
      type: "client",
      code: "X1",
      bill_address: { address: "Calle 2" },
    });
  });
});

describe("mergeLocalChangesIntoHoldedContact — full replacement safety", () => {
  const remote: HoldedContact = {
    id: "c1",
    name: "ACME",
    code: "B1",
    vat_number: "ESB1",
    email: "old@acme.test",
    phone: "111",
    mobile: "999",
    type: "supplier",
    iban: "ES1234",
    tags: ["vip"],
    contact_persons: [{ name: "Ana" }],
    bill_address: { address: "Old", city: "Madrid", postal_code: "28001", country_code: "ES" },
  } as HoldedContact;

  it("editing email keeps every unknown remote field intact", () => {
    const merged = mergeLocalChangesIntoHoldedContact(remote, { email: "new@acme.test" });
    expect(merged.email).toBe("new@acme.test");
    expect(merged.vat_number).toBe("ESB1");
    expect(merged.mobile).toBe("999");
    expect(merged.iban).toBe("ES1234");
    expect(merged.tags).toEqual(["vip"]);
    expect(merged.contact_persons).toEqual([{ name: "Ana" }]);
    // No cambiamos el tipo (no convertir proveedor en cliente):
    expect(merged.type).toBe("supplier");
    // id no viaja en el cuerpo del PUT:
    expect(merged.id).toBeUndefined();
  });

  it("editing address preserves city/postal_code/country not managed locally", () => {
    const merged = mergeLocalChangesIntoHoldedContact(remote, { address: "Nueva Calle 5" });
    expect(merged.bill_address).toEqual({ address: "Nueva Calle 5", city: "Madrid", postal_code: "28001", country_code: "ES" });
  });

  it("writes taxId to code and leaves vat_number untouched", () => {
    const merged = mergeLocalChangesIntoHoldedContact(remote, { taxId: "B999" });
    expect(merged.code).toBe("B999");
    expect(merged.vat_number).toBe("ESB1");
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
  it("shows only the last 4 characters using real bullet characters", () => {
    const masked = maskApiKey("abcd1234efgh5678");
    expect(masked).toBe("••••••••••••5678");
    expect(masked).not.toContain("â"); // sin mojibake â¢
  });
  it("returns null for empty input", () => {
    expect(maskApiKey("")).toBeNull();
    expect(maskApiKey(null)).toBeNull();
  });
});
