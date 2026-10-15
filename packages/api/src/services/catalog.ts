/** Services, their owner-configured fields, and the rate card as the signup wizard and admin see them. */
import { and, asc, desc, eq, inArray, isNull, or, schema, type DbOrTx } from "@css/db";
import { FieldConfig, type FieldDef, type PriceListItem } from "@css/domain";

export type ServiceRow = typeof schema.services.$inferSelect;
export type FieldRow = typeof schema.serviceFields.$inferSelect;

export interface CatalogService {
  service: ServiceRow;
  fields: FieldDef[];
  /** Empty = offered at every school. */
  schools: { schoolId: string; availability: string }[];
}

export function toFieldDef(row: FieldRow): FieldDef {
  const config = FieldConfig.safeParse(row.config);
  return {
    key: row.key,
    type: row.type as FieldDef["type"],
    label: row.label,
    help: row.help,
    required: row.required,
    sortOrder: row.sortOrder,
    config: config.success ? config.data : {},
    showIf: row.showIf ?? null,
  };
}

export async function servicesWithFields(db: DbOrTx, ids?: readonly string[]): Promise<CatalogService[]> {
  if (ids && !ids.length) return [];
  const services = await db
    .select()
    .from(schema.services)
    .where(ids ? inArray(schema.services.id, [...ids]) : undefined)
    .orderBy(asc(schema.services.sortOrder), asc(schema.services.name));
  const serviceIds = services.map((s) => s.id);
  if (!serviceIds.length) return [];
  const fields = await db
    .select()
    .from(schema.serviceFields)
    .where(and(inArray(schema.serviceFields.serviceId, serviceIds), eq(schema.serviceFields.active, true)))
    .orderBy(asc(schema.serviceFields.sortOrder));
  const schools = await db.select().from(schema.serviceSchools).where(inArray(schema.serviceSchools.serviceId, serviceIds));
  const out = services.map((service) => ({
    service,
    fields: fields.filter((f) => f.serviceId === service.id).map(toFieldDef),
    schools: schools.filter((x) => x.serviceId === service.id).map((x) => ({ schoolId: x.schoolId, availability: x.availability })),
  }));
  // Keep the caller's order when ids were given (wizard order = selection order).
  return ids ? ids.map((id) => out.find((o) => o.service.id === id)).filter((x): x is CatalogService => !!x) : out;
}

export function offeredAt(service: ServiceRow, now: Date): boolean {
  if (!service.active) return false;
  if (service.offeredFrom && now < service.offeredFrom) return false;
  if (service.offeredUntil && now >= service.offeredUntil) return false;
  return true;
}

export function offeredAtSchool(entry: CatalogService, schoolId: string | null): boolean {
  if (!entry.schools.length || !schoolId) return true;
  return entry.schools.some((s) => s.schoolId === schoolId);
}

export function collectsSchool(entry: Pick<CatalogService, "fields">): boolean {
  return entry.fields.some((f) => f.type === "school" || f.type === "residence");
}

/** A draft holding a service that has since ended moves to its successor (if that's offered now). */
export function successorIfEnded(entry: CatalogService, all: readonly CatalogService[], now: Date): CatalogService | null {
  let current: CatalogService | undefined = entry;
  for (let hops = 0; current && hops < 5; hops++) {
    if (offeredAt(current.service, now)) return current;
    const next: string | null = current.service.successorServiceId;
    current = next ? all.find((c) => c.service.id === next) : undefined;
  }
  return null;
}

/** The season new signups belong to by default: the latest one. */
export async function signupSeason(db: DbOrTx) {
  const [season] = await db.select().from(schema.seasons).orderBy(desc(schema.seasons.startsOn)).limit(1);
  if (!season) throw new Error("No season configured");
  return season;
}

export async function seasonFor(db: DbOrTx, seasonId: string) {
  const [season] = await db.select().from(schema.seasons).where(eq(schema.seasons.id, seasonId)).limit(1);
  if (!season) throw new Error("Season not found");
  return season;
}

export async function priceList(db: DbOrTx, seasonId: string): Promise<(PriceListItem & { id: string })[]> {
  return db
    .select({ id: schema.rateCardItems.id, code: schema.rateCardItems.code, name: schema.rateCardItems.name, unitPriceCents: schema.rateCardItems.unitPriceCents })
    .from(schema.rateCardItems)
    .where(and(eq(schema.rateCardItems.seasonId, seasonId), eq(schema.rateCardItems.active, true)));
}

export async function activeSchools(db: DbOrTx) {
  const schools = await db.select().from(schema.schools).where(eq(schema.schools.active, true)).orderBy(asc(schema.schools.name));
  const residences = await db.select().from(schema.residences).where(or(eq(schema.residences.active, true), isNull(schema.residences.active))).orderBy(asc(schema.residences.name));
  return schools.map((school) => ({
    id: school.id,
    name: school.name,
    shortName: school.shortName,
    color: school.color,
    allowsSpecialPickup: school.allowsSpecialPickup,
    residences: residences
      .filter((r) => r.schoolId === school.id)
      .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "dorm" ? -1 : b.kind === "dorm" ? 1 : a.kind.localeCompare(b.kind)))
      .map((r) => ({ id: r.id, name: r.name, kind: r.kind })),
  }));
}
