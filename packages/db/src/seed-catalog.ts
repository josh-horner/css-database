/**
 * Catalog seed: schools, residences, rate card, services with their signup questions, capacity, knowledge base.
 * These are business facts the owner edits in admin (public school/dorm names; prices from docs/baseline-metrics.md).
 */
import { dateRange, type FieldConfig, type FieldType } from "@css/domain";
import { eq } from "drizzle-orm";
import type { Db } from "./client";
import * as s from "./schema";

type Season = typeof s.seasons.$inferSelect;

export const SCHOOLS = [
  {
    name: "University of Colorado Boulder",
    shortName: "CU Boulder",
    city: "Boulder",
    color: "#CFB87C",
    lat: 40.0076,
    lng: -105.2659,
    allowsSpecialPickup: true,
    residences: [
      ["Farrand Hall", "dorm", 40.0063, -105.2648],
      ["Libby Hall", "dorm", 40.0037, -105.2669],
      ["Kittredge Central", "dorm", 40.0031, -105.2593],
      ["Baker Hall", "dorm", 40.0084, -105.2678],
      ["Williams Village North", "dorm", 39.9946, -105.2494],
      ["Greek house", "greek", 40.0047, -105.2742],
      ["Off campus (The Hill)", "off_campus", 40.0021, -105.2775],
    ],
  },
  {
    name: "Colorado State University",
    shortName: "CSU",
    city: "Fort Collins",
    color: "#1E4D2B",
    lat: 40.5734,
    lng: -105.0865,
    allowsSpecialPickup: false,
    residences: [
      ["Corbett Hall", "dorm", 40.5755, -105.0921],
      ["Parmelee Hall", "dorm", 40.5752, -105.0938],
      ["Braiden Hall", "dorm", 40.5768, -105.0889],
      ["Off campus", "off_campus", 40.5707, -105.0812],
    ],
  },
  {
    name: "University of Denver",
    shortName: "DU",
    city: "Denver",
    color: "#BA0C2F",
    lat: 39.6766,
    lng: -104.9619,
    allowsSpecialPickup: false,
    residences: [
      ["Johnson-McFarlane Hall", "dorm", 39.6744, -104.9632],
      ["Centennial Halls", "dorm", 39.6781, -104.9651],
      ["Off campus", "off_campus", 39.6789, -104.9588],
    ],
  },
  {
    name: "Colorado College",
    shortName: "CC",
    city: "Colorado Springs",
    color: "#D29F13",
    lat: 38.8486,
    lng: -104.8233,
    allowsSpecialPickup: false,
    residences: [
      ["Loomis Hall", "dorm", 38.8489, -104.8244],
      ["Mathias Hall", "dorm", 38.8471, -104.8226],
      ["Off campus", "off_campus", 38.8452, -104.8210],
    ],
  },
  {
    name: "Colorado School of Mines",
    shortName: "Mines",
    city: "Golden",
    color: "#21314D",
    lat: 39.751,
    lng: -105.2226,
    allowsSpecialPickup: false,
    residences: [
      ["Morgan Hall", "dorm", 39.7497, -105.2236],
      ["Thomas Hall", "dorm", 39.7502, -105.2245],
      ["Off campus", "off_campus", 39.7539, -105.2201],
    ],
  },
] as const;

