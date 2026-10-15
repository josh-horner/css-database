/**
 * Crew tips (docs/domain-model.md#tips): one box per crew member, pre-filled with a default the customer can
 * change. Each employee gets exactly what was entered for them; CSS absorbs the card fee. Never booking revenue.
 */
import { assertCents, sumCents, type Cents } from "./money";

export const DEFAULT_TIP_CENTS = 1000;
export const MAX_TIP_PER_PERSON_CENTS = 50_000;

export interface TipLine {
  employeeId: string;
  amountCents: Cents;
}

export function defaultTipLines(employeeIds: readonly string[], amount = DEFAULT_TIP_CENTS): TipLine[] {
  return employeeIds.map((employeeId) => ({ employeeId, amountCents: amount }));
}

export function validateTip(lines: readonly TipLine[], crewEmployeeIds: readonly string[]): Cents {
  const crew = new Set(crewEmployeeIds);
  for (const line of lines) {
    assertCents(line.amountCents, "tip");
    if (!crew.has(line.employeeId)) throw new Error("Tips can only go to members of the crew on this job");
    if (line.amountCents < 0 || line.amountCents > MAX_TIP_PER_PERSON_CENTS) throw new Error("Tip amount out of range");
  }
  const total = sumCents(lines.map((l) => l.amountCents));
  if (total <= 0) throw new Error("Tip total must be more than $0");
  return total;
}
