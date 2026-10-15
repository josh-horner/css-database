/**
 * Hot leads, the signup funnel, and the one abandonment reminder (docs/features/signup-funnel.md).
 */
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, gte, inArray, isNull, lte, schema, sql, type DbOrTx } from "@css/db";
import { estimateBooking, funnel, isAbandoned, leadPriority, mergeFields, STEP_TITLES, stepIndex, WIZARD_STEPS, type WizardStep } from "@css/domain";
import { signedLinkToken } from "../auth";
import type { Services } from "../context";
import { audit } from "./audit";
import { priceList, seasonFor, servicesWithFields } from "./catalog";
import { sendEmail, sendSms } from "./messaging";
import { getSettings } from "./settings";

export async function hotLeads(services: Services, opts: { includeAutomated: boolean; includeWorked: boolean }) {
  const { db } = services;
  const drafts = await db
    .select({ booking: schema.bookings, person: schema.persons, school: schema.schools })
    .from(schema.bookings)
    .innerJoin(schema.persons, eq(schema.bookings.customerPersonId, schema.persons.id))
    .leftJoin(schema.schools, eq(schema.bookings.schoolId, schema.schools.id))
    .where(and(eq(schema.bookings.lifecycle, "draft"), lte(schema.bookings.lastActivityAt, new Date(Date.now() - 2 * 3_600_000))))
    .orderBy(desc(schema.bookings.lastActivityAt))
    .limit(500);
  if (!drafts.length) return [];
  const ids = drafts.map((d) => d.booking.id);
  const errors = await db
    .select()
    .from(schema.funnelEvents)
    .where(and(inArray(schema.funnelEvents.bookingId, ids), eq(schema.funnelEvents.event, "error")));
  const parties = await db.select().from(schema.bookingParties).where(inArray(schema.bookingParties.bookingId, ids));
  const contacts = await db.select().from(schema.contactPoints).where(inArray(schema.contactPoints.personId, parties.map((p) => p.personId)));
  const conversations = await db.select().from(schema.conversations).where(inArray(schema.conversations.bookingId, ids));
  const allServices = await servicesWithFields(db);

  // Next pickup day at their school makes a lead more urgent.
  const today = new Date().toISOString().slice(0, 10);
  const nextDays = await db
    .select({ schoolId: schema.serviceDays.schoolId, date: sql<string>`min(${schema.serviceDays.date})` })
    .from(schema.serviceDays)
    .where(and(eq(schema.serviceDays.type, "pickup"), gte(schema.serviceDays.date, today)))
    .groupBy(schema.serviceDays.schoolId);

  const out = [];
  for (const { booking, person, school } of drafts) {
    const cardFailed = errors.some((e) => e.bookingId === booking.id && (e.meta as { cardFailed?: boolean } | null)?.cardFailed);
    const priority = leadPriority(booking.stepReached, cardFailed);
    if (priority === "automated" && !opts.includeAutomated) continue;
    if (booking.outreachOutcome && booking.outreachOutcome !== "left_vm" && !opts.includeWorked) continue;
    const signer = parties.find((p) => p.bookingId === booking.id && p.roles.includes("signer"));
    const mine = contacts.filter((c) => c.personId === signer?.personId);
    const phone = mine.find((c) => c.kind === "phone");
    const selected = (booking.draft?.serviceIds ?? []).map((id) => allServices.find((s) => s.service.id === id)).filter((x): x is NonNullable<typeof x> => !!x);
    let estimateCents = 0;
    if (selected.length) {
      const season = await seasonFor(db, booking.seasonId);
      const est = estimateBooking({
        services: selected.map((s) => ({ id: s.service.id, name: s.service.name, chargesDeposit: s.service.chargesDeposit, baseRateCardCode: s.service.baseRateCardCode, fields: s.fields })),
        answers: booking.draft?.answers ?? {},
        priceList: await priceList(db, season.id),
        depositCents: season.depositCents,
      });
      estimateCents = est.depositCents + est.laterCents;
    }
    const answers = booking.draft?.answers ?? {};
    const merged = mergeFields(selected.map((s) => ({ id: s.service.id, name: s.service.name, fields: s.fields })));
    const named = merged
      .filter((f) => f.type === "person")
      .map((f) => answers[f.key] as { firstName?: string; lastName?: string } | undefined)
      .find((p) => p?.firstName);
    out.push({
      bookingId: booking.id,
      name: `${person.firstName} ${person.lastName}`.trim() || (named ? `${named.firstName} ${named.lastName ?? ""}`.trim() : null),
      email: mine.find((c) => c.kind === "email")?.value ?? null,
      phone: phone?.value ?? null,
      canText: !!phone?.smsConsentAt && !phone.smsOptOutAt,
      personId: signer?.personId ?? person.id,
      signerRole: booking.draft?.signerRole ?? null,
      stepReached: booking.stepReached,
      stepTitle: STEP_TITLES[booking.stepReached as WizardStep] ?? booking.stepReached,
      cardFailed,
      priority,
      services: selected.map((s) => s.service.name),
      school: school?.shortName ?? null,
      nextPickupDay: nextDays.find((d) => d.schoolId === booking.schoolId)?.date ?? null,
      estimateCents,
      lastActivityAt: booking.lastActivityAt,
      reminderSentAt: booking.reminderSentAt,
      outreach: { outcome: booking.outreachOutcome, at: booking.outreachAt },
      hasChat: conversations.some((c) => c.bookingId === booking.id),
    });
  }
  const rank = { high: 0, low: 1, automated: 2 };
  return out.sort(
    (a, b) =>
      rank[a.priority] - rank[b.priority] ||
      stepIndex(b.stepReached) - stepIndex(a.stepReached) ||
      (a.nextPickupDay ?? "9999").localeCompare(b.nextPickupDay ?? "9999") ||
      (b.lastActivityAt?.getTime() ?? 0) - (a.lastActivityAt?.getTime() ?? 0),
  );
}

