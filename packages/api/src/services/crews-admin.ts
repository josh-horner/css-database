/**
 * Daily crews and job assignment (docs/domain-model.md#appointment-job-dispatch): crews are formed per day,
 * jobs are assigned to a crew for the day, and publishing texts each employee their crew.
 */
import { TRPCError } from "@trpc/server";
import { and, asc, eq, inArray, isNull, ne, schema, sql, type DbOrTx } from "@css/db";
import { formatPhone, normalizePhone } from "@css/domain";
import type { Services } from "../context";
import { audit } from "./audit";
import { bookingLedger } from "./billing";
import { reservedCounts } from "./capacity";
import { sendSms } from "./messaging";
import { getSettings } from "./settings";
import { windowLabel } from "./time";

const CREW_COLORS = ["#2563EB", "#DC2626", "#16A34A", "#9333EA", "#EA580C", "#0891B2", "#CA8A04", "#DB2777"];

export async function crewDay(db: DbOrTx, date: string) {
  const crews = await db.select().from(schema.crews).where(eq(schema.crews.date, date)).orderBy(asc(schema.crews.name));
  const crewIds = crews.map((c) => c.id);
  const members = crewIds.length
    ? await db
        .select({ crewId: schema.crewMembers.crewId, role: schema.crewMembers.role, employee: schema.employees })
        .from(schema.crewMembers)
        .innerJoin(schema.employees, eq(schema.crewMembers.employeeId, schema.employees.id))
        .where(inArray(schema.crewMembers.crewId, crewIds))
    : [];
  const devices = await db.select().from(schema.devices).orderBy(asc(schema.devices.name));
  const jobs = await db
    .select({ job: schema.jobs, appointment: schema.appointments, booking: schema.bookings, person: schema.persons, school: schema.schools, residence: schema.residences })
    .from(schema.jobs)
    .innerJoin(schema.appointments, eq(schema.jobs.appointmentId, schema.appointments.id))
    .innerJoin(schema.bookings, eq(schema.appointments.bookingId, schema.bookings.id))
    .innerJoin(schema.persons, eq(schema.bookings.customerPersonId, schema.persons.id))
    .leftJoin(schema.schools, eq(schema.bookings.schoolId, schema.schools.id))
    .leftJoin(schema.residences, eq(schema.bookings.residenceId, schema.residences.id))
    .where(and(eq(schema.appointments.date, date), isNull(schema.appointments.cancelledAt), ne(schema.bookings.lifecycle, "cancelled")))
    .orderBy(asc(schema.jobs.sequence), asc(schema.appointments.windowId));
  const employees = await db.select().from(schema.employees).where(eq(schema.employees.active, true)).orderBy(asc(schema.employees.firstName));
  const assigned = new Set(members.map((m) => m.employee.id));
  const settings = await getSettings(db);

  // No release without payment: deliveries for past-due bookings show as on hold.
  const pastDue = new Set<string>();
  for (const j of jobs.filter((x) => x.appointment.type === "delivery")) {
    if ((await bookingLedger(db, j.booking.id)).paymentStatus === "past_due") pastDue.add(j.job.id);
  }
  const jobView = (j: (typeof jobs)[number]) => ({
    jobId: j.job.id,
    crewId: j.job.crewId,
    sequence: j.job.sequence,
    status: j.job.status,
    type: j.appointment.type,
    window: windowLabel(j.appointment.windowId),
    windowId: j.appointment.windowId,
    address: j.appointment.address,
    room: j.appointment.room,
    lat: j.appointment.lat,
    lng: j.appointment.lng,
    school: j.school?.shortName ?? null,
    schoolColor: j.school?.color ?? null,
    residence: j.residence?.name ?? null,
    bookingId: j.booking.id,
    confirmationNumber: j.booking.confirmationNumber,
    name: `${j.person.firstName} ${j.person.lastName}`,
    onHold: pastDue.has(j.job.id),
    trackingToken: j.job.trackingToken,
  });
  return {
    date,
    roles: settings.crewRoles,
    crews: crews.map((c) => ({
      ...c,
      members: members.filter((m) => m.crewId === c.id).map((m) => ({ employeeId: m.employee.id, name: `${m.employee.firstName} ${m.employee.lastName}`, role: m.role, phone: formatPhone(m.employee.phone) })),
      device: devices.find((d) => d.assignedCrewId === c.id) ?? null,
      jobs: jobs.filter((j) => j.job.crewId === c.id).map(jobView),
    })),
    unassigned: jobs.filter((j) => !j.job.crewId).map(jobView),
    available: employees.filter((e) => !assigned.has(e.id)).map((e) => ({ id: e.id, name: `${e.firstName} ${e.lastName}`, defaultRoles: e.defaultRoles })),
    devices: devices.map((d) => ({ id: d.id, name: d.name, assignedCrewId: d.assignedCrewId, lastSeenAt: d.lastSeenAt })),
  };
}

