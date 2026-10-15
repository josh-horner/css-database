/**
 * Bookings for staff (docs/apps/admin.md): search and filters, the Customer 360 read model, and every staff
 * action. Every mutation writes an audit event with before/after.
 */
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, ilike, inArray, isNull, ne, or, schema, sql, type DbOrTx } from "@css/db";
import {
  campusOf,
  canClose,
  formatCents,
  formatPhone,
  mergeFields,
  normalizeEmail,
  normalizePhone,
  validateAnswers,
  type FieldDef,
  type PersonAnswer,
} from "@css/domain";
import type { Services } from "../context";
import { audit } from "./audit";
import { bookingLedger, chargeInvoice, openDraftInvoice } from "./billing";
import { materialize, trackingToken, upsertPerson } from "./booking-builder";
import { reserveServiceDay } from "./capacity";
import { activeSchools, servicesWithFields, signupSeason, toFieldDef } from "./catalog";
import { emailBooking, sendEmail, sendSms, smsBooking } from "./messaging";
import { sendConfirmation, uniqueReferralCode } from "./signup";
import { localDate, windowLabel } from "./time";

type Actor = { type: "staff" | "customer"; id: string };
const LIFECYCLES = schema.lifecycle.enumValues;

// ---------------------------------------------------------------------------------------------
// Search and list

export interface BookingFilters {
  q?: string;
  seasonId?: string | null;
  schoolId?: string | null;
  lifecycle?: (typeof LIFECYCLES)[number] | "active" | null;
  flag?: string | null;
  serviceId?: string | null;
  limit?: number;
  offset?: number;
}

export async function listBookings(db: DbOrTx, f: BookingFilters) {
  const q = f.q?.trim() ?? "";
  const conditions = [];
  if (f.seasonId) conditions.push(eq(schema.bookings.seasonId, f.seasonId));
  if (f.schoolId) conditions.push(eq(schema.bookings.schoolId, f.schoolId));
  if (f.lifecycle === "active" || !f.lifecycle) conditions.push(and(ne(schema.bookings.lifecycle, "draft"), ne(schema.bookings.lifecycle, "cancelled")));
  else conditions.push(eq(schema.bookings.lifecycle, f.lifecycle));
  if (f.flag) conditions.push(sql`${f.flag} = any(${schema.bookings.flags})`);
  if (f.serviceId)
    conditions.push(sql`exists (select 1 from booking_services bs where bs.booking_id = ${schema.bookings.id} and bs.service_id = ${f.serviceId})`);
  if (q) {
    const like = `%${q}%`;
    const digits = q.replace(/\D/g, "");
    const parts = [
      sql`exists (select 1 from booking_parties bp join persons p on p.id = bp.person_id where bp.booking_id = ${schema.bookings.id}
          and (p.first_name || ' ' || p.last_name) ilike ${like})`,
      sql`exists (select 1 from booking_parties bp join contact_points cp on cp.person_id = bp.person_id where bp.booking_id = ${schema.bookings.id}
          and cp.value ilike ${like})`,
      sql`exists (select 1 from payments pay where pay.booking_id = ${schema.bookings.id} and pay.provider_ref = ${q})`,
      ilike(schema.bookings.referralCode, like),
    ];
    if (/^\d{1,6}$/.test(q)) parts.push(eq(schema.bookings.confirmationNumber, Number(q)));
    if (digits.length >= 7)
      parts.push(sql`exists (select 1 from booking_parties bp join contact_points cp on cp.person_id = bp.person_id where bp.booking_id = ${schema.bookings.id}
          and cp.kind = 'phone' and cp.value like ${`%${digits.slice(-10)}%`})`);
    conditions.push(or(...parts));
  }
  const where = and(...conditions);
  const [{ total }] = (await db.select({ total: sql<number>`count(*)::int` }).from(schema.bookings).where(where)) as [{ total: number }];
  const rows = await db
    .select({ booking: schema.bookings, person: schema.persons, school: schema.schools, residence: schema.residences, season: schema.seasons })
    .from(schema.bookings)
    .innerJoin(schema.persons, eq(schema.bookings.customerPersonId, schema.persons.id))
    .innerJoin(schema.seasons, eq(schema.bookings.seasonId, schema.seasons.id))
    .leftJoin(schema.schools, eq(schema.bookings.schoolId, schema.schools.id))
    .leftJoin(schema.residences, eq(schema.bookings.residenceId, schema.residences.id))
    .where(where)
    .orderBy(desc(schema.seasons.startsOn), asc(schema.bookings.confirmationNumber), desc(schema.bookings.lastActivityAt))
    .limit(Math.min(f.limit ?? 50, 500))
    .offset(f.offset ?? 0);
  const ids = rows.map((r) => r.booking.id);
  const services = ids.length
    ? await db
        .select({ bookingId: schema.bookingServices.bookingId, name: schema.services.name })
        .from(schema.bookingServices)
        .innerJoin(schema.services, eq(schema.bookingServices.serviceId, schema.services.id))
        .where(inArray(schema.bookingServices.bookingId, ids))
    : [];
  const nextAppts = ids.length
    ? await db
        .select()
        .from(schema.appointments)
        .where(and(inArray(schema.appointments.bookingId, ids), isNull(schema.appointments.cancelledAt)))
        .orderBy(asc(schema.appointments.date))
    : [];
  const out = [];
  for (const r of rows) {
    const ledger = await bookingLedger(db, r.booking.id);
    out.push({
      id: r.booking.id,
      confirmationNumber: r.booking.confirmationNumber,
      season: r.season.name,
      lifecycle: r.booking.lifecycle,
      flags: r.booking.flags,
      customerName: `${r.person.firstName} ${r.person.lastName}`.trim() || "(no name yet)",
      school: r.school?.shortName ?? null,
      schoolColor: r.school?.color ?? null,
      residence: r.residence?.name ?? null,
      services: services.filter((s) => s.bookingId === r.booking.id).map((s) => s.name),
      nextAppointment: nextAppts.find((a) => a.bookingId === r.booking.id) ?? null,
      balanceCents: ledger.balanceCents,
      paymentStatus: ledger.paymentStatus,
      storageLocation: r.booking.storageLocation,
    });
  }
  return { total, rows: out };
}