// Most common prices in 2025–26 invoice text (docs/baseline-metrics.md#prices-observed-in-invoices).
const RATE_CARD: [code: string, name: string, category: string, cents: number, unit: "each" | "hour" | "minute" | "flat", onContract: boolean][] = [
  ["DEPOSIT", "Sign-up fee / deposit", "fees", 5900, "flat", false],
  ["IN_ROOM", "In-room pick-up", "fees", 7500, "flat", false],
  ["SPECIAL_PICKUP", "Special pickup (outside scheduled days)", "fees", 25000, "flat", false],
  ["SPECIAL_DELIVERY", "Special delivery", "fees", 10000, "flat", false],
  ["LABOR_2", "Moving labor, 2 movers + truck", "labor", 15000, "hour", false],
  ["LABOR_3", "Moving labor, 3 movers + truck", "labor", 17500, "hour", false],
  ["LABOR_4", "Moving labor, 4 movers + truck", "labor", 22500, "hour", false],
  ["UPSTAIRS", "Past ground floor (crew time)", "labor", 292, "minute", true],
  ["BOX_S", "Small box", "boxes", 3900, "each", true],
  ["BOX_M", "Medium box", "boxes", 4900, "each", true],
  ["BOX_L", "Large box", "boxes", 5900, "each", true],
  ["BOX_XL", "XL box", "boxes", 7900, "each", true],
  ["BOX_XXL", "XXL / wardrobe box", "boxes", 9900, "each", true],
  ["TV_BOX", "TV box", "boxes", 6900, "each", true],
  ["TOWER_S", "Plastic tower / bin, small", "bins", 3900, "each", true],
  ["TOWER_M", "Plastic tower / bin, medium", "bins", 4900, "each", true],
  ["TOWER_L", "Plastic tower / bin, large", "bins", 5900, "each", true],
  ["DUFFEL_M", "Duffel bag, medium", "bags", 4900, "each", true],
  ["DUFFEL_L", "Duffel bag, large", "bags", 5900, "each", true],
  ["SUITCASE", "Suitcase", "bags", 6900, "each", true],
  ["MINI_FRIDGE", "Mini fridge", "appliances", 6900, "each", true],
  ["MICROWAVE", "Microwave", "appliances", 3900, "each", true],
  ["AC_UNIT", "AC unit", "appliances", 4900, "each", true],
  ["FAN", "Fan", "appliances", 2900, "each", true],
  ["TV", "TV", "appliances", 6900, "each", true],
  ["VACUUM", "Vacuum", "appliances", 4900, "each", true],
  ["BED", "Bed (frame + mattress)", "furniture", 16900, "each", true],
  ["MATTRESS", "Mattress", "furniture", 14900, "each", true],
  ["COUCH", "Couch / futon", "furniture", 14900, "each", true],
  ["BED_FRAME", "Bed frame", "furniture", 9900, "each", true],
  ["HEADBOARD", "Headboard", "furniture", 6900, "each", true],
  ["DESK", "Desk", "furniture", 7900, "each", true],
  ["DRESSER", "Dresser", "furniture", 9900, "each", true],
  ["NIGHT_STAND", "Night stand", "furniture", 5900, "each", true],
  ["DESK_CHAIR", "Desk chair", "furniture", 6900, "each", true],
  ["COFFEE_TABLE", "Coffee table", "furniture", 6900, "each", true],
  ["OTTOMAN", "Ottoman", "furniture", 4900, "each", true],
  ["RUG", "Rug", "furniture", 5900, "each", true],
  ["TOPPER", "Mattress topper / pad", "furniture", 6900, "each", true],
  ["BIKE", "Bike", "sports", 7900, "each", true],
  ["SKI_BAG", "Skis / ski bag", "sports", 6900, "each", true],
  ["SNOWBOARD", "Snowboard", "sports", 6900, "each", true],
  ["BOOT_BAG", "Boot bag / backpack / cooler", "sports", 3900, "each", true],
  ["GUITAR", "Guitar", "sports", 4900, "each", true],
  ["MIRROR", "Mirror", "small items", 1900, "each", true],
  ["LAMP", "Lamp", "small items", 1900, "each", true],
  ["HAMPER", "Hamper / shoe rack", "small items", 1900, "each", true],
  ["SMALL_ITEM", "Laundry basket / trash can / poster tube", "small items", 1000, "each", true],
  ["MATTRESS_COVER", "Mattress cover", "supplies", 1500, "each", true],
  ["BUBBLE_WRAP", "Bubble wrap", "supplies", 500, "each", true],
  ["CAR_STORAGE", "Summer car storage", "other", 130000, "flat", false],
];

export async function seedRateCard(db: Db, season: Season) {
  await db.insert(s.rateCardItems).values(
    RATE_CARD.map(([code, name, category, cents, unit, onContract], i) => ({
      seasonId: season.id,
      code,
      name,
      category,
      unitPriceCents: cents,
      unit,
      onContract,
      sortOrder: i,
    })),
  );
}

export async function seedSchools(db: Db) {
  const out = [];
  for (const school of SCHOOLS) {
    const { residences, ...row } = school;
    const [inserted] = await db.insert(s.schools).values(row).returning();
    const res = await db
      .insert(s.residences)
      .values(
        residences.map(([name, kind, lat, lng]) => ({
          schoolId: inserted!.id,
          name,
          kind,
          address: kind === "dorm" ? `${name}, ${school.city}, CO` : `${school.city}, CO`,
          lat,
          lng,
        })),
      )
      .returning();
    out.push({ school: inserted!, residences: res });
  }
  return out;
}