export async function recordOutreach(services: Services, staffId: string, bookingId: string, outcome: "reached" | "left_vm" | "not_interested" | "completed", note: string | null) {
  const { db } = services;
  const [before] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, bookingId));
  if (!before) throw new TRPCError({ code: "NOT_FOUND" });
  await db.update(schema.bookings).set({ outreachOutcome: outcome, outreachAt: new Date() }).where(eq(schema.bookings.id, bookingId));
  if (note?.trim()) await db.insert(schema.notes).values({ bookingId, staffUserId: staffId, body: note.trim() });
  await audit(db, { type: "staff", id: staffId }, "booking", bookingId, "outreach", { outcome: before.outreachOutcome }, { outcome, note });
}

/** A signed, long-lived link that resumes the draft at its step (sets the draft cookie). */
export function resumeLink(services: Services, bookingId: string) {
  return `${services.config.portalUrl}/signup/resume/${signedLinkToken("resume", bookingId, services.config.appSecret)}`;
}

export async function emailLead(services: Services, staffId: string, bookingId: string, subject: string, body: string) {
  const lead = (await hotLeads(services, { includeAutomated: true, includeWorked: true })).find((l) => l.bookingId === bookingId);
  if (!lead?.email) throw new TRPCError({ code: "BAD_REQUEST", message: "No email on this signup" });
  await sendEmail(services, { to: lead.email, subject, text: `${body}\n\nPick up where you left off: ${resumeLink(services, bookingId)}`, purpose: "staff_message", author: "staff", personId: lead.personId, bookingId });
  await audit(services.db, { type: "staff", id: staffId }, "booking", bookingId, "lead_emailed");
}

export async function textLead(services: Services, staffId: string, bookingId: string, body: string) {
  const lead = (await hotLeads(services, { includeAutomated: true, includeWorked: true })).find((l) => l.bookingId === bookingId);
  if (!lead?.phone || !lead.canText) throw new TRPCError({ code: "BAD_REQUEST", message: "They didn't check \"CSS can text me if I get stuck\"" });
  await sendSms(services, { to: lead.phone, body: `${body} ${resumeLink(services, bookingId)}`, purpose: "staff_message", author: "staff", personId: lead.personId, bookingId });
  await audit(services.db, { type: "staff", id: staffId }, "booking", bookingId, "lead_texted");
}