/** Bookings as CSV (filters as above, up to 5,000 rows). */
export async function bookingsCsv(db: DbOrTx, f: BookingFilters) {
  const { rows } = await listBookings(db, { ...f, limit: 5000, offset: 0 });
  const header = ["confirmation", "season", "customer", "school", "residence", "lifecycle", "services", "next_appointment", "balance", "payment_status", "flags"];
  const csv = [header.join(",")];
  for (const r of rows) {
    csv.push(
      [r.confirmationNumber ?? "", r.season, r.customerName, r.school ?? "", r.residence ?? "", r.lifecycle, r.services.join("; "), r.nextAppointment?.date ?? "", (r.balanceCents / 100).toFixed(2), r.paymentStatus, r.flags.join("; ")]
        .map(csvCell)
        .join(","),
    );
  }
  return csv.join("\n");
}

export function csvCell(v: unknown): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// ---------------------------------------------------------------------------------------------
// Customer 360

export async function renderAnswer(db: DbOrTx, field: FieldDef, value: unknown): Promise<string> {
  if (value === null || value === undefined || value === "") return "—";
  switch (field.type) {
    case "yes_no":
      return value ? "Yes" : "No";
    case "select":
      return field.config.options?.find((o) => o.value === value)?.label ?? String(value);
    case "multi_select":
      return (value as string[]).map((v) => field.config.options?.find((o) => o.value === v)?.label ?? v).join(", ");
    case "school": {
      const [s] = await db.select().from(schema.schools).where(eq(schema.schools.id, value as string));
      return s?.name ?? "—";
    }
    case "residence": {
      const r = value as { residenceId: string; room?: string; address?: string };
      const [res] = await db.select().from(schema.residences).where(eq(schema.residences.id, r.residenceId));
      return [res?.name, r.room && `room ${r.room}`, r.address].filter(Boolean).join(", ");
    }
    case "person": {
      const p = value as PersonAnswer;
      return [`${p.firstName} ${p.lastName}`, p.email, p.phone && formatPhone(normalizePhone(p.phone) ?? p.phone)].filter(Boolean).join(" · ");
    }
    case "appointment": {
      const a = value as { date: string; windowId?: string | null; special?: boolean };
      return `${a.date} · ${windowLabel(a.windowId ?? null)}${a.special ? " (special)" : ""}`;
    }
    default:
      return String(value);
  }
}

