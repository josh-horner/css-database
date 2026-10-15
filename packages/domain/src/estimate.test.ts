import { describe, expect, it } from "vitest";
import { estimateBooking } from "./estimate";

const priceList = [
  { code: "IN_ROOM", name: "In-room pick-up", unitPriceCents: 7500 },
  { code: "SHIP_BOX", name: "Ship a box", unitPriceCents: 4500 },
  { code: "BIKE", name: "Bike", unitPriceCents: 7900 },
];

describe("estimate", () => {
  it("charges the deposit today and prices answers from the rate card", () => {
    const est = estimateBooking({
      services: [
        { id: "a", name: "Summer storage", chargesDeposit: true, baseRateCardCode: null, fields: [] },
        { id: "b", name: "In-room pickup", chargesDeposit: false, baseRateCardCode: "IN_ROOM", fields: [] },
        {
          id: "c",
          name: "Shipping",
          chargesDeposit: false,
          baseRateCardCode: null,
          fields: [
            { key: "boxes", type: "number", label: "Boxes", required: true, sortOrder: 0, config: { rateCardCode: "SHIP_BOX" } },
            { key: "bike", type: "yes_no", label: "Bike?", required: false, sortOrder: 1, config: { rateCardCode: "BIKE" } },
          ],
        },
      ],
      answers: { boxes: 3, bike: false },
      priceList,
      depositCents: 5900,
      discounts: [{ description: "Referral", amountCents: 1000 }],
    });
    expect(est.depositCents).toBe(5900);
    expect(est.lines.map((l) => l.description)).toEqual(["In-room pick-up", "Ship a box", "Referral"]);
    expect(est.laterCents).toBe(7500 + 3 * 4500 - 1000);
    expect(est.itemsPricedAtPickup).toBe(true);
  });

  it("no deposit when no service charges one", () => {
    const est = estimateBooking({ services: [{ id: "x", name: "IKEA", chargesDeposit: false, baseRateCardCode: null, fields: [] }], answers: {}, priceList, depositCents: 5900 });
    expect(est.depositCents).toBe(0);
    expect(est.itemsPricedAtPickup).toBe(false);
  });
});
