/**
 * Turns answers into real records. Shared by customer signup, staff-created bookings, and "Add service":
 * persons + contact points (with consent), parties, booking services, field answers, appointments (capacity
 * checked), jobs, and rate-card charges on the booking's open invoice.
 */
import { randomBytes } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, eq, inArray, ne, schema, type DbOrTx } from "@css/db";
import {
  estimateBooking,
  isSignerField,
  isVisible,
  mergeFields,
  nextConfirmationNumber,
  normalizeEmail,
  normalizePhone,
  type AppointmentAnswer,
  type MergedField,
  type PersonAnswer,
  type ResidenceAnswer,
} from "@css/domain";
import type { CatalogService } from "./catalog";
import { priceList } from "./catalog";
import { openDraftInvoice } from "./billing";
import { reserveServiceDay } from "./capacity";

type Tx = DbOrTx;
export type PartyRole = "customer" | "student" | "guardian" | "payer" | "signer";

/** Finds a person by email (any contact point), else creates one; adds missing contacts and consent. */
export async function upsertPerson(tx: Tx, answer: PersonAnswer, existingPersonId: string | null = null) {
  const email = answer.email ? normalizeEmail(answer.email) : null;
  const phone = answer.phone ? normalizePhone(answer.phone) : null;
  let personId = existingPersonId;
  if (!personId && email) {
    const [match] = await tx
      .select({ personId: schema.contactPoints.personId })
      .from(schema.contactPoints)
      .where(and(eq(schema.contactPoints.kind, "email"), eq(schema.contactPoints.value, email)))
      .limit(1);
    personId = match?.personId ?? null;
  }
  if (personId) {
    await tx.update(schema.persons).set({ firstName: answer.firstName.trim(), lastName: answer.lastName.trim() }).where(eq(schema.persons.id, personId));
  } else {
    const [created] = await tx.insert(schema.persons).values({ firstName: answer.firstName.trim(), lastName: answer.lastName.trim() }).returning();
    personId = created!.id;
  }
  const now = new Date();
  if (email) {
    await tx.insert(schema.contactPoints).values({ personId, kind: "email", value: email }).onConflictDoNothing();
  }
  if (phone) {
    await tx
      .insert(schema.contactPoints)
      .values({ personId, kind: "phone", value: phone, smsConsentAt: answer.smsConsent ? now : null })
      .onConflictDoNothing();
    if (answer.smsConsent) {
      await tx
        .update(schema.contactPoints)
        .set({ smsConsentAt: now, smsOptOutAt: null })
        .where(and(eq(schema.contactPoints.personId, personId), eq(schema.contactPoints.kind, "phone"), eq(schema.contactPoints.value, phone)));
    }
  }
  return personId;
}

async function addRoles(tx: Tx, bookingId: string, personId: string, roles: PartyRole[]) {
  const [existing] = await tx
    .select()
    .from(schema.bookingParties)
    .where(and(eq(schema.bookingParties.bookingId, bookingId), eq(schema.bookingParties.personId, personId)))
    .limit(1);
  if (existing) {
    const merged = [...new Set([...existing.roles, ...roles])];
    await tx.update(schema.bookingParties).set({ roles: merged }).where(and(eq(schema.bookingParties.bookingId, bookingId), eq(schema.bookingParties.personId, personId)));
  } else {
    await tx.insert(schema.bookingParties).values({ bookingId, personId, roles });
  }
}

export async function partiesOf(tx: Tx, bookingId: string) {
  return tx.select().from(schema.bookingParties).where(eq(schema.bookingParties.bookingId, bookingId));
}

const roleOfPersonField = (f: MergedField) => f.config.role ?? "customer";

/**
 * Persons for every person field. The signer (whoever filled the form) is matched to the role they said they
 * are; existing parties fill roles the answers leave empty (staff mode, add-ons).
 */
export async function resolvePersons(
  tx: Tx,
  fields: readonly MergedField[],
  answers: Record<string, unknown>,
  opts: { bookingId: string | null; signer?: { personId: string; role: "student" | "guardian" | "other" } | null },
) {
  const existing = opts.bookingId ? await partiesOf(tx, opts.bookingId) : [];
  const byRole = new Map<string, string>();
  for (const p of existing) for (const r of p.roles) if (!byRole.has(r)) byRole.set(r, p.personId);
  const resolved: { key: string; role: string; personId: string }[] = [];
  for (const field of fields) {
    if (field.type !== "person" || !isVisible(field, answers)) continue;
    const role = roleOfPersonField(field);
    const answer = answers[field.key] as PersonAnswer | undefined;
    const signerMatches = !!opts.signer && isSignerField(field, opts.signer.role);
    if (answer?.firstName) {
      const personId = await upsertPerson(tx, answer, signerMatches ? opts.signer!.personId : (byRole.get(role) ?? null));
      resolved.push({ key: field.key, role, personId });
    } else if (byRole.get(role)) {
      resolved.push({ key: field.key, role, personId: byRole.get(role)! });
    }
  }
  return resolved;
}