export async function bookingDetail(db: DbOrTx, bookingId: string) {
  const [row] = await db
    .select({ booking: schema.bookings, season: schema.seasons, school: schema.schools, residence: schema.residences })
    .from(schema.bookings)
    .innerJoin(schema.seasons, eq(schema.bookings.seasonId, schema.seasons.id))
    .leftJoin(schema.schools, eq(schema.bookings.schoolId, schema.schools.id))
    .leftJoin(schema.residences, eq(schema.bookings.residenceId, schema.residences.id))
    .where(eq(schema.bookings.id, bookingId))
    .limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found" });
  const { booking } = row;

  const partyRows = await db
    .select({ party: schema.bookingParties, person: schema.persons })
    .from(schema.bookingParties)
    .innerJoin(schema.persons, eq(schema.bookingParties.personId, schema.persons.id))
    .where(eq(schema.bookingParties.bookingId, bookingId));
  const personIds = partyRows.map((p) => p.person.id);
  const contacts = personIds.length ? await db.select().from(schema.contactPoints).where(inArray(schema.contactPoints.personId, personIds)) : [];
  const cards = personIds.length
    ? await db.select().from(schema.paymentMethods).where(inArray(schema.paymentMethods.personId, personIds)).orderBy(desc(schema.paymentMethods.createdAt))
    : [];

  const bsRows = await db
    .select({ bs: schema.bookingServices, service: schema.services })
    .from(schema.bookingServices)
    .innerJoin(schema.services, eq(schema.bookingServices.serviceId, schema.services.id))
    .where(eq(schema.bookingServices.bookingId, bookingId))
    .orderBy(asc(schema.bookingServices.createdAt), asc(schema.services.sortOrder));
  const fieldRows = bsRows.length ? await db.select().from(schema.serviceFields).where(inArray(schema.serviceFields.serviceId, bsRows.map((b) => b.service.id))) : [];
  const answers = bsRows.length ? await db.select().from(schema.fieldAnswers).where(inArray(schema.fieldAnswers.bookingServiceId, bsRows.map((b) => b.bs.id))) : [];
  const services = [];
  for (const { bs, service } of bsRows) {
    const fields = fieldRows.filter((f) => f.serviceId === service.id).sort((a, b) => a.sortOrder - b.sortOrder);
    const rendered = [];
    for (const f of fields) {
      const a = answers.find((x) => x.bookingServiceId === bs.id && x.fieldKey === f.key);
      if (!a) continue;
      rendered.push({ key: f.key, label: f.label, display: await renderAnswer(db, toFieldDef(f), a.value) });
    }
    services.push({
      id: bs.id,
      serviceId: service.id,
      name: service.name,
      source: bs.source,
      reason: bs.reason,
      acceptanceRequired: bs.acceptanceRequired,
      acceptedAt: bs.acceptedAt,
      createdAt: bs.createdAt,
      answers: rendered,
    });
  }
  // Drafts: show what they've entered so far.
  const draftAnswers = [];
  if (booking.lifecycle === "draft" && booking.draft) {
    const draftServices = await servicesWithFields(db, booking.draft.serviceIds);
    for (const f of mergeFields(draftServices.map((s) => ({ id: s.service.id, name: s.service.name, fields: s.fields })))) {
      const v = booking.draft.answers[f.key];
      if (v !== undefined) draftAnswers.push({ key: f.key, label: f.label, display: await renderAnswer(db, f, v) });
    }
    services.push(
      ...draftServices.map((s) => ({ id: `draft-${s.service.id}`, serviceId: s.service.id, name: s.service.name, source: "signup" as const, reason: null, acceptanceRequired: false, acceptedAt: null, createdAt: booking.createdAt, answers: [] })),
    );
  }

  const appts = await db
    .select({ appointment: schema.appointments, job: schema.jobs, crew: schema.crews })
    .from(schema.appointments)
    .leftJoin(schema.jobs, eq(schema.jobs.appointmentId, schema.appointments.id))
    .leftJoin(schema.crews, eq(schema.jobs.crewId, schema.crews.id))
    .where(eq(schema.appointments.bookingId, bookingId))
    .orderBy(asc(schema.appointments.date));
  const items = await db.select().from(schema.items).where(eq(schema.items.bookingId, bookingId)).orderBy(asc(schema.items.createdAt));
  const jobIds = appts.map((a) => a.job?.id).filter((x): x is string => !!x);
  const photos = jobIds.length
    ? await db.select({ id: schema.photos.id, jobId: schema.photos.jobId, itemId: schema.photos.itemId, kind: schema.photos.kind }).from(schema.photos).where(inArray(schema.photos.jobId, jobIds))
    : [];
  const rateItems = items.some((i) => i.rateCardItemId)
    ? await db.select().from(schema.rateCardItems).where(inArray(schema.rateCardItems.id, items.map((i) => i.rateCardItemId).filter((x): x is string => !!x)))
    : [];
  const ledger = await bookingLedger(db, bookingId);
  const messages = await db
    .select()
    .from(schema.messages)
    .where(or(eq(schema.messages.bookingId, bookingId), personIds.length ? inArray(schema.messages.personId, personIds) : sql`false`))
    .orderBy(desc(schema.messages.createdAt))
    .limit(60);
  const notes = await db.select().from(schema.notes).where(eq(schema.notes.bookingId, bookingId)).orderBy(desc(schema.notes.pinned), desc(schema.notes.createdAt));
  const staff = await db.select({ id: schema.staffUsers.id, name: schema.staffUsers.name }).from(schema.staffUsers);
  const relatedIds = [bookingId, ...ledger.invoices.map((i) => i.id), ...appts.map((a) => a.appointment.id), ...jobIds];
  const auditRows = await db.select().from(schema.auditEvents).where(inArray(schema.auditEvents.entityId, relatedIds)).orderBy(desc(schema.auditEvents.at)).limit(80);
  const claims = await db.select().from(schema.claims).where(eq(schema.claims.bookingId, bookingId)).orderBy(desc(schema.claims.createdAt));
  const referralsOut = await db.select().from(schema.referrals).where(eq(schema.referrals.referrerBookingId, bookingId));
  const [referredBy] = await db.select().from(schema.referrals).where(eq(schema.referrals.refereeBookingId, bookingId));
  const [collections] = await db.select().from(schema.collectionsCases).where(and(eq(schema.collectionsCases.bookingId, bookingId), ne(schema.collectionsCases.status, "resolved")));
  const otherBookings = personIds.length
    ? await db
        .select({ id: schema.bookings.id, confirmationNumber: schema.bookings.confirmationNumber, lifecycle: schema.bookings.lifecycle, season: schema.seasons.name })
        .from(schema.bookingParties)
        .innerJoin(schema.bookings, eq(schema.bookingParties.bookingId, schema.bookings.id))
        .innerJoin(schema.seasons, eq(schema.bookings.seasonId, schema.seasons.id))
        .where(and(inArray(schema.bookingParties.personId, personIds), ne(schema.bookings.id, bookingId)))
    : [];
  const funnel = booking.lifecycle === "draft" ? await db.select().from(schema.funnelEvents).where(eq(schema.funnelEvents.bookingId, bookingId)).orderBy(desc(schema.funnelEvents.at)).limit(30) : [];
  const staffName = (id: string | null) => staff.find((s) => s.id === id)?.name ?? null;

  return {
    id: booking.id,
    confirmationNumber: booking.confirmationNumber,
    season: { id: row.season.id, name: row.season.name },
    lifecycle: booking.lifecycle,
    flags: booking.flags,
    stepReached: booking.stepReached,
    lastActivityAt: booking.lastActivityAt,
    submittedAt: booking.submittedAt,
    createdAt: booking.createdAt,
    cancelReason: booking.cancelReason,
    school: row.school ? { id: row.school.id, name: row.school.name, shortName: row.school.shortName, color: row.school.color } : null,
    residence: row.residence ? { id: row.residence.id, name: row.residence.name, kind: row.residence.kind } : null,
    campus: campusOf(row.residence?.kind),
    room: booking.room,
    address: booking.address,
    storageLocation: booking.storageLocation,
    storageUntil: booking.storageUntil,
    heardFrom: booking.heardFrom,
    referralCode: booking.referralCode,
    enteredCode: booking.enteredCode,
    outreach: { outcome: booking.outreachOutcome, at: booking.outreachAt },
    people: partyRows.map(({ party, person }) => ({
      personId: person.id,
      name: `${person.firstName} ${person.lastName}`.trim() || "(no name yet)",
      firstName: person.firstName,
      lastName: person.lastName,
      roles: party.roles,
      contacts: contacts
        .filter((c) => c.personId === person.id)
        .map((c) => ({ id: c.id, kind: c.kind, value: c.value, display: c.kind === "phone" ? formatPhone(c.value) : c.value, verified: !!c.verifiedAt, sms: !!c.smsConsentAt && !c.smsOptOutAt, optedOut: !!c.smsOptOutAt, marketing: !!c.marketingConsentAt })),
      cards: cards.filter((c) => c.personId === person.id).map((c) => ({ id: c.id, brand: c.brand, last4: c.last4, exp: `${c.expMonth}/${c.expYear}`, active: c.active, provider: c.provider })),
    })),
    services,
    draftAnswers,
    appointments: appts.map(({ appointment, job, crew }) => ({
      id: appointment.id,
      type: appointment.type,
      date: appointment.date,
      windowId: appointment.windowId,
      window: windowLabel(appointment.windowId),
      address: appointment.address,
      room: appointment.room,
      notes: appointment.notes,
      overbooked: appointment.overbooked,
      cancelled: !!appointment.cancelledAt,
      serviceDayId: appointment.serviceDayId,
      job: job ? { id: job.id, status: job.status, crew: crew?.name ?? null, crewColor: crew?.color ?? null, completedAt: job.completedAt, signedByName: job.signedByName, trackingToken: job.trackingToken } : null,
    })),
    items: items.map((i) => ({
      id: i.id,
      name: rateItems.find((r) => r.id === i.rateCardItemId)?.name ?? i.description ?? "Other",
      description: i.description,
      quantity: i.quantity,
      deliveredQuantity: i.deliveredQuantity,
      status: i.status,
      damage: i.preExistingDamage,
      photoIds: photos.filter((p) => p.itemId === i.id).map((p) => p.id),
    })),
    otherPhotos: photos.filter((p) => !p.itemId).map((p) => ({ id: p.id, kind: p.kind })),
    ledger: {
      balanceCents: ledger.balanceCents,
      paymentStatus: ledger.paymentStatus,
      canClose: canClose({ invoices: ledger.invoices.map((i) => ({ id: i.id, status: i.status, lines: i.lines })), payments: ledger.payments.map((p) => ({ invoiceId: p.invoiceId, amountCents: p.amountCents, status: p.status, kind: p.kind })), writeOffs: ledger.writeOffs }),
      invoices: ledger.invoices.map((i) => ({
        id: i.id,
        status: i.status,
        source: i.source,
        waiveCardFee: i.waiveCardFee,
        createdAt: i.createdAt,
        issuedAt: i.issuedAt,
        approvedBy: staffName(i.approvedByStaffId),
        totalCents: i.totalCents,
        balanceCents: i.balanceCents,
        lines: i.lines.map((l) => ({ id: l.id, kind: l.kind, description: l.description, quantity: l.quantity, unitPriceCents: l.unitPriceCents, needsPrice: l.needsPrice, reason: l.reason, bookingServiceId: l.bookingServiceId })),
      })),
      payments: ledger.payments.map((p) => ({ id: p.id, kind: p.kind, amountCents: p.amountCents, status: p.status, provider: p.provider, providerRef: p.providerRef, failureMessage: p.failureMessage, createdAt: p.createdAt, invoiceId: p.invoiceId })),
      writeOffs: ledger.writeOffs.map((w) => ({ ...w, staff: staffName(w.staffUserId) })),
    },
    collections: collections ? { status: collections.status, failedAttempts: collections.failedAttempts, nextAttemptAt: collections.nextAttemptAt } : null,
    messages: messages.map((m) => ({ id: m.id, channel: m.channel, direction: m.direction, author: m.author, purpose: m.purpose, to: m.toAddress, subject: m.subject, body: m.body, status: m.status, at: m.createdAt })),
    notes: notes.map((n) => ({ ...n, staff: staffName(n.staffUserId) })),
    audit: auditRows.map((a) => ({ ...a, actor: a.actorType === "staff" ? (staffName(a.actorId) ?? "staff") : a.actorType })),
    claims,
    referrals: { made: referralsOut.length, referredBy: referredBy ? { code: referredBy.code, kind: referredBy.kind } : null },
    otherBookings,
    funnel,
  };
}

