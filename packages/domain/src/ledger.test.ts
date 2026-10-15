import { describe, expect, it } from "vitest";
import {
  bookingBalance,
  canClose,
  cardFeeLine,
  invoiceSubtotal,
  invoiceTotal,
  paymentStatus,
  type LedgerInvoice,
  type LedgerLine,
} from "./ledger";

const boxes: LedgerLine[] = [
  { kind: "charge", quantity: 4, unitPriceCents: 5900 },
  { kind: "charge", quantity: 1, unitPriceCents: 6900 },
];

function issued(id: string, lines: LedgerLine[]): LedgerInvoice {
  return { id, status: "issued", lines };
}

describe("ledger", () => {
  it("totals lines and treats discounts as negative", () => {
    expect(invoiceSubtotal(boxes)).toBe(30500);
    expect(invoiceTotal({ lines: [...boxes, { kind: "discount", quantity: 1, unitPriceCents: 2500 }] })).toBe(28000);
  });

  it("generates the card fee from the subtotal unless waived", () => {
    expect(cardFeeLine(30500, 300, false)).toEqual({ kind: "card_fee", quantity: 1, unitPriceCents: 915 });
    expect(cardFeeLine(30500, 300, true)).toBeNull();
    expect(cardFeeLine(0, 300, false)).toBeNull();
  });

  it("ignores drafts and invoices awaiting review when computing what is owed", () => {
    const ledger = {
      invoices: [issued("a", boxes), { id: "b", status: "pending_review" as const, lines: boxes }],
      payments: [],
    };
    expect(bookingBalance(ledger)).toBe(30500);
  });

  it("derives payment status from rows", () => {
    const invoices = [issued("a", boxes)];
    expect(paymentStatus({ invoices: [], payments: [] })).toBe("none_due");
    expect(paymentStatus({ invoices, payments: [] })).toBe("balance_due");
    expect(
      paymentStatus({ invoices, payments: [{ invoiceId: "a", amountCents: 30500, status: "failed", kind: "charge" }] }),
    ).toBe("past_due");
    expect(
      paymentStatus({ invoices, payments: [{ invoiceId: "a", amountCents: 30500, status: "succeeded", kind: "charge" }] }),
    ).toBe("paid");
    expect(
      paymentStatus({ invoices, payments: [{ invoiceId: "a", amountCents: 40000, status: "succeeded", kind: "charge" }] }),
    ).toBe("credit");
  });

  it("only closes at zero, which a write-off can reach", () => {
    const invoices = [issued("a", boxes)];
    const payments = [{ invoiceId: "a", amountCents: 30000, status: "succeeded" as const, kind: "charge" as const }];
    expect(canClose({ invoices, payments })).toBe(false);
    expect(canClose({ invoices, payments, writeOffs: [{ amountCents: 500 }] })).toBe(true);
    expect(paymentStatus({ invoices, payments, writeOffs: [{ amountCents: 500 }] })).toBe("written_off");
  });
});
