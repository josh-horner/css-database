/**
 * The customer signup wizard (docs/features/signup-funnel.md, docs/apps/portal.md).
 * A signup is a draft Booking from the first step that captures an email; every step autosaves and logs
 * funnel events. Confirmation verifies the email, saves the card, charges the deposit, and materializes
 * the answers into real records.
 */
import { TRPCError } from "@trpc/server";
import { and, eq, inArray, isNull, ne, schema, type DbOrTx } from "@css/db";
import {
  assembleWizard,
  campusOf,
  CHARGE_AUTHORIZATION_VERSION,
  chargeAuthorizationText,
  confirmationProblems,
  estimateBooking,
  furthestStep,
  isSignerField,
  makeReferralCode,
  mergeFields,
  normalizeCode,
  normalizeEmail,
  normalizePhone,
  referralReward,
  scheduleTitle,
  STEP_TITLES,
  validateAnswers,
  WIZARD_STEPS,
  type AppointmentAnswer,
  type MergedField,
  type ResidenceAnswer,
  type WizardStep,
} from "@css/domain";
import type { DraftState } from "@css/db/schema";
import { readSignedLinkToken, signedLinkToken } from "../auth";
import type { Context, Services } from "../context";
import { audit } from "./audit";
import { checkSlotAnswer, materialize, partiesOf } from "./booking-builder";
import { collectsSchool, offeredAt, offeredAtSchool, priceList, seasonFor, servicesWithFields, signupSeason, successorIfEnded, type CatalogService } from "./catalog";
import { slotsFor } from "./capacity";
import { openDraftInvoice } from "./billing";
import { sendCode, sessionPersonIds } from "./customer-auth";
import { emailBooking, smsBooking } from "./messaging";
import { getSettings } from "./settings";
import { localDate, windowLabel } from "./time";

export const DRAFT_COOKIE = "css_draft";
const DRAFT_DAYS = 60;

type Booking = typeof schema.bookings.$inferSelect;

function draftOf(booking: Booking): DraftState {
  return booking.draft ?? { serviceIds: [], answers: {} };
}

async function funnelEvent(db: DbOrTx, bookingId: string, step: string, event: "viewed" | "completed" | "error", meta?: Record<string, unknown>) {
  await db.insert(schema.funnelEvents).values({ bookingId, step, event, meta: meta ?? null });
}

export async function currentDraft(ctx: Context): Promise<Booking | null> {
  const id = readSignedLinkToken("draft", ctx.cookies.get(DRAFT_COOKIE), ctx.config.appSecret);
  if (!id) return null;
  const [booking] = await ctx.db.select().from(schema.bookings).where(eq(schema.bookings.id, id)).limit(1);
  return booking ?? null;
}

async function requireDraft(ctx: Context): Promise<Booking> {
  const booking = await currentDraft(ctx);
  if (!booking || booking.lifecycle !== "draft") throw new TRPCError({ code: "NOT_FOUND", message: "Start your signup again" });
  return booking;
}

function setDraftCookie(ctx: Context, bookingId: string) {
  ctx.cookies.set(DRAFT_COOKIE, signedLinkToken("draft", bookingId, ctx.config.appSecret), DRAFT_DAYS * 86_400);
}

async function signerOf(db: DbOrTx, bookingId: string) {
  const parties = await partiesOf(db, bookingId);
  const signer = parties.find((p) => p.roles.includes("signer")) ?? parties[0];
  if (!signer) throw new TRPCError({ code: "NOT_FOUND" });
  const [person] = await db.select().from(schema.persons).where(eq(schema.persons.id, signer.personId));
  const contacts = await db.select().from(schema.contactPoints).where(eq(schema.contactPoints.personId, signer.personId));
  const email = contacts.find((c) => c.kind === "email");
  const phone = contacts.find((c) => c.kind === "phone");
  return { person: person!, email, phone };
}

/** Selected services, moving any that have ended to their successor. */
async function selectedServices(db: DbOrTx, draft: DraftState, now: Date) {
  if (!draft.serviceIds.length) return { services: [] as CatalogService[], changed: false };
  const all = await servicesWithFields(db);
  let changed = false;
  const out: CatalogService[] = [];
  for (const id of draft.serviceIds) {
    const entry = all.find((e) => e.service.id === id);
    if (!entry) continue;
    const current = draft.staffMode ? entry : successorIfEnded(entry, all, now);
    if (!current) {
      changed = true;
      continue;
    }
    if (current.service.id !== id) changed = true;
    if (!out.some((o) => o.service.id === current.service.id)) out.push(current);
  }
  return { services: out, changed };
}