export async function createCrew(services: Services, staffId: string, input: { date: string; name?: string | null; vehicle?: string | null }) {
  const { db } = services;
  const existing = await db.select().from(schema.crews).where(eq(schema.crews.date, input.date));
  const [crew] = await db
    .insert(schema.crews)
    .values({ date: input.date, name: input.name?.trim() || `Crew ${existing.length + 1}`, color: CREW_COLORS[existing.length % CREW_COLORS.length]!, vehicle: input.vehicle ?? null })
    .returning();
  await audit(db, { type: "staff", id: staffId }, "crew", crew!.id, "created", null, crew);
  return crew!;
}

export async function updateCrew(services: Services, staffId: string, crewId: string, patch: { name?: string; vehicle?: string | null; color?: string }) {
  const [before] = await services.db.select().from(schema.crews).where(eq(schema.crews.id, crewId));
  if (!before) throw new TRPCError({ code: "NOT_FOUND" });
  await services.db.update(schema.crews).set(patch).where(eq(schema.crews.id, crewId));
  await audit(services.db, { type: "staff", id: staffId }, "crew", crewId, "updated", before, patch);
}

/** Copies a previous day's crews and members (the usual starting point), not their jobs. */
export async function copyCrews(services: Services, staffId: string, fromDate: string, toDate: string) {
  const { db } = services;
  const already = await db.select().from(schema.crews).where(eq(schema.crews.date, toDate));
  if (already.length) throw new TRPCError({ code: "BAD_REQUEST", message: "That day already has crews" });
  const from = await db.select().from(schema.crews).where(eq(schema.crews.date, fromDate));
  if (!from.length) throw new TRPCError({ code: "BAD_REQUEST", message: `No crews on ${fromDate}` });
  for (const c of from) {
    const [copy] = await db.insert(schema.crews).values({ date: toDate, name: c.name, color: c.color, vehicle: c.vehicle }).returning();
    const members = await db.select().from(schema.crewMembers).where(eq(schema.crewMembers.crewId, c.id));
    if (members.length) await db.insert(schema.crewMembers).values(members.map((m) => ({ crewId: copy!.id, employeeId: m.employeeId, role: m.role })));
  }
  await audit(db, { type: "staff", id: staffId }, "crew_day", toDate, "copied", { fromDate }, { crews: from.length });
}

export async function setMember(services: Services, staffId: string, input: { crewId: string; employeeId: string; role: string | null }) {
  const { db } = services;
  const [crew] = await db.select().from(schema.crews).where(eq(schema.crews.id, input.crewId));
  if (!crew) throw new TRPCError({ code: "NOT_FOUND" });
  // One crew per person per day: moving someone takes them off their other crew.
  const sameDay = await db.select({ id: schema.crews.id }).from(schema.crews).where(eq(schema.crews.date, crew.date));
  const dayIds = sameDay.map((c) => c.id);
  const [before] = await db.select().from(schema.crewMembers).where(and(inArray(schema.crewMembers.crewId, dayIds), eq(schema.crewMembers.employeeId, input.employeeId)));
  if (before) await db.delete(schema.crewMembers).where(and(eq(schema.crewMembers.crewId, before.crewId), eq(schema.crewMembers.employeeId, input.employeeId)));
  if (input.role) await db.insert(schema.crewMembers).values({ crewId: input.crewId, employeeId: input.employeeId, role: input.role });
  await audit(db, { type: "staff", id: staffId }, "crew", input.crewId, input.role ? "member_set" : "member_removed", before ?? null, input);
}