/** Funnel by step for a date range (drafts and bookings started in the range), optionally by school. */
export async function funnelReport(db: DbOrTx, input: { from: string; to: string; schoolId?: string | null }) {
  const rows = await db
    .select({ step: schema.bookings.stepReached, lifecycle: schema.bookings.lifecycle, schoolId: schema.bookings.schoolId })
    .from(schema.bookings)
    .where(
      and(
        sql`(${schema.bookings.createdAt} at time zone 'America/Denver')::date between ${input.from} and ${input.to}`,
        input.schoolId ? eq(schema.bookings.schoolId, input.schoolId) : undefined,
        isNull(schema.bookings.createdByStaffId),
      ),
    );
  const reached = rows.map((r) => (r.lifecycle === "draft" ? r.step : "done"));
  const steps: readonly string[] = WIZARD_STEPS;
  const counts = funnel(reached, steps);
  const errors = await db
    .select({ step: schema.funnelEvents.step, n: sql<number>`count(*)::int` })
    .from(schema.funnelEvents)
    .where(and(eq(schema.funnelEvents.event, "error"), sql`(${schema.funnelEvents.at} at time zone 'America/Denver')::date between ${input.from} and ${input.to}`))
    .groupBy(schema.funnelEvents.step);
  return counts.map((c, i) => ({
    step: c.step,
    title: STEP_TITLES[c.step as WizardStep],
    reached: c.reached,
    dropOff: i === 0 ? 0 : (counts[i - 1]!.reached || 0) - c.reached,
    errors: errors.find((e) => e.step === c.step)?.n ?? 0,
  }));
}

/**
 * Worker: mark idle drafts abandoned and send the one "finish your signup" reminder
 * (email always allowed as transactional; one text only with "CSS can text me if I get stuck").
 */
export async function processAbandonedDrafts(services: Services, now = new Date()) {
  const { db } = services;
  const settings = await getSettings(db);
  const drafts = await db
    .select()
    .from(schema.bookings)
    .where(and(eq(schema.bookings.lifecycle, "draft"), isNull(schema.bookings.abandonedAt)))
    .orderBy(asc(schema.bookings.lastActivityAt))
    .limit(200);
  let reminded = 0;
  for (const draft of drafts) {
    if (!isAbandoned(draft, now, settings)) continue;
    await db.update(schema.bookings).set({ abandonedAt: now }).where(eq(schema.bookings.id, draft.id));
    if (!settings.abandonmentEmail || draft.reminderSentAt || draft.createdByStaffId) continue;
    const parties = await db.select().from(schema.bookingParties).where(eq(schema.bookingParties.bookingId, draft.id));
    const signer = parties.find((p) => p.roles.includes("signer"));
    if (!signer) continue;
    const contacts = await db.select().from(schema.contactPoints).where(eq(schema.contactPoints.personId, signer.personId));
    const email = contacts.find((c) => c.kind === "email" && !c.bouncedAt);
    const phone = contacts.find((c) => c.kind === "phone" && c.smsConsentAt && !c.smsOptOutAt);
    const link = resumeLink(services, draft.id);
    if (email) {
      await sendEmail(services, {
        to: email.value,
        subject: "Finish your College Student Storage signup",
        text: `You're almost signed up! Pick up right where you left off (step: ${STEP_TITLES[draft.stepReached as WizardStep] ?? draft.stepReached}):\n${link}\n\nQuestions? Just reply to this email.`,
        purpose: "signup_reminder",
        personId: signer.personId,
        bookingId: draft.id,
      });
    }
    if (phone && stepIndex(draft.stepReached) >= stepIndex("people")) {
      await sendSms(services, { to: phone.value, body: `CSS: You're almost signed up! Finish here: ${link}`, purpose: "signup_reminder", author: "system", personId: signer.personId, bookingId: draft.id });
    }
    if (email || phone) {
      await db.update(schema.bookings).set({ reminderSentAt: now }).where(eq(schema.bookings.id, draft.id));
      reminded++;
    }
  }
  return { reminded };
}
