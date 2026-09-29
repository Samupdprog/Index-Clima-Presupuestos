import { describe, expect, it } from "vitest";
import { decimalForApi, formatDecimalForInput, parseDecimalText } from "./decimal";
import { formatMoney, formatNumber } from "./format";

describe("decimal input parsing", () => {
  it.each([
    ["13,96", "13.96"], ["13.96", "13.96"], ["1.234,50", "1234.5"], ["1,234.50", "1234.5"], ["1 234,5", "1234.5"],
    ["1.234.567", "1234567"], ["1.234", "1234"], ["0.125", "0.125"], ["13.960", "13960"], ["1234.5", "1234.5"], ["0.000000", "0"], ["5.000000", "5"], ["007", "7"], ["-0,50", "-0.5"], ["-0", "0"],
    [",5", "0.5"], ["12 €", "12"], ["7 %", "7"], ["10.", "10"], [5, "5"],
  ])("parses %s as %s", (input, expected) => expect(parseDecimalText(input)).toBe(expected));

  it.each(["", "   ", "abc", "1,2,3", "1.23.4", "12.34.567", "--1", "1e5", null, undefined])("rejects %s", (input) => expect(parseDecimalText(input as string)).toBeNull());
});

describe("decimal presentation", () => {
  it("formats editable values without useless zeros", () => {
    expect(formatDecimalForInput("0.000000")).toBe("0");
    expect(formatDecimalForInput("5.000000")).toBe("5");
    expect(formatDecimalForInput("13.960000")).toBe("13,96");
    expect(formatDecimalForInput("1234.500000")).toBe("1.234,50");
    expect(formatDecimalForInput("1234")).toBe("1.234");
    expect(formatDecimalForInput("6.983333")).toBe("6,983333");
    expect(formatDecimalForInput("-1500.5")).toBe("-1.500,50");
    expect(formatDecimalForInput("0.5")).toBe("0,50");
    expect(formatDecimalForInput("1.500")).toBe("1,50");
    expect(formatDecimalForInput(null)).toBe("");
  });
  it("round-trips every formatted value", () => {
    for (const value of ["0", "5", "13.96", "1234.5", "1234", "1234567.125", "6.983333", "-0.5"]) {
      expect(parseDecimalText(formatDecimalForInput(value))).toBe(value);
    }
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