async function allocateConfirmationNumber(tx: Tx, seasonId: string): Promise<number> {
  // Serialize allocation per season (fixes legacy's read-then-write race).
  await tx.select({ id: schema.seasons.id }).from(schema.seasons).where(eq(schema.seasons.id, seasonId)).for("update");
  const taken = await tx
    .select({ n: schema.bookings.confirmationNumber })
    .from(schema.bookings)
    .where(and(eq(schema.bookings.seasonId, seasonId), ne(schema.bookings.lifecycle, "cancelled")));
  // Numbers still on the shelf from earlier seasons (abroad/semester storage) are taken too.
  const onShelf = await tx
    .select({ n: schema.bookings.confirmationNumber })
    .from(schema.bookings)
    .where(and(ne(schema.bookings.seasonId, seasonId), inArray(schema.bookings.lifecycle, ["picked_up", "in_storage", "delivery_scheduled"])));
  const nums = (rows: { n: number | null }[]) => rows.map((r) => r.n).filter((n): n is number => n !== null);
  return nextConfirmationNumber(nums(taken), nums(onShelf));
}

export function trackingToken() {
  return randomBytes(18).toString("base64url");
}

export interface MaterializeInput {
  booking: typeof schema.bookings.$inferSelect;
  services: readonly CatalogService[];
  answers: Record<string, unknown>;
  source: "signup" | "staff_addon" | "customer_addon";
  signer?: { personId: string; role: "student" | "guardian" | "other" } | null;
  staff?: { id: string; reason: string | null; overbookReason?: string | null } | null;
  acceptanceRequired?: boolean;
  /** Assign a confirmation number and mark confirmed (new bookings). */
  confirm: boolean;
  discounts?: { description: string; amountCents: number; reason: string }[];
}

