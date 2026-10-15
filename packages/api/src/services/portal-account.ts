/**
 * The customer's account (docs/apps/portal.md#account-after-signup). Access to each booking is derived from the
 * verified contact point the session proved (ADR-0004); permissions follow the person's roles on the booking.
 */
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, inArray, isNull, ne, schema } from "@css/db";
import { campusOf, formatPhone, type PersonAnswer } from "@css/domain";
import type { Context, CustomerSession } from "../context";
import { audit } from "./audit";
import { bookingLedger } from "./billing";
import { addAppointment, addParty, rescheduleAppointment } from "./bookings";
import { slotsFor } from "./capacity";
import { seasonFor } from "./catalog";
import { claimEligibility, submitClaim } from "./claims";
import { accessibleBookings, requireBookingAccess, sessionPersonIds } from "./customer-auth";
import { currentDraft } from "./signup";
import { getSettings } from "./settings";
import { localDate, windowLabel } from "./time";

type CustomerCtx = Context & { customer: CustomerSession };

const TIMELINE = ["confirmed", "picked_up", "in_storage", "delivery_scheduled", "delivered"] as const;
const TIMELINE_LABELS: Record<(typeof TIMELINE)[number], string> = {
  confirmed: "Signed up",
  picked_up: "Picked up",
  in_storage: "In storage",
  delivery_scheduled: "Delivery scheduled",
  delivered: "Delivered",
};

export async function accountHome(ctx: CustomerCtx) {
  const { db } = ctx;
  const personIds = await sessionPersonIds(db, ctx.customer);
  const persons = personIds.length ? await db.select().from(schema.persons).where(inArray(schema.persons.id, personIds)) : [];
  const access = await accessibleBookings(db, ctx.customer);
  const ids = access.map((a) => a.bookingId);
  const rows = ids.length
    ? await db
        .select({ booking: schema.bookings, season: schema.seasons, person: schema.persons, school: schema.schools })
        .from(schema.bookings)
        .innerJoin(schema.seasons, eq(schema.bookings.seasonId, schema.seasons.id))
        .innerJoin(schema.persons, eq(schema.bookings.customerPersonId, schema.persons.id))
        .leftJoin(schema.schools, eq(schema.bookings.schoolId, schema.schools.id))
        .where(and(inArray(schema.bookings.id, ids), ne(schema.bookings.lifecycle, "draft")))
        .orderBy(desc(schema.seasons.startsOn), desc(schema.bookings.createdAt))
    : [];
  const services = ids.length
    ? await db
        .select({ bookingId: schema.bookingServices.bookingId, name: schema.services.name })
        .from(schema.bookingServices)
        .innerJoin(schema.services, eq(schema.bookingServices.serviceId, schema.services.id))
        .where(inArray(schema.bookingServices.bookingId, ids))
    : [];
  const appts = ids.length
    ? await db.select().from(schema.appointments).where(and(inArray(schema.appointments.bookingId, ids), isNull(schema.appointments.cancelledAt))).orderBy(asc(schema.appointments.date))
    : [];
  const today = localDate(ctx.config.timeZone);
  const bookings = [];
  for (const r of rows) {
    const ledger = await bookingLedger(db, r.booking.id);
    const next = appts.find((a) => a.bookingId === r.booking.id && a.date >= today);
    bookings.push({
      id: r.booking.id,
      confirmationNumber: r.booking.confirmationNumber,
      season: r.season.name,
      lifecycle: r.booking.lifecycle,
      customerName: `${r.person.firstName} ${r.person.lastName}`,
      school: r.school?.shortName ?? null,
      schoolColor: r.school?.color ?? null,
      services: services.filter((s) => s.bookingId === r.booking.id).map((s) => s.name),
      nextAppointment: next ? { type: next.type, date: next.date, window: windowLabel(next.windowId) } : null,
      balanceCents: ledger.balanceCents,
      paymentStatus: ledger.paymentStatus,
      roles: access.find((a) => a.bookingId === r.booking.id)?.roles ?? [],
    });
  }
  const draft = await currentDraft(ctx);
  return {
    contact: { kind: ctx.customer.kind, value: ctx.customer.kind === "phone" ? formatPhone(ctx.customer.value) : ctx.customer.value },
    names: persons.map((p) => `${p.firstName} ${p.lastName}`.trim()).filter(Boolean),
    personIds,
    bookings,
    draft: draft && draft.lifecycle === "draft" ? { stepReached: draft.stepReached } : null,
  };
}