async function codeInfo(db: DbOrTx, code: string | null, bookingId: string | null) {
  if (!code) return null;
  const normalized = normalizeCode(code);
  const [referrer] = await db
    .select({ booking: schema.bookings, person: schema.persons })
    .from(schema.bookings)
    .innerJoin(schema.persons, eq(schema.bookings.customerPersonId, schema.persons.id))
    .where(and(eq(schema.bookings.referralCode, normalized), ne(schema.bookings.lifecycle, "cancelled")))
    .limit(1);
  if (referrer && referrer.booking.id !== bookingId) {
    return { kind: "referral" as const, code: normalized, valid: true, referrerBookingId: referrer.booking.id, description: `Referred by ${referrer.person.firstName} ${referrer.person.lastName.slice(0, 1)}.` };
  }
  const [promo] = await db.select().from(schema.promotions).where(and(eq(schema.promotions.code, normalized), eq(schema.promotions.active, true))).limit(1);
  if (promo && (!promo.validUntil || promo.validUntil > new Date())) {
    if (promo.maxUses !== null) {
      const used = await db.select({ id: schema.bookings.id }).from(schema.bookings).where(and(eq(schema.bookings.enteredCode, normalized), ne(schema.bookings.lifecycle, "draft")));
      if (used.length >= promo.maxUses) return { kind: "invalid" as const, code: normalized, valid: false, description: "That code has been used up" };
    }
    return { kind: "promotion" as const, code: normalized, valid: true, promotion: promo, description: promo.description };
  }
  return { kind: "invalid" as const, code: normalized, valid: false, description: "We don't recognize that code" };
}

/** Discount lines a code gives this booking (the referrer's side is handled at confirmation). */
async function codeDiscounts(db: DbOrTx, info: Awaited<ReturnType<typeof codeInfo>>, signerRole: DraftState["signerRole"]) {
  if (!info?.valid) return [];
  if (info.kind === "promotion") return [{ description: `Promotion ${info.code}: ${info.promotion.description}`, amountCents: info.promotion.amountCents, reason: "Promotion" }];
  if (info.kind === "referral") {
    const reward = referralReward(signerRole === "guardian", await getSettings(db));
    return [{ description: `Referral discount (${info.code})`, amountCents: reward.refereeCents, reason: "Referral" }];
  }
  return [];
}

function nextStepAfter(steps: readonly WizardStep[], step: WizardStep): WizardStep {
  const i = steps.indexOf(step);
  return steps[Math.min(i + 1, steps.length - 1)] ?? "review";
}

export async function draftView(ctx: Context, booking: Booking) {
  const { db } = ctx;
  const draft = draftOf(booking);
  const now = new Date();
  const { services } = await selectedServices(db, draft, now);
  const plan = assembleWizard(services.map((s) => ({ id: s.service.id, name: s.service.name, fields: s.fields })));
  const signer = await signerOf(db, booking.id);
  const season = await seasonFor(db, booking.seasonId);
  const code = await codeInfo(db, booking.enteredCode, booking.id);
  const discounts = await codeDiscounts(db, code, draft.signerRole);
  const estimate = estimateBooking({
    services: services.map((s) => ({ id: s.service.id, name: s.service.name, chargesDeposit: s.service.chargesDeposit, baseRateCardCode: s.service.baseRateCardCode, fields: s.fields })),
    answers: draft.answers,
    priceList: await priceList(db, season.id),
    depositCents: season.depositCents,
    discounts,
  });
  const verified =
    !!signer.email &&
    !!ctx.customer &&
    ((ctx.customer.kind === "email" && ctx.customer.value === signer.email.value) || (ctx.customer.kind === "phone" && ctx.customer.value === signer.phone?.value));
  const residenceAnswer = Object.values(draft.answers).find((v): v is ResidenceAnswer => typeof v === "object" && v !== null && "residenceId" in v);
  const residence = residenceAnswer
    ? (await db.select().from(schema.residences).where(eq(schema.residences.id, residenceAnswer.residenceId)).limit(1))[0]
    : undefined;
  return {
    id: booking.id,
    lifecycle: booking.lifecycle,
    confirmationNumber: booking.confirmationNumber,
    seasonName: season.name,
    stepReached: booking.stepReached as WizardStep,
    steps: plan.steps.map((s) => ({ id: s, title: s === "schedule" ? scheduleTitle(plan.fieldsByStep.schedule) : STEP_TITLES[s] })),
    fieldsByStep: plan.fieldsByStep,
    services: services.map((s) => ({ id: s.service.id, name: s.service.name, chargesDeposit: s.service.chargesDeposit, instructions: s.service.instructions })),
    answers: draft.answers,
    signerRole: draft.signerRole ?? null,
    signer: {
      firstName: signer.person.firstName,
      lastName: signer.person.lastName,
      email: signer.email?.value ?? null,
      phone: signer.phone?.value ?? null,
      smsConsent: !!signer.phone?.smsConsentAt,
      marketingConsent: !!signer.email?.marketingConsentAt,
    },
    verified,
    signedIn: !!ctx.customer,
    campus: campusOf(residence?.kind),
    estimate,
    code,
    heardFrom: booking.heardFrom,
    authorizationText: chargeAuthorizationText(estimate.depositCents),
    payments: { provider: ctx.integrations.payments.provider, publishableKey: ctx.config.stripePublishableKey || null, demoMode: ctx.config.demoMode },
  };
}

export type DraftView = Awaited<ReturnType<typeof draftView>>;

