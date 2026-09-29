import { describe, expect, it } from "vitest";
import { decimalForApi, formatDecimalForInput, parseDecimalText } from "./decimal";
import { formatMoney, formatNumber } from "./format";

describe("decimal input parsing", () => {
  it.each([
    ["13,96", "13.96"], ["13.96", "13.96"], ["1.234,50", "1234.5"], ["1,234.50", "1234.5"], ["1 234,5", "1234.5"],
    ["1.234.567", "1234567"], ["0.000000", "0"], ["5.000000", "5"], ["007", "7"], ["-0,50", "-0.5"], ["-0", "0"],
    [",5", "0.5"], ["12 €", "12"], ["7 %", "7"], ["10.", "10"], [5, "5"],
  ])("parses %s as %s", (input, expected) => expect(parseDecimalText(input)).toBe(expected));

  it.each(["", "   ", "abc", "1,2,3", "1.23.4", "--1", "1e5", null, undefined])("rejects %s", (input) => expect(parseDecimalText(input as string)).toBeNull());
});

describe("decimal presentation", () => {
  it("formats editable values without useless zeros", () => {
    expect(formatDecimalForInput("0.000000")).toBe("0");
    expect(formatDecimalForInput("5.000000")).toBe("5");
    expect(formatDecimalForInput("13.960000")).toBe("13,96");
    expect(formatDecimalForInput("1234.500000")).toBe("1234,5");
    expect(formatDecimalForInput(null)).toBe("");
  });
  it("sends canonical strings to the API", () => {
    expect(decimalForApi("1.234,50")).toBe("1234.5");
    expect(decimalForApi("", "0")).toBe("0");
    expect(decimalForApi("x", "7")).toBe("7");
  });
  it("displays money and numbers in Spanish format", () => {
    expect(formatMoney("5.000000")).toMatch(/^5\s€$/);
    expect(formatMoney("13.96")).toMatch(/^13,96\s€$/);
    expect(formatMoney("1234.5")).toMatch(/^1\.234,50\s€$/);
    expect(formatNumber("0.000000")).toBe("0");
  });
});
