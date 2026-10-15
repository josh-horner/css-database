/**
 * Approval is the billing schedule: approving an invoice issues it and charges the card on file at once.
 * Declines start the automatic follow-up, then the owner's Collections list
 * (docs/domain-model.md#billing-timing-and-collections).
 */
import { randomBytes } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, inArray, lte, schema, type DbOrTx } from "@css/db";
import {
  bookingBalance,
  cardFeeLine,
  invoiceTotal,
  isOwed,
  paymentStatus,
  formatCents,
  invoiceBalance,
  invoiceSubtotal,
  nextCollectionsStep,
  readyToApprove,
  type LedgerInvoice,
  type LedgerPayment,
} from "@css/domain";
import type { Services } from "../context";
import { audit } from "./audit";
import { emailBooking, smsBooking } from "./messaging";

export async function loadInvoice(services: Services, invoiceId: string) {
  const { db } = services;
  const [invoice] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, invoiceId)).limit(1);
  if (!invoice) throw new TRPCError({ code: "NOT_FOUND", message: "Invoice not found" });
  const lines = await db.select().from(schema.invoiceLines).where(eq(schema.invoiceLines.invoiceId, invoiceId)).orderBy(asc(schema.invoiceLines.createdAt));
  const payments = await db.select().from(schema.payments).where(eq(schema.payments.invoiceId, invoiceId)).orderBy(asc(schema.payments.createdAt));
  return { invoice, lines, payments };
}

function asLedger(invoice: { id: string; status: LedgerInvoice["status"] }, lines: { kind: LedgerInvoice["lines"][number]["kind"]; quantity: number; unitPriceCents: number }[]): LedgerInvoice {
  return { id: invoice.id, status: invoice.status, lines };
}

function asLedgerPayments(payments: (typeof schema.payments.$inferSelect)[]): LedgerPayment[] {
  return payments.map((p) => ({ invoiceId: p.invoiceId, amountCents: p.amountCents, status: p.status, kind: p.kind }));
}

/** Owner sets a price on an "Other" line (or corrects a quantity) while the invoice is still in review. */
export async function updateDraftLine(
  services: Services,
  staffId: string,
  lineId: string,
  patch: { unitPriceCents?: number; quantity?: number; description?: string },
) {
  const { db } = services;
  const [line] = await db.select().from(schema.invoiceLines).where(eq(schema.invoiceLines.id, lineId)).limit(1);
  if (!line) throw new TRPCError({ code: "NOT_FOUND" });
  const { invoice } = await loadInvoice(services, line.invoiceId);
  if (invoice.status !== "pending_review" && invoice.status !== "draft")
    throw new TRPCError({ code: "BAD_REQUEST", message: "Issued invoices can't be edited; add an adjustment instead" });
  const next = {
    unitPriceCents: patch.unitPriceCents ?? line.unitPriceCents,
    quantity: patch.quantity ?? line.quantity,
    description: patch.description ?? line.description,
    needsPrice: patch.unitPriceCents !== undefined ? false : line.needsPrice,
  };
  if (!Number.isInteger(next.unitPriceCents) || next.unitPriceCents < 0) throw new TRPCError({ code: "BAD_REQUEST", message: "Price must be whole cents" });
  if (!Number.isInteger(next.quantity) || next.quantity < 1) throw new TRPCError({ code: "BAD_REQUEST", message: "Quantity must be at least 1" });
  await db.update(schema.invoiceLines).set(next).where(eq(schema.invoiceLines.id, lineId));
  await audit(db, { type: "staff", id: staffId }, "invoice_line", lineId, "edited", line, next);
}