export async function getDraft(ctx: Context) {
  const booking = await currentDraft(ctx);
  if (!booking) return null;
  if (booking.lifecycle !== "draft") return { ...(await draftView(ctx, booking)), lifecycle: booking.lifecycle };
  // Resuming a draft whose service has ended moves it to the successor; answers carry over by key.
  const draft = draftOf(booking);
  const { services, changed } = await selectedServices(ctx.db, draft, new Date());
  if (changed) {
    const next = { ...draft, serviceIds: services.map((s) => s.service.id) };
    await ctx.db.update(schema.bookings).set({ draft: next }).where(eq(schema.bookings.id, booking.id));
    booking.draft = next;
  }
  return draftView(ctx, booking);
}

export async function startSignup(
  ctx: Context,
  input: {
    email?: string | null;
    phone?: string | null;
    smsConsent: boolean;
    marketingConsent: boolean;
    code?: string | null;
    via?: string | null;
    signerRole: "student" | "guardian" | "other";
  },
) {
  const { db } = ctx;
  // Signed in with an email: we already know (and have verified) who this is.
  const sessionEmail = ctx.customer?.kind === "email" ? ctx.customer.value : null;
  const email = sessionEmail ?? (input.email ? normalizeEmail(input.email) : null);
  if (!email) throw new TRPCError({ code: "BAD_REQUEST", message: "Enter a valid email" });
  const phone = input.phone?.trim() ? normalizePhone(input.phone) : null;
  if (input.phone?.trim() && !phone) throw new TRPCError({ code: "BAD_REQUEST", message: "Enter a 10-digit phone number" });

  const existing = await currentDraft(ctx);
  let booking: Booking;
  if (existing && existing.lifecycle === "draft") {
    booking = existing;
    const signer = await signerOf(db, booking.id);
    if (signer.email && signer.email.value !== email) {
      // A different person on the same browser: start a fresh draft, never reveal the earlier one.
      booking = await createDraft(ctx, email, sessionEmail ? await sessionPerson(ctx) : null);
    }
  } else {
    booking = await createDraft(ctx, email, sessionEmail ? await sessionPerson(ctx) : null);
  }
  const signer = await signerOf(db, booking.id);
  const now = new Date();
  await db
    .insert(schema.contactPoints)
    .values({ personId: signer.person.id, kind: "email", value: email, marketingConsentAt: input.marketingConsent ? now : null, verifiedAt: sessionEmail ? now : null })
    .onConflictDoUpdate({
      target: [schema.contactPoints.personId, schema.contactPoints.kind, schema.contactPoints.value],
      set: { marketingConsentAt: input.marketingConsent ? now : null },
    });
  // The session already proved this address (it may not have existed as a contact when they signed in).
  if (sessionEmail) await markSessionContactVerified(ctx);
  if (phone) {
    await db
      .insert(schema.contactPoints)
      .values({ personId: signer.person.id, kind: "phone", value: phone, smsConsentAt: input.smsConsent ? now : null })
      .onConflictDoUpdate({
        target: [schema.contactPoints.personId, schema.contactPoints.kind, schema.contactPoints.value],
        set: { smsConsentAt: input.smsConsent ? now : null },
      });
  }
  const draft = draftOf(booking);
  const code = input.code?.trim() ? normalizeCode(input.code) : booking.enteredCode;
  // A parent signing up isn't the student; keep the party roles in step with who they said they are.
  await db
    .update(schema.bookingParties)
    .set({ roles: input.signerRole === "guardian" ? ["signer", "payer", "guardian"] : ["signer", "payer"] })
    .where(and(eq(schema.bookingParties.bookingId, booking.id), eq(schema.bookingParties.personId, signer.person.id)));
  await db
    .update(schema.bookings)
    .set({
      stepReached: furthestStep(booking.stepReached, "services"),
      lastActivityAt: now,
      enteredCode: code,
      draft: { ...draft, signerRole: input.signerRole, via: input.via ?? draft.via ?? null },
    })
    .where(eq(schema.bookings.id, booking.id));
  await funnelEvent(db, booking.id, "contact", "completed", { signerRole: input.signerRole, signedIn: !!sessionEmail });
  setDraftCookie(ctx, booking.id);
  return getDraft(ctx);
}

/** Marks the signed-in contact point verified wherever it exists (sign-in can precede the contact row). */
async function markSessionContactVerified(ctx: Context) {
  if (!ctx.customer) return;
  await ctx.db
    .update(schema.contactPoints)
    .set({ verifiedAt: new Date() })
    .where(and(eq(schema.contactPoints.kind, ctx.customer.kind), eq(schema.contactPoints.value, ctx.customer.value), isNull(schema.contactPoints.verifiedAt)));
}

/** The person behind a signed-in session (the most recently created, if a shared email has several). */
async function sessionPerson(ctx: Context): Promise<string | null> {
  if (!ctx.customer) return null;
  const ids = await sessionPersonIds(ctx.db, ctx.customer);
  return ids.at(-1) ?? null;
}

