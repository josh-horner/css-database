/**
 * Database schema. Mirrors docs/domain-model.md; update both together.
 * Conventions: uuid v7 ids, integer cents, timestamptz in UTC, appointment = local date + window id,
 * `legacyId` on rows that will be imported from the Rails app.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { v7 as uuidv7 } from "uuid";

const id = () =>
  uuid("id")
    .primaryKey()
    .$defaultFn(() => uuidv7());
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdateFn(() => new Date());
const legacyId = () => integer("legacy_id");
const ts = (name: string) => timestamp(name, { withTimezone: true });

// ---------------------------------------------------------------------------------------------
// Seasons, schools, services, rate card

export const seasonKind = pgEnum("season_kind", ["summer", "semester", "year_round"]);

export const seasons = pgTable("seasons", {
  id: id(),
  name: text("name").notNull(),
  kind: seasonKind("kind").notNull().default("summer"),
  startsOn: date("starts_on").notNull(),
  endsOn: date("ends_on").notNull(),
  cardFeeBps: integer("card_fee_bps").notNull().default(300),
  depositCents: integer("deposit_cents").notNull(),
  /** Customers can book a capacity-managed window no sooner than this many days ahead. */
  leadDays: integer("lead_days").notNull().default(2),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const schools = pgTable("schools", {
  id: id(),
  name: text("name").notNull(),
  shortName: text("short_name").notNull(),
  city: text("city").notNull(),
  /** Used on printed labels and the calendar. */
  color: text("color").notNull(),
  /** Paid "special pickup" outside the calendar is offered at signup. */
  allowsSpecialPickup: boolean("allows_special_pickup").notNull().default(false),
  lat: doublePrecision("lat").notNull(),
  lng: doublePrecision("lng").notNull(),
  active: boolean("active").notNull().default(true),
  legacyId: legacyId(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const residenceKind = pgEnum("residence_kind", ["dorm", "greek", "off_campus"]);

export const residences = pgTable("residences", {
  id: id(),
  schoolId: uuid("school_id")
    .notNull()
    .references(() => schools.id),
  name: text("name").notNull(),
  kind: residenceKind("kind").notNull(),
  address: text("address").notNull(),
  lat: doublePrecision("lat").notNull(),
  lng: doublePrecision("lng").notNull(),
  active: boolean("active").notNull().default(true),
  legacyId: legacyId(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const services = pgTable("services", {
  id: id(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  /** Groups variants on the admin timeline, e.g. student-storage. */
  family: text("family"),
  /** Student services belong to a season; null = assigned by appointment date. */
  seasonId: uuid("season_id").references(() => seasons.id),
  /** Null = no limit. Signup shows only services offered right now. */
  offeredFrom: ts("offered_from"),
  offeredUntil: ts("offered_until"),
  successorServiceId: uuid("successor_service_id"),
  /** Charge the season deposit at signup when this service is booked. */
  chargesDeposit: boolean("charges_deposit").notNull().default(true),
  /** Rate card code billed once when the service is booked (e.g. IN_ROOM). */
  baseRateCardCode: text("base_rate_card_code"),
  /** Shown at signup under the service. */
  instructions: text("instructions"),
  /** Staff only: customers can't pick it at signup. */
  staffOnly: boolean("staff_only").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  active: boolean("active").notNull().default(true),
  legacyId: legacyId(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const rateCardUnit = pgEnum("rate_card_unit", ["each", "hour", "minute", "flat"]);

export const rateCardItems = pgTable(
  "rate_card_items",
  {
    id: id(),
    seasonId: uuid("season_id")
      .notNull()
      .references(() => seasons.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    category: text("category").notNull(),
    unit: rateCardUnit("unit").notNull().default("each"),
    unitPriceCents: integer("unit_price_cents").notNull(),
    /** Offered on the crew's digital contract picker. */
    onContract: boolean("on_contract").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("rate_card_items_season_code").on(t.seasonId, t.code)],
);

/** Owner-configured question on a service (docs/domain-model.md#service-fields-owner-configured). */
export const serviceFields = pgTable(
  "service_fields",
  {
    id: id(),
    serviceId: uuid("service_id")
      .notNull()
      .references(() => services.id),
    /** Stable key; two services asking the same key (e.g. student) share one answer. */
    key: text("key").notNull(),
    type: text("type").notNull(),
    label: text("label").notNull(),
    help: text("help"),
    required: boolean("required").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    showIf: jsonb("show_if").$type<{ key: string; equals: unknown } | null>(),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("service_fields_service").on(t.serviceId, t.sortOrder)],
);

/** Which schools a student service is offered at. No rows = every school. */
export const serviceSchools = pgTable(
  "service_schools",
  {
    serviceId: uuid("service_id")
      .notNull()
      .references(() => services.id),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id),
    /** on | off | both: on-campus dorms, off-campus addresses, or both. */
    availability: text("availability").notNull().default("both"),
  },
  (t) => [primaryKey({ columns: [t.serviceId, t.schoolId] })],
);

export const appointmentTypeForDays = pgEnum("service_day_type", ["pickup", "delivery"]);

/** Capacity-managed window: school × date × type × window. Reserved is counted from appointments. */
export const serviceDays = pgTable(
  "service_days",
  {
    id: id(),
    seasonId: uuid("season_id")
      .notNull()
      .references(() => seasons.id),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id),
    date: date("date").notNull(),
    type: appointmentTypeForDays("type").notNull(),
    /** on | off | both */
    campusScope: text("campus_scope").notNull().default("both"),
    /** Null = date-only (most dorm pickups). */
    windowId: text("window_id"),
    capacity: integer("capacity").notNull(),
    blocked: boolean("blocked").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("service_days_school_date").on(t.schoolId, t.date)],
);

// ---------------------------------------------------------------------------------------------
// People and access (ADR-0004)

export const persons = pgTable("persons", {
  id: id(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  legacyId: legacyId(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const contactKind = pgEnum("contact_kind", ["email", "phone"]);

export const contactPoints = pgTable(
  "contact_points",
  {
    id: id(),
    personId: uuid("person_id")
      .notNull()
      .references(() => persons.id),
    kind: contactKind("kind").notNull(),
    /** Normalized: lowercased email, E.164 phone. */
    value: text("value").notNull(),
    verifiedAt: ts("verified_at"),
    /** "CSS can text me" consent. Transactional SMS still requires it; STOP sets optOut. */
    smsConsentAt: ts("sms_consent_at"),
    smsOptOutAt: ts("sms_opt_out_at"),
    marketingConsentAt: ts("marketing_consent_at"),
    bouncedAt: ts("bounced_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("contact_points_person_kind_value").on(t.personId, t.kind, t.value), index("contact_points_value").on(t.value)],
);

/** guardian_of: a parent with two kids is one Person with two links. */
export const personLinks = pgTable(
  "person_links",
  {
    guardianId: uuid("guardian_id")
      .notNull()
      .references(() => persons.id),
    studentId: uuid("student_id")
      .notNull()
      .references(() => persons.id),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.guardianId, t.studentId] })],
);

/** One-time sign-in codes. Signing in = proving you own a contact point. */
export const verificationCodes = pgTable(
  "verification_codes",
  {
    id: id(),
    kind: contactKind("kind").notNull(),
    value: text("value").notNull(),
    codeHash: text("code_hash").notNull(),
    expiresAt: ts("expires_at").notNull(),
    attempts: integer("attempts").notNull().default(0),
    usedAt: ts("used_at"),
    createdAt: createdAt(),
  },
  (t) => [index("verification_codes_value").on(t.value, t.createdAt)],
);

/** Customer session: a verified contact point; access is derived from the persons who own it. */
export const customerSessions = pgTable("customer_sessions", {
  id: id(),
  tokenHash: text("token_hash").notNull().unique(),
  kind: contactKind("kind").notNull(),
  value: text("value").notNull(),
  expiresAt: ts("expires_at").notNull(),
  revokedAt: ts("revoked_at"),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------------------------------------
// Bookings

export const lifecycle = pgEnum("booking_lifecycle", [
  "draft",
  "confirmed",
  "picked_up",
  "in_storage",
  "delivery_scheduled",
  "delivered",
  "closed",
  "cancelled",
]);

export interface DraftState {
  serviceIds: string[];
  answers: Record<string, unknown>;
  /** Who is filling it out. */
  signerRole?: "student" | "guardian" | "other";
  /** Staff-created drafts skip required-field checks. */
  staffMode?: boolean;
  /** Share platform carried in a referral link. */
  via?: string | null;
  /** Card being saved at the payment step (provider tokens only). */
  cardSetup?: { providerCustomerId: string; setupRef: string };
}

export const bookings = pgTable(
  "bookings",
  {
    id: id(),
    seasonId: uuid("season_id")
      .notNull()
      .references(() => seasons.id),
    confirmationNumber: integer("confirmation_number"),
    customerPersonId: uuid("customer_person_id")
      .notNull()
      .references(() => persons.id),
    schoolId: uuid("school_id").references(() => schools.id),
    residenceId: uuid("residence_id").references(() => residences.id),
    room: text("room"),
    lifecycle: lifecycle("lifecycle").notNull().default("draft"),
    flags: text("flags").array().notNull().default([]),
    /** Street address for off-campus residences and non-student services. */
    address: text("address"),
    storageUntil: date("storage_until"),
    storageLocation: text("storage_location"),
    /**
     * While lifecycle = draft: the wizard's selections and answers. Materialized into booking_services,
     * field_answers, persons, and appointments at confirmation, so changing your mind deletes nothing.
     */
    draft: jsonb("draft").$type<DraftState | null>(),
    /** Signup funnel (docs/features/signup-funnel.md). */
    stepReached: text("step_reached").notNull().default("contact"),
    lastActivityAt: ts("last_activity_at"),
    abandonedAt: ts("abandoned_at"),
    reminderSentAt: ts("reminder_sent_at"),
    submittedAt: ts("submitted_at"),
    cancelledAt: ts("cancelled_at"),
    cancelReason: text("cancel_reason"),
    /** "How did you hear about us" (attribution only; never triggers a reward). */
    heardFrom: text("heard_from"),
    /** This booking's own referral code, shared from the portal. */
    referralCode: text("referral_code").unique(),
    /** Code entered or carried in the signup link (referral or promotion). */
    enteredCode: text("entered_code"),
    createdByStaffId: uuid("created_by_staff_id"),
    /** Hot leads outreach (owner follow-up on stalled signups). */
    outreachOutcome: text("outreach_outcome"),
    outreachAt: ts("outreach_at"),
    legacyId: legacyId(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // Cancelled bookings keep their number, and it can be reused (legacy behavior, kept on purpose).
    uniqueIndex("bookings_season_confirmation").on(t.seasonId, t.confirmationNumber).where(sql`lifecycle <> 'cancelled'`),
    index("bookings_lifecycle").on(t.lifecycle, t.lastActivityAt),
  ],
);

export const bookingParties = pgTable(
  "booking_parties",
  {
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id),
    personId: uuid("person_id")
      .notNull()
      .references(() => persons.id),
    /** customer | student | guardian | payer | signer */
    roles: text("roles").array().notNull(),
  },
  (t) => [primaryKey({ columns: [t.bookingId, t.personId] })],
);

export const bookingServiceSource = pgEnum("booking_service_source", ["signup", "staff_addon", "customer_addon"]);

export const bookingServices = pgTable("booking_services", {
  id: id(),
  bookingId: uuid("booking_id")
    .notNull()
    .references(() => bookings.id),
  serviceId: uuid("service_id")
    .notNull()
    .references(() => services.id),
  source: bookingServiceSource("source").notNull().default("signup"),
  reason: text("reason"),
  addedByStaffId: uuid("added_by_staff_id"),
  /** Staff-added services that need the customer's OK before work is scheduled. */
  acceptanceRequired: boolean("acceptance_required").notNull().default(false),
  acceptedAt: ts("accepted_at"),
  createdAt: createdAt(),
});

/** Answer to a ServiceField. Reference types also point at the record they created (refId). */
export const fieldAnswers = pgTable(
  "field_answers",
  {
    id: id(),
    bookingServiceId: uuid("booking_service_id")
      .notNull()
      .references(() => bookingServices.id),
    fieldKey: text("field_key").notNull(),
    value: jsonb("value").$type<unknown>(),
    refId: uuid("ref_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("field_answers_service_key").on(t.bookingServiceId, t.fieldKey)],
);

export const funnelEvents = pgTable(
  "funnel_events",
  {
    id: id(),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id),
    step: text("step").notNull(),
    /** viewed | completed | error */
    event: text("event").notNull(),
    meta: jsonb("meta"),
    at: ts("at").notNull().defaultNow(),
  },
  (t) => [index("funnel_events_booking").on(t.bookingId, t.at), index("funnel_events_at").on(t.at)],
);

export const notes = pgTable("notes", {
  id: id(),
  bookingId: uuid("booking_id")
    .notNull()
    .references(() => bookings.id),
  staffUserId: uuid("staff_user_id"),
  body: text("body").notNull(),
  pinned: boolean("pinned").notNull().default(false),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------------------------------------
// Staff, employees, crews, devices

export const staffUsers = pgTable("staff_users", {
  id: id(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  /** owner | office | dispatcher | warehouse | readonly */
  role: text("role").notNull(),
  passwordHash: text("password_hash").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const employees = pgTable("employees", {
  id: id(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  phone: text("phone").notNull().unique(),
  defaultRoles: text("default_roles").array().notNull().default([]),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const crews = pgTable("crews", {
  id: id(),
  date: date("date").notNull(),
  name: text("name").notNull(),
  color: text("color").notNull(),
  vehicle: text("vehicle"),
  publishedAt: ts("published_at"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const crewMembers = pgTable(
  "crew_members",
  {
    crewId: uuid("crew_id")
      .notNull()
      .references(() => crews.id),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id),
    /** Owner-defined role name, e.g. lead, driver, mover. */
    role: text("role").notNull(),
  },
  (t) => [primaryKey({ columns: [t.crewId, t.employeeId] })],
);

export const devices = pgTable("devices", {
  id: id(),
  name: text("name").notNull(),
  /** sha256 of the device's bearer token; the token itself is shown once at pairing. */
  tokenHash: text("token_hash").notNull().unique(),
  assignedCrewId: uuid("assigned_crew_id").references(() => crews.id),
  lastSeenAt: ts("last_seen_at"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const timeEntries = pgTable("time_entries", {
  id: id(),
  employeeId: uuid("employee_id")
    .notNull()
    .references(() => employees.id),
  crewId: uuid("crew_id").references(() => crews.id),
  deviceId: uuid("device_id").references(() => devices.id),
  clockInAt: ts("clock_in_at").notNull(),
  clockOutAt: ts("clock_out_at"),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------------------------------------
// Appointments, jobs, routes, tracking

export const appointmentType = pgEnum("appointment_type", ["pickup", "delivery", "move", "service"]);

export const appointments = pgTable("appointments", {
  id: id(),
  bookingId: uuid("booking_id")
    .notNull()
    .references(() => bookings.id),
  type: appointmentType("type").notNull(),
  /** The booking service whose appointment field created this. */
  bookingServiceId: uuid("booking_service_id").references(() => bookingServices.id),
  /** Local (America/Denver) date + window id. Never a timestamp with seconds-of-day math. */
  date: date("date").notNull(),
  windowId: text("window_id"),
  /** Capacity-managed window this reserves, if any. */
  serviceDayId: uuid("service_day_id").references(() => serviceDays.id),
  /** Booked over capacity by staff (reason in audit). */
  overbooked: boolean("overbooked").notNull().default(false),
  cancelledAt: ts("cancelled_at"),
  address: text("address").notNull(),
  lat: doublePrecision("lat").notNull(),
  lng: doublePrecision("lng").notNull(),
  room: text("room"),
  notes: text("notes"),
  legacyId: legacyId(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const jobStatus = pgEnum("job_status", [
  "unassigned",
  "assigned",
  "en_route",
  "arrived",
  "completed",
  "failed",
  "on_hold",
]);

export const jobs = pgTable(
  "jobs",
  {
    id: id(),
    appointmentId: uuid("appointment_id")
      .notNull()
      .references(() => appointments.id),
    crewId: uuid("crew_id").references(() => crews.id),
    /** Order within the crew's day. */
    sequence: integer("sequence"),
    status: jobStatus("status").notNull().default("unassigned"),
    estServiceMinutes: integer("est_service_minutes").notNull().default(20),
    enRouteAt: ts("en_route_at"),
    arrivedAt: ts("arrived_at"),
    completedAt: ts("completed_at"),
    signedByName: text("signed_by_name"),
    /** Random token for the customer's no-login tracking link. */
    trackingToken: text("tracking_token").notNull().unique(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("jobs_crew_sequence").on(t.crewId, t.sequence)],
);

export const crewLocations = pgTable(
  "crew_locations",
  {
    id: id(),
    crewId: uuid("crew_id")
      .notNull()
      .references(() => crews.id),
    deviceId: uuid("device_id").references(() => devices.id),
    lat: doublePrecision("lat").notNull(),
    lng: doublePrecision("lng").notNull(),
    accuracyM: doublePrecision("accuracy_m"),
    recordedAt: ts("recorded_at").notNull(),
  },
  (t) => [index("crew_locations_crew_time").on(t.crewId, t.recordedAt)],
);

// ---------------------------------------------------------------------------------------------
// Items (the digital contract) and photos

export const itemStatus = pgEnum("item_status", ["collected", "in_storage", "delivered", "missing"]);
export const itemSource = pgEnum("item_source", ["crew", "ai", "staff", "legacy_text"]);

export const items = pgTable("items", {
  id: id(),
  bookingId: uuid("booking_id")
    .notNull()
    .references(() => bookings.id),
  /** The pickup job whose contract recorded this line. */
  jobId: uuid("job_id").references(() => jobs.id),
  rateCardItemId: uuid("rate_card_item_id").references(() => rateCardItems.id),
  description: text("description"),
  quantity: integer("quantity").notNull(),
  deliveredQuantity: integer("delivered_quantity").notNull().default(0),
  /** Damage the crew saw at pickup; shown to the customer before they sign. */
  preExistingDamage: text("pre_existing_damage"),
  status: itemStatus("status").notNull().default("collected"),
  source: itemSource("source").notNull().default("crew"),
  /** Client-generated id so a retried offline command can't create a duplicate. */
  clientId: text("client_id").unique(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const photoKind = pgEnum("photo_kind", ["item", "room", "delivery", "signature"]);

export const photos = pgTable("photos", {
  id: id(),
  jobId: uuid("job_id")
    .notNull()
    .references(() => jobs.id),
  itemId: uuid("item_id").references(() => items.id),
  kind: photoKind("kind").notNull(),
  storageKey: text("storage_key").notNull(),
  contentType: text("content_type").notNull(),
  takenAt: ts("taken_at").notNull(),
  clientId: text("client_id").unique(),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------------------------------------
// Ledger

export const invoiceStatus = pgEnum("invoice_status", ["draft", "pending_review", "approved", "issued", "paid", "void"]);
export const invoiceSource = pgEnum("invoice_source", ["manual", "contract", "ai"]);
export const lineKind = pgEnum("line_kind", ["charge", "adjustment", "discount", "card_fee"]);

export const invoices = pgTable("invoices", {
  id: id(),
  bookingId: uuid("booking_id")
    .notNull()
    .references(() => bookings.id),
  jobId: uuid("job_id").references(() => jobs.id),
  status: invoiceStatus("status").notNull().default("draft"),
  source: invoiceSource("source").notNull().default("manual"),
  waiveCardFee: boolean("waive_card_fee").notNull().default(false),
  approvedByStaffId: uuid("approved_by_staff_id").references(() => staffUsers.id),
  approvedAt: ts("approved_at"),
  issuedAt: ts("issued_at"),
  legacyId: legacyId(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const invoiceLines = pgTable("invoice_lines", {
  id: id(),
  invoiceId: uuid("invoice_id")
    .notNull()
    .references(() => invoices.id),
  bookingServiceId: uuid("booking_service_id").references(() => bookingServices.id),
  kind: lineKind("kind").notNull().default("charge"),
  rateCardItemId: uuid("rate_card_item_id").references(() => rateCardItems.id),
  itemId: uuid("item_id").references(() => items.id),
  description: text("description").notNull(),
  quantity: integer("quantity").notNull(),
  unitPriceCents: integer("unit_price_cents").notNull(),
  needsPrice: boolean("needs_price").notNull().default(false),
  /** Required when there's no rate card item (ad hoc) and for adjustments. */
  reason: text("reason"),
  createdAt: createdAt(),
});

export const paymentProvider = pgEnum("payment_provider", ["stripe", "authorizenet", "fake"]);

export const paymentMethods = pgTable("payment_methods", {
  id: id(),
  personId: uuid("person_id")
    .notNull()
    .references(() => persons.id),
  provider: paymentProvider("provider").notNull(),
  providerCustomerId: text("provider_customer_id").notNull(),
  providerPaymentMethodId: text("provider_payment_method_id").notNull(),
  brand: text("brand"),
  last4: text("last4"),
  expMonth: integer("exp_month"),
  expYear: integer("exp_year"),
  active: boolean("active").notNull().default(true),
  legacyId: legacyId(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** The customer's agreement to charge the card on file (ledger rule 9). */
export const chargeAuthorizations = pgTable("charge_authorizations", {
  id: id(),
  paymentMethodId: uuid("payment_method_id")
    .notNull()
    .references(() => paymentMethods.id),
  payerPersonId: uuid("payer_person_id")
    .notNull()
    .references(() => persons.id),
  bookingId: uuid("booking_id")
    .notNull()
    .references(() => bookings.id),
  textVersion: text("text_version").notNull(),
  text: text("text").notNull(),
  acceptedAt: ts("accepted_at").notNull(),
  ip: text("ip"),
  userAgent: text("user_agent"),
});

export const paymentStatus = pgEnum("payment_row_status", ["pending", "succeeded", "failed"]);
export const paymentKind = pgEnum("payment_kind", ["charge", "refund"]);

export const payments = pgTable(
  "payments",
  {
    id: id(),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id),
    invoiceId: uuid("invoice_id").references(() => invoices.id),
    paymentMethodId: uuid("payment_method_id").references(() => paymentMethods.id),
    provider: paymentProvider("provider").notNull(),
    providerRef: text("provider_ref"),
    kind: paymentKind("kind").notNull().default("charge"),
    amountCents: integer("amount_cents").notNull(),
    status: paymentStatus("status").notNull().default("pending"),
    failureCode: text("failure_code"),
    failureMessage: text("failure_message"),
    /** Off-session charges of a saved card are merchant-initiated. */
    merchantInitiated: boolean("merchant_initiated").notNull().default(true),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    legacyId: legacyId(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("payments_booking").on(t.bookingId)],
);

export const collectionsStatus = pgEnum("collections_status", ["retrying", "collections", "resolved"]);

/** Declined-payment follow-up: automated retries, then the owner's Collections list. */
export const collectionsCases = pgTable("collections_cases", {
  id: id(),
  bookingId: uuid("booking_id")
    .notNull()
    .references(() => bookings.id),
  invoiceId: uuid("invoice_id")
    .notNull()
    .references(() => invoices.id)
    .unique(),
  status: collectionsStatus("status").notNull().default("retrying"),
  firstDeclineAt: ts("first_decline_at").notNull(),
  failedAttempts: integer("failed_attempts").notNull().default(1),
  nextAttemptAt: ts("next_attempt_at"),
  /** Signed pay-or-update-card link token. */
  payToken: text("pay_token").notNull().unique(),
  outcomeNote: text("outcome_note"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const writeOffs = pgTable("write_offs", {
  id: id(),
  bookingId: uuid("booking_id")
    .notNull()
    .references(() => bookings.id),
  amountCents: integer("amount_cents").notNull(),
  reason: text("reason").notNull(),
  staffUserId: uuid("staff_user_id")
    .notNull()
    .references(() => staffUsers.id),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------------------------------------
// Tips and ratings

export const tips = pgTable("tips", {
  id: id(),
  jobId: uuid("job_id")
    .notNull()
    .references(() => jobs.id),
  payerPersonId: uuid("payer_person_id").references(() => persons.id),
  paymentRef: text("payment_ref"),
  /** (employeeId, amountCents)[]; each employee gets exactly their amount. */
  lines: jsonb("lines").$type<{ employeeId: string; amountCents: number }[]>().notNull(),
  totalCents: integer("total_cents").notNull(),
  paidOutAt: ts("paid_out_at"),
  createdAt: createdAt(),
});

export const crewRatings = pgTable("crew_ratings", {
  id: id(),
  jobId: uuid("job_id")
    .notNull()
    .references(() => jobs.id)
    .unique(),
  rating: integer("rating").notNull(),
  comment: text("comment"),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------------------------------------
// Messaging and conversations (features/customer-communication.md)

export const channel = pgEnum("channel", ["sms", "email", "chat"]);
export const conversationStatus = pgEnum("conversation_status", ["ai_handling", "escalated", "resolved"]);

export const conversations = pgTable("conversations", {
  id: id(),
  personId: uuid("person_id").references(() => persons.id),
  bookingId: uuid("booking_id").references(() => bookings.id),
  channel: channel("channel").notNull(),
  /** Phone or email on the other end, for routing replies. */
  externalAddress: text("external_address").notNull(),
  status: conversationStatus("status").notNull().default("ai_handling"),
  intent: text("intent"),
  summary: text("summary"),
  lastMessageAt: ts("last_message_at").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const messageDirection = pgEnum("message_direction", ["inbound", "outbound"]);
export const messageAuthor = pgEnum("message_author", ["customer", "staff", "ai", "system"]);
export const messageStatus = pgEnum("message_status", ["queued", "sent", "delivered", "failed", "received"]);

export const messages = pgTable(
  "messages",
  {
    id: id(),
    conversationId: uuid("conversation_id").references(() => conversations.id),
    personId: uuid("person_id").references(() => persons.id),
    bookingId: uuid("booking_id").references(() => bookings.id),
    channel: channel("channel").notNull(),
    direction: messageDirection("direction").notNull(),
    author: messageAuthor("author").notNull(),
    /** Template or purpose, e.g. on_my_way, payment_failed, receipt. */
    purpose: text("purpose"),
    toAddress: text("to_address").notNull(),
    fromAddress: text("from_address"),
    subject: text("subject"),
    body: text("body").notNull(),
    provider: text("provider"),
    providerId: text("provider_id"),
    status: messageStatus("status").notNull().default("queued"),
    error: text("error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("messages_conversation").on(t.conversationId, t.createdAt)],
);

export const aiReplies = pgTable("ai_replies", {
  id: id(),
  conversationId: uuid("conversation_id")
    .notNull()
    .references(() => conversations.id),
  inboundMessageId: uuid("inbound_message_id")
    .notNull()
    .references(() => messages.id),
  outboundMessageId: uuid("outbound_message_id").references(() => messages.id),
  model: text("model").notNull(),
  promptVersion: text("prompt_version").notNull(),
  intent: text("intent").notNull(),
  confidence: doublePrecision("confidence").notNull(),
  escalate: boolean("escalate").notNull(),
  reason: text("reason"),
  autoSent: boolean("auto_sent").notNull(),
  usage: jsonb("usage"),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------------------------------------
// Claims, referrals, promotions

export const claimStatus = pgEnum("claim_status", ["submitted", "reviewing", "resolved", "denied"]);

export const claims = pgTable("claims", {
  id: id(),
  bookingId: uuid("booking_id")
    .notNull()
    .references(() => bookings.id),
  submittedByPersonId: uuid("submitted_by_person_id").references(() => persons.id),
  /** damage | missing | other */
  kind: text("kind").notNull(),
  itemIds: uuid("item_ids").array().notNull().default([]),
  description: text("description").notNull(),
  /** Uploaded by the customer (storage keys); pickup/delivery photos are linked by item. */
  customerPhotoKeys: text("customer_photo_keys").array().notNull().default([]),
  status: claimStatus("status").notNull().default("submitted"),
  urgent: boolean("urgent").notNull().default(false),
  /** refund | credit | payment | none */
  resolution: text("resolution"),
  amountCents: integer("amount_cents"),
  resolutionNote: text("resolution_note"),
  resolvedByStaffId: uuid("resolved_by_staff_id"),
  resolvedAt: ts("resolved_at"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const referralStatus = pgEnum("referral_status", ["signed_up", "rewarded", "void"]);

export const referrals = pgTable("referrals", {
  id: id(),
  referrerBookingId: uuid("referrer_booking_id")
    .notNull()
    .references(() => bookings.id),
  refereeBookingId: uuid("referee_booking_id")
    .notNull()
    .references(() => bookings.id)
    .unique(),
  code: text("code").notNull(),
  /** Share platform carried in the link (?via=whatsapp), for the referral report. */
  via: text("via"),
  /** parent | student: who signed up the referee. */
  kind: text("kind").notNull(),
  refereeRewardCents: integer("referee_reward_cents").notNull(),
  referrerRewardCents: integer("referrer_reward_cents").notNull(),
  /** credit | payout */
  referrerRewardKind: text("referrer_reward_kind").notNull(),
  status: referralStatus("status").notNull().default("signed_up"),
  createdAt: createdAt(),
});

export const promotions = pgTable("promotions", {
  id: id(),
  code: text("code").notNull().unique(),
  description: text("description").notNull(),
  amountCents: integer("amount_cents").notNull(),
  seasonId: uuid("season_id").references(() => seasons.id),
  validUntil: ts("valid_until"),
  maxUses: integer("max_uses"),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// ---------------------------------------------------------------------------------------------
// Owner-edited content and settings

export const kbArticles = pgTable("kb_articles", {
  id: id(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  /** Shown on public help pages too. */
  public: boolean("public").notNull().default(true),
  active: boolean("active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Owner settings as typed JSON values (packages/domain/src/settings.ts holds the defaults). */
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<unknown>().notNull(),
  updatedAt: updatedAt(),
});

// ---------------------------------------------------------------------------------------------
// Audit

export const auditEvents = pgTable(
  "audit_events",
  {
    id: id(),
    actorType: text("actor_type").notNull(),
    actorId: text("actor_id"),
    entity: text("entity").notNull(),
    entityId: text("entity_id").notNull(),
    action: text("action").notNull(),
    before: jsonb("before"),
    after: jsonb("after"),
    at: ts("at").notNull().defaultNow(),
  },
  (t) => [index("audit_events_entity").on(t.entity, t.entityId)],
);
