import { describe, expect, it } from "vitest";
import { defaultTipLines, validateTip } from "./tips";

describe("tips", () => {
  it("seeds one box per crew member", () => {
    expect(defaultTipLines(["a", "b"])).toEqual([
      { employeeId: "a", amountCents: 1000 },
      { employeeId: "b", amountCents: 1000 },
    ]);
  });
  it("lets the customer change amounts per person and returns the total", () => {
    expect(validateTip([{ employeeId: "a", amountCents: 2000 }, { employeeId: "b", amountCents: 0 }], ["a", "b"])).toBe(2000);
  });
  it("rejects tips to people not on the crew, or nothing at all", () => {
    expect(() => validateTip([{ employeeId: "z", amountCents: 500 }], ["a"])).toThrow();
    expect(() => validateTip([{ employeeId: "a", amountCents: 0 }], ["a"])).toThrow();
  });
});