export async function accountBooking(ctx: CustomerCtx, bookingId: string) {
  const { db, config } = ctx;
  const access = await requireBookingAccess(ctx, bookingId);
  const [row] = await db
    .select({ booking: schema.bookings, season: schema.seasons, school: schema.schools, residence: schema.residences })
    .from(schema.bookings)
    .innerJoin(schema.seasons, eq(schema.bookings.seasonId, schema.seasons.id))
    .leftJoin(schema.schools, eq(schema.bookings.schoolId, schema.schools.id))
    .leftJoin(schema.residences, eq(schema.bookings.residenceId, schema.residences.id))
    .where(eq(schema.bookings.id, bookingId));
  if (!row || row.booking.lifecycle === "draft") throw new TRPCError({ code: "NOT_FOUND" });
  const { booking } = row;
  const parties = await db
    .select({ party: schema.bookingParties, person: schema.persons })
    .from(schema.bookingParties)
    .innerJoin(schema.persons, eq(schema.bookingParties.personId, schema.persons.id))
    .where(eq(schema.bookingParties.bookingId, bookingId));
  const contacts = await db.select().from(schema.contactPoints).where(inArray(schema.contactPoints.personId, parties.map((p) => p.person.id)));
  const bs = await db
    .select({ bs: schema.bookingServices, service: schema.services })
    .from(schema.bookingServices)
    .innerJoin(schema.services, eq(schema.bookingServices.serviceId, schema.services.id))
    .where(eq(schema.bookingServices.bookingId, bookingId));
  const appts = await db
    .select({ appt: schema.appointments, job: schema.jobs })
    .from(schema.appointments)
    .leftJoin(schema.jobs, eq(schema.jobs.appointmentId, schema.appointments.id))
    .where(and(eq(schema.appointments.bookingId, bookingId), isNull(schema.appointments.cancelledAt)))
    .orderBy(asc(schema.appointments.date));
  const items = await db.select().from(schema.items).where(eq(schema.items.bookingId, bookingId)).orderBy(asc(schema.items.createdAt));
  const rate = items.some((i) => i.rateCardItemId)
    ? await db.select().from(schema.rateCardItems).where(inArray(schema.rateCardItems.id, items.map((i) => i.rateCardItemId).filter((x): x is string => !!x)))
    : [];
  const jobIds = appts.map((a) => a.job?.id).filter((x): x is string => !!x);
  const photos = jobIds.length
    ? await db.select({ id: schema.photos.id, itemId: schema.photos.itemId, kind: schema.photos.kind, jobId: schema.photos.jobId }).from(schema.photos).where(inArray(schema.photos.jobId, jobIds))
    : [];
  const ledger = await bookingLedger(db, bookingId);
  const card = await db
    .select()
    .from(schema.paymentMethods)
    .where(and(inArray(schema.paymentMethods.personId, parties.filter((p) => p.party.roles.includes("payer")).map((p) => p.person.id)), eq(schema.paymentMethods.active, true)))
    .orderBy(desc(schema.paymentMethods.createdAt))
    .limit(1);
  const [authorization] = await db.select().from(schema.chargeAuthorizations).where(eq(schema.chargeAuthorizations.bookingId, bookingId)).orderBy(desc(schema.chargeAuthorizations.acceptedAt)).limit(1);
  const referrals = await db.select().from(schema.referrals).where(eq(schema.referrals.referrerBookingId, bookingId));
  const claims = await db.select().from(schema.claims).where(eq(schema.claims.bookingId, bookingId)).orderBy(desc(schema.claims.createdAt));
  const [collections] = await db.select().from(schema.collectionsCases).where(and(eq(schema.collectionsCases.bookingId, bookingId), ne(schema.collectionsCases.status, "resolved")));
  const eligibility = await claimEligibility(ctx, bookingId);
  const settings = await getSettings(db);
  const today = localDate(config.timeZone);
  const season = await seasonFor(db, booking.seasonId);
  const lifecycleIndex = TIMELINE.indexOf(booking.lifecycle as (typeof TIMELINE)[number]);
  const canManage = access.roles.some((r) => ["guardian", "payer", "customer", "student"].includes(r));
  const referralLink = booking.referralCode ? `${config.portalUrl}/signup?ref=${booking.referralCode}` : null;

  return {
    id: booking.id,
    confirmationNumber: booking.confirmationNumber,
    season: row.season.name,
    lifecycle: booking.lifecycle,
    roles: access.roles,
    school: row.school ? { name: row.school.name, shortName: row.school.shortName, color: row.school.color } : null,
    residence: row.residence?.name ?? null,
    room: booking.room,
    address: booking.address,
    timeline: TIMELINE.map((step, i) => ({ step, label: TIMELINE_LABELS[step], done: booking.lifecycle !== "cancelled" && i <= lifecycleIndex, current: i === lifecycleIndex })),
    services: bs.map(({ bs, service }) => ({
      id: bs.id,
      name: service.name,
      addedByStaff: bs.source === "staff_addon",
      reason: bs.reason,
      needsAcceptance: bs.acceptanceRequired && !bs.acceptedAt,
      acceptedAt: bs.acceptedAt,
    })),
    appointments: appts.map(({ appt, job }) => ({
      id: appt.id,
      type: appt.type,
      date: appt.date,
      window: windowLabel(appt.windowId),
      address: appt.address,
      status: job?.status ?? "unassigned",
      trackingUrl: job && appt.date === today && job.status !== "completed" ? `/t/${job.trackingToken}` : null,
      rateUrl: job?.status === "completed" ? `/r/${job.trackingToken}` : null,
      canReschedule: canManage && appt.type === "pickup" && !!appt.serviceDayId && appt.date > today && job?.status !== "completed",
    })),
    canScheduleDelivery:
      canManage && ["picked_up", "in_storage"].includes(booking.lifecycle) && !appts.some((a) => a.appt.type === "delivery") && !!booking.schoolId,
    items: items.map((i) => ({
      id: i.id,
      name: rate.find((r) => r.id === i.rateCardItemId)?.name ?? i.description ?? "Other",
      quantity: i.quantity,
      deliveredQuantity: i.deliveredQuantity,
      status: i.status,
      damageAtPickup: i.preExistingDamage,
      photoIds: photos.filter((p) => p.itemId === i.id).map((p) => p.id),
    })),
    deliveryPhotoIds: photos.filter((p) => p.kind === "delivery").map((p) => p.id),
    billing: {
      canSee: access.roles.some((r) => ["payer", "guardian", "customer", "student"].includes(r)),
      balanceCents: ledger.balanceCents,
      paymentStatus: ledger.paymentStatus,
      card: card[0] ? { brand: card[0].brand, last4: card[0].last4, exp: `${card[0].expMonth}/${card[0].expYear}` } : null,
      authorizationText: authorization?.text ?? null,
      payLink: collections ? `/pay/${collections.payToken}` : null,
      invoices: ledger.invoices
        .filter((i) => i.status === "issued" || i.status === "paid")
        .map((i) => ({
          id: i.id,
          status: i.status,
          issuedAt: i.issuedAt,
          totalCents: i.totalCents,
          balanceCents: i.balanceCents,
          lines: i.lines.filter((l) => l.quantity > 0).map((l) => ({ description: l.description, quantity: l.quantity, unitPriceCents: l.unitPriceCents, kind: l.kind })),
        })),
      payments: ledger.payments.filter((p) => p.status === "succeeded").map((p) => ({ kind: p.kind, amountCents: p.amountCents, at: p.createdAt })),
      pendingReview: ledger.invoices.some((i) => i.status === "pending_review"),
    },
    people: parties.map(({ party, person }) => ({
      personId: person.id,
      name: `${person.firstName} ${person.lastName}`.trim(),
      roles: party.roles.filter((r) => r !== "signer"),
      contacts: contacts.filter((c) => c.personId === person.id).map((c) => (c.kind === "phone" ? formatPhone(c.value) : c.value)),
    })),
    canInvite: access.roles.some((r) => ["guardian", "payer"].includes(r)),
    referral: { code: booking.referralCode, link: referralLink, shareText: referralLink ? settings.referralShareText.replace("{link}", referralLink) : null, count: referrals.length },
    claims: claims.map((c) => ({ id: c.id, kind: c.kind, status: c.status, description: c.description, resolution: c.resolution, amountCents: c.amountCents, createdAt: c.createdAt })),
    claimWindow: eligibility,
    leadDays: season.leadDays,
    campus: campusOf(row.residence?.kind),
    signupAgain: TIMELINE.indexOf(booking.lifecycle as (typeof TIMELINE)[number]) >= 1 || booking.lifecycle === "closed",
  };
}

