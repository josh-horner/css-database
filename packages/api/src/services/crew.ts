/** Crew tablet actions (docs/apps/crew.md). Every action is scoped to the device's crew. */
import { TRPCError } from "@trpc/server";
import { and, asc, eq, gte, inArray, lte, ne, schema } from "@css/db";
import { nextStop, priceContract, type RateCardItem } from "@css/domain";
import type { Services } from "../context";
import { audit } from "./audit";
import { openDraftInvoice } from "./billing";
import { smsBooking } from "./messaging";
import { crewRouteState, queueForJob } from "./tracking";
import { localDate, windowLabel } from "./time";

async function jobForCrew(services: Services, crewId: string, jobId: string) {
  const [row] = await services.db
    .select({ job: schema.jobs, appointment: schema.appointments, booking: schema.bookings })
    .from(schema.jobs)
    .innerJoin(schema.appointments, eq(schema.jobs.appointmentId, schema.appointments.id))
    .innerJoin(schema.bookings, eq(schema.appointments.bookingId, schema.bookings.id))
    .where(and(eq(schema.jobs.id, jobId), eq(schema.jobs.crewId, crewId)))
    .limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "That stop isn't on this crew's route" });
  return row;
}

export async function crewToday(services: Services, crewId: string) {
  const { db } = services;
  const [crew] = await db.select().from(schema.crews).where(eq(schema.crews.id, crewId)).limit(1);
  if (!crew) throw new TRPCError({ code: "NOT_FOUND" });
  const members = await db
    .select({ id: schema.employees.id, firstName: schema.employees.firstName, lastName: schema.employees.lastName, role: schema.crewMembers.role })
    .from(schema.crewMembers)
    .innerJoin(schema.employees, eq(schema.crewMembers.employeeId, schema.employees.id))
    .where(eq(schema.crewMembers.crewId, crewId));

  const { rows, stops } = await crewRouteState(db, crewId);
  const bookingIds = rows.map((r) => r.appointment.bookingId);
  const bookingRows = bookingIds.length
    ? await db
        .select({ booking: schema.bookings, person: schema.persons, residence: schema.residences })
        .from(schema.bookings)
        .innerJoin(schema.persons, eq(schema.bookings.customerPersonId, schema.persons.id))
        .leftJoin(schema.residences, eq(schema.bookings.residenceId, schema.residences.id))
        .where(inArray(schema.bookings.id, bookingIds))
    : [];
  const phones = bookingRows.length
    ? await db
        .select()
        .from(schema.contactPoints)
        .where(and(inArray(schema.contactPoints.personId, bookingRows.map((b) => b.person.id)), eq(schema.contactPoints.kind, "phone")))
    : [];
  const jobIds = rows.map((r) => r.job.id);
  const itemRows = jobIds.length ? await db.select().from(schema.items).where(inArray(schema.items.jobId, jobIds)) : [];
  const photoRows = jobIds.length
    ? await db.select({ id: schema.photos.id, jobId: schema.photos.jobId, itemId: schema.photos.itemId, kind: schema.photos.kind }).from(schema.photos).where(inArray(schema.photos.jobId, jobIds))
    : [];

  const next = nextStop(stops);
  return {
    crew: { id: crew.id, name: crew.name, color: crew.color, vehicle: crew.vehicle, date: crew.date },
    members,
    nextJobId: next?.jobId ?? null,
    stops: rows.map(({ job, appointment }) => {
      const b = bookingRows.find((x) => x.booking.id === appointment.bookingId)!;
      return {
        jobId: job.id,
        sequence: job.sequence,
        status: job.status,
        type: appointment.type,
        window: windowLabel(appointment.windowId),
        address: appointment.address,
        lat: appointment.lat,
        lng: appointment.lng,
        room: appointment.room,
        notes: appointment.notes,
        confirmationNumber: b.booking.confirmationNumber,
        customerName: `${b.person.firstName} ${b.person.lastName}`,
        customerPhone: phones.find((p) => p.personId === b.person.id)?.value ?? null,
        residence: b.residence?.name ?? null,
        signedByName: job.signedByName,
        items: itemRows
          .filter((i) => i.jobId === job.id)
          .map((i) => ({
            id: i.id,
            clientId: i.clientId,
            rateCardItemId: i.rateCardItemId,
            description: i.description,
            quantity: i.quantity,
            preExistingDamage: i.preExistingDamage,
            photoIds: photoRows.filter((p) => p.itemId === i.id).map((p) => p.id),
          })),
        deliveryPhotoCount: photoRows.filter((p) => p.jobId === job.id && p.kind === "delivery").length,
        hasSignature: photoRows.some((p) => p.jobId === job.id && p.kind === "signature"),
      };
    }),
  };
}