export async function approveInvoice(services: Services, staffId: string, invoiceId: string) {
  const { db } = services;
  await db.transaction(async (tx) => {
    const [invoice] = await tx.select().from(schema.invoices).where(eq(schema.invoices.id, invoiceId)).for("update");
    if (!invoice) throw new TRPCError({ code: "NOT_FOUND" });
    if (invoice.status !== "pending_review" && invoice.status !== "draft")
      throw new TRPCError({ code: "BAD_REQUEST", message: `Invoice is already ${invoice.status}` });
    const lines = await tx.select().from(schema.invoiceLines).where(eq(schema.invoiceLines.invoiceId, invoiceId));
    if (!readyToApprove(lines)) throw new TRPCError({ code: "BAD_REQUEST", message: "Every line needs a price before approval" });

    const [booking] = await tx.select().from(schema.bookings).where(eq(schema.bookings.id, invoice.bookingId));
    const [season] = await tx.select().from(schema.seasons).where(eq(schema.seasons.id, booking!.seasonId));
    const fee = cardFeeLine(invoiceSubtotal(lines), season!.cardFeeBps, invoice.waiveCardFee);
    if (fee) {
      await tx.insert(schema.invoiceLines).values({
        invoiceId,
        kind: "card_fee",
        description: `Card processing fee (${season!.cardFeeBps / 100}%)`,
        quantity: fee.quantity,
        unitPriceCents: fee.unitPriceCents,
        reason: "Rule: card fee",
      });
    }
    const now = new Date();
    await tx
      .update(schema.invoices)
      .set({ status: "issued", approvedByStaffId: staffId, approvedAt: now, issuedAt: now })
      .where(eq(schema.invoices.id, invoiceId));
    await audit(tx, { type: "staff", id: staffId }, "invoice", invoiceId, "approved_and_issued", { status: invoice.status }, { status: "issued" });
  });
  return chargeInvoice(services, invoiceId, "approval");
}

async function payerCard(services: Services, bookingId: string) {
  const { db } = services;
  const parties = await db.select().from(schema.bookingParties).where(eq(schema.bookingParties.bookingId, bookingId));
  const payer = parties.find((p) => p.roles.includes("payer")) ?? parties[0];
  if (!payer) return null;
  const [card] = await db
    .select()
    .from(schema.paymentMethods)
    .where(and(eq(schema.paymentMethods.personId, payer.personId), eq(schema.paymentMethods.active, true)))
    .orderBy(desc(schema.paymentMethods.createdAt))
    .limit(1);
  return card ?? null;
}

/** Charges whatever is still owed on an issued invoice to the payer's card on file. */
export async function chargeInvoice(services: Services, invoiceId: string, trigger: "approval" | "retry" | "customer") {
  const { db, integrations } = services;
  const { invoice, lines, payments } = await loadInvoice(services, invoiceId);
  if (invoice.status !== "issued") return { status: "skipped" as const, reason: `invoice is ${invoice.status}` };
  const owed = invoiceBalance(asLedger(invoice, lines), asLedgerPayments(payments));
  if (owed <= 0) {
    await db.update(schema.invoices).set({ status: "paid" }).where(eq(schema.invoices.id, invoiceId));
    return { status: "succeeded" as const, amountCents: 0 };
  }
  const card = await payerCard(services, invoice.bookingId);
  if (!card) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "No card on file for the payer" });

  const attempt = payments.filter((p) => p.kind === "charge").length + 1;
  const [booking] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, invoice.bookingId));
  const [payment] = await db
    .insert(schema.payments)
    .values({
      bookingId: invoice.bookingId,
      invoiceId,
      paymentMethodId: card.id,
      provider: card.provider,
      kind: "charge",
      amountCents: owed,
      status: "pending",
      merchantInitiated: trigger !== "customer",
      idempotencyKey: `${invoiceId}:charge:${attempt}`,
    })
    .returning();

  const result = await integrations.payments.charge({
    providerCustomerId: card.providerCustomerId,
    providerPaymentMethodId: card.providerPaymentMethodId,
    amountCents: owed,
    idempotencyKey: payment!.idempotencyKey,
    description: `CSS #${booking?.confirmationNumber ?? ""} invoice`,
    merchantInitiated: trigger !== "customer",
  });

  if (result.status === "succeeded") {
    await db.update(schema.payments).set({ status: "succeeded", providerRef: result.providerRef }).where(eq(schema.payments.id, payment!.id));
    await db.update(schema.invoices).set({ status: "paid" }).where(eq(schema.invoices.id, invoiceId));
    await db
      .update(schema.collectionsCases)
      .set({ status: "resolved", nextAttemptAt: null, outcomeNote: `Paid (${trigger})` })
      .where(eq(schema.collectionsCases.invoiceId, invoiceId));
    await emailBooking(
      services,
      invoice.bookingId,
      "invoice_paid",
      `CSS receipt for #${booking?.confirmationNumber}`,
      `Thanks! We charged ${formatCents(owed)} to the card ending in ${card.last4} for your CSS invoice.\n\n${lines
        .map((l) => `${l.quantity} × ${l.description}: ${formatCents(l.quantity * l.unitPriceCents)}`)
        .join("\n")}`,
      ["payer"],
    );
    return { status: "succeeded" as const, amountCents: owed };
  }

  await db
    .update(schema.payments)
    .set({ status: "failed", providerRef: result.providerRef, failureCode: result.code, failureMessage: result.message })
    .where(eq(schema.payments.id, payment!.id));
  await recordDecline(services, invoice.bookingId, invoiceId, owed, booking?.confirmationNumber ?? null);
  return { status: "failed" as const, amountCents: owed, message: result.message };
}

