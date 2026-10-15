/**
 * Ledger rules (docs/domain-model.md#ledger-built-so-it-cant-drift).
 * Balances are always derived from rows; nothing here reads a stored balance.
 */
import { percentOf, sumCents, type Cents } from "./money";

export type InvoiceStatus = "draft" | "pending_review" | "approved" | "issued" | "paid" | "void";
export type LineKind = "charge" | "adjustment" | "discount" | "card_fee";

export interface LedgerLine {
  kind: LineKind;
  quantity: number;
  unitPriceCents: Cents;
}

export interface LedgerInvoice {
  id: string;
  status: InvoiceStatus;
  lines: readonly LedgerLine[];
}

export interface LedgerPayment {
  invoiceId: string | null;
  amountCents: Cents;
  status: "pending" | "succeeded" | "failed";
  kind: "charge" | "refund";
}

export interface LedgerWriteOff {
  amountCents: Cents;
}

export interface LedgerCredit {
  /** Positive when credit is granted, negative when applied to an invoice. */
  amountCents: Cents;
}

export function lineAmount(line: LedgerLine): Cents {
  if (!Number.isInteger(line.quantity) || line.quantity < 0) throw new Error("quantity must be a non-negative integer");
  const amount = line.quantity * line.unitPriceCents;
  return line.kind === "discount" ? -Math.abs(amount) : amount;
}

export function invoiceSubtotal(lines: readonly LedgerLine[]): Cents {
  return sumCents(lines.filter((l) => l.kind !== "card_fee").map(lineAmount));
}

export function invoiceTotal(invoice: Pick<LedgerInvoice, "lines">): Cents {
  return sumCents(invoice.lines.map(lineAmount));
}

/** The card fee is a rule-generated line, never typed in. Returns null when waived or nothing is owed. */
export function cardFeeLine(subtotal: Cents, basisPoints: number, waived: boolean): LedgerLine | null {
  if (waived || subtotal <= 0 || basisPoints <= 0) return null;
  return { kind: "card_fee", quantity: 1, unitPriceCents: percentOf(subtotal, basisPoints) };
}

/** Only issued (or paid) invoices are owed. Drafts and invoices awaiting review are not. */
export function isOwed(status: InvoiceStatus): boolean {
  return status === "issued" || status === "paid";
}

export interface BookingLedger {
  invoices: readonly LedgerInvoice[];
  payments: readonly LedgerPayment[];
  writeOffs?: readonly LedgerWriteOff[];
}

export function bookingBalance(ledger: BookingLedger): Cents {
  const owed = sumCents(ledger.invoices.filter((i) => isOwed(i.status)).map(invoiceTotal));
  const settled = ledger.payments.filter((p) => p.status === "succeeded");
  const paid = sumCents(settled.filter((p) => p.kind === "charge").map((p) => p.amountCents));
  const refunded = sumCents(settled.filter((p) => p.kind === "refund").map((p) => p.amountCents));
  const writtenOff = sumCents((ledger.writeOffs ?? []).map((w) => w.amountCents));
  return owed - paid + refunded - writtenOff;
}

export function invoiceBalance(invoice: LedgerInvoice, payments: readonly LedgerPayment[]): Cents {
  const mine = payments.filter((p) => p.invoiceId === invoice.id && p.status === "succeeded");
  const paid = sumCents(mine.filter((p) => p.kind === "charge").map((p) => p.amountCents));
  const refunded = sumCents(mine.filter((p) => p.kind === "refund").map((p) => p.amountCents));
  return invoiceTotal(invoice) - paid + refunded;
}

export type PaymentStatus = "none_due" | "balance_due" | "paid" | "past_due" | "credit" | "written_off";

/** Derived, never hand-set. `past_due` = money owed and the most recent charge attempt failed. */
export function paymentStatus(ledger: BookingLedger): PaymentStatus {
  const balance = bookingBalance(ledger);
  const anyOwed = ledger.invoices.some((i) => isOwed(i.status));
  if ((ledger.writeOffs ?? []).length > 0 && balance === 0) return "written_off";
  if (balance < 0) return "credit";
  if (balance === 0) return anyOwed ? "paid" : "none_due";
  const charges = ledger.payments.filter((p) => p.kind === "charge");
  const last = charges.at(-1);
  return last?.status === "failed" ? "past_due" : "balance_due";
}

/** A booking can only close at exactly zero (a write-off can get it there; owner only). */
export function canClose(ledger: BookingLedger): boolean {
  return bookingBalance(ledger) === 0;
}