// ---------------------------------------------------------------------------------------------
// Staff actions

async function loadBooking(db: DbOrTx, bookingId: string) {
  const [booking] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, bookingId)).limit(1);
  if (!booking) throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found" });
  return booking;
}

export async function updateBooking(
  services: Services,
  actor: Actor,
  bookingId: string,
  patch: { flags?: string[]; storageLocation?: string | null; storageUntil?: string | null; room?: string | null; lifecycle?: (typeof LIFECYCLES)[number]; reason?: string | null },
) {
  const { db } = services;
  const before = await loadBooking(db, bookingId);
  const next: Partial<typeof schema.bookings.$inferInsert> = {};
  if (patch.flags) next.flags = [...new Set(patch.flags.map((f) => f.trim().toLowerCase().replace(/\s+/g, "_")).filter(Boolean))];
  if (patch.storageLocation !== undefined) next.storageLocation = patch.storageLocation?.trim() || null;
  if (patch.storageUntil !== undefined) next.storageUntil = patch.storageUntil || null;
  if (patch.room !== undefined) next.room = patch.room?.trim() || null;
  if (patch.lifecycle && patch.lifecycle !== before.lifecycle) {
    if (patch.lifecycle === "cancelled") throw new TRPCError({ code: "BAD_REQUEST", message: "Use Cancel booking" });
    if (patch.lifecycle === "draft") throw new TRPCError({ code: "BAD_REQUEST", message: "A booking can't go back to draft" });
    if (patch.lifecycle === "closed") {
      const ledger = await bookingLedger(db, bookingId);
      if (ledger.balanceCents !== 0) throw new TRPCError({ code: "BAD_REQUEST", message: `Balance is ${formatCents(ledger.balanceCents)}. Collect, refund, or write it off before closing.` });
    }
    if (!patch.reason?.trim()) throw new TRPCError({ code: "BAD_REQUEST", message: "Give a reason for changing the status by hand" });
    next.lifecycle = patch.lifecycle;
  }
  if (!Object.keys(next).length) return;
  await db.update(schema.bookings).set(next).where(eq(schema.bookings.id, bookingId));
  await audit(db, actor, "booking", bookingId, "updated", pick(before, Object.keys(next)), { ...next, reason: patch.reason ?? null });
}

function pick(obj: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries(keys.map((k) => [k, obj[k]]));
}

/** Cancels without deleting anything: appointments are marked cancelled and their jobs come off routes. */
export async function cancelBooking(services: Services, actor: Actor, bookingId: string, reason: string) {
  const { db } = services;
  const booking = await loadBooking(db, bookingId);
  if (["delivered", "closed", "cancelled"].includes(booking.lifecycle)) throw new TRPCError({ code: "BAD_REQUEST", message: `Booking is ${booking.lifecycle}` });
  if (!reason.trim()) throw new TRPCError({ code: "BAD_REQUEST", message: "Give a reason" });
  await db.transaction(async (tx) => {
    await tx.update(schema.bookings).set({ lifecycle: "cancelled", cancelledAt: new Date(), cancelReason: reason.trim() }).where(eq(schema.bookings.id, bookingId));
    const appts = await tx.select().from(schema.appointments).where(and(eq(schema.appointments.bookingId, bookingId), isNull(schema.appointments.cancelledAt)));
    for (const a of appts) {
      await tx.update(schema.appointments).set({ cancelledAt: new Date() }).where(eq(schema.appointments.id, a.id));
      await tx
        .update(schema.jobs)
        .set({ status: "on_hold", crewId: null, sequence: null })
        .where(and(eq(schema.jobs.appointmentId, a.id), ne(schema.jobs.status, "completed")));
    }
    await audit(tx, actor, "booking", bookingId, "cancelled", { lifecycle: booking.lifecycle }, { lifecycle: "cancelled", reason });
  });
}

export async function addNote(services: Services, staffId: string, bookingId: string, body: string, pinned: boolean) {
  await loadBooking(services.db, bookingId);
  const [note] = await services.db.insert(schema.notes).values({ bookingId, staffUserId: staffId, body: body.trim(), pinned }).returning();
  await audit(services.db, { type: "staff", id: staffId }, "booking", bookingId, "note_added", null, { noteId: note!.id });
  return note!;
}