async function recordDecline(services: Services, bookingId: string, invoiceId: string, owedCents: number, confirmationNumber: number | null) {
  const { db, config } = services;
  const now = new Date();
  const [existing] = await db.select().from(schema.collectionsCases).where(eq(schema.collectionsCases.invoiceId, invoiceId)).limit(1);
  const failedAttempts = existing ? existing.failedAttempts + 1 : 1;
  const firstDeclineAt = existing?.firstDeclineAt ?? now;
  const step = nextCollectionsStep(firstDeclineAt, failedAttempts);
  const status = step.action === "move_to_collections" ? "collections" : "retrying";
  const nextAttemptAt = step.action === "retry_and_remind" ? step.at : null;
  const payToken = existing?.payToken ?? randomBytes(18).toString("base64url");

  if (existing) {
    await db.update(schema.collectionsCases).set({ failedAttempts, status, nextAttemptAt }).where(eq(schema.collectionsCases.id, existing.id));
  } else {
    await db.insert(schema.collectionsCases).values({ bookingId, invoiceId, firstDeclineAt, failedAttempts, status, nextAttemptAt, payToken });
  }

  // Tell the payer (email always; text only with consent), with a link to pay or update the card.
  const link = `${config.portalUrl}/pay/${payToken}`;
  const amount = formatCents(owedCents);
  await emailBooking(
    services,
    bookingId,
    "payment_failed",
    `Your CSS payment didn't go through (#${confirmationNumber})`,
    `We tried to charge ${amount} for your CSS invoice, but the card on file was declined.\n\nPlease pay or update your card here: ${link}\n\n` +
      (status === "retrying" && nextAttemptAt ? `We'll try the card again on ${nextAttemptAt.toDateString()}.` : "Someone from CSS will be in touch."),
    ["payer"],
  );
  await smsBooking(services, bookingId, "payment_failed", `CSS: Your payment of ${amount} for #${confirmationNumber} was declined. Pay or update your card: ${link}`, ["payer"]);
}

/** Worker: retry declined invoices whose next attempt is due. */
export async function retryDueCollections(services: Services, now = new Date()) {
  const due = await services.db
    .select()
    .from(schema.collectionsCases)
    .where(and(eq(schema.collectionsCases.status, "retrying"), lte(schema.collectionsCases.nextAttemptAt, now)));
  const results = [];
  for (const c of due) results.push(await chargeInvoice(services, c.invoiceId, "retry"));
  return results;
}