async function createDraft(ctx: Context, email: string, knownPersonId: string | null = null): Promise<Booking> {
  const { db } = ctx;
  const season = await signupSeason(db);
  // No data is revealed before verification, so a new (unverified) email always gets a new person. A signed-in
  // visitor has proven their email, so their existing person signs.
  let personId = knownPersonId;
  if (!personId) {
    const [person] = await db.insert(schema.persons).values({ firstName: "", lastName: "" }).returning();
    personId = person!.id;
    await db.insert(schema.contactPoints).values({ personId, kind: "email", value: email });
  }
  const person = { id: personId };
  const [booking] = await db
    .insert(schema.bookings)
    .values({ seasonId: season.id, customerPersonId: person.id, lifecycle: "draft", stepReached: "contact", lastActivityAt: new Date(), draft: { serviceIds: [], answers: {} } })
    .returning();
  await db.insert(schema.bookingParties).values({ bookingId: booking!.id, personId: person.id, roles: ["signer", "payer"] });
  await funnelEvent(db, booking!.id, "contact", "viewed");
  setDraftCookie(ctx, booking!.id);
  return booking!;
}

/** Services offered right now (and at the school, for student services). */
export async function catalog(ctx: Context, opts: { schoolId?: string | null; staff?: boolean }) {
  const now = new Date();
  const all = await servicesWithFields(ctx.db);
  return all
    .filter((e) => (opts.staff ? e.service.active : offeredAt(e.service, now) && !e.service.staffOnly))
    .filter((e) => offeredAtSchool(e, opts.schoolId ?? null))
    .map((e) => ({
      id: e.service.id,
      code: e.service.code,
      name: e.service.name,
      description: e.service.description,
      instructions: e.service.instructions,
      family: e.service.family,
      chargesDeposit: e.service.chargesDeposit,
      baseRateCardCode: e.service.baseRateCardCode,
      collectsSchool: collectsSchool(e),
      staffOnly: e.service.staffOnly,
      fields: e.fields,
    }));
}

export async function selectServices(ctx: Context, serviceIds: string[]) {
  const booking = await requireDraft(ctx);
  const draft = draftOf(booking);
  const offered = await catalog(ctx, { staff: draft.staffMode });
  const ids = [...new Set(serviceIds)].filter((id) => offered.some((o) => o.id === id));
  if (!ids.length) {
    await funnelEvent(ctx.db, booking.id, "services", "error", { message: "no services" });
    throw new TRPCError({ code: "BAD_REQUEST", message: "Pick at least one service" });
  }
  const chosen = await servicesWithFields(ctx.db, ids);
  const seasonId = chosen.find((c) => c.service.seasonId)?.service.seasonId ?? booking.seasonId;
  const plan = assembleWizard(chosen.map((s) => ({ id: s.service.id, name: s.service.name, fields: s.fields })));
  await ctx.db
    .update(schema.bookings)
    .set({
      seasonId,
      draft: { ...draft, serviceIds: ids },
      stepReached: furthestStep(booking.stepReached, nextStepAfter(plan.steps, "services")),
      lastActivityAt: new Date(),
    })
    .where(eq(schema.bookings.id, booking.id));
  await funnelEvent(ctx.db, booking.id, "services", "completed", { services: chosen.map((c) => c.service.code) });
  return getDraft(ctx);
}

/** Extra checks beyond field shapes: residence at the chosen school, off-campus address, real windows. */
async function crossChecks(db: DbOrTx, fields: readonly MergedField[], answers: Record<string, unknown>, allFields: readonly MergedField[] = fields) {
  const errors: Record<string, string> = {};
  const schoolField = allFields.find((f) => f.type === "school");
  const schoolId = schoolField ? ((answers[schoolField.key] as string | undefined) ?? null) : null;
  for (const field of fields) {
    const value = answers[field.key];
    if (field.type === "residence" && value && typeof value === "object") {
      const r = value as ResidenceAnswer;
      const [residence] = await db.select().from(schema.residences).where(eq(schema.residences.id, r.residenceId)).limit(1);
      if (!residence || (schoolId && residence.schoolId !== schoolId)) errors[field.key] = "Pick a residence at your school";
      else if (residence.kind !== "dorm" && !r.address?.trim()) errors[field.key] = "Enter your street address";
      else if (residence.kind === "dorm" && !r.room?.trim()) errors[field.key] = "Enter your room number";
    }
    if (field.type === "appointment" && value && typeof value === "object") {
      const a = value as AppointmentAnswer;
      if (field.config.scheduling === "service_days" && !a.serviceDayId && !a.special) errors[field.key] = "Pick a day from the list";
      else {
        try {
          await checkSlotAnswer(db, a, { schoolId, type: field.config.appointmentType === "delivery" ? "delivery" : "pickup" });
        } catch {
          errors[field.key] = "Pick a day from the list";
        }
      }
    }
  }
  return errors;
}