export async function updatePerson(
  services: Services,
  actor: Actor,
  input: { bookingId: string; personId: string; firstName: string; lastName: string; email?: string | null; phone?: string | null; smsConsent?: boolean },
) {
  const { db } = services;
  const [party] = await db
    .select()
    .from(schema.bookingParties)
    .where(and(eq(schema.bookingParties.bookingId, input.bookingId), eq(schema.bookingParties.personId, input.personId)));
  if (!party) throw new TRPCError({ code: "NOT_FOUND" });
  const [before] = await db.select().from(schema.persons).where(eq(schema.persons.id, input.personId));
  const email = input.email ? normalizeEmail(input.email) : null;
  if (input.email && !email) throw new TRPCError({ code: "BAD_REQUEST", message: "Enter a valid email" });
  const phone = input.phone ? normalizePhone(input.phone) : null;
  if (input.phone && !phone) throw new TRPCError({ code: "BAD_REQUEST", message: "Enter a 10-digit phone number" });
  await db.transaction(async (tx) => {
    await tx.update(schema.persons).set({ firstName: input.firstName.trim(), lastName: input.lastName.trim() }).where(eq(schema.persons.id, input.personId));
    // A changed email/phone becomes a new contact point; old ones stay for history (and keep working for sign-in).
    const now = new Date();
    if (email) await tx.insert(schema.contactPoints).values({ personId: input.personId, kind: "email", value: email }).onConflictDoNothing();
    if (phone) {
      await tx.insert(schema.contactPoints).values({ personId: input.personId, kind: "phone", value: phone }).onConflictDoNothing();
      if (input.smsConsent !== undefined)
        await tx
          .update(schema.contactPoints)
          .set({ smsConsentAt: input.smsConsent ? now : null })
          .where(and(eq(schema.contactPoints.personId, input.personId), eq(schema.contactPoints.kind, "phone"), eq(schema.contactPoints.value, phone)));
    }
    await audit(tx, actor, "person", input.personId, "updated", before, { firstName: input.firstName, lastName: input.lastName, email, phone, smsConsent: input.smsConsent });
  });
}

/** Adds another parent/guardian (or any role) to a booking; they can sign in with that email or phone. */
export async function addParty(services: Services, actor: Actor, bookingId: string, role: "guardian" | "payer" | "customer", person: PersonAnswer) {
  const { db, config } = services;
  const booking = await loadBooking(db, bookingId);
  const personId = await db.transaction(async (tx) => {
    const id = await upsertPerson(tx, person);
    const [existing] = await tx.select().from(schema.bookingParties).where(and(eq(schema.bookingParties.bookingId, bookingId), eq(schema.bookingParties.personId, id)));
    if (existing) await tx.update(schema.bookingParties).set({ roles: [...new Set([...existing.roles, role])] }).where(and(eq(schema.bookingParties.bookingId, bookingId), eq(schema.bookingParties.personId, id)));
    else await tx.insert(schema.bookingParties).values({ bookingId, personId: id, roles: [role] });
    if (role === "guardian") {
      const [student] = (await tx.select().from(schema.bookingParties).where(eq(schema.bookingParties.bookingId, bookingId))).filter((p) => p.roles.includes("student"));
      if (student) await tx.insert(schema.personLinks).values({ guardianId: id, studentId: student.personId }).onConflictDoNothing();
    }
    await audit(tx, actor, "booking", bookingId, "party_added", null, { personId: id, role });
    return id;
  });
  if (person.email) {
    await sendEmail(services, {
      to: normalizeEmail(person.email)!,
      subject: `You've been added to CSS booking #${booking.confirmationNumber}`,
      text: `Hi ${person.firstName},\n\nYou now have access to College Student Storage booking #${booking.confirmationNumber}. Sign in with this email to see appointments, items, and billing: ${config.portalUrl}/account`,
      purpose: "access_invite",
      personId,
      bookingId,
    });
  }
  return personId;
}

/** Moves an appointment. Capacity is re-checked; moving to another date takes the job off its crew (legacy rule). */
export async function rescheduleAppointment(
  services: Services,
  actor: Actor,
  input: { appointmentId: string; date: string; windowId: string | null; serviceDayId: string | null; overbookReason?: string | null; notify: boolean },
) {
  const { db } = services;
  const [appt] = await db.select().from(schema.appointments).where(eq(schema.appointments.id, input.appointmentId));
  if (!appt || appt.cancelledAt) throw new TRPCError({ code: "NOT_FOUND" });
  const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.appointmentId, appt.id));
  if (job?.status === "completed") throw new TRPCError({ code: "BAD_REQUEST", message: "That appointment already happened" });
  await db.transaction(async (tx) => {
    let overbooked = false;
    if (input.serviceDayId && input.serviceDayId !== appt.serviceDayId) {
      overbooked = (await reserveServiceDay(tx, input.serviceDayId, input.overbookReason ? { reason: input.overbookReason } : null)).overbooked;
    }
    await tx
      .update(schema.appointments)
      .set({ date: input.date, windowId: input.windowId, serviceDayId: input.serviceDayId, overbooked })
      .where(eq(schema.appointments.id, appt.id));
    if (job && input.date !== appt.date) await tx.update(schema.jobs).set({ crewId: null, sequence: null, status: "unassigned" }).where(eq(schema.jobs.id, job.id));
    await audit(tx, actor, "appointment", appt.id, "rescheduled", { date: appt.date, windowId: appt.windowId }, { date: input.date, windowId: input.windowId, overbookReason: input.overbookReason ?? null });
  });
  if (input.notify) {
    const what = appt.type === "pickup" ? "pickup" : appt.type === "delivery" ? "delivery" : "appointment";
    const when = `${input.date} (${windowLabel(input.windowId)})`;
    await emailBooking(services, appt.bookingId, "appointment_changed", `Your CSS ${what} is now ${input.date}`, `Your ${what} has been moved to ${when}.`);
    await smsBooking(services, appt.bookingId, "appointment_changed", `CSS: Your ${what} is now ${when}.`);
  }
}

