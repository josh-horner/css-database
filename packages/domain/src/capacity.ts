/**
 * Capacity-managed pickup/delivery windows (docs/domain-model.md#serviceday-and-capacity).
 * Customers see only windows with room, at least `leadDays` ahead. Staff can overbook with a reason.
 */
export type CampusScope = "on" | "off" | "both";

export interface ServiceDaySlot {
  id: string;
  date: string;
  windowId: string | null;
  campusScope: CampusScope;
  capacity: number;
  blocked: boolean;
}

export interface AvailableSlot extends ServiceDaySlot {
  reserved: number;
  remaining: number;
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Dorms are on campus; Greek houses and apartments are off campus. */
export function campusOf(residenceKind: "dorm" | "greek" | "off_campus" | null | undefined): "on" | "off" | null {
  if (!residenceKind) return null;
  return residenceKind === "dorm" ? "on" : "off";
}

export function scopeMatches(scope: CampusScope, campus: "on" | "off" | null): boolean {
  return scope === "both" || campus === null || scope === campus;
}

export function availableSlots(
  days: readonly ServiceDaySlot[],
  reservedById: ReadonlyMap<string, number>,
  opts: { today: string; leadDays: number; campus: "on" | "off" | null; staff?: boolean },
): AvailableSlot[] {
  const earliest = opts.staff ? opts.today : addDays(opts.today, opts.leadDays);
  return days
    .filter((d) => d.date >= earliest && scopeMatches(d.campusScope, opts.campus))
    .map((d) => {
      const reserved = reservedById.get(d.id) ?? 0;
      return { ...d, reserved, remaining: Math.max(0, d.capacity - reserved) };
    })
    .filter((d) => opts.staff || (!d.blocked && d.remaining > 0))
    .sort((a, b) => (a.date === b.date ? (a.windowId ?? "").localeCompare(b.windowId ?? "") : a.date.localeCompare(b.date)));
}

export class CapacityError extends Error {}

/** Checked inside the reserving transaction (row-locked). Throws unless there's room or an override. */
export function assertCanReserve(slot: { capacity: number; blocked: boolean }, reserved: number, override: { reason: string } | null) {
  if (override?.reason.trim()) return { overbooked: slot.blocked || reserved >= slot.capacity };
  if (slot.blocked) throw new CapacityError("That window is closed. Please pick another.");
  if (reserved >= slot.capacity) throw new CapacityError("That window just filled up. Please pick another.");
  return { overbooked: false };
}

/** Every date from start to end inclusive, optionally skipping weekdays (0 = Sunday). */
export function dateRange(start: string, end: string, skipWeekdays: readonly number[] = []): string[] {
  const out: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const weekday = new Date(`${d}T12:00:00Z`).getUTCDay();
    if (!skipWeekdays.includes(weekday)) out.push(d);
    if (out.length > 400) break;
  }
  return out;
}