export async function customerSlots(ctx: CustomerCtx, bookingId: string, type: "pickup" | "delivery") {
  await requireBookingAccess(ctx, bookingId);
  const [booking] = await ctx.db.select().from(schema.bookings).where(eq(schema.bookings.id, bookingId));
  if (!booking?.schoolId) return [];
  const residence = booking.residenceId ? (await ctx.db.select().from(schema.residences).where(eq(schema.residences.id, booking.residenceId)))[0] : undefined;
  const season = await seasonFor(ctx.db, booking.seasonId);
  return slotsFor(ctx.db, { seasonId: season.id, schoolId: booking.schoolId, type, campus: campusOf(residence?.kind), today: localDate(ctx.config.timeZone), leadDays: season.leadDays });
}

async function personForSession(ctx: CustomerCtx, bookingId: string) {
  const ids = await sessionPersonIds(ctx.db, ctx.customer);
  const parties = await ctx.db.select().from(schema.bookingParties).where(and(eq(schema.bookingParties.bookingId, bookingId), inArray(schema.bookingParties.personId, ids)));
  return parties[0]?.personId ?? ids[0]!;
}

export async function customerReschedule(ctx: CustomerCtx, appointmentId: string, serviceDayId: string) {
  const [appt] = await ctx.db.select().from(schema.appointments).where(eq(schema.appointments.id, appointmentId));
  if (!appt) throw new TRPCError({ code: "NOT_FOUND" });
  await requireBookingAccess(ctx, appt.bookingId, ["guardian", "payer", "customer", "student"]);
  const slot = (await customerSlots(ctx, appt.bookingId, appt.type === "delivery" ? "delivery" : "pickup")).find((s) => s.id === serviceDayId);
  if (!slot) throw new TRPCError({ code: "BAD_REQUEST", message: "That window isn't available. Pick another." });
  const personId = await personForSession(ctx, appt.bookingId);
  await rescheduleAppointment(ctx, { type: "customer", id: personId }, { appointmentId, date: slot.date, windowId: slot.windowId, serviceDayId: slot.id, notify: true });
}