export async function contractPicker(services: Services, crewId: string) {
  const [crew] = await services.db.select().from(schema.crews).where(eq(schema.crews.id, crewId)).limit(1);
  if (!crew) return [];
  const [season] = await services.db
    .select()
    .from(schema.seasons)
    .where(and(lte(schema.seasons.startsOn, crew.date), gte(schema.seasons.endsOn, crew.date)))
    .orderBy(asc(schema.seasons.startsOn))
    .limit(1);
  if (!season) return [];
  return services.db
    .select({ id: schema.rateCardItems.id, name: schema.rateCardItems.name, category: schema.rateCardItems.category, unitPriceCents: schema.rateCardItems.unitPriceCents })
    .from(schema.rateCardItems)
    .where(and(eq(schema.rateCardItems.seasonId, season.id), eq(schema.rateCardItems.onContract, true), eq(schema.rateCardItems.active, true)))
    .orderBy(asc(schema.rateCardItems.sortOrder));
}

export async function onMyWay(services: Services, crewId: string, jobId: string, deviceId: string) {
  const { db, config } = services;
  const row = await jobForCrew(services, crewId, jobId);
  if (row.job.status === "completed") throw new TRPCError({ code: "BAD_REQUEST", message: "That stop is already done" });
  // One stop at a time: anything else en route goes back to the queue.
  await db
    .update(schema.jobs)
    .set({ status: "assigned", enRouteAt: null })
    .where(and(eq(schema.jobs.crewId, crewId), eq(schema.jobs.status, "en_route"), ne(schema.jobs.id, jobId)));
  await db.update(schema.jobs).set({ status: "en_route", enRouteAt: new Date() }).where(eq(schema.jobs.id, jobId));
  await audit(db, { type: "device", id: deviceId }, "job", jobId, "en_route");

  const q = await queueForJob(db, jobId, config.timeZone);
  const [person] = await db.select().from(schema.persons).where(eq(schema.persons.id, row.booking.customerPersonId));
  const eta = q ? `ETA about ${q.view.etaMinutes} min (around ${q.etaLabel}).` : "";
  const body = `CSS: Hi ${person?.firstName ?? "there"}! Your CSS crew is on the way for your ${row.appointment.type}. ${eta} Track them live: ${config.portalUrl}/t/${row.job.trackingToken}`;
  const sent = await smsBooking(services, row.booking.id, "on_my_way", body);
  return { notified: sent };
}

export async function arrive(services: Services, crewId: string, jobId: string, deviceId: string) {
  await jobForCrew(services, crewId, jobId);
  await services.db.update(schema.jobs).set({ status: "arrived", arrivedAt: new Date() }).where(eq(schema.jobs.id, jobId));
  await audit(services.db, { type: "device", id: deviceId }, "job", jobId, "arrived");
}

export async function saveItem(
  services: Services,
  crewId: string,
  input: { jobId: string; clientId: string; rateCardItemId: string | null; description: string | null; quantity: number; preExistingDamage: string | null },
) {
  const row = await jobForCrew(services, crewId, input.jobId);
  if (row.job.status === "completed") throw new TRPCError({ code: "BAD_REQUEST", message: "This contract is already signed" });
  // Validate with the same rules that price it.
  priceContract([{ rateCardItemId: input.rateCardItemId, description: input.description, quantity: input.quantity }], await rateCardFor(services, input.rateCardItemId));
  const values = {
    bookingId: row.booking.id,
    jobId: input.jobId,
    rateCardItemId: input.rateCardItemId,
    description: input.description?.trim() || null,
    quantity: input.quantity,
    preExistingDamage: input.preExistingDamage?.trim() || null,
    clientId: input.clientId,
    source: "crew" as const,
  };
  const [item] = await services.db
    .insert(schema.items)
    .values(values)
    .onConflictDoUpdate({ target: schema.items.clientId, set: values })
    .returning();
  return item!;
}

async function rateCardFor(services: Services, rateCardItemId: string | null): Promise<RateCardItem[]> {
  if (!rateCardItemId) return [];
  const rows = await services.db.select().from(schema.rateCardItems).where(eq(schema.rateCardItems.id, rateCardItemId));
  return rows.map((r) => ({ id: r.id, code: r.code, name: r.name, unitPriceCents: r.unitPriceCents, active: r.active }));
}

export async function removeItem(services: Services, crewId: string, itemId: string) {
  const [item] = await services.db.select().from(schema.items).where(eq(schema.items.id, itemId)).limit(1);
  if (!item?.jobId) throw new TRPCError({ code: "NOT_FOUND" });
  const row = await jobForCrew(services, crewId, item.jobId);
  if (row.job.status === "completed") throw new TRPCError({ code: "BAD_REQUEST", message: "This contract is already signed" });
  await services.db.delete(schema.photos).where(eq(schema.photos.itemId, itemId));
  await services.db.delete(schema.items).where(eq(schema.items.id, itemId));
}

/**
 * Customer signs; the contract becomes a draft invoice awaiting the owner's approval (nothing is retyped).
 * Deliveries require delivery photos before completion.
 */