export async function saveStep(ctx: Context, input: { step: WizardStep; answers: Record<string, unknown>; signerRole?: "student" | "guardian" | "other" }) {
  const { db } = ctx;
  const booking = await requireDraft(ctx);
  const draft = draftOf(booking);
  const { services } = await selectedServices(db, draft, new Date());
  const plan = assembleWizard(services.map((s) => ({ id: s.service.id, name: s.service.name, fields: s.fields })));
  const stepFields = plan.fieldsByStep[input.step] ?? [];
  const allowed = new Set(stepFields.map((f) => f.key));
  const answers = { ...draft.answers };
  for (const [key, value] of Object.entries(input.answers)) if (allowed.has(key)) answers[key] = value;
  // Changing school clears a residence from the old school.
  const schoolField = stepFields.find((f) => f.type === "school");
  if (schoolField && answers[schoolField.key] !== draft.answers[schoolField.key]) {
    for (const f of mergeFields(services.map((s) => ({ id: s.service.id, name: s.service.name, fields: s.fields })))) {
      if (f.type === "appointment" && f.config.scheduling === "service_days") delete answers[f.key];
    }
  }
  const signerRole = input.signerRole ?? draft.signerRole;
  if (input.step === "people" && !signerRole) {
    return { ok: false as const, errors: { _signer: "Go back to the first step and tell us who's signing up" }, draft: await getDraft(ctx) };
  }

  const allFields = mergeFields(services.map((s) => ({ id: s.service.id, name: s.service.name, fields: s.fields })));
  const errors = { ...validateAnswers(stepFields, answers, { staffMode: draft.staffMode }), ...(await crossChecks(db, stepFields, answers, allFields)) };
  await db.update(schema.bookings).set({ draft: { ...draft, answers, signerRole }, lastActivityAt: new Date() }).where(eq(schema.bookings.id, booking.id));
  if (Object.keys(errors).length) {
    await funnelEvent(db, booking.id, input.step, "error", { fields: Object.keys(errors) });
    return { ok: false as const, errors, draft: await getDraft(ctx) };
  }

  const patch: Partial<typeof schema.bookings.$inferInsert> = { stepReached: furthestStep(booking.stepReached, nextStepAfter(plan.steps, input.step)) };
  if (schoolField) patch.schoolId = answers[schoolField.key] as string;
  const residenceField = stepFields.find((f) => f.type === "residence");
  if (residenceField) {
    const r = answers[residenceField.key] as ResidenceAnswer;
    Object.assign(patch, { residenceId: r.residenceId, room: r.room ?? null, address: r.address ?? null });
  }
  await db.update(schema.bookings).set(patch).where(eq(schema.bookings.id, booking.id));

  // Name the signer early so Hot leads can show who stopped where.
  if (input.step === "people" && signerRole) {
    const mine = stepFields.find((f) => isSignerField(f, signerRole));
    const answer = mine ? (answers[mine.key] as { firstName?: string; lastName?: string } | undefined) : undefined;
    if (answer?.firstName) {
      const signer = await signerOf(db, booking.id);
      await db.update(schema.persons).set({ firstName: answer.firstName, lastName: answer.lastName ?? "" }).where(eq(schema.persons.id, signer.person.id));
    }
  }
  await funnelEvent(db, booking.id, input.step, "completed");
  return { ok: true as const, errors: {}, draft: await getDraft(ctx) };
}

export async function trackView(ctx: Context, step: WizardStep) {
  const booking = await currentDraft(ctx);
  if (!booking || booking.lifecycle !== "draft" || !WIZARD_STEPS.includes(step)) return;
  await funnelEvent(ctx.db, booking.id, step, "viewed");
  await ctx.db.update(schema.bookings).set({ lastActivityAt: new Date() }).where(eq(schema.bookings.id, booking.id));
}

/** Windows for an appointment field, given the draft's school and residence. */
export async function availability(ctx: Context, fieldKey: string) {
  const { db } = ctx;
  const booking = await requireDraft(ctx);
  const draft = draftOf(booking);
  const { services } = await selectedServices(db, draft, new Date());
  const field = mergeFields(services.map((s) => ({ id: s.service.id, name: s.service.name, fields: s.fields }))).find((f) => f.key === fieldKey);
  if (!field || field.type !== "appointment") throw new TRPCError({ code: "BAD_REQUEST" });
  const schoolId = booking.schoolId;
  if (!schoolId) return { slots: [], allowsSpecial: false };
  const residence = booking.residenceId ? (await db.select().from(schema.residences).where(eq(schema.residences.id, booking.residenceId)).limit(1))[0] : undefined;
  const season = await seasonFor(db, booking.seasonId);
  const [school] = await db.select().from(schema.schools).where(eq(schema.schools.id, schoolId)).limit(1);
  const slots = await slotsFor(db, {
    seasonId: season.id,
    schoolId,
    type: field.config.appointmentType === "delivery" ? "delivery" : "pickup",
    campus: campusOf(residence?.kind),
    today: localDate(ctx.config.timeZone),
    leadDays: season.leadDays,
    staff: draft.staffMode,
  });
  return { slots, allowsSpecial: !!school?.allowsSpecialPickup };
}