export async function customerScheduleDelivery(ctx: CustomerCtx, bookingId: string, serviceDayId: string) {
  await requireBookingAccess(ctx, bookingId, ["guardian", "payer", "customer", "student"]);
  const slot = (await customerSlots(ctx, bookingId, "delivery")).find((s) => s.id === serviceDayId);
  if (!slot) throw new TRPCError({ code: "BAD_REQUEST", message: "That window isn't available. Pick another." });
  const existing = await ctx.db
    .select()
    .from(schema.appointments)
    .where(and(eq(schema.appointments.bookingId, bookingId), eq(schema.appointments.type, "delivery"), isNull(schema.appointments.cancelledAt)));
  if (existing.length) throw new TRPCError({ code: "BAD_REQUEST", message: "Delivery is already scheduled" });
  const personId = await personForSession(ctx, bookingId);
  await addAppointment(ctx, { type: "customer", id: personId }, { bookingId, type: "delivery", date: slot.date, windowId: slot.windowId, serviceDayId: slot.id });
}

export async function customerInvite(ctx: CustomerCtx, bookingId: string, person: PersonAnswer) {
  await requireBookingAccess(ctx, bookingId, ["guardian", "payer"]);
  const personId = await personForSession(ctx, bookingId);
  return addParty(ctx, { type: "customer", id: personId }, bookingId, "guardian", person);
}

export async function customerClaim(ctx: CustomerCtx, input: { bookingId: string; kind: "damage" | "missing" | "other"; itemIds: string[]; description: string; photoKeys: string[] }) {
  await requireBookingAccess(ctx, input.bookingId);
  const personId = await personForSession(ctx, input.bookingId);
  return submitClaim(ctx, { ...input, personId });
}

export async function acceptService(ctx: CustomerCtx, bookingServiceId: string) {
  const [bs] = await ctx.db.select().from(schema.bookingServices).where(eq(schema.bookingServices.id, bookingServiceId));
  if (!bs) throw new TRPCError({ code: "NOT_FOUND" });
  await requireBookingAccess(ctx, bs.bookingId, ["guardian", "payer", "customer", "student"]);
  const personId = await personForSession(ctx, bs.bookingId);
  await ctx.db.update(schema.bookingServices).set({ acceptedAt: new Date() }).where(eq(schema.bookingServices.id, bookingServiceId));
  await audit(ctx.db, { type: "customer", id: personId }, "booking_service", bookingServiceId, "accepted", null, { ip: ctx.request.ip, userAgent: ctx.request.userAgent });
}

/** Printable labels: staff, or a customer with access to the booking. */
export async function labelsData(ctx: Context, bookingId: string) {
  if (!ctx.staff) {
    if (!ctx.customer) throw new TRPCError({ code: "UNAUTHORIZED" });
    await requireBookingAccess({ ...ctx, customer: ctx.customer }, bookingId);
  }
  const [row] = await ctx.db
    .select({ booking: schema.bookings, person: schema.persons, school: schema.schools, season: schema.seasons })
    .from(schema.bookings)
    .innerJoin(schema.persons, eq(schema.bookings.customerPersonId, schema.persons.id))
    .innerJoin(schema.seasons, eq(schema.bookings.seasonId, schema.seasons.id))
    .leftJoin(schema.schools, eq(schema.bookings.schoolId, schema.schools.id))
    .where(eq(schema.bookings.id, bookingId));
  if (!row?.booking.confirmationNumber) throw new TRPCError({ code: "NOT_FOUND" });
  return {
    confirmationNumber: row.booking.confirmationNumber,
    name: `${row.person.firstName} ${row.person.lastName}`,
    school: row.school?.shortName ?? null,
    color: row.school?.color ?? "#1d4ed8",
    season: row.season.name,
  };
}