export async function materialize(tx: Tx, input: MaterializeInput) {
  const { booking } = input;
  const fields = mergeFields(input.services.map((s) => ({ id: s.service.id, name: s.service.name, fields: s.fields })));
  const persons = await resolvePersons(tx, fields, input.answers, { bookingId: booking.id, signer: input.signer });

  // Parties and roles.
  const student = persons.find((p) => p.role === "student");
  const customerPerson = student ?? persons.find((p) => p.role === "customer");
  for (const p of persons) {
    const roles: PartyRole[] = p.role === "student" ? ["customer", "student"] : p.role === "guardian" ? ["guardian"] : ["customer"];
    await addRoles(tx, booking.id, p.personId, roles);
  }
  for (const g of persons.filter((p) => p.role === "guardian")) {
    if (student) await tx.insert(schema.personLinks).values({ guardianId: g.personId, studentId: student.personId }).onConflictDoNothing();
  }
  if (input.signer) await addRoles(tx, booking.id, input.signer.personId, ["signer", "payer"]);
  else if (input.confirm) {
    // Staff-created: the guardian pays if there is one, otherwise the customer.
    const payer = persons.find((p) => p.role === "guardian") ?? customerPerson;
    if (payer) await addRoles(tx, booking.id, payer.personId, ["payer"]);
  }

  // School and residence on the booking.
  const patch: Partial<typeof schema.bookings.$inferInsert> = {};
  const schoolField = fields.find((f) => f.type === "school");
  const residenceField = fields.find((f) => f.type === "residence");
  if (schoolField && typeof input.answers[schoolField.key] === "string") patch.schoolId = input.answers[schoolField.key] as string;
  const residenceAnswer = residenceField ? (input.answers[residenceField.key] as ResidenceAnswer | undefined) : undefined;
  if (residenceAnswer?.residenceId) {
    patch.residenceId = residenceAnswer.residenceId;
    patch.room = residenceAnswer.room ?? null;
    patch.address = residenceAnswer.address ?? null;
  }
  if (customerPerson && customerPerson.personId !== booking.customerPersonId) patch.customerPersonId = customerPerson.personId;
  if (input.confirm) {
    patch.confirmationNumber = await allocateConfirmationNumber(tx, booking.seasonId);
    patch.lifecycle = "confirmed";
    patch.submittedAt = new Date();
    patch.stepReached = "done";
    patch.draft = null;
  }
  const [updated] = Object.keys(patch).length
    ? await tx.update(schema.bookings).set(patch).where(eq(schema.bookings.id, booking.id)).returning()
    : await tx.select().from(schema.bookings).where(eq(schema.bookings.id, booking.id));

  // Booking services and their answers.
  const created: { bookingServiceId: string; entry: CatalogService }[] = [];
  for (const entry of input.services) {
    const [bs] = await tx
      .insert(schema.bookingServices)
      .values({
        bookingId: booking.id,
        serviceId: entry.service.id,
        source: input.source,
        reason: input.staff?.reason ?? null,
        addedByStaffId: input.staff?.id ?? null,
        acceptanceRequired: input.acceptanceRequired ?? false,
      })
      .returning();
    created.push({ bookingServiceId: bs!.id, entry });
    for (const field of entry.fields) {
      if (!isVisible(field, input.answers)) continue;
      const value = input.answers[field.key];
      if (value === undefined || value === null || value === "") continue;
      const refId =
        field.type === "person"
          ? (persons.find((p) => p.key === field.key)?.personId ?? null)
          : field.type === "school"
            ? (value as string)
            : field.type === "residence"
              ? (value as ResidenceAnswer).residenceId
              : null;
      await tx.insert(schema.fieldAnswers).values({ bookingServiceId: bs!.id, fieldKey: field.key, value, refId }).onConflictDoNothing();
    }
  }

  // Appointments (once per key) and their jobs.
  const residence = updated!.residenceId
    ? (await tx.select().from(schema.residences).where(eq(schema.residences.id, updated!.residenceId)).limit(1))[0]
    : undefined;
  const school = updated!.schoolId ? (await tx.select().from(schema.schools).where(eq(schema.schools.id, updated!.schoolId)).limit(1))[0] : undefined;
  const appointments = [];
  for (const field of fields.filter((f) => f.type === "appointment" && isVisible(f, input.answers))) {
    const answer = input.answers[field.key] as AppointmentAnswer | undefined;
    if (!answer?.date) continue;
    const owner = created.find((c) => field.serviceIds.includes(c.entry.service.id))!;
    let overbooked = false;
    if (answer.serviceDayId) {
      const r = await reserveServiceDay(tx, answer.serviceDayId, input.staff?.overbookReason ? { reason: input.staff.overbookReason } : null);
      overbooked = r.overbooked;
    }
    const addressKey = field.config.addressKey ?? fields.find((f) => f.type === "address")?.key;
    const typedAddress = addressKey && typeof input.answers[addressKey] === "string" ? (input.answers[addressKey] as string) : null;
    const address = residence ? (updated!.address ?? residence.address) : (typedAddress ?? school?.name ?? "Address to confirm");
    const [appointment] = await tx
      .insert(schema.appointments)
      .values({
        bookingId: booking.id,
        bookingServiceId: owner.bookingServiceId,
        type: field.config.appointmentType ?? "pickup",
        date: answer.date,
        windowId: answer.windowId ?? null,
        serviceDayId: answer.serviceDayId ?? null,
        overbooked,
        address,
        // No geocoder yet: residence or school coordinates, else Boulder (docs/demo.md shortcuts).
        lat: residence?.lat ?? school?.lat ?? 40.015,
        lng: residence?.lng ?? school?.lng ?? -105.2705,
        room: residence ? (updated!.room ?? null) : null,
        notes: answer.special ? "Special pickup requested" : null,
      })
      .returning();
    await tx.insert(schema.jobs).values({ appointmentId: appointment!.id, status: "unassigned", trackingToken: trackingToken() });
    appointments.push(appointment!);
  }

  // Known charges from the rate card go on the booking's open invoice for the owner to approve later.
  const prices = await priceList(tx, booking.seasonId);
  const estimate = estimateBooking({
    services: input.services.map((s) => ({ id: s.service.id, name: s.service.name, chargesDeposit: false, baseRateCardCode: s.service.baseRateCardCode, fields: s.fields })),
    answers: input.answers,
    priceList: prices,
    depositCents: 0,
  });
  const discounts = input.discounts ?? [];
  if (estimate.lines.length || discounts.length) {
    const invoiceId = await openDraftInvoice(tx, booking.id);
    for (const line of estimate.lines) {
      await tx.insert(schema.invoiceLines).values({
        invoiceId,
        bookingServiceId: created.find((c) => c.entry.service.id === line.serviceId)?.bookingServiceId ?? created[0]?.bookingServiceId ?? null,
        kind: "charge",
        rateCardItemId: prices.find((p) => p.code === line.rateCardCode)?.id ?? null,
        description: line.description,
        quantity: line.quantity,
        unitPriceCents: line.unitPriceCents,
      });
    }
    for (const d of discounts) {
      await tx.insert(schema.invoiceLines).values({
        invoiceId,
        bookingServiceId: created[0]?.bookingServiceId ?? null,
        kind: "discount",
        description: d.description,
        quantity: 1,
        unitPriceCents: d.amountCents,
        reason: d.reason,
      });
    }
  }

  return { booking: updated!, bookingServices: created, appointments, persons, estimate };
}

/** Throws unless a service-days appointment answer points at a real window for this school and type. */
export async function checkSlotAnswer(db: DbOrTx, answer: AppointmentAnswer, expect: { schoolId: string | null; type: string }) {
  if (!answer.serviceDayId) return;
  const [day] = await db.select().from(schema.serviceDays).where(eq(schema.serviceDays.id, answer.serviceDayId)).limit(1);
  if (!day || day.schoolId !== expect.schoolId || day.type !== expect.type || day.date !== answer.date)
    throw new TRPCError({ code: "BAD_REQUEST", message: "Pick a window from the list" });
}