export async function reviewQueue(services: Services) {
  const { db } = services;
  const invoices = await db
    .select({ invoice: schema.invoices, booking: schema.bookings, person: schema.persons, job: schema.jobs })
    .from(schema.invoices)
    .innerJoin(schema.bookings, eq(schema.invoices.bookingId, schema.bookings.id))
    .innerJoin(schema.persons, eq(schema.bookings.customerPersonId, schema.persons.id))
    .leftJoin(schema.jobs, eq(schema.invoices.jobId, schema.jobs.id))
    .where(eq(schema.invoices.status, "pending_review"))
    .orderBy(asc(schema.invoices.createdAt));
  const ids = invoices.map((i) => i.invoice.id);
  const lines = ids.length ? await db.select().from(schema.invoiceLines).where(inArray(schema.invoiceLines.invoiceId, ids)) : [];
  const jobIds = invoices.map((i) => i.invoice.jobId).filter((x): x is string => !!x);
  const photos = jobIds.length
    ? await db.select({ id: schema.photos.id, jobId: schema.photos.jobId, itemId: schema.photos.itemId, kind: schema.photos.kind }).from(schema.photos).where(inArray(schema.photos.jobId, jobIds))
    : [];
  return invoices.map(({ invoice, booking, person, job }) => {
    const myLines = lines.filter((l) => l.invoiceId === invoice.id);
    return {
      id: invoice.id,
      confirmationNumber: booking.confirmationNumber,
      customerName: `${person.firstName} ${person.lastName}`,
      bookingId: booking.id,
      pickedUpAt: job?.completedAt ?? null,
      signedByName: job?.signedByName ?? null,
      waiveCardFee: invoice.waiveCardFee,
      subtotalCents: invoiceSubtotal(myLines),
      ready: readyToApprove(myLines),
      lines: myLines.map((l) => ({
        id: l.id,
        description: l.description,
        quantity: l.quantity,
        unitPriceCents: l.unitPriceCents,
        needsPrice: l.needsPrice,
        photoIds: photos.filter((p) => p.itemId && p.itemId === l.itemId).map((p) => p.id),
      })),
      otherPhotoIds: photos.filter((p) => p.jobId === invoice.jobId && !p.itemId).map((p) => p.id),
    };
  });
}

export async function collectionsList(services: Services) {
  const { db } = services;
  const rows = await db
    .select({ c: schema.collectionsCases, booking: schema.bookings, person: schema.persons })
    .from(schema.collectionsCases)
    .innerJoin(schema.bookings, eq(schema.collectionsCases.bookingId, schema.bookings.id))
    .innerJoin(schema.persons, eq(schema.bookings.customerPersonId, schema.persons.id))
    .orderBy(desc(schema.collectionsCases.updatedAt));
  const out = [];
  for (const { c, booking, person } of rows) {
    const { invoice, lines, payments } = await loadInvoice(services, c.invoiceId);
    const owed = invoiceBalance(asLedger(invoice, lines), asLedgerPayments(payments));
    const lastFailure = [...payments].reverse().find((p) => p.status === "failed");
    out.push({
      id: c.id,
      status: c.status,
      confirmationNumber: booking.confirmationNumber,
      customerName: `${person.firstName} ${person.lastName}`,
      bookingId: booking.id,
      owedCents: owed,
      failedAttempts: c.failedAttempts,
      nextAttemptAt: c.nextAttemptAt,
      lastFailure: lastFailure?.failureMessage ?? null,
      payLink: `${services.config.portalUrl}/pay/${c.payToken}`,
    });
  }
  return out;
}

/** Public pay page data. */
export async function payPage(services: Services, payToken: string) {
  const { db } = services;
  const [c] = await db.select().from(schema.collectionsCases).where(eq(schema.collectionsCases.payToken, payToken)).limit(1);
  if (!c) return null;
  const { invoice, lines, payments } = await loadInvoice(services, c.invoiceId);
  const [booking] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, c.bookingId));
  const card = await payerCard(services, c.bookingId);
  return {
    confirmationNumber: booking?.confirmationNumber ?? null,
    owedCents: invoiceBalance(asLedger(invoice, lines), asLedgerPayments(payments)),
    lines: lines.map((l) => ({ description: l.description, quantity: l.quantity, amountCents: l.quantity * l.unitPriceCents })),
    cardLast4: card?.last4 ?? null,
    status: invoice.status,
    demoMode: services.config.demoMode,
  };
}

