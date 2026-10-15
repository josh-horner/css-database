/** Capacity-managed windows: what customers can pick, and reserving one inside the booking transaction. */
import { TRPCError } from "@trpc/server";
import { and, asc, eq, inArray, isNull, ne, schema, sql, type DbOrTx } from "@css/db";
import { assertCanReserve, availableSlots, CapacityError, type AvailableSlot, type CampusScope } from "@css/domain";
import { windowLabel } from "./time";

export async function reservedCounts(db: DbOrTx, serviceDayIds: readonly string[]): Promise<Map<string, number>> {
  if (!serviceDayIds.length) return new Map();
  const rows = await db
    .select({ id: schema.appointments.serviceDayId, n: sql<number>`count(*)::int` })
    .from(schema.appointments)
    .innerJoin(schema.bookings, eq(schema.appointments.bookingId, schema.bookings.id))
    .where(
      and(
        inArray(schema.appointments.serviceDayId, [...serviceDayIds]),
        isNull(schema.appointments.cancelledAt),
        ne(schema.bookings.lifecycle, "cancelled"),
      ),
    )
    .groupBy(schema.appointments.serviceDayId);
  return new Map(rows.map((r) => [r.id!, r.n]));
}

export async function slotsFor(
  db: DbOrTx,
  input: { seasonId: string; schoolId: string; type: "pickup" | "delivery"; campus: "on" | "off" | null; today: string; leadDays: number; staff?: boolean },
): Promise<(AvailableSlot & { label: string })[]> {
  const days = await db
    .select()
    .from(schema.serviceDays)
    .where(and(eq(schema.serviceDays.seasonId, input.seasonId), eq(schema.serviceDays.schoolId, input.schoolId), eq(schema.serviceDays.type, input.type)))
    .orderBy(asc(schema.serviceDays.date));
  const reserved = await reservedCounts(db, days.map((d) => d.id));
  return availableSlots(
    days.map((d) => ({ ...d, campusScope: d.campusScope as CampusScope })),
    reserved,
    { today: input.today, leadDays: input.leadDays, campus: input.campus, staff: input.staff },
  ).map((slot) => ({ ...slot, label: windowLabel(slot.windowId) }));
}

/**
 * Locks the window row and checks room in the same transaction, so two people can't take the last spot.
 * Staff may overbook with a reason.
 */
export async function reserveServiceDay(tx: DbOrTx, serviceDayId: string, override: { reason: string } | null) {
  const [day] = await tx.select().from(schema.serviceDays).where(eq(schema.serviceDays.id, serviceDayId)).for("update");
  if (!day) throw new TRPCError({ code: "BAD_REQUEST", message: "That pickup window no longer exists" });
  const reserved = (await reservedCounts(tx, [serviceDayId])).get(serviceDayId) ?? 0;
  try {
    return { day, ...assertCanReserve(day, reserved, override) };
  } catch (err) {
    if (err instanceof CapacityError) throw new TRPCError({ code: "CONFLICT", message: err.message });
    throw err;
  }
}
