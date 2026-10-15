import { describe, expect, it } from "vitest";
import { ContractError, priceContract, readyToApprove, type RateCardItem } from "./contract";

const rateCard: RateCardItem[] = [
  { id: "lg", code: "BOX_L", name: "Large box", unitPriceCents: 5900, active: true },
  { id: "fridge", code: "MINI_FRIDGE", name: "Mini fridge", unitPriceCents: 6900, active: true },
];

describe("digital contract pricing", () => {
  it("prices rate card lines from the rate card", () => {
    const lines = priceContract(
      [
        { rateCardItemId: "lg", description: null, quantity: 4 },
        { rateCardItemId: "fridge", description: "black", quantity: 1 },
      ],
      rateCard,
    );
    expect(lines.map((l) => [l.description, l.quantity, l.unitPriceCents])).toEqual([
      ["Large box", 4, 5900],
      ["Mini fridge: black", 1, 6900],
    ]);
    expect(readyToApprove(lines)).toBe(true);
  });

  it("leaves Other lines unpriced for the owner", () => {
    const lines = priceContract([{ rateCardItemId: null, description: "Kayak", quantity: 1 }], rateCard);
    expect(lines[0]).toMatchObject({ needsPrice: true, unitPriceCents: 0, description: "Kayak" });
    expect(readyToApprove(lines)).toBe(false);
  });

  it("rejects bad lines", () => {
    expect(() => priceContract([{ rateCardItemId: null, description: " ", quantity: 1 }], rateCard)).toThrow(ContractError);
    expect(() => priceContract([{ rateCardItemId: "lg", description: null, quantity: 0 }], rateCard)).toThrow(ContractError);
    expect(() => priceContract([{ rateCardItemId: "nope", description: null, quantity: 1 }], rateCard)).toThrow(ContractError);
  });
});