interface FieldSeed {
  key: string;
  type: FieldType;
  label: string;
  help?: string;
  required?: boolean;
  config?: FieldConfig;
  showIf?: { key: string; equals: unknown };
}

const SCHOOL: FieldSeed = { key: "school", type: "school", label: "Your school", config: { parentLabel: "Your student's school" } };
const RESIDENCE: FieldSeed = {
  key: "residence",
  type: "residence",
  label: "Where do you live?",
  help: "Dorm, Greek house, or off-campus address",
  config: { parentLabel: "Where does your student live?" },
};
const STUDENT: FieldSeed = { key: "student", type: "person", label: "Student", config: { role: "student", askPhone: true } };
const GUARDIAN: FieldSeed = {
  key: "guardian",
  type: "person",
  label: "Parent or guardian",
  help: "They get the same updates and can sign in to see the booking.",
  config: { role: "guardian" },
};
const CUSTOMER: FieldSeed = { key: "customer", type: "person", label: "Your contact info", config: { role: "customer", askPhone: true } };

export interface SeededServices {
  byCode: Record<string, typeof s.services.$inferSelect>;
}

export async function seedServices(db: Db, signupSeason: Season, schoolIds: string[]): Promise<SeededServices> {
  const y = Number(signupSeason.startsOn.slice(0, 4));
  const denver = (isoDate: string) => new Date(`${isoDate}T06:00:00Z`); // midnight MDT
  const defs: {
    code: string;
    name: string;
    description: string;
    family?: string;
    seasonId?: string | null;
    offeredFrom?: Date | null;
    offeredUntil?: Date | null;
    chargesDeposit?: boolean;
    baseRateCardCode?: string;
    instructions?: string;
    staffOnly?: boolean;
    schools?: boolean;
    fields: FieldSeed[];
  }[] = [
    {
      code: "SUMMER_STORAGE",
      name: "Summer storage",
      description: "We pick up from your dorm or apartment in May, store everything over the summer, and deliver in August.",
      family: "student-storage",
      seasonId: signupSeason.id,
      offeredFrom: denver(`${y - 1}-08-01`),
      offeredUntil: denver(`${y}-05-10`),
      instructions: "The $59 sign-up fee includes boxes, tape, and packing supplies. Storage is priced per item at pickup from our price list.",
      schools: true,
      fields: [
        SCHOOL,
        RESIDENCE,
        STUDENT,
        GUARDIAN,
        {
          key: "pickup",
          type: "appointment",
          label: "Pickup day",
          help: "Pick a day your school's crews are on campus.",
          config: { appointmentType: "pickup", scheduling: "service_days", parentLabel: "Your student's pickup day" },
        },
        {
          key: "delivery_plan",
          type: "select",
          label: "Fall delivery",
          required: false,
          help: "You'll schedule the exact day in summer.",
          config: {
            options: [
              { value: "deliver", label: "Deliver to my fall address" },
              { value: "ship", label: "Ship it to me" },
              { value: "unsure", label: "Not sure yet" },
            ],
          },
        },
      ],
    },
    {
      code: "OFFSEASON_STORAGE",
      name: "Summer storage (late signup)",
      description: "Missed the scheduled pickup days? Tell us when you need a pickup and we'll fit you in.",
      family: "student-storage",
      seasonId: signupSeason.id,
      offeredFrom: denver(`${y}-05-10`),
      offeredUntil: denver(`${y}-08-01`),
      fields: [SCHOOL, RESIDENCE, STUDENT, GUARDIAN, { key: "pickup", type: "appointment", label: "Requested pickup date", config: { appointmentType: "pickup", scheduling: "customer_date" } }],
    },
    {
      code: "SEMESTER_STORAGE",
      name: "Semester / study abroad storage",
      description: "Store your things while you're away for a semester or a year abroad.",
      family: "abroad",
      seasonId: signupSeason.id,
      fields: [
        SCHOOL,
        RESIDENCE,
        STUDENT,
        GUARDIAN,
        { key: "pickup", type: "appointment", label: "Requested pickup date", config: { appointmentType: "pickup", scheduling: "customer_date" } },
        {
          key: "returning",
          type: "select",
          label: "When are you back?",
          config: {
            options: [
              { value: "next_semester", label: "Next semester" },
              { value: "next_year", label: "Next school year" },
              { value: "unsure", label: "Not sure yet" },
            ],
          },
        },
      ],
    },
    {
      code: "IN_ROOM_PICKUP",
      name: "In-room pick-up",
      description: "Add to storage: our crew carries everything out of your room, so you don't have to bring it down.",
      family: "add-ons",
      chargesDeposit: false,
      baseRateCardCode: "IN_ROOM",
      fields: [{ key: "access_notes", type: "long_text", label: "Anything the crew should know?", required: false, help: "Floor, elevator, gate codes…" }],
    },
    {
      code: "SHIPPING",
      name: "Shipping",
      description: "We pick up your boxes and ship them home or to your next school.",
      family: "shipping",
      chargesDeposit: false,
      fields: [
        STUDENT,
        { key: "ship_to", type: "address", label: "Ship to", help: "Full street address" },
        { key: "ship_boxes", type: "number", label: "About how many boxes?", help: "Priced by size and weight once we have them.", config: { min: 1, max: 50 } },
      ],
    },
    {
      code: "CAR_STORAGE",
      name: "Summer car storage",
      description: "Indoor storage for your car over the summer.",
      family: "car",
      seasonId: signupSeason.id,
      chargesDeposit: false,
      baseRateCardCode: "CAR_STORAGE",
      fields: [
        STUDENT,
        { key: "vehicle", type: "text", label: "Year, make, and model" },
        { key: "plate", type: "text", label: "License plate" },
        { key: "car_dropoff", type: "date", label: "Drop-off date" },
      ],
    },
    {
      code: "MOVING",
      name: "Local moving",
      description: "Movers and a truck for a local move, billed by the hour.",
      family: "moving",
      chargesDeposit: false,
      fields: [
        CUSTOMER,
        { key: "move_from", type: "address", label: "Moving from" },
        { key: "move_to", type: "address", label: "Moving to" },
        { key: "move", type: "appointment", label: "Moving day", config: { appointmentType: "move", scheduling: "customer_date", addressKey: "move_from" } },
        {
          key: "crew_size",
          type: "select",
          label: "Crew",
          help: "Billed by the hour; most dorm and apartment moves take 2–3 hours.",
          config: {
            options: [
              { value: "2", label: "2 movers + truck ($150/hr)", rateCardCode: "LABOR_2" },
              { value: "3", label: "3 movers + truck ($175/hr)", rateCardCode: "LABOR_3" },
              { value: "4", label: "4 movers + truck ($225/hr)", rateCardCode: "LABOR_4" },
            ],
          },
        },
      ],
    },
    {
      code: "FURNITURE_DELIVERY",
      name: "IKEA / furniture delivery",
      description: "We pick up your order and bring it to your door.",
      family: "delivery",
      chargesDeposit: false,
      fields: [
        CUSTOMER,
        { key: "delivery_address", type: "address", label: "Deliver to" },
        { key: "delivery", type: "appointment", label: "Delivery date", config: { appointmentType: "delivery", scheduling: "customer_date", addressKey: "delivery_address" } },
        { key: "delivery_items", type: "long_text", label: "What are we picking up?", help: "Store, order number, and the items" },
      ],
    },
    {
      code: "SHORT_TERM",
      name: "Short-term storage",
      description: "A few weeks of storage between leases or semesters.",
      family: "short-term",
      chargesDeposit: false,
      staffOnly: true,
      fields: [{ key: "storage_until", type: "date", label: "Store until" }],
    },
    {
      code: "SPECIAL_PICKUP",
      name: "Special pickup",
      description: "A pickup outside the scheduled days.",
      family: "add-ons",
      chargesDeposit: false,
      baseRateCardCode: "SPECIAL_PICKUP",
      staffOnly: true,
      fields: [{ key: "special_pickup", type: "appointment", label: "Pickup date", config: { appointmentType: "pickup", scheduling: "customer_date" } }],
    },
  ];

  const byCode: SeededServices["byCode"] = {};
  for (const [i, def] of defs.entries()) {
    const [service] = await db
      .insert(s.services)
      .values({
        code: def.code,
        name: def.name,
        description: def.description,
        family: def.family ?? null,
        seasonId: def.seasonId ?? null,
        offeredFrom: def.offeredFrom ?? null,
        offeredUntil: def.offeredUntil ?? null,
        chargesDeposit: def.chargesDeposit ?? true,
        baseRateCardCode: def.baseRateCardCode ?? null,
        instructions: def.instructions ?? null,
        staffOnly: def.staffOnly ?? false,
        sortOrder: i,
      })
      .returning();
    byCode[def.code] = service!;
    await db.insert(s.serviceFields).values(
      def.fields.map((f, order) => ({
        serviceId: service!.id,
        key: f.key,
        type: f.type,
        label: f.label,
        help: f.help ?? null,
        required: f.required ?? true,
        sortOrder: order,
        config: (f.config ?? {}) as Record<string, unknown>,
        showIf: f.showIf ?? null,
      })),
    );
    if (def.schools) await db.insert(s.serviceSchools).values(schoolIds.map((schoolId) => ({ serviceId: service!.id, schoolId })));
  }
  await db.update(s.services).set({ successorServiceId: byCode.OFFSEASON_STORAGE!.id }).where(eqId(byCode.SUMMER_STORAGE!.id));
  return { byCode };
}