/** Adds an appointment for an existing booking service (e.g. scheduling a delivery). */
export async function addAppointment(
  services: Services,
  actor: Actor,
  input: { bookingId: string; type: "pickup" | "delivery" | "move" | "service"; date: string; windowId: string | null; serviceDayId: string | null; overbookReason?: string | null; notes?: string | null },
) {
  const { db } = services;
  const booking = await loadBooking(db, input.bookingId);
  const residence = booking.residenceId ? (await db.select().from(schema.residences).where(eq(schema.residences.id, booking.residenceId)))[0] : undefined;
  const school = booking.schoolId ? (await db.select().from(schema.schools).where(eq(schema.schools.id, booking.schoolId)))[0] : undefined;
  const [bs] = await db.select().from(schema.bookingServices).where(eq(schema.bookingServices.bookingId, input.bookingId)).limit(1);
  return db.transaction(async (tx) => {
    let overbooked = false;
    if (input.serviceDayId) overbooked = (await reserveServiceDay(tx, input.serviceDayId, input.overbookReason ? { reason: input.overbookReason } : null)).overbooked;
    const [appt] = await tx
      .insert(schema.appointments)
      .values({
        bookingId: input.bookingId,
        bookingServiceId: bs?.id ?? null,
        type: input.type,
        date: input.date,
        windowId: input.windowId,
        serviceDayId: input.serviceDayId,
        overbooked,
        address: booking.address ?? residence?.address ?? school?.name ?? "Address to confirm",
        lat: residence?.lat ?? school?.lat ?? 40.015,
        lng: residence?.lng ?? school?.lng ?? -105.2705,
        room: booking.room,
        notes: input.notes ?? null,
      })
      .returning();
    await tx.insert(schema.jobs).values({ appointmentId: appt!.id, status: "unassigned", trackingToken: trackingToken() });
    if (input.type === "delivery" && ["picked_up", "in_storage"].includes(booking.lifecycle))
      await tx.update(schema.bookings).set({ lifecycle: "delivery_scheduled" }).where(eq(schema.bookings.id, input.bookingId));
    await audit(tx, actor, "appointment", appt!.id, "created", null, { ...input });
    return appt!;
  });
}

export async function cancelAppointment(services: Services, actor: Actor, appointmentId: string, reason: string) {
  const { db } = services;
  const [appt] = await db.select().from(schema.appointments).where(eq(schema.appointments.id, appointmentId));
  if (!appt) throw new TRPCError({ code: "NOT_FOUND" });
  await db.update(schema.appointments).set({ cancelledAt: new Date() }).where(eq(schema.appointments.id, appointmentId));
  await db.update(schema.jobs).set({ status: "on_hold", crewId: null, sequence: null }).where(and(eq(schema.jobs.appointmentId, appointmentId), ne(schema.jobs.status, "completed")));
  await audit(db, actor, "appointment", appointmentId, "cancelled", { date: appt.date }, { reason });
}

/**
 * Add service (structured add-ons, Josh 2026-10-14): fields in staff mode, appointments, rate-card charges on
 * the open invoice, a reason, and a notice to the customer.
 */
export async function addService(
  services: Services,
  staffId: string,
  input: { bookingId: string; serviceId: string; answers: Record<string, unknown>; reason: string; acceptanceRequired: boolean; overbookReason?: string | null; notify: boolean },
) {
  const { db } = services;
  const booking = await loadBooking(db, input.bookingId);
  if (booking.lifecycle === "draft" || booking.lifecycle === "cancelled") throw new TRPCError({ code: "BAD_REQUEST", message: `Booking is ${booking.lifecycle}` });
  const [entry] = await servicesWithFields(db, [input.serviceId]);
  if (!entry) throw new TRPCError({ code: "NOT_FOUND", message: "Service not found" });
  const errors = validateAnswers(entry.fields, input.answers, { staffMode: true });
  if (Object.keys(errors).length) throw new TRPCError({ code: "BAD_REQUEST", message: Object.entries(errors).map(([k, v]) => `${k}: ${v}`).join("; ") });
  const result = await db.transaction(async (tx) => {
    const r = await materialize(tx, {
      booking,
      services: [entry],
      answers: input.answers,
      source: "staff_addon",
      staff: { id: staffId, reason: input.reason, overbookReason: input.overbookReason },
      acceptanceRequired: input.acceptanceRequired,
      confirm: false,
    });
    await audit(tx, { type: "staff", id: staffId }, "booking", booking.id, "service_added", null, { service: entry.service.name, reason: input.reason, estimate: r.estimate.laterCents });
    return r;
  });
  if (input.notify) {
    const est = result.estimate.lines.length ? ` Estimated: ${formatCents(result.estimate.laterCents)}.` : "";
    const accept = input.acceptanceRequired ? ` Please review and accept it here: ${services.config.portalUrl}/account/bookings/${booking.id}` : ` Details: ${services.config.portalUrl}/account/bookings/${booking.id}`;
    await emailBooking(services, booking.id, "service_added", `We added ${entry.service.name} to your CSS booking #${booking.confirmationNumber}`, `${entry.service.name} was added to booking #${booking.confirmationNumber}.${est}${accept}`);
    await smsBooking(services, booking.id, "service_added", `CSS: ${entry.service.name} was added to #${booking.confirmationNumber}.${est}${accept}`);
  }
  return { bookingServiceIds: result.bookingServices.map((b) => b.bookingServiceId), estimateCents: result.estimate.laterCents };
}