/** Assigns jobs to a crew in the given order (null crew = back to unassigned). */
export async function assignJobs(services: Services, staffId: string, input: { crewId: string | null; jobIds: string[]; overrideHoldReason?: string | null }) {
  const { db } = services;
  await db.transaction(async (tx) => {
    for (const [i, jobId] of input.jobIds.entries()) {
      const [job] = await tx.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
      if (!job) continue;
      if (job.status === "completed") continue;
      if (input.crewId && !input.overrideHoldReason) {
        const [appt] = await tx.select().from(schema.appointments).where(eq(schema.appointments.id, job.appointmentId));
        if (appt?.type === "delivery" && (await bookingLedger(tx, appt.bookingId)).paymentStatus === "past_due")
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "That delivery is on hold: the balance is past due. Override with a reason to dispatch it anyway." });
      }
      await tx
        .update(schema.jobs)
        .set({ crewId: input.crewId, sequence: input.crewId ? i + 1 : null, status: input.crewId ? (["en_route", "arrived"].includes(job.status) ? job.status : "assigned") : "unassigned" })
        .where(eq(schema.jobs.id, jobId));
    }
    await audit(tx, { type: "staff", id: staffId }, "crew", input.crewId ?? "unassigned", "jobs_assigned", null, input);
  });
}

/** Simple auto-order: nearest neighbor from the crew's first stop, AM windows before PM. */
export async function autoOrder(services: Services, staffId: string, crewId: string) {
  const { db } = services;
  const rows = await db
    .select({ job: schema.jobs, appt: schema.appointments })
    .from(schema.jobs)
    .innerJoin(schema.appointments, eq(schema.jobs.appointmentId, schema.appointments.id))
    .where(eq(schema.jobs.crewId, crewId));
  const rank = (w: string | null) => (w === "AM" ? 0 : w === "PM" ? 2 : 1);
  const ordered: typeof rows = [];
  for (const group of [0, 1, 2]) {
    const pool = rows.filter((r) => rank(r.appt.windowId) === group);
    let here = ordered.at(-1)?.appt ?? pool[0]?.appt;
    while (pool.length && here) {
      const h = here;
      pool.sort((a, b) => Math.hypot(a.appt.lat - h.lat, a.appt.lng - h.lng) - Math.hypot(b.appt.lat - h.lat, b.appt.lng - h.lng));
      const next = pool.shift()!;
      ordered.push(next);
      here = next.appt;
    }
  }
  await assignJobs(services, staffId, { crewId, jobIds: ordered.map((r) => r.job.id), overrideHoldReason: "auto-order keeps existing assignments" });
}

/** Texts each crew member their assignment and marks the crews published. */
export async function publishDay(services: Services, staffId: string, date: string) {
  const { db } = services;
  const day = await crewDay(db, date);
  let texts = 0;
  for (const crew of day.crews) {
    const lead = crew.members.find((m) => m.role === "lead");
    const first = crew.jobs[0];
    for (const m of crew.members) {
      const [employee] = await db.select().from(schema.employees).where(eq(schema.employees.id, m.employeeId));
      const to = employee ? normalizePhone(employee.phone) : null;
      if (!to) continue;
      const body =
        `CSS crews for ${date}: you're on ${crew.name} as ${m.role}` +
        (lead && lead.employeeId !== m.employeeId ? ` with ${lead.name} leading` : "") +
        (crew.vehicle ? `, ${crew.vehicle}` : "") +
        `. ${crew.jobs.length} stop${crew.jobs.length === 1 ? "" : "s"}` +
        (first ? `, first at ${first.residence ?? first.address} (${first.window})` : "") +
        ". Reply here with questions.";
      await sendSms(services, { to, body, purpose: "crew_notice", author: "system" });
      texts++;
    }
    await db.update(schema.crews).set({ publishedAt: new Date() }).where(eq(schema.crews.id, crew.id));
  }
  await audit(db, { type: "staff", id: staffId }, "crew_day", date, "published", null, { texts });
  return { texts };
}