const eqId = (id: string) => eq(s.services.id, id);

/** Pickup days late April–mid May and delivery days mid–late August, per school (no Sundays). */
export async function seedServiceDays(db: Db, season: Season, schoolIds: string[]) {
  const y = Number(season.startsOn.slice(0, 4));
  const rows: (typeof s.serviceDays.$inferInsert)[] = [];
  for (const schoolId of schoolIds) {
    for (const date of dateRange(`${y}-04-28`, `${y}-05-15`, [0])) {
      rows.push({ seasonId: season.id, schoolId, date, type: "pickup", campusScope: "on", windowId: null, capacity: 40 });
      rows.push({ seasonId: season.id, schoolId, date, type: "pickup", campusScope: "off", windowId: "AM", capacity: 10 });
      rows.push({ seasonId: season.id, schoolId, date, type: "pickup", campusScope: "off", windowId: "PM", capacity: 10 });
    }
    for (const date of dateRange(`${y}-08-14`, `${y}-08-28`, [0])) {
      rows.push({ seasonId: season.id, schoolId, date, type: "delivery", campusScope: "on", windowId: null, capacity: 40 });
      rows.push({ seasonId: season.id, schoolId, date, type: "delivery", campusScope: "off", windowId: "AM", capacity: 10 });
      rows.push({ seasonId: season.id, schoolId, date, type: "delivery", campusScope: "off", windowId: "PM", capacity: 10 });
    }
  }
  return db.insert(s.serviceDays).values(rows).returning();
}

