/**
 * Claims (docs/domain-model.md#claims): submitted online within N days after delivery, worked as a periodic
 * queue, resolved through the ledger. Pickup and delivery photos for the lines involved are attached automatically.
 */
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, inArray, schema, type DbOrTx } from "@css/db";
import { claimWindowOpen, formatCents } from "@css/domain";
import type { Services } from "../context";
import { audit } from "./audit";
import { openDraftInvoice } from "./billing";
import { refundPayment } from "./bookings";
import { emailBooking } from "./messaging";
import { getSettings } from "./settings";
import { localDate } from "./time";

/** Date of the completed delivery for a booking, if any. */
export async function deliveredOn(db: DbOrTx, bookingId: string, timeZone: string): Promise<string | null> {
  const rows = await db
    .select({ completedAt: schema.jobs.completedAt })
    .from(schema.jobs)
    .innerJoin(schema.appointments, eq(schema.jobs.appointmentId, schema.appointments.id))
    .where(and(eq(schema.appointments.bookingId, bookingId), eq(schema.appointments.type, "delivery"), eq(schema.jobs.status, "completed")))
    .orderBy(desc(schema.jobs.completedAt))
    .limit(1);
  return rows[0]?.completedAt ? localDate(timeZone, rows[0].completedAt) : null;
}

export async function claimEligibility(services: Services, bookingId: string) {
  const settings = await getSettings(services.db);
  const delivered = await deliveredOn(services.db, bookingId, services.config.timeZone);
  return {
    deliveredOn: delivered,
    windowDays: settings.claimWindowDays,
    open: claimWindowOpen(delivered, localDate(services.config.timeZone), settings.claimWindowDays),
  };
}

export async function submitClaim(
  services: Services,
  input: { bookingId: string; personId: string; kind: "damage" | "missing" | "other"; itemIds: string[]; description: string; photoKeys: string[] },
) {
  const { db } = services;
  const eligibility = await claimEligibility(services, input.bookingId);
  if (!eligibility.open)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: eligibility.deliveredOn ? `Claims can be filed within ${eligibility.windowDays} days after delivery.` : "Claims open after your delivery.",
    });
  const items = input.itemIds.length ? await db.select().from(schema.items).where(and(inArray(schema.items.id, input.itemIds), eq(schema.items.bookingId, input.bookingId))) : [];
  if (items.length !== input.itemIds.length) throw new TRPCError({ code: "BAD_REQUEST", message: "Pick items from your contract" });
  const [claim] = await db
    .insert(schema.claims)
    .values({ bookingId: input.bookingId, submittedByPersonId: input.personId, kind: input.kind, itemIds: input.itemIds, description: input.description.trim(), customerPhotoKeys: input.photoKeys })
    .returning();
  const [booking] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, input.bookingId));
  if (booking && !booking.flags.includes("claim_open")) await db.update(schema.bookings).set({ flags: [...booking.flags, "claim_open"] }).where(eq(schema.bookings.id, booking.id));
  await audit(db, { type: "customer", id: input.personId }, "claim", claim!.id, "submitted", null, { kind: input.kind, items: input.itemIds.length });
  await emailBooking(
    services,
    input.bookingId,
    "claim_update",
    `We received your claim for CSS #${booking?.confirmationNumber}`,
    "Thanks for letting us know. We review claims with the pickup and delivery photos and will email you with the outcome.",
  );
  return claim!;
}

export async function claimsQueue(db: DbOrTx, status: "open" | "all") {
  const rows = await db
    .select({ claim: schema.claims, booking: schema.bookings, person: schema.persons })
    .from(schema.claims)
    .innerJoin(schema.bookings, eq(schema.claims.bookingId, schema.bookings.id))
    .innerJoin(schema.persons, eq(schema.bookings.customerPersonId, schema.persons.id))
    .where(status === "open" ? inArray(schema.claims.status, ["submitted", "reviewing"]) : undefined)
    .orderBy(desc(schema.claims.urgent), asc(schema.claims.createdAt));
  const out = [];
  for (const r of rows) {
    const items = r.claim.itemIds.length ? await db.select().from(schema.items).where(inArray(schema.items.id, r.claim.itemIds)) : [];
    const rate = items.some((i) => i.rateCardItemId)
      ? await db.select().from(schema.rateCardItems).where(inArray(schema.rateCardItems.id, items.map((i) => i.rateCardItemId).filter((x): x is string => !!x)))
      : [];
    const photos = items.length
      ? await db.select({ id: schema.photos.id, itemId: schema.photos.itemId, kind: schema.photos.kind }).from(schema.photos).where(inArray(schema.photos.itemId, items.map((i) => i.id)))
      : [];
    const jobs = await db
      .select({ job: schema.jobs, appt: schema.appointments, crew: schema.crews })
      .from(schema.jobs)
      .innerJoin(schema.appointments, eq(schema.jobs.appointmentId, schema.appointments.id))
      .leftJoin(schema.crews, eq(schema.jobs.crewId, schema.crews.id))
      .where(and(eq(schema.appointments.bookingId, r.booking.id), eq(schema.jobs.status, "completed")));
    const deliveryPhotos = jobs.some((j) => j.appt.type === "delivery")
      ? await db
          .select({ id: schema.photos.id })
          .from(schema.photos)
          .where(and(inArray(schema.photos.jobId, jobs.filter((j) => j.appt.type === "delivery").map((j) => j.job.id)), eq(schema.photos.kind, "delivery")))
      : [];
    const payments = await db.select().from(schema.payments).where(and(eq(schema.payments.bookingId, r.booking.id), eq(schema.payments.kind, "charge"), eq(schema.payments.status, "succeeded")));
    out.push({
      ...r.claim,
      confirmationNumber: r.booking.confirmationNumber,
      bookingId: r.booking.id,
      customerName: `${r.person.firstName} ${r.person.lastName}`,
      items: items.map((i) => ({
        id: i.id,
        name: rate.find((x) => x.id === i.rateCardItemId)?.name ?? i.description ?? "Other",
        quantity: i.quantity,
        damageAtPickup: i.preExistingDamage,
        pickupPhotoIds: photos.filter((p) => p.itemId === i.id).map((p) => p.id),
      })),
      deliveryPhotoIds: deliveryPhotos.map((p) => p.id),
      crews: jobs.map((j) => ({ type: j.appt.type, crew: j.crew?.name ?? null, date: j.appt.date })),
      refundablePayments: payments.map((p) => ({ id: p.id, amountCents: p.amountCents, createdAt: p.createdAt })),
    });
  }
  return out;
}