export async function completeJob(services: Services, crewId: string, jobId: string, signedByName: string | null, deviceId: string) {
  const { db } = services;
  const row = await jobForCrew(services, crewId, jobId);
  if (row.job.status === "completed") return { invoiceId: null };
  const photos = await db.select().from(schema.photos).where(eq(schema.photos.jobId, jobId));
  const items = await db.select().from(schema.items).where(eq(schema.items.jobId, jobId));

  if (row.appointment.type === "pickup" && items.length === 0)
    throw new TRPCError({ code: "BAD_REQUEST", message: "Add at least one item to the contract" });
  if (row.appointment.type === "delivery" && !photos.some((p) => p.kind === "delivery"))
    throw new TRPCError({ code: "BAD_REQUEST", message: "Take delivery photos before completing" });
  if (!signedByName?.trim() && !photos.some((p) => p.kind === "signature"))
    throw new TRPCError({ code: "BAD_REQUEST", message: "Get a signature, or a photo if nobody is there" });

  const rateIds = items.map((i) => i.rateCardItemId).filter((x): x is string => !!x);
  const rateRows = rateIds.length ? await db.select().from(schema.rateCardItems).where(inArray(schema.rateCardItems.id, rateIds)) : [];
  const priced = priceContract(
    items.map((i) => ({ rateCardItemId: i.rateCardItemId, description: i.description, quantity: i.quantity })),
    rateRows.map((r) => ({ id: r.id, code: r.code, name: r.name, unitPriceCents: r.unitPriceCents, active: r.active })),
  );

  let invoiceId: string | null = null;
  await db.transaction(async (tx) => {
    await tx.update(schema.jobs).set({ status: "completed", completedAt: new Date(), signedByName: signedByName?.trim() || null }).where(eq(schema.jobs.id, jobId));
    if (row.appointment.type === "delivery") {
      // Delivered = every line's quantity checked off; a shortfall is handled from admin as missing.
      const lines = await tx.select().from(schema.items).where(eq(schema.items.bookingId, row.booking.id));
      for (const line of lines.filter((l) => l.status !== "missing")) {
        await tx.update(schema.items).set({ status: "delivered", deliveredQuantity: line.quantity }).where(eq(schema.items.id, line.id));
      }
      await tx.update(schema.bookings).set({ lifecycle: "delivered" }).where(eq(schema.bookings.id, row.booking.id));
      await audit(tx, { type: "device", id: deviceId }, "booking", row.booking.id, "delivered");
      return;
    }
    if (row.appointment.type !== "pickup") return;
    await tx.update(schema.bookings).set({ lifecycle: "picked_up" }).where(eq(schema.bookings.id, row.booking.id));
    // The contract joins whatever is already on the booking's open bill (add-ons, discounts), so the owner
    // approves one invoice.
    const services = await tx.select().from(schema.bookingServices).where(eq(schema.bookingServices.bookingId, row.booking.id));
    const service = services.find((s) => s.id === row.appointment.bookingServiceId) ?? services[0];
    const openId = await openDraftInvoice(tx, row.booking.id);
    const [invoice] = await tx
      .update(schema.invoices)
      .set({ jobId, status: "pending_review", source: "contract" })
      .where(eq(schema.invoices.id, openId))
      .returning();
    invoiceId = invoice!.id;
    await tx.insert(schema.invoiceLines).values(
      priced.map((line, idx) => ({
        invoiceId: invoice!.id,
        bookingServiceId: service?.id ?? null,
        kind: line.kind,
        rateCardItemId: line.rateCardItemId,
        itemId: items[idx]!.id,
        description: line.description,
        quantity: line.quantity,
        unitPriceCents: line.unitPriceCents,
        needsPrice: line.needsPrice,
        reason: line.rateCardItemId ? null : "Crew entered an item not on the rate card",
      })),
    );
    await audit(tx, { type: "device", id: deviceId }, "invoice", invoice!.id, "drafted_from_contract");
  });

  if (row.appointment.type === "pickup") {
    const lines = priced.map((l) => `${l.quantity}× ${l.description}`).join(", ");
    await smsBooking(
      services,
      row.booking.id,
      "pickup_receipt",
      `CSS: Pickup complete for #${row.booking.confirmationNumber}. We picked up: ${lines}. Your bill follows after review. Thanks!`,
    );
  }
  return { invoiceId };
}

export async function recordLocations(
  services: Services,
  crewId: string,
  deviceId: string,
  points: { lat: number; lng: number; accuracyM: number | null; recordedAt: Date }[],
) {
  if (!points.length) return;
  await services.db.insert(schema.crewLocations).values(points.map((p) => ({ crewId, deviceId, ...p })));
}

export async function deviceCrewForToday(services: Services, device: { id: string; assignedCrewId: string | null }) {
  if (!device.assignedCrewId) return null;
  const [crew] = await services.db.select().from(schema.crews).where(eq(schema.crews.id, device.assignedCrewId)).limit(1);
  if (!crew) return null;
  // A device stays paired to its crew; the date tells the app whether it's today's assignment.
  return { crewId: crew.id, isToday: crew.date === localDate(services.config.timeZone) };
}
