/**
 * Signup rules: what a booking needs before it can be confirmed, referral rewards, funnel triage,
 * and claim windows (docs/features/signup-funnel.md, docs/domain-model.md).
 */
import type { Cents } from "./money";
import { addDays } from "./capacity";
import { stepIndex, type WizardStep } from "./fields";
import type { Settings } from "./settings";

export interface ConfirmInput {
  serviceCount: number;
  fieldErrors: Record<string, string>;
  termsAccepted: boolean;
  hasPaymentMethod: boolean;
  /** Staff created it without a card (customer pays by link). */
  staffWaiver: boolean;
  needsGuardian: boolean;
  hasGuardian: boolean;
}

/** Problems that block confirmation, in the customer's words. Empty = OK. */
export function confirmationProblems(input: ConfirmInput): string[] {
  const out: string[] = [];
  if (input.serviceCount === 0) out.push("Pick at least one service.");
  if (Object.keys(input.fieldErrors).length) out.push("Some answers are missing or need fixing.");
  if (input.needsGuardian && !input.hasGuardian && !input.staffWaiver) out.push("Add a parent or guardian contact.");
  if (!input.staffWaiver) {
    if (!input.termsAccepted) out.push("Please accept the terms.");
    if (!input.hasPaymentMethod) out.push("Add a card for the deposit.");
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Referrals (keep legacy's rules; config in settings)

export interface ReferralReward {
  kind: "parent" | "student";
  refereeCents: Cents;
  referrerCents: Cents;
  referrerRewardKind: "credit" | "payout";
}

/** Parent referral: both sides get a credit. Student referral: referee gets money off, referrer a payout. */
export function referralReward(signerIsGuardian: boolean, settings: Pick<Settings, "referralParentRewardCents" | "referralStudentRefereeCents" | "referralStudentReferrerCents">): ReferralReward {
  if (signerIsGuardian) {
    return { kind: "parent", refereeCents: settings.referralParentRewardCents, referrerCents: settings.referralParentRewardCents, referrerRewardKind: "credit" };
  }
  return { kind: "student", refereeCents: settings.referralStudentRefereeCents, referrerCents: settings.referralStudentReferrerCents, referrerRewardKind: "payout" };
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Short, speakable personal code, e.g. MAYA-7K2Q. */
export function makeReferralCode(firstName: string, random: () => number = Math.random): string {
  const name = firstName.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 6) || "CSS";
  let suffix = "";
  for (let i = 0; i < 4; i++) suffix += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  return `${name}-${suffix}`;
}

export function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, "");
}

// ---------------------------------------------------------------------------------------------
// Funnel and hot leads

export type LeadPriority = "high" | "low" | "automated";

/** Triage by how far they got (owner does the follow-up himself). */
export function leadPriority(stepReached: string, cardFailed: boolean): LeadPriority {
  if (cardFailed || stepIndex(stepReached) >= stepIndex("review")) return "high";
  if (stepIndex(stepReached) >= stepIndex("school")) return "low";
  return "automated";
}

/** Idle threshold depends on how far they got: later steps are chased sooner. */
export function isAbandoned(
  draft: { stepReached: string; lastActivityAt: Date | null },
  now: Date,
  settings: Pick<Settings, "abandonAfterHoursEarly" | "abandonAfterHoursLate">,
): boolean {
  if (!draft.lastActivityAt) return false;
  const late = stepIndex(draft.stepReached) >= stepIndex("people" satisfies WizardStep);
  const hours = late ? settings.abandonAfterHoursLate : settings.abandonAfterHoursEarly;
  return now.getTime() - draft.lastActivityAt.getTime() >= hours * 3_600_000;
}

export interface FunnelRow {
  step: string;
  reached: number;
}

/** Counts of drafts/bookings that reached at least each step. */
export function funnel(stepsReached: readonly string[], steps: readonly string[]): FunnelRow[] {
  return steps.map((step) => ({ step, reached: stepsReached.filter((s) => stepIndex(s) >= stepIndex(step)).length }));
}

// ---------------------------------------------------------------------------------------------
// Claims

/** Customers can file a claim within N days after delivery. */
export function claimWindowOpen(deliveredOn: string | null, today: string, days: number): boolean {
  if (!deliveredOn) return false;
  return today >= deliveredOn && today <= addDays(deliveredOn, days);
}

export const CHARGE_AUTHORIZATION_VERSION = "2027-01";

export function chargeAuthorizationText(depositCents: Cents): string {
  const deposit = `$${(depositCents / 100).toFixed(depositCents % 100 ? 2 : 0)}`;
  return depositCents > 0
    ? `Your card will be charged the ${deposit} deposit now. By signing up you authorize CSS to charge this card for your remaining balance after pickup and for any services or fees you add.`
    : "Your card won't be charged now. By signing up you authorize CSS to charge this card for your balance after service and for any services or fees you add.";
}