export async function resolveClaim(
  services: Services,
  staffId: string,
  input: { claimId: string; outcome: "refund" | "credit" | "payment" | "denied"; amountCents: number | null; paymentId?: string | null; note: string },
) {
  const { db } = services;
  const [claim] = await db.select().from(schema.claims).where(eq(schema.claims.id, input.claimId));
  if (!claim) throw new TRPCError({ code: "NOT_FOUND" });
  if (claim.status === "resolved" || claim.status === "denied") throw new TRPCError({ code: "BAD_REQUEST", message: "Already closed" });
  if (input.outcome !== "denied" && (!input.amountCents || input.amountCents <= 0)) throw new TRPCError({ code: "BAD_REQUEST", message: "Enter an amount" });
  if (input.outcome === "refund") {
    if (!input.paymentId) throw new TRPCError({ code: "BAD_REQUEST", message: "Pick the payment to refund" });
    await refundPayment(services, staffId, { paymentId: input.paymentId, amountCents: input.amountCents!, reason: `Claim: ${input.note}` });
  }
  if (input.outcome === "credit") {
    const [bs] = await db.select().from(schema.bookingServices).where(eq(schema.bookingServices.bookingId, claim.bookingId)).limit(1);
    await db.insert(schema.invoiceLines).values({
      invoiceId: await openDraftInvoice(db, claim.bookingId),
      bookingServiceId: bs?.id ?? null,
      kind: "discount",
      description: "Claim credit",
      quantity: 1,
      unitPriceCents: input.amountCents!,
      reason: `Claim ${claim.id.slice(0, 8)}: ${input.note}`,
    });
  }
  await db
    .update(schema.claims)
    .set({
      status: input.outcome === "denied" ? "denied" : "resolved",
      resolution: input.outcome === "denied" ? "none" : input.outcome,
      amountCents: input.outcome === "denied" ? null : input.amountCents,
      resolutionNote: input.note,
      resolvedByStaffId: staffId,
      resolvedAt: new Date(),
    })
    .where(eq(schema.claims.id, claim.id));
  const [booking] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, claim.bookingId));
  const stillOpen = await db.select().from(schema.claims).where(and(eq(schema.claims.bookingId, claim.bookingId), inArray(schema.claims.status, ["submitted", "reviewing"])));
  if (booking && !stillOpen.length) await db.update(schema.bookings).set({ flags: booking.flags.filter((f) => f !== "claim_open") }).where(eq(schema.bookings.id, booking.id));
  await audit(db, { type: "staff", id: staffId }, "claim", claim.id, "resolved", { status: claim.status }, input);
  const outcome =
    input.outcome === "denied"
      ? "After reviewing the pickup and delivery photos, we weren't able to approve this claim."
      : input.outcome === "refund"
        ? `We refunded ${formatCents(input.amountCents!)} to your card.`
        : input.outcome === "credit"
          ? `We added a ${formatCents(input.amountCents!)} credit to your account.`
          : `We're sending you ${formatCents(input.amountCents!)}.`;
  await emailBooking(services, claim.bookingId, "claim_update", `Your CSS claim for #${booking?.confirmationNumber}`, `${outcome}\n\n${input.note}`);
}

export async function setClaimStatus(services: Services, staffId: string, claimId: string, patch: { status?: "reviewing"; urgent?: boolean }) {
  await services.db.update(schema.claims).set(patch).where(eq(schema.claims.id, claimId));
  await audit(services.db, { type: "staff", id: staffId }, "claim", claimId, "updated", null, patch);
}
