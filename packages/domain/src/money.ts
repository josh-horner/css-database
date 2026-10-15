/** All money is integer cents. These helpers keep it that way. */

export type Cents = number;

export function assertCents(value: number, label = "amount"): Cents {
  if (!Number.isSafeInteger(value)) throw new Error(`${label} must be integer cents, got ${value}`);
  return value;
}

export function sumCents(values: readonly Cents[]): Cents {
  return values.reduce((total, v) => total + assertCents(v), 0);
}

/** Basis points of an amount, rounded half away from zero (3% = 300 bps). */
export function percentOf(amount: Cents, basisPoints: number): Cents {
  assertCents(amount);
  const raw = (amount * basisPoints) / 10_000;
  return Math.sign(raw) * Math.round(Math.abs(raw));
}

export function formatCents(amount: Cents): string {
  const sign = amount < 0 ? "-" : "";
  const abs = Math.abs(assertCents(amount));
  const dollars = Math.floor(abs / 100).toLocaleString("en-US");
  return `${sign}$${dollars}.${String(abs % 100).padStart(2, "0")}`;
}

/** Parse a user-typed dollar string ("59", "$1,300.50") into cents. Returns null when invalid. */
export function parseDollars(input: string): Cents | null {
  const cleaned = input.replace(/[$,\s]/g, "");
  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, frac = ""] = cleaned.replace("-", "").split(".");
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return cleaned.startsWith("-") ? -cents : cents;
}
