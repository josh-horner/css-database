import { describe, expect, it } from "vitest";
import { addDays, assertCanReserve, availableSlots, CapacityError, dateRange } from "./capacity";

const day = (id: string, date: string, extra: Partial<Parameters<typeof availableSlots>[0][number]> = {}) => ({
  id,
  date,
  windowId: "AM",
  campusScope: "both" as const,
  capacity: 2,
  blocked: false,
  ...extra,
});

describe("capacity", () => {
  it("shows only open windows past the lead time, matching campus", () => {
    const days = [day("a", "2027-05-01"), day("b", "2027-05-03"), day("c", "2027-05-04", { blocked: true }), day("d", "2027-05-05", { campusScope: "off" }), day("e", "2027-05-06")];
    const reserved = new Map([["e", 2]]);
    const slots = availableSlots(days, reserved, { today: "2027-05-01", leadDays: 2, campus: "on" });
    expect(slots.map((s) => s.id)).toEqual(["b"]);
    expect(slots[0]!.remaining).toBe(2);
  });

  it("staff see everything, including full and blocked windows", () => {
    const slots = availableSlots([day("a", "2027-05-01", { blocked: true })], new Map([["a", 5]]), { today: "2027-05-01", leadDays: 2, campus: null, staff: true });
    expect(slots).toHaveLength(1);
    expect(slots[0]!.remaining).toBe(0);
  });

  it("refuses a full window unless overridden with a reason", () => {
    expect(() => assertCanReserve({ capacity: 2, blocked: false }, 2, null)).toThrow(CapacityError);
    expect(assertCanReserve({ capacity: 2, blocked: false }, 2, { reason: "Owner OK'd by phone" })).toEqual({ overbooked: true });
    expect(assertCanReserve({ capacity: 2, blocked: false }, 1, null)).toEqual({ overbooked: false });
  });

  it("date helpers", () => {
    expect(addDays("2027-02-28", 1)).toBe("2027-03-01");
    expect(dateRange("2027-05-01", "2027-05-04", [0])).toEqual(["2027-05-01", "2027-05-03", "2027-05-04"]); // 05-02 is a Sunday
  });
});