export async function applyCode(ctx: Context, code: string) {
  const booking = await requireDraft(ctx);
  const info = await codeInfo(ctx.db, code, booking.id);
  if (!info?.valid) return { ok: false as const, message: info?.description ?? "We don't recognize that code" };
  await ctx.db.update(schema.bookings).set({ enteredCode: info.code }).where(eq(schema.bookings.id, booking.id));
  return { ok: true as const, message: info.description };
}

export async function sendSignupCode(ctx: Context) {
  const booking = await requireDraft(ctx);
  const signer = await signerOf(ctx.db, booking.id);
  if (!signer.email) throw new TRPCError({ code: "BAD_REQUEST" });
  return sendCode(ctx, { kind: "email", value: signer.email.value });
}

export async function cardSetup(ctx: Context) {
  const booking = await requireDraft(ctx);
  const signer = await signerOf(ctx.db, booking.id);
  const setup = await ctx.integrations.payments.createCardSetup({
    email: signer.email?.value ?? "",
    name: `${signer.person.firstName} ${signer.person.lastName}`.trim() || (signer.email?.value ?? ""),
  });
  await ctx.db
    .update(schema.bookings)
    .set({ draft: { ...draftOf(booking), cardSetup: { providerCustomerId: setup.providerCustomerId, setupRef: setup.setupRef } } })
    .where(eq(schema.bookings.id, booking.id));
  return { provider: ctx.integrations.payments.provider, clientSecret: setup.clientSecret, publishableKey: ctx.config.stripePublishableKey || null };
}

/**
 * Review & pay. Order matters: save the card, charge the deposit, then confirm in one transaction
 * (confirmation number, capacity, records). If confirming fails, the deposit is refunded.
 */
