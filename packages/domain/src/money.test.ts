import { describe, expect, it } from "vitest";
import { formatCents, parseDollars, percentOf, sumCents } from "./money";

describe("money", () => {
  it("sums integer cents and rejects fractions", () => {
    expect(sumCents([5900, 4900, 3900])).toBe(14700);
    expect(() => sumCents([10.5])).toThrow();
  });

  it("computes a 3% card fee rounded to the cent", () => {
    expect(percentOf(14700, 300)).toBe(441);
    expect(percentOf(1050, 300)).toBe(32); // 31.5 rounds up
    expect(percentOf(-1050, 300)).toBe(-32);
  });

  it("formats and parses dollars", () => {
    expect(formatCents(130000)).toBe("$1,300.00");
    expect(formatCents(-441)).toBe("-$4.41");
    expect(parseDollars("$1,300.5")).toBe(130050);
    expect(parseDollars("59")).toBe(5900);
    expect(parseDollars("5.999")).toBeNull();
  });
});
