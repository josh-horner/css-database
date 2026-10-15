/** Customer queue position, ETA, and crew position (docs/apps/portal.md, ADR-0005). */
import { and, asc, desc, eq, gte, schema, type DbOrTx } from "@css/db";
import { queueView, type LatLng, type RouteStopState, type StopStatus } from "@css/domain";
import { localTime, windowLabel } from "./time";

const LOCATION_FRESH_MS = 30 * 60_000;

function stopStatus(status: (typeof schema.jobStatus.enumValues)[number]): StopStatus {
  switch (status) {
    case "en_route":
      return "en_route";
    case "arrived":
      return "arrived";
    case "completed":
      return "completed";
    case "failed":
    case "on_hold":
      return "skipped";
    default:
      return "pending";
  }
}

/** Every stop on a crew's day, in order, as the domain's route state. */
export async function crewRouteState(db: DbOrTx, crewId: string) {
  const rows = await db
    .select({ job: schema.jobs, appointment: schema.appointments })
    .from(schema.jobs)
    .innerJoin(schema.appointments, eq(schema.jobs.appointmentId, schema.appointments.id))
    .where(eq(schema.jobs.crewId, crewId))
    .orderBy(asc(schema.jobs.sequence));
  const stops: RouteStopState[] = rows.map(({ job, appointment }) => ({
    jobId: job.id,
    sequence: job.sequence ?? 0,
    status: stopStatus(job.status),
    location: { lat: appointment.lat, lng: appointment.lng },
    serviceMinutes: job.estServiceMinutes,
  }));
  return { rows, stops };
}

export async function latestCrewLocation(db: DbOrTx, crewId: string, now = new Date()) {
  const [loc] = await db
    .select()
    .from(schema.crewLocations)
    .where(and(eq(schema.crewLocations.crewId, crewId), gte(schema.crewLocations.recordedAt, new Date(now.getTime() - LOCATION_FRESH_MS))))
    .orderBy(desc(schema.crewLocations.recordedAt))
    .limit(1);
  return loc ? { lat: loc.lat, lng: loc.lng, recordedAt: loc.recordedAt } : null;
}

export async function queueForJob(db: DbOrTx, jobId: string, timeZone: string, now = new Date()) {
  const [row] = await db
    .select({ job: schema.jobs, crew: schema.crews })
    .from(schema.jobs)
    .leftJoin(schema.crews, eq(schema.jobs.crewId, schema.crews.id))
    .where(eq(schema.jobs.id, jobId))
    .limit(1);
  if (!row?.crew) return null;
  const { stops } = await crewRouteState(db, row.crew.id);
  const crewAt = await latestCrewLocation(db, row.crew.id, now);
  const view = queueView(stops, jobId, crewAt as LatLng | null);
  if (!view) return null;
  const etaAt = new Date(now.getTime() + view.etaMinutes * 60_000);
  return { view, crew: row.crew, crewAt, etaAt, etaLabel: localTime(timeZone, etaAt) };
}

/** Human-readable queue sentence, used in texts and as a fact for the AI assistant. */
export function queueSentence(q: NonNullable<Awaited<ReturnType<typeof queueForJob>>>): string {
  const { view, crew, etaLabel } = q;
  if (view.status === "completed") return `${crew.name} already finished this stop today.`;
  if (view.status === "arrived") return `${crew.name} is at your stop now.`;
  if (view.crewHeadingHere) return `${crew.name} is on the way to you now. ETA about ${view.etaMinutes} min (around ${etaLabel}).`;
  return `You're stop ${view.position} of ${view.totalStops} for ${crew.name}. ${view.stopsAhead} stop${view.stopsAhead === 1 ? "" : "s"} ahead of you; current ETA around ${etaLabel}.`;
}

export async function trackingByToken(db: DbOrTx, token: string, timeZone: string, now = new Date()) {
  const [row] = await db
    .select({ job: schema.jobs, appointment: schema.appointments, booking: schema.bookings, person: schema.persons, school: schema.schools })
    .from(schema.jobs)
    .innerJoin(schema.appointments, eq(schema.jobs.appointmentId, schema.appointments.id))
    .innerJoin(schema.bookings, eq(schema.appointments.bookingId, schema.bookings.id))
    .innerJoin(schema.persons, eq(schema.bookings.customerPersonId, schema.persons.id))
    .leftJoin(schema.schools, eq(schema.bookings.schoolId, schema.schools.id))
    .where(eq(schema.jobs.trackingToken, token))
    .limit(1);
  if (!row) return null;
  const q = await queueForJob(db, row.job.id, timeZone, now);
  const showCrew = q && (q.view.crewHeadingHere || q.view.status === "arrived");
  return {
    firstName: row.person.firstName,
    confirmationNumber: row.booking.confirmationNumber,
    type: row.appointment.type,
    date: row.appointment.date,
    window: windowLabel(row.appointment.windowId),
    address: row.appointment.address,
    room: row.appointment.room,
    schoolColor: row.school?.color ?? "#2563EB",
    destination: { lat: row.appointment.lat, lng: row.appointment.lng },
    crew: q ? { name: q.crew.name, color: q.crew.color } : null,
    queue: q
      ? {
          status: q.view.status,
          position: q.view.position,
          totalStops: q.view.totalStops,
          stopsAhead: q.view.stopsAhead,
          etaMinutes: q.view.etaMinutes,
          etaLabel: q.etaLabel,
          crewHeadingHere: q.view.crewHeadingHere,
          sentence: queueSentence(q),
        }
      : null,
    // Privacy: the crew's position is shown only while they're heading to (or at) this customer.
    crewLocation: showCrew ? q.crewAt : null,
    updatedAt: now,
  };
}
