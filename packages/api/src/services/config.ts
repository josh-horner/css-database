/**
 * Owner configuration (docs/apps/admin.md#must-have-for-cutover-parity-with-legacy, "Config"): seasons, schools and
 * residences, rate card, the service builder, capacity, promotions, knowledge base, settings, staff, employees,
 * devices. Nothing is hard-deleted: things are deactivated.
 */
import { createHash, randomBytes } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, inArray, schema, sql, type DbOrTx } from "@css/db";
import { dateRange, FIELD_TYPES, FieldConfig, normalizeEmail, normalizePhone, type Settings } from "@css/domain";
import { hashPassword } from "@css/db";
import type { Services } from "../context";
import { audit } from "./audit";
import { reservedCounts } from "./capacity";
import { servicesWithFields } from "./catalog";
import { getSettings, setSetting } from "./settings";

type StaffActor = { type: "staff"; id: string };
const staff = (id: string): StaffActor => ({ type: "staff", id });

async function auditUpdate<T extends Record<string, unknown>>(db: DbOrTx, staffId: string, entity: string, id: string, before: T | undefined, patch: Partial<T>) {
  await audit(db, staff(staffId), entity, id, before ? "updated" : "created", before ? Object.fromEntries(Object.keys(patch).map((k) => [k, before[k]])) : null, patch);
}

// ---------------------------------------------------------------------------------------------
// Seasons

export async function listSeasons(db: DbOrTx) {
  return db.select().from(schema.seasons).orderBy(desc(schema.seasons.startsOn));
}

export async function saveSeason(
  services: Services,
  staffId: string,
  input: { id?: string | null; name: string; kind: "summer" | "semester" | "year_round"; startsOn: string; endsOn: string; depositCents: number; cardFeeBps: number; leadDays: number; copyRateCardFrom?: string | null },
) {
  const { db } = services;
  const values = { name: input.name.trim(), kind: input.kind, startsOn: input.startsOn, endsOn: input.endsOn, depositCents: input.depositCents, cardFeeBps: input.cardFeeBps, leadDays: input.leadDays };
  if (input.id) {
    const [before] = await db.select().from(schema.seasons).where(eq(schema.seasons.id, input.id));
    await db.update(schema.seasons).set(values).where(eq(schema.seasons.id, input.id));
    await auditUpdate(db, staffId, "season", input.id, before, values);
    return input.id;
  }
  const [season] = await db.insert(schema.seasons).values(values).returning();
  if (input.copyRateCardFrom) {
    const items = await db.select().from(schema.rateCardItems).where(eq(schema.rateCardItems.seasonId, input.copyRateCardFrom));
    if (items.length)
      await db.insert(schema.rateCardItems).values(
        items.map(({ id: _id, createdAt: _c, updatedAt: _u, seasonId: _s, ...rest }) => ({ ...rest, seasonId: season!.id })),
      );
  }
  await auditUpdate(db, staffId, "season", season!.id, undefined, values);
  return season!.id;
}

// ---------------------------------------------------------------------------------------------
// Schools and residences

export async function listSchools(db: DbOrTx) {
  const schools = await db.select().from(schema.schools).orderBy(asc(schema.schools.name));
  const residences = await db.select().from(schema.residences).orderBy(asc(schema.residences.name));
  return schools.map((s) => ({ ...s, residences: residences.filter((r) => r.schoolId === s.id) }));
}

export async function saveSchool(
  services: Services,
  staffId: string,
  input: { id?: string | null; name: string; shortName: string; city: string; color: string; lat: number; lng: number; active: boolean; allowsSpecialPickup: boolean },
) {
  const { db } = services;
  const { id, ...values } = input;
  if (id) {
    const [before] = await db.select().from(schema.schools).where(eq(schema.schools.id, id));
    await db.update(schema.schools).set(values).where(eq(schema.schools.id, id));
    await auditUpdate(db, staffId, "school", id, before, values);
    return id;
  }
  const [row] = await db.insert(schema.schools).values(values).returning();
  await auditUpdate(db, staffId, "school", row!.id, undefined, values);
  return row!.id;
}

