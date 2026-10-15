/**
 * Demo/dev seed. FAKE PEOPLE ONLY (CLAUDE.md): names, emails (example.com), and 555 phone numbers are invented.
 * Schools, dorm names, and prices are public business facts (prices from docs/baseline-metrics.md).
 *
 * - "Today" (America/Denver) is a pickup day: one crew, one tablet, six stops around CU Boulder (docs/demo.md).
 * - The next summer season is open for signup with the full service catalog and capacity, ~60 fake confirmed
 *   bookings, and a handful of stalled signups for Hot leads.
 * Set DEMO_CUSTOMER_PHONE to receive stop 3's texts on a real phone.
 */
import { createHash, randomBytes, scryptSync } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { CHARGE_AUTHORIZATION_VERSION, WIZARD_STEPS, chargeAuthorizationText, makeReferralCode, stepIndex } from "@css/domain";
import type { PaymentGateway } from "@css/integrations";
import type { Db } from "./client";
import * as s from "./schema";
import { seedKb, seedRateCard, seedSchools, seedServiceDays, seedServices } from "./seed-catalog";

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  return `scrypt:${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}
const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");
const token = () => randomBytes(18).toString("base64url");
const eqBooking = (id: string) => eq(s.bookings.id, id);
const partyOf = (bookingId: string, personId: string) => and(eq(s.bookingParties.bookingId, bookingId), eq(s.bookingParties.personId, personId));

export interface SeedOptions {
  payments: PaymentGateway;
  deviceToken?: string;
  demoPhone?: string | null;
  /** Local date (America/Denver) to schedule the demo route on. Defaults to today. */
  date?: string;
  /** Skip the ~60 fake bookings and stalled signups (faster tests). */
  minimal?: boolean;
  log?: (line: string) => void;
}

/** Deterministic pseudo-random numbers so every reset looks the same. */
function rng(seedValue: number) {
  let a = seedValue;
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    pick: <T,>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)]!,
    int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
  };
}

const FIRST = ["Olivia", "Lucas", "Emma", "Mateo", "Chloe", "Owen", "Zoe", "Elijah", "Lily", "Caleb", "Nora", "Isaac", "Aria", "Jonah", "Mila", "Theo", "Hazel", "Miles", "Ruby", "Felix", "Ivy", "Gavin", "Leah", "Rowan", "Tessa", "Dylan", "Jade", "Quinn", "Sadie", "Wyatt"];
const LAST = ["Anderson", "Baker", "Castillo", "Dawson", "Ellis", "Foster", "Garcia", "Hughes", "Ito", "Jensen", "Khan", "Lopez", "Morgan", "Novak", "Ortiz", "Price", "Reyes", "Sato", "Turner", "Vargas", "Walsh", "Young", "Zimmer", "Bishop", "Cole"];
const PARENT_FIRST = ["Laura", "Mark", "Susan", "David", "Jennifer", "Michael", "Lisa", "Robert", "Angela", "Steven", "Rachel", "Brian"];
const HEARD = ["Friend or roommate", "Parent Facebook group", "Instagram", "Flyer on campus", "Used CSS before", "Google", "School website"];
const AUTH_TEXT = chargeAuthorizationText(5900);

export async function seed(db: Db, opts: SeedOptions): Promise<void> {
  const log = opts.log ?? console.log;
  const today = opts.date ?? new Intl.DateTimeFormat("en-CA", { timeZone: "America/Denver" }).format(new Date());
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const existing = await db.select().from(s.seasons).limit(1);
  if (existing.length) {
    log("database already seeded; run `pnpm db:reset` to start over");
    return;
  }

  // The demo route runs in the current calendar year's season; signups after May are for next summer.
  const [currentSeason] = await db
    .insert(s.seasons)
    .values({ name: `Summer ${year}`, kind: "summer", startsOn: `${year}-01-01`, endsOn: `${year}-12-31`, depositCents: 5900 })
    .returning();
  const signupYear = month >= 6 ? year + 1 : year;
  const signupSeason =
    signupYear === year
      ? currentSeason!
      : (
          await db
            .insert(s.seasons)
            .values({ name: `Summer ${signupYear}`, kind: "summer", startsOn: `${signupYear}-01-01`, endsOn: `${signupYear}-12-31`, depositCents: 5900 })
            .returning()
        )[0]!;
  await seedRateCard(db, currentSeason!);
  if (signupSeason.id !== currentSeason!.id) await seedRateCard(db, signupSeason);

  const schoolRows = await seedSchools(db);
  const schoolIds = schoolRows.map((r) => r.school.id);
  const { byCode } = await seedServices(db, signupSeason, schoolIds);
  const serviceDays = await seedServiceDays(db, signupSeason, schoolIds);
  await seedKb(db);

  await db.insert(s.staffUsers).values([
    { name: "Owner (demo)", email: "owner@example.com", role: "owner", passwordHash: hashPassword("demo") },
    { name: "Office (demo)", email: "office@example.com", role: "office", passwordHash: hashPassword("demo") },
  ]);

  const employeeRows = await db
    .insert(s.employees)
    .values([
      { firstName: "Sam", lastName: "Rivera", phone: "+13035550101", defaultRoles: ["lead", "driver"] },
      { firstName: "Jordan", lastName: "Lee", phone: "+13035550102", defaultRoles: ["mover"] },
      { firstName: "Alex", lastName: "Kim", phone: "+13035550103", defaultRoles: ["mover"] },
      { firstName: "Casey", lastName: "Nguyen", phone: "+13035550104", defaultRoles: ["warehouse"] },
      { firstName: "Riley", lastName: "Shah", phone: "+13035550105", defaultRoles: ["lead", "driver"] },
      { firstName: "Morgan", lastName: "Diaz", phone: "+13035550106", defaultRoles: ["mover"] },
      { firstName: "Taylor", lastName: "Brooks", phone: "+13035550107", defaultRoles: ["mover", "driver"] },
      { firstName: "Jamie", lastName: "Holt", phone: "+13035550108", defaultRoles: ["mover"] },
    ])
    .returning();

  const [crew] = await db
    .insert(s.crews)
    .values({ date: today, name: "Crew 1", color: "#2563EB", vehicle: "Box truck 2", publishedAt: new Date() })
    .returning();
  await db.insert(s.crewMembers).values([
    { crewId: crew!.id, employeeId: employeeRows[0]!.id, role: "lead" },
    { crewId: crew!.id, employeeId: employeeRows[1]!.id, role: "mover" },
    { crewId: crew!.id, employeeId: employeeRows[2]!.id, role: "mover" },
  ]);
  const deviceToken = opts.deviceToken || "dev-tablet-token";
  await db.insert(s.devices).values([
    { name: "Tablet 1", tokenHash: sha256(deviceToken), assignedCrewId: crew!.id },
    { name: "Tablet 2", tokenHash: sha256(`${deviceToken}-2`) },
  ]);

  const storage = byCode.SUMMER_STORAGE!;
  const cu = schoolRows[0]!;

  // -------------------------------------------------------------------------------------------
  // Helpers

  async function person(first: string, last: string, email: string | null, phone: string | null, verified: boolean, smsConsent: boolean) {
    const [p] = await db.insert(s.persons).values({ firstName: first, lastName: last }).returning();
    const now = new Date();
    const contacts: (typeof s.contactPoints.$inferInsert)[] = [];
    if (email) contacts.push({ personId: p!.id, kind: "email", value: email, verifiedAt: verified ? now : null });
    if (phone) contacts.push({ personId: p!.id, kind: "phone", value: phone, verifiedAt: verified ? now : null, smsConsentAt: smsConsent ? now : null });
    if (contacts.length) await db.insert(s.contactPoints).values(contacts);
    return p!;
  }

  async function answer(bookingServiceId: string, fieldKey: string, value: unknown, refId: string | null = null) {
    await db.insert(s.fieldAnswers).values({ bookingServiceId, fieldKey, value, refId });
  }

  async function funnelThrough(bookingId: string, step: string, at: Date, extra?: { error?: string }) {
    const upto = stepIndex(step);
    const rows: (typeof s.funnelEvents.$inferInsert)[] = [];
    WIZARD_STEPS.forEach((st, i) => {
      if (i > upto) return;
      const t = new Date(at.getTime() - (upto - i) * 90_000);
      rows.push({ bookingId, step: st, event: "viewed", at: t });
      if (i < upto || st === "done") rows.push({ bookingId, step: st, event: "completed", at: new Date(t.getTime() + 60_000) });
    });
    if (extra?.error) rows.push({ bookingId, step, event: "error", meta: { message: extra.error, cardFailed: true }, at });
    await db.insert(s.funnelEvents).values(rows);
  }

  async function draftInvoice(bookingId: string): Promise<string> {
    const [existingDraft] = await db.select().from(s.invoices).where(and(eq(s.invoices.bookingId, bookingId), eq(s.invoices.status, "draft"))).limit(1);
    if (existingDraft) return existingDraft.id;
    const [created] = await db.insert(s.invoices).values({ bookingId, status: "draft", source: "manual" }).returning();
    return created!.id;
  }

  async function confirmedStorageBooking(input: {
    seasonId: string;
    confirmationNumber: number;
    student: typeof s.persons.$inferSelect;
    studentContact: { email: string; phone: string };
    guardian: typeof s.persons.$inferSelect;
    guardianContact: { email: string; phone: string };
    schoolId: string;
    residence: typeof s.residences.$inferSelect;
    room: string;
    address: string | null;
    submittedAt: Date;
    cardBehavior: "succeeds" | "declines";
    heardFrom: string | null;
    pickup: { date: string; windowId: string | null; serviceDayId: string | null };
    job: { crewId: string | null; sequence: number | null; status: "assigned" | "unassigned"; trackingToken: string };
    notes?: string | null;
    referralCode: string;
  }) {
    const [booking] = await db
      .insert(s.bookings)
      .values({
        seasonId: input.seasonId,
        confirmationNumber: input.confirmationNumber,
        customerPersonId: input.student.id,
        schoolId: input.schoolId,
        residenceId: input.residence.id,
        room: input.room,
        address: input.address,
        lifecycle: "confirmed",
        stepReached: "done",
        lastActivityAt: input.submittedAt,
        submittedAt: input.submittedAt,
        heardFrom: input.heardFrom,
        referralCode: input.referralCode,
        createdAt: input.submittedAt,
      })
      .returning();
    await db.insert(s.bookingParties).values([
      { bookingId: booking!.id, personId: input.student.id, roles: ["customer", "student", "signer"] },
      { bookingId: booking!.id, personId: input.guardian.id, roles: ["guardian", "payer"] },
    ]);
    await db.insert(s.personLinks).values({ guardianId: input.guardian.id, studentId: input.student.id }).onConflictDoNothing();
    const [bs] = await db.insert(s.bookingServices).values({ bookingId: booking!.id, serviceId: storage.id, createdAt: input.submittedAt }).returning();
    await answer(bs!.id, "school", input.schoolId, input.schoolId);
    await answer(bs!.id, "residence", { residenceId: input.residence.id, room: input.room, ...(input.address ? { address: input.address } : {}) }, input.residence.id);
    await answer(bs!.id, "student", { firstName: input.student.firstName, lastName: input.student.lastName, ...input.studentContact, smsConsent: true }, input.student.id);
    await answer(bs!.id, "guardian", { firstName: input.guardian.firstName, lastName: input.guardian.lastName, ...input.guardianContact, smsConsent: true }, input.guardian.id);
    await answer(bs!.id, "pickup", input.pickup);

    const card = await opts.payments.createTestSavedCard({
      email: input.guardianContact.email,
      name: `${input.guardian.firstName} ${input.guardian.lastName}`,
      behavior: input.cardBehavior,
    });
    const [pm] = await db.insert(s.paymentMethods).values({ personId: input.guardian.id, provider: opts.payments.provider, ...card }).returning();
    await db.insert(s.chargeAuthorizations).values({
      paymentMethodId: pm!.id,
      payerPersonId: input.guardian.id,
      bookingId: booking!.id,
      textVersion: CHARGE_AUTHORIZATION_VERSION,
      text: AUTH_TEXT,
      acceptedAt: input.submittedAt,
    });
    const [deposit] = await db
      .insert(s.invoices)
      .values({ bookingId: booking!.id, status: "paid", source: "manual", waiveCardFee: true, issuedAt: input.submittedAt, approvedAt: input.submittedAt, createdAt: input.submittedAt })
      .returning();
    await db.insert(s.invoiceLines).values({ invoiceId: deposit!.id, bookingServiceId: bs!.id, description: "Sign-up fee / deposit", quantity: 1, unitPriceCents: 5900 });
    await db.insert(s.payments).values({
      bookingId: booking!.id,
      invoiceId: deposit!.id,
      paymentMethodId: pm!.id,
      provider: opts.payments.provider,
      providerRef: `seed_deposit_${booking!.id.slice(-8)}`,
      amountCents: 5900,
      status: "succeeded",
      merchantInitiated: false,
      idempotencyKey: `seed-deposit-${booking!.id}`,
      createdAt: input.submittedAt,
    });
    const [appointment] = await db
      .insert(s.appointments)
      .values({
        bookingId: booking!.id,
        bookingServiceId: bs!.id,
        type: "pickup",
        date: input.pickup.date,
        windowId: input.pickup.windowId,
        serviceDayId: input.pickup.serviceDayId,
        address: input.address ?? input.residence.address,
        lat: input.residence.lat,
        lng: input.residence.lng,
        room: input.room,
        notes: input.notes ?? null,
      })
      .returning();
    await db.insert(s.jobs).values({
      appointmentId: appointment!.id,
      crewId: input.job.crewId,
      sequence: input.job.sequence,
      status: input.job.status,
      trackingToken: input.job.trackingToken,
    });
    await funnelThrough(booking!.id, "done", input.submittedAt);
    return { booking: booking!, bookingService: bs! };
  }

  // -------------------------------------------------------------------------------------------
  // Today's demo route: six fake students at CU Boulder, each with a fake parent.

  const r = rng(2027);
  const route = [
    { first: "Maya", last: "Patel", parent: "Priya", residence: 0, room: "214", window: "AM" },
    { first: "Ethan", last: "Brooks", parent: "Dana", residence: 1, room: "3-08", window: "AM" },
    { first: "Sofia", last: "Martinez", parent: "Elena", residence: 2, room: "122", window: "AM" },
    { first: "Liam", last: "Okafor", parent: "Grace", residence: 3, room: "407", window: "PM" },
    { first: "Ava", last: "Chen", parent: "Wei", residence: 4, room: "N-512", window: "PM" },
    { first: "Noah", last: "Fischer", parent: "Karen", residence: 6, room: "Apt 2", window: "PM" },
  ];
  const demoPhone = opts.demoPhone?.trim() || null;
  for (const [i, p] of route.entries()) {
    const stop = i + 1;
    const studentPhone = stop === 3 && demoPhone ? demoPhone : `+1303555${String(1100 + stop).padStart(4, "0")}`;
    const studentEmail = `${p.first.toLowerCase()}.${p.last.toLowerCase()}@example.com`;
    const parentEmail = `${p.parent.toLowerCase()}.${p.last.toLowerCase()}@example.com`;
    const parentPhone = `+1720555${String(1100 + stop).padStart(4, "0")}`;
    const student = await person(p.first, p.last, studentEmail, studentPhone, true, true);
    const guardian = await person(p.parent, p.last, parentEmail, parentPhone, true, true);
    const residence = cu.residences[p.residence]!;
    await confirmedStorageBooking({
      seasonId: currentSeason!.id,
      confirmationNumber: 100 + stop,
      student,
      studentContact: { email: studentEmail, phone: studentPhone },
      guardian,
      guardianContact: { email: parentEmail, phone: parentPhone },
      schoolId: cu.school.id,
      residence,
      room: p.room,
      address: residence.kind === "dorm" ? null : "1135 College Ave, Boulder, CO",
      submittedAt: new Date(Date.now() - (40 - stop) * 86_400_000),
      cardBehavior: stop === 5 ? "declines" : "succeeds", // stop 5's card is declined when charged
      heardFrom: HEARD[stop % HEARD.length]!,
      pickup: { date: today, windowId: p.window, serviceDayId: null },
      job: { crewId: crew!.id, sequence: stop, status: "assigned", trackingToken: stop === 3 ? "demo-stop-3" : token() },
      notes: stop === 4 ? "Elevator is out; 4th floor walk-up." : null,
      referralCode: makeReferralCode(p.first, r.next),
    });
  }

  let population = 0;
  let stalled = 0;
  if (!opts.minimal) {
    const confirmed: { booking: typeof s.bookings.$inferSelect; bookingService: typeof s.bookingServices.$inferSelect; guardianIsSigner: boolean }[] = [];
    const used = new Set<string>();
    const name = (): [string, string] => {
      for (;;) {
        const n: [string, string] = [r.pick(FIRST), r.pick(LAST)];
        if (!used.has(n.join(" "))) {
          used.add(n.join(" "));
          return n;
        }
      }
    };

    // ~60 confirmed signups for next summer, spread across schools (CU-heavy, like real volume).
    for (let i = 0; i < 60; i++) {
      const [first, last] = name();
      const parentFirst = r.pick(PARENT_FIRST);
      const schoolRow = r.next() < 0.5 ? cu : r.pick(schoolRows.slice(1));
      const residence = r.pick(schoolRow.residences);
      const onCampus = residence.kind === "dorm";
      const daysForSchool = serviceDays.filter((d) => d.schoolId === schoolRow.school.id && d.type === "pickup" && d.campusScope === (onCampus ? "on" : "off"));
      const day = r.pick(daysForSchool);
      const tag = `${first}.${last}`.toLowerCase();
      const parentEmail = `${parentFirst.toLowerCase()}.${last.toLowerCase()}@example.com`;
      const studentPhone = `+1303556${String(2000 + i).padStart(4, "0")}`;
      const parentPhone = `+1720556${String(2000 + i).padStart(4, "0")}`;
      const student = await person(first, last, `${tag}@example.com`, studentPhone, true, r.next() < 0.8);
      const guardian = await person(parentFirst, last, parentEmail, parentPhone, true, r.next() < 0.7);
      const submittedAt = new Date(Date.now() - r.int(1, 55) * 86_400_000 - r.int(0, 86_000) * 1000);
      const created = await confirmedStorageBooking({
        seasonId: signupSeason.id,
        confirmationNumber: 100 + i,
        student,
        studentContact: { email: `${tag}@example.com`, phone: studentPhone },
        guardian,
        guardianContact: { email: parentEmail, phone: parentPhone },
        schoolId: schoolRow.school.id,
        residence,
        room: onCampus ? String(r.int(101, 499)) : `Apt ${r.int(1, 12)}`,
        address: onCampus ? null : `${r.int(700, 1500)} ${r.pick(["College Ave", "Pleasant St", "Elm Ave", "Plum St", "Laurel Ave"])}, ${schoolRow.school.city}, CO`,
        submittedAt,
        cardBehavior: "succeeds",
        heardFrom: r.pick(HEARD),
        pickup: { date: day.date, windowId: day.windowId, serviceDayId: day.id },
        job: { crewId: null, sequence: null, status: "unassigned", trackingToken: token() },
        referralCode: makeReferralCode(first, r.next),
      });
      const guardianIsSigner = r.next() < 0.5;
      if (guardianIsSigner) {
        await db.update(s.bookingParties).set({ roles: ["guardian", "payer", "signer"] }).where(partyOf(created.booking.id, guardian.id));
        await db.update(s.bookingParties).set({ roles: ["customer", "student"] }).where(partyOf(created.booking.id, student.id));
      }
      confirmed.push({ ...created, guardianIsSigner });

      // About one in five adds in-room pickup, billed with the pickup invoice.
      if (r.next() < 0.2) {
        const [bs] = await db.insert(s.bookingServices).values({ bookingId: created.booking.id, serviceId: byCode.IN_ROOM_PICKUP!.id, createdAt: submittedAt }).returning();
        await db.insert(s.invoiceLines).values({ invoiceId: await draftInvoice(created.booking.id), bookingServiceId: bs!.id, description: "In-room pick-up", quantity: 1, unitPriceCents: 7500 });
      }
    }
    population = confirmed.length;

    // A few referrals: later signups used earlier customers' links.
    for (let i = 0; i < 6; i++) {
      const referrer = confirmed[i]!;
      const referee = confirmed[20 + i * 3]!;
      const parent = referee.guardianIsSigner;
      const refereeCents = parent ? 2500 : 1000;
      await db.insert(s.referrals).values({
        referrerBookingId: referrer.booking.id,
        refereeBookingId: referee.booking.id,
        code: referrer.booking.referralCode!,
        via: r.pick(["sms", "whatsapp", "facebook", "copy", "email"]),
        kind: parent ? "parent" : "student",
        refereeRewardCents: refereeCents,
        referrerRewardCents: 2500,
        referrerRewardKind: parent ? "credit" : "payout",
      });
      await db.update(s.bookings).set({ enteredCode: referrer.booking.referralCode }).where(eqBooking(referee.booking.id));
      await db.insert(s.invoiceLines).values({
        invoiceId: await draftInvoice(referee.booking.id),
        bookingServiceId: referee.bookingService.id,
        kind: "discount",
        description: `Referral discount (${referrer.booking.referralCode})`,
        quantity: 1,
        unitPriceCents: refereeCents,
        reason: "Referral",
      });
      if (parent) {
        await db.insert(s.invoiceLines).values({
          invoiceId: await draftInvoice(referrer.booking.id),
          bookingServiceId: referrer.bookingService.id,
          kind: "discount",
          description: "Referral credit (a friend signed up)",
          quantity: 1,
          unitPriceCents: 2500,
          reason: "Referral",
        });
      }
    }

    // Stalled signups at every step, for Hot leads and the funnel.
    const stalledSteps = ["contact", "contact", "contact", "services", "services", "school", "school", "people", "people", "schedule", "schedule", "review", "review", "review"];
    for (const [i, step] of stalledSteps.entries()) {
      const [first, last] = name();
      const lastActivityAt = new Date(Date.now() - r.int(3, 140) * 3_600_000);
      const parentSigning = r.next() < 0.5;
      const signerFirst = parentSigning ? r.pick(PARENT_FIRST) : first;
      const named = stepIndex(step) > stepIndex("people");
      const email = `${signerFirst.toLowerCase()}.${last.toLowerCase()}${i}@example.com`;
      const phone = r.next() < 0.5 ? `+1720557${String(3000 + i).padStart(4, "0")}` : null;
      const signer = await person(named ? signerFirst : "", named ? last : "", email, phone, false, !!phone && r.next() < 0.6);
      const schoolRow = r.next() < 0.5 ? cu : r.pick(schoolRows.slice(1));
      const pastSchool = stepIndex(step) > stepIndex("school");
      const residence = r.pick(schoolRow.residences);
      const [draft] = await db
        .insert(s.bookings)
        .values({
          seasonId: signupSeason.id,
          customerPersonId: signer.id,
          schoolId: stepIndex(step) >= stepIndex("school") ? schoolRow.school.id : null,
          residenceId: pastSchool ? residence.id : null,
          room: pastSchool ? String(r.int(101, 499)) : null,
          lifecycle: "draft",
          stepReached: step,
          lastActivityAt,
          createdAt: new Date(lastActivityAt.getTime() - 20 * 60_000),
        })
        .returning();
      await db
        .insert(s.bookingParties)
        .values({ bookingId: draft!.id, personId: signer.id, roles: parentSigning ? ["signer", "guardian", "payer"] : ["signer", "customer", "student", "payer"] });
      const answers: Record<string, unknown> = {};
      if (stepIndex(step) >= stepIndex("school")) answers.school = schoolRow.school.id;
      if (pastSchool) answers.residence = { residenceId: residence.id, room: draft!.room ?? undefined };
      await db
        .update(s.bookings)
        .set({ draft: { serviceIds: stepIndex(step) >= stepIndex("services") ? [storage.id] : [], answers, signerRole: parentSigning ? "guardian" : "student" } })
        .where(eqBooking(draft!.id));
      const cardFailed = step === "review" && i === stalledSteps.length - 1;
      await funnelThrough(draft!.id, step, lastActivityAt, cardFailed ? { error: "Your card was declined." } : undefined);
      stalled++;
    }
  }

  log(`Seeded ${today}: 1 crew, 6 pickups${opts.minimal ? "" : `; ${population} bookings and ${stalled} stalled signups for ${signupSeason.name}`}.`);
  log(`  Staff login: owner@example.com / demo (office@example.com / demo)`);
  log(`  Crew tablet token: ${deviceToken}`);
  log(`  Tracking page for stop 3: /t/demo-stop-3`);
  log(`  Payments: ${opts.payments.provider}; stop 5's card is declined when charged.`);
}