/** Staff-created booking (phone signups): fields in staff mode, no card required; the payer gets a link later. */
export async function createBookingByStaff(
  services: Services,
  staffId: string,
  input: { serviceIds: string[]; answers: Record<string, unknown>; seasonId?: string | null; overbookReason?: string | null; notify: boolean },
) {
  const { db } = services;
  const entries = await servicesWithFields(db, input.serviceIds);
  if (!entries.length) throw new TRPCError({ code: "BAD_REQUEST", message: "Pick at least one service" });
  const merged = mergeFields(entries.map((e) => ({ id: e.service.id, name: e.service.name, fields: e.fields })));
  const errors = validateAnswers(merged, input.answers, { staffMode: true });
  if (Object.keys(errors).length) throw new TRPCError({ code: "BAD_REQUEST", message: Object.entries(errors).map(([k, v]) => `${k}: ${v}`).join("; ") });
  const firstPerson = merged.find((f) => f.type === "person" && (input.answers[f.key] as PersonAnswer | undefined)?.firstName);
  if (!firstPerson) throw new TRPCError({ code: "BAD_REQUEST", message: "Enter at least the customer's or student's name" });
  const seasonId = input.seasonId ?? entries.find((e) => e.service.seasonId)?.service.seasonId ?? (await signupSeason(db)).id;
  const booking = await db.transaction(async (tx) => {
    const anchor = await upsertPerson(tx, input.answers[firstPerson.key] as PersonAnswer);
    const [draft] = await tx
      .insert(schema.bookings)
      .values({ seasonId, customerPersonId: anchor, lifecycle: "draft", stepReached: "review", lastActivityAt: new Date(), createdByStaffId: staffId })
      .returning();
    const r = await materialize(tx, { booking: draft!, services: entries, answers: input.answers, source: "signup", staff: { id: staffId, reason: "Created by staff", overbookReason: input.overbookReason }, confirm: true });
    const [customer] = await tx.select().from(schema.persons).where(eq(schema.persons.id, r.booking.customerPersonId));
    await tx.update(schema.bookings).set({ referralCode: await uniqueReferralCode(tx, customer?.firstName ?? "CSS") }).where(eq(schema.bookings.id, draft!.id));
    // The deposit is still owed: it goes on the open bill and is charged once the payer adds a card.
    const season = (await tx.select().from(schema.seasons).where(eq(schema.seasons.id, seasonId)))[0]!;
    if (entries.some((e) => e.service.chargesDeposit) && season.depositCents > 0) {
      await tx.insert(schema.invoiceLines).values({
        invoiceId: await openDraftInvoice(tx, draft!.id),
        bookingServiceId: r.bookingServices.find((b) => b.entry.service.chargesDeposit)?.bookingServiceId ?? null,
        description: "Sign-up fee / deposit",
        quantity: 1,
        unitPriceCents: season.depositCents,
      });
    }
    await audit(tx, { type: "staff", id: staffId }, "booking", draft!.id, "created_by_staff", null, { confirmationNumber: r.booking.confirmationNumber });
    return r.booking;
  });
  if (input.notify) await sendConfirmation(services, booking.id);
  return { bookingId: booking.id, confirmationNumber: booking.confirmationNumber };
}

/** Staff-sent message to people on a booking. SMS still requires consent and honors STOP. */
export async function messageBooking(
  services: Services,
  staffId: string,
  input: { bookingId: string; channel: "sms" | "email"; subject?: string | null; body: string; roles?: string[] },
) {
  const booking = await loadBooking(services.db, input.bookingId);
  const sent =
    input.channel === "sms"
      ? await smsBooking(services, input.bookingId, "staff_message", input.body, input.roles)
      : await emailBooking(services, input.bookingId, "staff_message", input.subject?.trim() || `About your CSS booking #${booking.confirmationNumber}`, input.body, input.roles);
  await audit(services.db, { type: "staff", id: staffId }, "booking", input.bookingId, "message_sent", null, { channel: input.channel, recipients: sent });
  return { sent };
}

/** Text one specific number (Hot leads, collections), only with consent. */
export async function textPerson(services: Services, staffId: string, input: { personId: string; bookingId: string | null; body: string }) {
  const [phone] = await services.db
    .select()
    .from(schema.contactPoints)
    .where(and(eq(schema.contactPoints.personId, input.personId), eq(schema.contactPoints.kind, "phone")))
    .limit(1);
  if (!phone) throw new TRPCError({ code: "BAD_REQUEST", message: "No phone on file" });
  if (!phone.smsConsentAt || phone.smsOptOutAt) throw new TRPCError({ code: "BAD_REQUEST", message: "They haven't agreed to texts. Email or call instead." });
  await sendSms(services, { to: phone.value, body: input.body, purpose: "staff_message", author: "staff", personId: input.personId, bookingId: input.bookingId });
  await audit(services.db, { type: "staff", id: staffId }, "person", input.personId, "texted", null, { bookingId: input.bookingId });
}

// ---------------------------------------------------------------------------------------------
// Billing actions

/**
 * A charge or discount on the booking's open invoice. Every line belongs to a service on the booking (add the
 * service first), and is a rate card item or has a reason (ad-hoc lines are reported).
 */
export async function addInvoiceLine(
  services: Services,
  staffId: string,
  input: {
    bookingId: string;
    bookingServiceId: string;
    kind: "charge" | "discount" | "adjustment";
    rateCardItemId?: string | null;
    description?: string | null;
    quantity: number;
    unitPriceCents?: number | null;
    reason?: string | null;
  },
) {
  const { db } = services;
  const booking = await loadBooking(db, input.bookingId);
  const [bs] = await db.select().from(schema.bookingServices).where(and(eq(schema.bookingServices.id, input.bookingServiceId), eq(schema.bookingServices.bookingId, input.bookingId)));
  if (!bs) throw new TRPCError({ code: "BAD_REQUEST", message: "Pick a service on this booking (add the service first if it's new)" });
  let description = input.description?.trim() ?? "";
  let unitPriceCents = input.unitPriceCents ?? null;
  if (input.rateCardItemId) {
    const [item] = await db.select().from(schema.rateCardItems).where(eq(schema.rateCardItems.id, input.rateCardItemId));
    if (!item || item.seasonId !== booking.seasonId) throw new TRPCError({ code: "BAD_REQUEST", message: "That price isn't on this season's rate card" });
    description ||= item.name;
    unitPriceCents ??= item.unitPriceCents;
  } else if (!input.reason?.trim()) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Lines that aren't on the rate card need a reason" });
  }
  if (!description) throw new TRPCError({ code: "BAD_REQUEST", message: "Describe the line" });
  if (unitPriceCents === null || !Number.isInteger(unitPriceCents) || unitPriceCents < 0) throw new TRPCError({ code: "BAD_REQUEST", message: "Enter a price" });
  const invoiceId = await openDraftInvoice(db, input.bookingId);
  const [line] = await db
    .insert(schema.invoiceLines)
    .values({
      invoiceId,
      bookingServiceId: bs.id,
      kind: input.kind,
      rateCardItemId: input.rateCardItemId ?? null,
      description,
      quantity: input.quantity,
      unitPriceCents,
      reason: input.reason?.trim() || null,
    })
    .returning();
  await audit(db, { type: "staff", id: staffId }, "invoice_line", line!.id, "added", null, line);
  return line!;
}

