import { describe, expect, it } from "vitest";
import { nextConfirmationNumber } from "./confirmation";

describe("confirmation numbers", () => {
  it("starts at 100", () => expect(nextConfirmationNumber([])).toBe(100));
  it("fills the lowest gap (a cancelled number is reused)", () => expect(nextConfirmationNumber([100, 101, 103])).toBe(102));
  it("skips numbers still on the shelf from earlier seasons", () =>
    expect(nextConfirmationNumber([100, 101], [102, 104])).toBe(103));
  it("grows past three digits when it has to", () =>
    expect(nextConfirmationNumber(Array.from({ length: 900 }, (_, i) => i + 100))).toBe(1000));
});
