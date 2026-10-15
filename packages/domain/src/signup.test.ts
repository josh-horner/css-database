import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, resolveSettings } from "./settings";
import { claimWindowOpen, confirmationProblems, funnel, isAbandoned, leadPriority, makeReferralCode, referralReward } from "./signup";

describe("confirmation", () => {
  const ok = { serviceCount: 1, fieldErrors: {}, termsAccepted: true, hasPaymentMethod: true, staffWaiver: false, needsGuardian: true, hasGuardian: true };
  it("passes a complete signup", () => expect(confirmationProblems(ok)).toEqual([]));
  it("needs card and terms unless staff waive", () => {
    expect(confirmationProblems({ ...ok, termsAccepted: false, hasPaymentMethod: false })).toHaveLength(2);
    expect(confirmationProblems({ ...ok, termsAccepted: false, hasPaymentMethod: false, staffWaiver: true })).toEqual([]);
  });
  it("needs a guardian for student services", () => expect(confirmationProblems({ ...ok, hasGuardian: false })).toEqual(["Add a parent or guardian contact."]));
});

describe("referrals", () => {
  it("parent referral credits both sides; student referral pays the referrer", () => {
    expect(referralReward(true, DEFAULT_SETTINGS)).toEqual({ kind: "parent", refereeCents: 2500, referrerCents: 2500, referrerRewardKind: "credit" });
    expect(referralReward(false, DEFAULT_SETTINGS)).toEqual({ kind: "student", refereeCents: 1000, referrerCents: 2500, referrerRewardKind: "payout" });
  });
  it("codes are short and readable", () => {
    expect(makeReferralCode("Mary-Kate", () => 0)).toBe("MARYKA-AAAA");
  });
});

describe("funnel and hot leads", () => {
  it("triages by step reached", () => {
    expect(leadPriority("services", false)).toBe("automated");
    expect(leadPriority("people", false)).toBe("low");
    expect(leadPriority("review", false)).toBe("high");
    expect(leadPriority("services", true)).toBe("high");
  });
  it("later steps are abandoned sooner", () => {
    const now = new Date("2027-04-01T15:00:00Z");
    const threeHoursAgo = new Date("2027-04-01T12:00:00Z");
    expect(isAbandoned({ stepReached: "review", lastActivityAt: threeHoursAgo }, now, DEFAULT_SETTINGS)).toBe(true);
    expect(isAbandoned({ stepReached: "services", lastActivityAt: threeHoursAgo }, now, DEFAULT_SETTINGS)).toBe(false);
  });
  it("counts who reached each step", () => {
    expect(funnel(["contact", "services", "review", "done"], ["contact", "services", "review"])).toEqual([
      { step: "contact", reached: 4 },
      { step: "services", reached: 3 },
      { step: "review", reached: 2 },
    ]);
  });
});

describe("claims and settings", () => {
  it("claim window is N days after delivery", () => {
    expect(claimWindowOpen("2027-08-20", "2027-08-27", 7)).toBe(true);
    expect(claimWindowOpen("2027-08-20", "2027-08-28", 7)).toBe(false);
    expect(claimWindowOpen(null, "2027-08-21", 7)).toBe(false);
  });
  it("bad stored settings fall back per key", () => {
    const s = resolveSettings([{ key: "tipDefaultCents", value: 500 }, { key: "claimWindowDays", value: "seven" }]);
    expect(s.tipDefaultCents).toBe(500);
    expect(s.claimWindowDays).toBe(7);
  });
});