export async function saveResidence(
  services: Services,
  staffId: string,
  input: { id?: string | null; schoolId: string; name: string; kind: "dorm" | "greek" | "off_campus"; address: string; lat: number; lng: number; active: boolean },
) {
  const { db } = services;
  const { id, ...values } = input;
  if (id) {
    const [before] = await db.select().from(schema.residences).where(eq(schema.residences.id, id));
    await db.update(schema.residences).set(values).where(eq(schema.residences.id, id));
    await auditUpdate(db, staffId, "residence", id, before, values);
    return id;
  }
  const [row] = await db.insert(schema.residences).values(values).returning();
  await auditUpdate(db, staffId, "residence", row!.id, undefined, values);
  return row!.id;
}

// ---------------------------------------------------------------------------------------------
// Rate card

export async function rateCard(db: DbOrTx, seasonId: string) {
  return db
    .select()
    .from(schema.rateCardItems)
    .where(eq(schema.rateCardItems.seasonId, seasonId))
    .orderBy(asc(schema.rateCardItems.category), asc(schema.rateCardItems.sortOrder));
}

export async function saveRateCardItem(
  services: Services,
  staffId: string,
  input: { id?: string | null; seasonId: string; code: string; name: string; category: string; unit: "each" | "hour" | "minute" | "flat"; unitPriceCents: number; onContract: boolean; active: boolean },
) {
  const { db } = services;
  const { id, ...values } = { ...input, code: input.code.trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_") };
  if (id) {
    const [before] = await db.select().from(schema.rateCardItems).where(eq(schema.rateCardItems.id, id));
    await db.update(schema.rateCardItems).set(values).where(eq(schema.rateCardItems.id, id));
    await auditUpdate(db, staffId, "rate_card_item", id, before, values);
    return id;
  }
  const [max] = await db.select({ n: sql<number>`coalesce(max(sort_order), 0)::int` }).from(schema.rateCardItems).where(eq(schema.rateCardItems.seasonId, input.seasonId));
  try {
    const [row] = await db.insert(schema.rateCardItems).values({ ...values, sortOrder: (max?.n ?? 0) + 1 }).returning();
    await auditUpdate(db, staffId, "rate_card_item", row!.id, undefined, values);
    return row!.id;
  } catch {
    throw new TRPCError({ code: "CONFLICT", message: `Code ${values.code} is already on this season's rate card` });
  }
}

/**
 * "Learning the price list from his decisions": things priced by hand that aren't on the rate card yet.
 * Crew "Other" lines the owner priced and ad-hoc staff lines, grouped by description.
 */
export async function rateCardSuggestions(db: DbOrTx, seasonId: string) {
  const rows = (await db.execute(sql`
    select lower(trim(l.description)) as description, count(*)::int as times,
      mode() within group (order by l.unit_price_cents)::int as typical_cents,
      min(l.unit_price_cents)::int as min_cents, max(l.unit_price_cents)::int as max_cents
    from invoice_lines l join invoices i on i.id = l.invoice_id join bookings b on b.id = i.booking_id
    where b.season_id = ${seasonId} and l.rate_card_item_id is null and l.kind = 'charge' and l.quantity > 0 and l.needs_price = false
      and lower(l.description) not like '%deposit%'
    group by 1 order by 2 desc limit 25`)) as unknown as { description: string; times: number; typical_cents: number; min_cents: number; max_cents: number }[];
  return rows;
}

// ---------------------------------------------------------------------------------------------
// Service builder

export async function listServicesAdmin(db: DbOrTx) {
  const all = await servicesWithFields(db);
  const counts = (await db.execute(sql`
    select bs.service_id, count(distinct bs.booking_id)::int as bookings
    from booking_services bs join bookings b on b.id = bs.booking_id where b.lifecycle <> 'cancelled' group by 1`)) as unknown as { service_id: string; bookings: number }[];
  const fieldRows = await db.select().from(schema.serviceFields).orderBy(asc(schema.serviceFields.sortOrder));
  return all.map((e) => ({
    ...e.service,
    schools: e.schools,
    fields: fieldRows.filter((f) => f.serviceId === e.service.id),
    bookings: counts.find((c) => c.service_id === e.service.id)?.bookings ?? 0,
  }));
}

export async function saveService(
  services: Services,
  staffId: string,
  input: {
    id?: string | null;
    code: string;
    name: string;
    description: string | null;
    family: string | null;
    seasonId: string | null;
    offeredFrom: Date | null;
    offeredUntil: Date | null;
    successorServiceId: string | null;
    chargesDeposit: boolean;
    baseRateCardCode: string | null;
    instructions: string | null;
    staffOnly: boolean;
    active: boolean;
    schoolIds: string[];
  },
) {
  const { db } = services;
  const { id, schoolIds, ...rest } = input;
  const values = { ...rest, code: rest.code.trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_"), name: rest.name.trim() };
  if (values.offeredFrom && values.offeredUntil && values.offeredFrom >= values.offeredUntil) throw new TRPCError({ code: "BAD_REQUEST", message: "Offered-until must be after offered-from" });
  if (id && values.successorServiceId === id) throw new TRPCError({ code: "BAD_REQUEST", message: "A service can't be its own successor" });
  return db.transaction(async (tx) => {
    let serviceId = id;
    if (id) {
      const [before] = await tx.select().from(schema.services).where(eq(schema.services.id, id));
      await tx.update(schema.services).set(values).where(eq(schema.services.id, id));
      await auditUpdate(tx, staffId, "service", id, before, values);
    } else {
      const [max] = await tx.select({ n: sql<number>`coalesce(max(sort_order), 0)::int` }).from(schema.services);
      const [row] = await tx.insert(schema.services).values({ ...values, sortOrder: (max?.n ?? 0) + 1 }).returning();
      serviceId = row!.id;
      await auditUpdate(tx, staffId, "service", serviceId, undefined, values);
    }
    // School availability is configuration; replacing the set is fine.
    await tx.delete(schema.serviceSchools).where(eq(schema.serviceSchools.serviceId, serviceId!));
    if (schoolIds.length) await tx.insert(schema.serviceSchools).values(schoolIds.map((schoolId) => ({ serviceId: serviceId!, schoolId })));
    return serviceId!;
  });
}

const KEY = /^[a-z][a-z0-9_]{1,40}$/;

/**
 * Saves a field. Confirmed bookings keep the answers they gave (answers are stored with their key and value),
 * so edits only affect new drafts; removing a field deactivates it.
 */
export async function saveField(
  services: Services,
  staffId: string,
  input: { id?: string | null; serviceId: string; key: string; type: string; label: string; help: string | null; required: boolean; config: unknown; showIf: { key: string; equals: unknown } | null; active: boolean },
) {
  const { db } = services;
  if (!(FIELD_TYPES as readonly string[]).includes(input.type)) throw new TRPCError({ code: "BAD_REQUEST", message: "Unknown field type" });
  if (!KEY.test(input.key)) throw new TRPCError({ code: "BAD_REQUEST", message: "Key: lowercase letters, numbers, and underscores, starting with a letter" });
  const config = FieldConfig.safeParse(input.config);
  if (!config.success) throw new TRPCError({ code: "BAD_REQUEST", message: "Field settings are invalid" });
  if ((input.type === "select" || input.type === "multi_select") && !(config.data.options ?? []).length) throw new TRPCError({ code: "BAD_REQUEST", message: "Add at least one option" });
  if (input.type === "person" && !config.data.role) throw new TRPCError({ code: "BAD_REQUEST", message: "Pick who this person is" });
  if (input.type === "appointment" && (!config.data.appointmentType || !config.data.scheduling)) throw new TRPCError({ code: "BAD_REQUEST", message: "Pick the appointment type and how it's scheduled" });
  const siblings = await db.select().from(schema.serviceFields).where(and(eq(schema.serviceFields.serviceId, input.serviceId), eq(schema.serviceFields.active, true)));
  if (siblings.some((s) => s.key === input.key && s.id !== input.id)) throw new TRPCError({ code: "CONFLICT", message: `This service already asks "${input.key}"` });
  const values = { serviceId: input.serviceId, key: input.key, type: input.type, label: input.label.trim(), help: input.help?.trim() || null, required: input.required, config: config.data as Record<string, unknown>, showIf: input.showIf, active: input.active };
  if (input.id) {
    const [before] = await db.select().from(schema.serviceFields).where(eq(schema.serviceFields.id, input.id));
    await db.update(schema.serviceFields).set(values).where(eq(schema.serviceFields.id, input.id));
    await auditUpdate(db, staffId, "service_field", input.id, before, values);
    return input.id;
  }
  const [row] = await db.insert(schema.serviceFields).values({ ...values, sortOrder: siblings.length }).returning();
  await auditUpdate(db, staffId, "service_field", row!.id, undefined, values);
  return row!.id;
}

export async function reorderFields(services: Services, staffId: string, serviceId: string, fieldIds: string[]) {
  const { db } = services;
  for (const [i, id] of fieldIds.entries()) await db.update(schema.serviceFields).set({ sortOrder: i }).where(and(eq(schema.serviceFields.id, id), eq(schema.serviceFields.serviceId, serviceId)));
  await audit(db, staff(staffId), "service", serviceId, "fields_reordered", null, { fieldIds });
}

/** Fields other services already use, so the owner reuses keys (a shared key is asked once). */
export async function fieldLibrary(db: DbOrTx) {
  const rows = await db.select().from(schema.serviceFields).where(eq(schema.serviceFields.active, true)).orderBy(asc(schema.serviceFields.key));
  const byKey = new Map<string, (typeof rows)[number] & { usedBy: number }>();
  for (const r of rows) {
    const e = byKey.get(r.key);
    if (e) e.usedBy++;
    else byKey.set(r.key, { ...r, usedBy: 1 });
  }
  return [...byKey.values()].map((r) => ({ key: r.key, type: r.type, label: r.label, help: r.help, required: r.required, config: r.config, usedBy: r.usedBy }));
}

// ---------------------------------------------------------------------------------------------
// Capacity (service days)

export async function generateServiceDays(
  services: Services,
  staffId: string,
  input: { seasonId: string; schoolIds: string[]; type: "pickup" | "delivery"; from: string; to: string; skipWeekdays: number[]; windows: { campusScope: "on" | "off" | "both"; windowId: string | null; capacity: number }[] },
) {
  const { db } = services;
  const dates = dateRange(input.from, input.to, input.skipWeekdays);
  if (!dates.length || !input.windows.length || !input.schoolIds.length) throw new TRPCError({ code: "BAD_REQUEST", message: "Pick schools, dates, and at least one window" });
  const existing = await db
    .select()
    .from(schema.serviceDays)
    .where(and(eq(schema.serviceDays.seasonId, input.seasonId), inArray(schema.serviceDays.schoolId, input.schoolIds), eq(schema.serviceDays.type, input.type)));
  const rows = [];
  for (const schoolId of input.schoolIds)
    for (const date of dates)
      for (const w of input.windows) {
        if (existing.some((e) => e.schoolId === schoolId && e.date === date && e.campusScope === w.campusScope && e.windowId === w.windowId)) continue;
        rows.push({ seasonId: input.seasonId, schoolId, date, type: input.type, campusScope: w.campusScope, windowId: w.windowId, capacity: w.capacity });
      }
  if (rows.length) await db.insert(schema.serviceDays).values(rows);
  await audit(db, staff(staffId), "service_days", input.seasonId, "generated", null, { count: rows.length, ...input });
  return { created: rows.length };
}

export async function updateServiceDay(services: Services, staffId: string, id: string, patch: { capacity?: number; blocked?: boolean }) {
  const { db } = services;
  const [before] = await db.select().from(schema.serviceDays).where(eq(schema.serviceDays.id, id));
  if (!before) throw new TRPCError({ code: "NOT_FOUND" });
  if (patch.capacity !== undefined) {
    const reserved = (await reservedCounts(db, [id])).get(id) ?? 0;
    if (patch.capacity < reserved) throw new TRPCError({ code: "BAD_REQUEST", message: `${reserved} already booked; capacity can't go below that (block it instead)` });
  }
  await db.update(schema.serviceDays).set(patch).where(eq(schema.serviceDays.id, id));
  await auditUpdate(db, staffId, "service_day", id, before, patch);
}

// ---------------------------------------------------------------------------------------------
// Promotions, knowledge base, settings

export async function listPromotions(db: DbOrTx) {
  const promos = await db.select().from(schema.promotions).orderBy(desc(schema.promotions.createdAt));
  const uses = (await db.execute(sql`select entered_code, count(*)::int as n from bookings where lifecycle not in ('draft','cancelled') and entered_code is not null group by 1`)) as unknown as { entered_code: string; n: number }[];
  return promos.map((p) => ({ ...p, uses: uses.find((u) => u.entered_code === p.code)?.n ?? 0 }));
}

export async function savePromotion(
  services: Services,
  staffId: string,
  input: { id?: string | null; code: string; description: string; amountCents: number; seasonId: string | null; validUntil: Date | null; maxUses: number | null; active: boolean },
) {
  const { db } = services;
  const { id, ...rest } = input;
  const values = { ...rest, code: rest.code.trim().toUpperCase().replace(/\s+/g, "") };
  if (id) {
    const [before] = await db.select().from(schema.promotions).where(eq(schema.promotions.id, id));
    await db.update(schema.promotions).set(values).where(eq(schema.promotions.id, id));
    await auditUpdate(db, staffId, "promotion", id, before, values);
    return id;
  }
  try {
    const [row] = await db.insert(schema.promotions).values(values).returning();
    await auditUpdate(db, staffId, "promotion", row!.id, undefined, values);
    return row!.id;
  } catch {
    throw new TRPCError({ code: "CONFLICT", message: "That code already exists" });
  }
}

export async function listKb(db: DbOrTx) {
  return db.select().from(schema.kbArticles).orderBy(asc(schema.kbArticles.sortOrder), asc(schema.kbArticles.title));
}

export async function saveKb(services: Services, staffId: string, input: { id?: string | null; title: string; body: string; public: boolean; active: boolean }) {
  const { db } = services;
  const { id, ...values } = input;
  if (id) {
    const [before] = await db.select().from(schema.kbArticles).where(eq(schema.kbArticles.id, id));
    await db.update(schema.kbArticles).set(values).where(eq(schema.kbArticles.id, id));
    await auditUpdate(db, staffId, "kb_article", id, before, values);
    return id;
  }
  const [row] = await db.insert(schema.kbArticles).values(values).returning();
  await auditUpdate(db, staffId, "kb_article", row!.id, undefined, values);
  return row!.id;
}

/** Questions the assistant escalated recently: candidates for new knowledge base articles. */
export async function faqSuggestions(db: DbOrTx) {
  const rows = await db
    .select({ intent: schema.aiReplies.intent, reason: schema.aiReplies.reason, body: schema.messages.body, at: schema.aiReplies.createdAt })
    .from(schema.aiReplies)
    .innerJoin(schema.messages, eq(schema.aiReplies.inboundMessageId, schema.messages.id))
    .where(eq(schema.aiReplies.escalate, true))
    .orderBy(desc(schema.aiReplies.createdAt))
    .limit(40);
  return rows;
}

export async function saveSettings(services: Services, staffId: string, patch: Partial<Settings>) {
  const before = await getSettings(services.db);
  for (const [key, value] of Object.entries(patch)) await setSetting(services.db, key as keyof Settings, value);
  await audit(services.db, staff(staffId), "settings", "owner", "updated", Object.fromEntries(Object.keys(patch).map((k) => [k, before[k as keyof Settings]])), patch);
  return getSettings(services.db);
}

// ---------------------------------------------------------------------------------------------
// Staff, employees, devices

export async function listStaff(db: DbOrTx) {
  return db
    .select({ id: schema.staffUsers.id, name: schema.staffUsers.name, email: schema.staffUsers.email, role: schema.staffUsers.role, active: schema.staffUsers.active, createdAt: schema.staffUsers.createdAt })
    .from(schema.staffUsers)
    .orderBy(asc(schema.staffUsers.name));
}

export const STAFF_ROLES = ["owner", "office", "dispatcher", "warehouse", "readonly"] as const;

export async function saveStaff(
  services: Services,
  staffId: string,
  input: { id?: string | null; name: string; email: string; role: (typeof STAFF_ROLES)[number]; active: boolean; password?: string | null },
) {
  const { db } = services;
  const email = normalizeEmail(input.email);
  if (!email) throw new TRPCError({ code: "BAD_REQUEST", message: "Enter a valid email" });
  if (input.id === staffId && (!input.active || input.role !== "owner")) {
    const owners = await db.select().from(schema.staffUsers).where(and(eq(schema.staffUsers.role, "owner"), eq(schema.staffUsers.active, true)));
    if (owners.length <= 1) throw new TRPCError({ code: "BAD_REQUEST", message: "Keep at least one active owner" });
  }
  const values: Partial<typeof schema.staffUsers.$inferInsert> = { name: input.name.trim(), email, role: input.role, active: input.active };
  if (input.password) {
    if (input.password.length < 10) throw new TRPCError({ code: "BAD_REQUEST", message: "Passwords need at least 10 characters" });
    values.passwordHash = hashPassword(input.password);
  }
  if (input.id) {
    await db.update(schema.staffUsers).set(values).where(eq(schema.staffUsers.id, input.id));
    await audit(db, staff(staffId), "staff_user", input.id, "updated", null, { ...values, passwordHash: values.passwordHash ? "(changed)" : undefined });
    return input.id;
  }
  if (!input.password) throw new TRPCError({ code: "BAD_REQUEST", message: "Set a starting password" });
  try {
    const [row] = await db.insert(schema.staffUsers).values(values as typeof schema.staffUsers.$inferInsert).returning();
    await audit(db, staff(staffId), "staff_user", row!.id, "created", null, { name: values.name, email, role: values.role });
    return row!.id;
  } catch {
    throw new TRPCError({ code: "CONFLICT", message: "That email already has a login" });
  }
}

export async function listEmployees(db: DbOrTx) {
  return db.select().from(schema.employees).orderBy(desc(schema.employees.active), asc(schema.employees.firstName));
}

export async function saveEmployee(services: Services, staffId: string, input: { id?: string | null; firstName: string; lastName: string; phone: string; defaultRoles: string[]; active: boolean }) {
  const { db } = services;
  const phone = normalizePhone(input.phone);
  if (!phone) throw new TRPCError({ code: "BAD_REQUEST", message: "Enter a 10-digit phone number" });
  const values = { firstName: input.firstName.trim(), lastName: input.lastName.trim(), phone, defaultRoles: input.defaultRoles, active: input.active };
  try {
    if (input.id) {
      const [before] = await db.select().from(schema.employees).where(eq(schema.employees.id, input.id));
      await db.update(schema.employees).set(values).where(eq(schema.employees.id, input.id));
      await auditUpdate(db, staffId, "employee", input.id, before, values);
      return input.id;
    }
    const [row] = await db.insert(schema.employees).values(values).returning();
    await auditUpdate(db, staffId, "employee", row!.id, undefined, values);
    return row!.id;
  } catch (err) {
    if (err instanceof TRPCError) throw err;
    throw new TRPCError({ code: "CONFLICT", message: "Another employee has that phone number" });
  }
}

/** Creates a tablet and shows its pairing code once; only the hash is stored. */
export async function createDevice(services: Services, staffId: string, name: string) {
  const token = randomBytes(9).toString("base64url");
  const [row] = await services.db
    .insert(schema.devices)
    .values({ name: name.trim(), tokenHash: createHash("sha256").update(token).digest("hex") })
    .returning();
  await audit(services.db, staff(staffId), "device", row!.id, "created", null, { name });
  return { id: row!.id, pairingCode: token };
}

/** Revoking a lost tablet: its token stops working immediately (the row is kept for history). */
export async function revokeDevice(services: Services, staffId: string, deviceId: string) {
  await services.db
    .update(schema.devices)
    .set({ tokenHash: `revoked:${randomBytes(8).toString("hex")}`, assignedCrewId: null, name: sql`${schema.devices.name} || ' (revoked)'` })
    .where(eq(schema.devices.id, deviceId));
  await audit(services.db, staff(staffId), "device", deviceId, "revoked");
}

/** "Services & costs": the third-party tools behind the system, in plain English, and which are live. */
export function servicesAndCosts(services: Services) {
  const { integrations } = services;
  const live = (name: string) => !["fake", "console", "local", "keyword"].includes(name);
  return [
    { tool: "Stripe", what: "Charges cards: deposits at signup, balances after approval, tips. Saves cards securely so we never see card numbers.", cost: "2.9% + 30¢ per charge (passed on as the 3% card fee)", breaksWithout: "No payments", live: integrations.payments.provider === "stripe" },
    { tool: "Authorize.net", what: "Backup card processor; existing saved cards from the old system.", cost: "Monthly gateway fee + per-transaction fee", breaksWithout: "Old saved cards can't be charged until customers update them", live: integrations.payments.provider === "authorizenet" },
    { tool: "Twilio", what: "Texts: on-my-way, receipts, reminders, two-way conversations with customers and crew.", cost: "About 1¢ per text segment, plus a few dollars a month for the number", breaksWithout: "No texts; customers get email only", live: live(integrations.sms.name) },
    { tool: "Amazon SES", what: "Email: confirmations, invoices, receipts, sign-in codes.", cost: "About 10¢ per 1,000 emails", breaksWithout: "No email", live: live(integrations.email.name) },
    { tool: "Claude (Anthropic)", what: "Answers routine customer texts (\"when are you coming?\") from the knowledge base and the booking, and hands everything else to you.", cost: "Roughly a few cents per conversation", breaksWithout: "Every message waits for a person", live: integrations.assistant.model !== "fake" },
    { tool: "Amazon S3", what: "Stores crew photos of items, rooms, and deliveries.", cost: "A few dollars a month", breaksWithout: "No photos", live: integrations.files.name === "s3" },
    { tool: "Hosting (AWS)", what: "Runs the website, admin, and database.", cost: "Tens of dollars a month off-season, more in May and August", breaksWithout: "Everything", live: true },
    { tool: "Mailchimp", what: "Optional: the one \"finish your signup\" email and marketing to people who opted in.", cost: "Standard plan, low hundreds a year at your list size", breaksWithout: "Reminders go out as plain emails from us instead", live: false },
    { tool: "Maps (OpenStreetMap)", what: "Map tiles on dispatch and tracking pages.", cost: "Free for the demo; a commercial tile plan in production", breaksWithout: "No maps", live: true },
  ];
}