export async function assignDevice(services: Services, staffId: string, deviceId: string, crewId: string | null) {
  const { db } = services;
  const [before] = await db.select().from(schema.devices).where(eq(schema.devices.id, deviceId));
  if (!before) throw new TRPCError({ code: "NOT_FOUND" });
  if (crewId) await db.update(schema.devices).set({ assignedCrewId: null }).where(eq(schema.devices.assignedCrewId, crewId));
  await db.update(schema.devices).set({ assignedCrewId: crewId }).where(eq(schema.devices.id, deviceId));
  await audit(db, { type: "staff", id: staffId }, "device", deviceId, "assigned", { crewId: before.assignedCrewId }, { crewId });
}

/** Calendar: appointments per day for a date range, colored by school. */
export async function calendar(db: DbOrTx, from: string, to: string, schoolId?: string | null) {
  const rows = await db
    .select({ appt: schema.appointments, booking: schema.bookings, person: schema.persons, school: schema.schools, job: schema.jobs, crew: schema.crews })
    .from(schema.appointments)
    .innerJoin(schema.bookings, eq(schema.appointments.bookingId, schema.bookings.id))
    .innerJoin(schema.persons, eq(schema.bookings.customerPersonId, schema.persons.id))
    .leftJoin(schema.schools, eq(schema.bookings.schoolId, schema.schools.id))
    .leftJoin(schema.jobs, eq(schema.jobs.appointmentId, schema.appointments.id))
    .leftJoin(schema.crews, eq(schema.jobs.crewId, schema.crews.id))
    .where(
      and(
        sql`${schema.appointments.date} between ${from} and ${to}`,
        isNull(schema.appointments.cancelledAt),
        ne(schema.bookings.lifecycle, "cancelled"),
        schoolId ? eq(schema.bookings.schoolId, schoolId) : undefined,
      ),
    )
    .orderBy(asc(schema.appointments.date), asc(schema.appointments.windowId));
  return rows.map((r) => ({
    appointmentId: r.appt.id,
    date: r.appt.date,
    type: r.appt.type,
    windowId: r.appt.windowId,
    window: windowLabel(r.appt.windowId),
    bookingId: r.booking.id,
    confirmationNumber: r.booking.confirmationNumber,
    name: `${r.person.firstName} ${r.person.lastName}`,
    school: r.school?.shortName ?? "—",
    schoolColor: r.school?.color ?? "#64748b",
    crew: r.crew?.name ?? null,
    jobStatus: r.job?.status ?? null,
    overbooked: r.appt.overbooked,
  }));
}

/** Capacity grid: every window for a school in a date range with reserved counts. */
export async function capacityGrid(db: DbOrTx, input: { seasonId: string; schoolId: string; type: "pickup" | "delivery" }) {
  const days = await db
    .select()
    .from(schema.serviceDays)
    .where(and(eq(schema.serviceDays.seasonId, input.seasonId), eq(schema.serviceDays.schoolId, input.schoolId), eq(schema.serviceDays.type, input.type)))
    .orderBy(asc(schema.serviceDays.date), asc(schema.serviceDays.campusScope), asc(schema.serviceDays.windowId));
  const reserved = await reservedCounts(db, days.map((d) => d.id));
  return days.map((d) => ({ ...d, window: windowLabel(d.windowId), reserved: reserved.get(d.id) ?? 0 }));
}