export async function completeSignup(ctx: Context, input: { acceptTerms: boolean; heardFrom: string | null; demoToken?: string | null }) {
  const { db, integrations } = ctx;
  const booking = await requireDraft(ctx);
  const draft = draftOf(booking);
  const view = await draftView(ctx, booking);
  if (!view.verified) throw new TRPCError({ code: "UNAUTHORIZED", message: "Confirm your email with the code we sent" });

  const { services } = await selectedServices(db, draft, new Date());
  const fields = mergeFields(services.map((s) => ({ id: s.service.id, name: s.service.name, fields: s.fields })));
  const fieldErrors = { ...validateAnswers(fields, draft.answers), ...(await crossChecks(db, fields, draft.answers)) };
  const problems = confirmationProblems({
    serviceCount: services.length,
    fieldErrors,
    termsAccepted: input.acceptTerms,
    hasPaymentMethod: !!draft.cardSetup,
    staffWaiver: false,
    needsGuardian: fields.some((f) => f.type === "person" && f.config.role === "guardian" && f.required),
    hasGuardian: fields.some((f) => f.type === "person" && f.config.role === "guardian" && !!(draft.answers[f.key] as { firstName?: string } | undefined)?.firstName),
  });
  if (problems.length) {
    await funnelEvent(db, booking.id, "review", "error", { problems, fields: Object.keys(fieldErrors) });
    throw new TRPCError({ code: "BAD_REQUEST", message: problems.join(" ") });
  }

  const signer = await signerOf(db, booking.id);
  let card;
  try {
    card = await integrations.payments.completeCardSetup({ ...draft.cardSetup!, demoToken: input.demoToken ?? undefined });
  } catch (err) {
    await funnelEvent(db, booking.id, "review", "error", { message: String(err), cardFailed: true });
    throw new TRPCError({ code: "BAD_REQUEST", message: "We couldn't save that card. Please try again." });
  }
  const [paymentMethod] = await db.insert(schema.paymentMethods).values({ personId: signer.person.id, provider: integrations.payments.provider, ...card }).returning();

  // Deposit first: a declined card shouldn't consume a confirmation number or a pickup slot.
  const depositCents = view.estimate.depositCents;
  let depositPaymentId: string | null = null;
  if (depositCents > 0) {
    const [payment] = await db
      .insert(schema.payments)
      .values({
        bookingId: booking.id,
        paymentMethodId: paymentMethod!.id,
        provider: integrations.payments.provider,
        kind: "charge",
        amountCents: depositCents,
        status: "pending",
        merchantInitiated: false,
        idempotencyKey: `${booking.id}:deposit:${paymentMethod!.id}`,
      })
      .returning();
    const result = await integrations.payments.charge({
      providerCustomerId: card.providerCustomerId,
      providerPaymentMethodId: card.providerPaymentMethodId,
      amountCents: depositCents,
      idempotencyKey: payment!.idempotencyKey,
      description: "CSS sign-up deposit",
      merchantInitiated: false,
    });
    if (result.status === "failed") {
      await db.update(schema.payments).set({ status: "failed", failureCode: result.code, failureMessage: result.message, providerRef: result.providerRef }).where(eq(schema.payments.id, payment!.id));
      await db.update(schema.paymentMethods).set({ active: false }).where(eq(schema.paymentMethods.id, paymentMethod!.id));
      await funnelEvent(db, booking.id, "review", "error", { message: result.message, cardFailed: true });
      throw new TRPCError({ code: "BAD_REQUEST", message: `${result.message} Try another card.` });
    }
    await db.update(schema.payments).set({ status: "succeeded", providerRef: result.providerRef }).where(eq(schema.payments.id, payment!.id));
    depositPaymentId = payment!.id;
  }

  const code = await codeInfo(db, booking.enteredCode, booking.id);
  const settings = await getSettings(db);
  let confirmed;
  try {
    confirmed = await db.transaction(async (tx) => {
      const result = await materialize(tx, {
        booking,
        services,
        answers: draft.answers,
        source: "signup",
        signer: { personId: signer.person.id, role: draft.signerRole ?? "other" },
        confirm: true,
        discounts: await codeDiscounts(tx, code, draft.signerRole),
      });
      const firstName = (await tx.select().from(schema.persons).where(eq(schema.persons.id, result.booking.customerPersonId)))[0]?.firstName ?? "CSS";
      await tx
        .update(schema.bookings)
        .set({ heardFrom: input.heardFrom?.slice(0, 120) ?? null, referralCode: await uniqueReferralCode(tx, firstName), lastActivityAt: new Date() })
        .where(eq(schema.bookings.id, booking.id));
      if (depositCents > 0) {
        const [invoice] = await tx
          .insert(schema.invoices)
          .values({ bookingId: booking.id, status: "paid", source: "manual", waiveCardFee: true, approvedAt: new Date(), issuedAt: new Date() })
          .returning();
        await tx.insert(schema.invoiceLines).values({
          invoiceId: invoice!.id,
          bookingServiceId: result.bookingServices.find((b) => b.entry.service.chargesDeposit)?.bookingServiceId ?? null,
          description: "Sign-up fee / deposit",
          quantity: 1,
          unitPriceCents: depositCents,
        });
        await tx.update(schema.payments).set({ invoiceId: invoice!.id }).where(eq(schema.payments.id, depositPaymentId!));
      }
      await tx.insert(schema.chargeAuthorizations).values({
        paymentMethodId: paymentMethod!.id,
        payerPersonId: signer.person.id,
        bookingId: booking.id,
        textVersion: CHARGE_AUTHORIZATION_VERSION,
        text: chargeAuthorizationText(depositCents),
        acceptedAt: new Date(),
        ip: ctx.request.ip,
        userAgent: ctx.request.userAgent,
      });
      if (code?.valid && code.kind === "referral") {
        const reward = referralReward(draft.signerRole === "guardian", settings);
        await tx.insert(schema.referrals).values({
          referrerBookingId: code.referrerBookingId,
          refereeBookingId: booking.id,
          code: code.code,
          via: draft.via ?? null,
          kind: reward.kind,
          refereeRewardCents: reward.refereeCents,
          referrerRewardCents: reward.referrerCents,
          referrerRewardKind: reward.referrerRewardKind,
        });
        if (reward.referrerRewardKind === "credit") {
          const [referrerService] = await tx.select().from(schema.bookingServices).where(eq(schema.bookingServices.bookingId, code.referrerBookingId)).limit(1);
          await tx.insert(schema.invoiceLines).values({
            invoiceId: await openDraftInvoice(tx, code.referrerBookingId),
            bookingServiceId: referrerService?.id ?? null,
            kind: "discount",
            description: "Referral credit (a friend signed up)",
            quantity: 1,
            unitPriceCents: reward.referrerCents,
            reason: "Referral",
          });
        }
      }
      await audit(tx, { type: "customer", id: signer.person.id }, "booking", booking.id, "signup_completed", null, { confirmationNumber: result.booking.confirmationNumber });
      return result;
    });
  } catch (err) {
    if (depositPaymentId) await refundDeposit(ctx, depositPaymentId, booking.id);
    throw err;
  }

  // Confirmation required a verified signer; make sure access to the booking follows from it.
  await markSessionContactVerified(ctx);
  await db.insert(schema.funnelEvents).values([
    { bookingId: booking.id, step: "review", event: "completed" },
    { bookingId: booking.id, step: "done", event: "completed" },
  ]);
  await sendConfirmation(ctx, booking.id);
  return { bookingId: booking.id, confirmationNumber: confirmed.booking.confirmationNumber };
}

async function refundDeposit(ctx: Services, paymentId: string, bookingId: string) {
  const [payment] = await ctx.db.select().from(schema.payments).where(eq(schema.payments.id, paymentId));
  if (!payment?.providerRef) return;
  const result = await ctx.integrations.payments.refund({ providerRef: payment.providerRef, amountCents: payment.amountCents, idempotencyKey: `${paymentId}:refund:signup` });
  await ctx.db.insert(schema.payments).values({
    bookingId,
    paymentMethodId: payment.paymentMethodId,
    provider: payment.provider,
    kind: "refund",
    amountCents: payment.amountCents,
    status: result.status === "succeeded" ? "succeeded" : "failed",
    providerRef: result.status === "succeeded" ? result.providerRef : null,
    failureMessage: result.status === "failed" ? result.message : null,
    merchantInitiated: true,
    idempotencyKey: `${paymentId}:refund:signup`,
  });
}