export const STARTER_KB = [
  {
    title: "Pickup day",
    body:
      "Pickups happen in a morning window (9:30 AM–12:30 PM) or an afternoon window (1:30–4:30 PM). Dorm pickups are by date. " +
      "On pickup day you get a text when the crew is on the way, with a live tracking link showing your place in line and ETA. " +
      "Have everything packed, closed, and labeled with your confirmation number before the window starts.",
  },
  { title: "Labels", body: "Write or print your confirmation number on every box and item. Printable labels are in your account." },
  {
    title: "Billing",
    body:
      "The $59 sign-up fee is charged at signup and includes boxes, tape, and supplies. After pickup, CSS reviews the crew's list of what was picked up and the card on file is charged for storage. " +
      "Storage is priced per item by size; for example small/medium/large boxes are $39/$49/$59. A 3% card processing fee applies. " +
      "If a payment fails, you get a link to pay or update your card.",
  },
  { title: "Rescheduling", body: "You can change your pickup day in your account up to 2 days before. A person at CSS confirms other changes. The assistant can't change appointments." },
  { title: "Packing supplies", body: "Boxes, tape, and mattress covers come with your sign-up and are dropped off or available on campus before pickup days. Extra boxes are added to your bill at pickup." },
  { title: "Damage or missing items", body: "Claims are filed online within 7 days after delivery, with photos. Pickup and delivery photos are attached automatically. A person at CSS reviews every claim." },
];

export async function seedKb(db: Db) {
  await db.insert(s.kbArticles).values(STARTER_KB.map((a, i) => ({ ...a, sortOrder: i })));
}