/** Draft lines can be voided (marked, never deleted) before the invoice is issued. */
export async function removeDraftLine(services: Services, staffId: string, lineId: string, reason: string) {
  const { db } = services;
  const [line] = await db.select().from(schema.invoiceLines).where(eq(schema.invoiceLines.id, lineId));
  if (!line) throw new TRPCError({ code: "NOT_FOUND" });
  const [invoice] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, line.invoiceId));
  if (!invoice || !["draft", "pending_review"].includes(invoice.status)) throw new TRPCError({ code: "BAD_REQUEST", message: "Issued invoices can't change; add an adjustment instead" });
  // Zero the line and keep it, with the reason, so the history shows what was proposed and why it came off.
  await db.update(schema.invoiceLines).set({ quantity: 0, needsPrice: false, reason: `Removed: ${reason}` }).where(eq(schema.invoiceLines.id, lineId));
  await audit(db, { type: "staff", id: staffId }, "invoice_line", lineId, "removed", line, { reason });
}

export async function setWaiveCardFee(services: Services, staffId: string, invoiceId: string, waive: boolean) {
  const { db } = services;
  const [invoice] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, invoiceId));
  if (!invoice || !["draft", "pending_review"].includes(invoice.status)) throw new TRPCError({ code: "BAD_REQUEST", message: "Only before approval" });
  await db.update(schema.invoices).set({ waiveCardFee: waive }).where(eq(schema.invoices.id, invoiceId));
  await audit(db, { type: "staff", id: staffId }, "invoice", invoiceId, waive ? "card_fee_waived" : "card_fee_restored");
}

export async function chargeBalanceNow(services: Services, staffId: string, invoiceId: string) {
  await audit(services.db, { type: "staff", id: staffId }, "invoice", invoiceId, "charge_requested");
  return chargeInvoice(services, invoiceId, "retry");
}

export async function refundPayment(services: Services, staffId: string, input: { paymentId: string; amountCents: number; reason: string }) {
  const { db, integrations } = services;
  const [payment] = await db.select().from(schema.payments).where(eq(schema.payments.id, input.paymentId));
  if (!payment || payment.kind !== "charge" || payment.status !== "succeeded") throw new TRPCError({ code: "BAD_REQUEST", message: "Only successful charges can be refunded" });
  const refunded = await db
    .select({ n: sql<number>`coalesce(sum(amount_cents), 0)::int` })
    .from(schema.payments)
    .where(and(eq(schema.payments.kind, "refund"), eq(schema.payments.status, "succeeded"), sql`idempotency_key like ${`${payment.id}:refund:%`}`));
  const remaining = payment.amountCents - (refunded[0]?.n ?? 0);
  if (input.amountCents <= 0 || input.amountCents > remaining) throw new TRPCError({ code: "BAD_REQUEST", message: `You can refund up to ${formatCents(remaining)}` });
  if (!input.reason.trim()) throw new TRPCError({ code: "BAD_REQUEST", message: "Give a reason" });
  const key = `${payment.id}:refund:${Date.now()}`;
  const result = await integrations.payments.refund({ providerRef: payment.providerRef ?? "", amountCents: input.amountCents, idempotencyKey: key });
  const [row] = await db
    .insert(schema.payments)
    .values({
      bookingId: payment.bookingId,
      invoiceId: payment.invoiceId,
      paymentMethodId: payment.paymentMethodId,
      provider: payment.provider,
      kind: "refund",
      amountCents: input.amountCents,
      status: result.status === "succeeded" ? "succeeded" : "failed",
      providerRef: result.status === "succeeded" ? result.providerRef : null,
      failureMessage: result.status === "failed" ? result.message : null,
      merchantInitiated: true,
      idempotencyKey: key,
    })
    .returning();
  await audit(db, { type: "staff", id: staffId }, "payment", row!.id, "refund", { paymentId: payment.id }, { amountCents: input.amountCents, reason: input.reason, status: row!.status });
  if (result.status === "failed") throw new TRPCError({ code: "BAD_REQUEST", message: `Refund failed: ${result.message}` });
  return row!;
}

/** Owner only (enforced by the router). Zeroes the balance with a recorded reason. */
export async function writeOff(services: Services, staffId: string, input: { bookingId: string; reason: string }) {
  const { db } = services;
  const ledger = await bookingLedger(db, input.bookingId);
  if (ledger.balanceCents <= 0) throw new TRPCError({ code: "BAD_REQUEST", message: "Nothing is owed" });
  if (!input.reason.trim()) throw new TRPCError({ code: "BAD_REQUEST", message: "Give a reason" });
  const [row] = await db.insert(schema.writeOffs).values({ bookingId: input.bookingId, amountCents: ledger.balanceCents, reason: input.reason.trim(), staffUserId: staffId }).returning();
  await db.update(schema.collectionsCases).set({ status: "resolved", nextAttemptAt: null, outcomeNote: `Written off: ${input.reason}` }).where(eq(schema.collectionsCases.bookingId, input.bookingId));
  await audit(db, { type: "staff", id: staffId }, "booking", input.bookingId, "written_off", { balanceCents: ledger.balanceCents }, { reason: input.reason });
  return row!;
}

export async function voidDraftInvoice(services: Services, staffId: string, invoiceId: string, reason: string) {
  const { db } = services;
  const [invoice] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, invoiceId));
  if (!invoice || !["draft", "pending_review"].includes(invoice.status)) throw new TRPCError({ code: "BAD_REQUEST", message: "Only unissued invoices can be voided" });
  await db.update(schema.invoices).set({ status: "void" }).where(eq(schema.invoices.id, invoiceId));
  await audit(db, { type: "staff", id: staffId }, "invoice", invoiceId, "voided", { status: invoice.status }, { reason });
}

export async function submitForReview(services: Services, staffId: string, invoiceId: string) {
  const { db } = services;
  const [invoice] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, invoiceId));
  if (!invoice || invoice.status !== "draft") throw new TRPCError({ code: "BAD_REQUEST", message: "Only drafts" });
  await db.update(schema.invoices).set({ status: "pending_review" }).where(eq(schema.invoices.id, invoiceId));
  await audit(db, { type: "staff", id: staffId }, "invoice", invoiceId, "submitted_for_review");
}

// ---------------------------------------------------------------------------------------------
// Lookups for forms

export async function formLookups(db: DbOrTx) {
  const seasons = await db.select().from(schema.seasons).orderBy(desc(schema.seasons.startsOn));
  const svc = await servicesWithFields(db);
  return {
    seasons: seasons.map((s) => ({ id: s.id, name: s.name })),
    schools: await activeSchools(db),
    services: svc.map((s) => ({ id: s.service.id, name: s.service.name, active: s.service.active, staffOnly: s.service.staffOnly, fields: s.fields })),
    today: localDate("America/Denver"),
  };
}