/**
 * Demo only: the customer "updates their card" to a test card that succeeds, then pays.
 * The real flow uses the provider's hosted card fields (Stripe Payment Element) — card data never reaches us.
 */
export async function payWithDemoCard(services: Services, payToken: string) {
  if (!services.config.demoMode) throw new TRPCError({ code: "FORBIDDEN" });
  const { db, integrations } = services;
  const [c] = await db.select().from(schema.collectionsCases).where(eq(schema.collectionsCases.payToken, payToken)).limit(1);
  if (!c) throw new TRPCError({ code: "NOT_FOUND" });
  const current = await payerCard(services, c.bookingId);
  if (!current) throw new TRPCError({ code: "PRECONDITION_FAILED" });
  const card = await integrations.payments.createTestSavedCard({ email: `pay-${c.id}@example.com`, name: "Updated card", behavior: "succeeds" });
  await db.update(schema.paymentMethods).set({ active: false }).where(eq(schema.paymentMethods.id, current.id));
  await db.insert(schema.paymentMethods).values({ personId: current.personId, provider: integrations.payments.provider, ...card });
  return chargeInvoice(services, c.invoiceId, "customer");
}

/**
 * The booking's open (draft) invoice: charges known before service (add-ons, discounts) collect here, and
 * the pickup contract appends to it, so the owner reviews and approves one bill.
 */
export async function openDraftInvoice(db: DbOrTx, bookingId: string): Promise<string> {
  const [existing] = await db
    .select()
    .from(schema.invoices)
    .where(and(eq(schema.invoices.bookingId, bookingId), inArray(schema.invoices.status, ["draft", "pending_review"])))
    .orderBy(asc(schema.invoices.createdAt))
    .limit(1);
  if (existing) return existing.id;
  const [created] = await db.insert(schema.invoices).values({ bookingId, status: "draft", source: "manual" }).returning();
  return created!.id;
}

/** Everything the ledger needs for one booking, plus the derived balance and payment status. */
export async function bookingLedger(db: DbOrTx, bookingId: string) {
  const invoices = await db.select().from(schema.invoices).where(eq(schema.invoices.bookingId, bookingId)).orderBy(asc(schema.invoices.createdAt));
  const ids = invoices.map((i) => i.id);
  const lines = ids.length ? await db.select().from(schema.invoiceLines).where(inArray(schema.invoiceLines.invoiceId, ids)).orderBy(asc(schema.invoiceLines.createdAt)) : [];
  const payments = await db.select().from(schema.payments).where(eq(schema.payments.bookingId, bookingId)).orderBy(asc(schema.payments.createdAt));
  const writeOffs = await db.select().from(schema.writeOffs).where(eq(schema.writeOffs.bookingId, bookingId));
  const ledger = {
    invoices: invoices.map((i) => asLedger(i, lines.filter((l) => l.invoiceId === i.id))),
    payments: asLedgerPayments(payments),
    writeOffs: writeOffs.map((w) => ({ amountCents: w.amountCents })),
  };
  return {
    invoices: invoices.map((invoice) => {
      const mine = lines.filter((l) => l.invoiceId === invoice.id);
      return {
        ...invoice,
        lines: mine,
        totalCents: invoiceTotal({ lines: mine }),
        balanceCents: isOwed(invoice.status) ? invoiceBalance(asLedger(invoice, mine), asLedgerPayments(payments)) : 0,
      };
    }),
    payments,
    writeOffs,
    balanceCents: bookingBalance(ledger),
    paymentStatus: paymentStatus(ledger),
  };
}