export async function uniqueReferralCode(db: DbOrTx, firstName: string): Promise<string> {
  for (;;) {
    const code = makeReferralCode(firstName);
    const [clash] = await db.select({ id: schema.bookings.id }).from(schema.bookings).where(eq(schema.bookings.referralCode, code)).limit(1);
    if (!clash) return code;
  }
}

/** Confirmation email to everyone on the booking; a short text to anyone who said CSS can text them. */
export async function sendConfirmation(ctx: Services, bookingId: string) {
  const { db, config } = ctx;
  const [booking] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, bookingId));
  const services = await db
    .select({ name: schema.services.name })
    .from(schema.bookingServices)
    .innerJoin(schema.services, eq(schema.bookingServices.serviceId, schema.services.id))
    .where(eq(schema.bookingServices.bookingId, bookingId));
  const appts = await db.select().from(schema.appointments).where(eq(schema.appointments.bookingId, bookingId));
  const lines = appts.map((a) => `${a.type === "pickup" ? "Pickup" : a.type === "delivery" ? "Delivery" : "Appointment"}: ${a.date} (${windowLabel(a.windowId)})`);
  const link = `${config.portalUrl}/account/bookings/${bookingId}`;
  const n = booking!.confirmationNumber;
  await emailBooking(
    ctx,
    bookingId,
    "signup_confirmation",
    `You're signed up with CSS: confirmation #${n}`,
    `Thanks for signing up with College Student Storage!\n\nConfirmation number: ${n}\nWrite it (or print labels) on every box and item.\n\nServices: ${services.map((s) => s.name).join(", ")}\n${lines.join("\n")}\n\nYour booking, labels, and referral link: ${link}\n\nWe'll text and email you before your appointment and when the crew is on the way.`,
  );
  await smsBooking(ctx, bookingId, "signup_confirmation", `CSS: You're signed up! Confirmation #${n}. ${lines[0] ?? ""}. Details & labels: ${link}`);
}

/** Returning customer: a new draft cloned from a past booking, asking only what changes each year. */
export async function signupAgain(ctx: Context, fromBookingId: string, signerPersonId: string) {
  const { db } = ctx;
  const [from] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, fromBookingId)).limit(1);
  if (!from) throw new TRPCError({ code: "NOT_FOUND" });
  const services = await db.select().from(schema.bookingServices).where(and(eq(schema.bookingServices.bookingId, fromBookingId), eq(schema.bookingServices.source, "signup")));
  const answers = services.length
    ? await db.select().from(schema.fieldAnswers).where(inArray(schema.fieldAnswers.bookingServiceId, services.map((s) => s.id)))
    : [];
  // Carry over the school and the people (from current Person/ContactPoint values, not old snapshots).
  // Residence, pickup, and everything else are asked again: they change every year.
  const carried: Record<string, unknown> = {};
  for (const a of answers) {
    if (a.fieldKey === "school") carried.school = a.value;
    const isPerson = !!a.value && typeof a.value === "object" && "firstName" in (a.value as object);
    if (!isPerson || !a.refId) continue;
    const [p] = await db.select().from(schema.persons).where(eq(schema.persons.id, a.refId));
    const contacts = await db.select().from(schema.contactPoints).where(eq(schema.contactPoints.personId, a.refId));
    const phone = contacts.find((c) => c.kind === "phone");
    carried[a.fieldKey] = {
      firstName: p?.firstName ?? "",
      lastName: p?.lastName ?? "",
      email: contacts.find((c) => c.kind === "email")?.value ?? "",
      phone: phone?.value ?? "",
      smsConsent: !!phone?.smsConsentAt && !phone.smsOptOutAt,
    };
  }
  const signerRoles = (await partiesOf(db, fromBookingId)).find((p) => p.personId === signerPersonId)?.roles ?? [];
  const season = await signupSeason(db);
  const all = await servicesWithFields(db);
  const serviceIds = services
    .map((s) => all.find((e) => e.service.id === s.serviceId))
    .map((e) => (e ? successorIfEnded(e, all, new Date())?.service.id : undefined))
    .filter((x): x is string => !!x);
  const [draft] = await db
    .insert(schema.bookings)
    .values({
      seasonId: season.id,
      customerPersonId: from.customerPersonId,
      schoolId: from.schoolId,
      lifecycle: "draft",
      stepReached: "services",
      lastActivityAt: new Date(),
      draft: { serviceIds, answers: carried, signerRole: signerRoles.includes("guardian") ? "guardian" : signerRoles.includes("student") ? "student" : "other" },
    })
    .returning();
  await db.insert(schema.bookingParties).values({ bookingId: draft!.id, personId: signerPersonId, roles: ["signer", "payer"] });
  await funnelEvent(db, draft!.id, "contact", "completed", { returning: true });
  setDraftCookie(ctx, draft!.id);
  return { draftId: draft!.id };
}
