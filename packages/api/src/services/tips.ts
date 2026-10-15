/**
 * Rate the crew and tip them (docs/domain-model.md#tips). One tip box per crew member, pre-filled with the
 * owner's default; each employee gets exactly what the customer entered; CSS absorbs the card fee.
 * Tips are owed to employees and never touch a booking's invoices or balance.
 */
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, schema, sql, type DbOrTx } from "@css/db";
import { formatCents } from "@css/domain";
import type { Services } from "../context";
import { audit } from "./audit";
import { sendEmail } from "./messaging";
import { getSettings } from "./settings";

async function jobByToken(db: DbOrTx, token: string) {
  const [row] = await db
    .select({ job: schema.jobs, appt: schema.appointments, booking: schema.bookings, crew: schema.crews })
    .from(schema.jobs)
    .innerJoin(schema.appointments, eq(schema.jobs.appointmentId, schema.appointments.id))
    .innerJoin(schema.bookings, eq(schema.appointments.bookingId, schema.bookings.id))
    .leftJoin(schema.crews, eq(schema.jobs.crewId, schema.crews.id))
    .where(eq(schema.jobs.trackingToken, token))
    .limit(1);
  return row ?? null;
}

async function payerCard(db: DbOrTx, bookingId: string) {
  const parties = await db.select().from(schema.bookingParties).where(eq(schema.bookingParties.bookingId, bookingId));
  const payer = parties.find((p) => p.roles.includes("payer")) ?? parties[0];
  if (!payer) return null;
  const [card] = await db
    .select()
    .from(schema.paymentMethods)
    .where(and(eq(schema.paymentMethods.personId, payer.personId), eq(schema.paymentMethods.active, true)))
    .orderBy(desc(schema.paymentMethods.createdAt))
    .limit(1);
  return card ? { ...card, payerPersonId: payer.personId } : null;
}

export async function ratePage(services: Services, token: string) {
  const { db } = services;
  const row = await jobByToken(db, token);
  if (!row || row.job.status !== "completed" || !row.crew) return null;
  const members = await db
    .select({ id: schema.employees.id, firstName: schema.employees.firstName, role: schema.crewMembers.role })
    .from(schema.crewMembers)
    .innerJoin(schema.employees, eq(schema.crewMembers.employeeId, schema.employees.id))
    .where(eq(schema.crewMembers.crewId, row.crew.id))
    .orderBy(asc(schema.employees.firstName));
  const [rating] = await db.select().from(schema.crewRatings).where(eq(schema.crewRatings.jobId, row.job.id));
  const [tip] = await db.select().from(schema.tips).where(eq(schema.tips.jobId, row.job.id));
  const settings = await getSettings(db);
  const card = await payerCard(db, row.booking.id);
  return {
    type: row.appt.type,
    date: row.appt.date,
    confirmationNumber: row.booking.confirmationNumber,
    crewName: row.crew.name,
    members: members.map((m) => ({ id: m.id, firstName: m.firstName, role: m.role })),
    tipDefaultCents: settings.tipDefaultCents,
    rated: rating ? { rating: rating.rating, comment: rating.comment } : null,
    tipped: tip ? { totalCents: tip.totalCents } : null,
    cardLast4: card?.last4 ?? null,
  };
}

export async function submitRating(
  services: Services,
  input: { token: string; rating: number; comment: string | null; tips: { employeeId: string; amountCents: number }[] },
) {
  const { db, integrations } = services;
  const row = await jobByToken(db, input.token);
  if (!row || row.job.status !== "completed" || !row.crew) throw new TRPCError({ code: "NOT_FOUND", message: "This link isn't valid" });
  if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) throw new TRPCError({ code: "BAD_REQUEST", message: "Pick 1 to 5 stars" });
  await db
    .insert(schema.crewRatings)
    .values({ jobId: row.job.id, rating: input.rating, comment: input.comment?.trim() || null })
    .onConflictDoUpdate({ target: schema.crewRatings.jobId, set: { rating: input.rating, comment: input.comment?.trim() || null } });

  const members = await db.select().from(schema.crewMembers).where(eq(schema.crewMembers.crewId, row.crew.id));
  const lines = input.tips.filter((t) => t.amountCents > 0 && members.some((m) => m.employeeId === t.employeeId));
  if (lines.some((l) => !Number.isInteger(l.amountCents) || l.amountCents > 50_000)) throw new TRPCError({ code: "BAD_REQUEST", message: "Tips must be under $500 each" });
  const total = lines.reduce((s, l) => s + l.amountCents, 0);
  if (!total) return { tipped: 0 };
  const [existing] = await db.select().from(schema.tips).where(eq(schema.tips.jobId, row.job.id));
  if (existing) throw new TRPCError({ code: "BAD_REQUEST", message: "You already tipped this crew. Thank you!" });
  const card = await payerCard(db, row.booking.id);
  if (!card) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "No card on file to tip with" });
  const result = await integrations.payments.charge({
    providerCustomerId: card.providerCustomerId,
    providerPaymentMethodId: card.providerPaymentMethodId,
    amountCents: total,
    idempotencyKey: `${row.job.id}:tip`,
    description: `Tip for CSS ${row.crew.name}`,
    merchantInitiated: false,
  });
  if (result.status === "failed") throw new TRPCError({ code: "BAD_REQUEST", message: `${result.message} Your rating was saved.` });
  const [tip] = await db
    .insert(schema.tips)
    .values({ jobId: row.job.id, payerPersonId: card.payerPersonId, paymentRef: result.providerRef, lines, totalCents: total })
    .returning();
  await audit(db, { type: "customer", id: card.payerPersonId }, "tip", tip!.id, "tipped", null, { totalCents: total });
  const [email] = await db.select().from(schema.contactPoints).where(and(eq(schema.contactPoints.personId, card.payerPersonId), eq(schema.contactPoints.kind, "email"))).limit(1);
  if (email)
    await sendEmail(services, {
      to: email.value,
      subject: "Thanks for tipping your CSS crew",
      text: `We charged ${formatCents(total)} to your card ending in ${card.last4}. Every dollar goes to the crew.`,
      purpose: "tip_receipt",
      personId: card.payerPersonId,
      bookingId: row.booking.id,
    });
  return { tipped: total };
}

/** Tips owed per employee for a pay period, and a payroll export; marking paid records the payout. */
export async function tipsForPeriod(db: DbOrTx, from: string, to: string) {
  const rows = (await db.execute(sql`
    select e.id as employee_id, e.first_name || ' ' || e.last_name as name,
      count(*)::int as tips,
      sum((line->>'amountCents')::int)::int as total,
      sum((line->>'amountCents')::int) filter (where t.paid_out_at is null)::int as unpaid
    from tips t cross join lateral jsonb_array_elements(t.lines) line join employees e on e.id = (line->>'employeeId')::uuid
    where (t.created_at at time zone 'America/Denver')::date between ${from} and ${to}
    group by 1, 2 order by 2`)) as unknown as { employee_id: string; name: string; tips: number; total: number; unpaid: number | null }[];
  const recent = await db
    .select({ tip: schema.tips, job: schema.jobs, crew: schema.crews })
    .from(schema.tips)
    .innerJoin(schema.jobs, eq(schema.tips.jobId, schema.jobs.id))
    .leftJoin(schema.crews, eq(schema.jobs.crewId, schema.crews.id))
    .where(sql`(${schema.tips.createdAt} at time zone 'America/Denver')::date between ${from} and ${to}`)
    .orderBy(desc(schema.tips.createdAt));
  return {
    employees: rows.map((r) => ({ employeeId: r.employee_id, name: r.name, tips: r.tips, totalCents: r.total, unpaidCents: r.unpaid ?? 0 })),
    tips: recent.map((r) => ({ id: r.tip.id, at: r.tip.createdAt, crew: r.crew?.name ?? null, totalCents: r.tip.totalCents, paidOut: !!r.tip.paidOutAt })),
  };
}

export async function markTipsPaid(services: Services, staffId: string, from: string, to: string) {
  const updated = await services.db
    .update(schema.tips)
    .set({ paidOutAt: new Date() })
    .where(and(sql`(${schema.tips.createdAt} at time zone 'America/Denver')::date between ${from} and ${to}`, sql`${schema.tips.paidOutAt} is null`))
    .returning({ id: schema.tips.id });
  await audit(services.db, { type: "staff", id: staffId }, "tips", `${from}..${to}`, "paid_out", null, { count: updated.length });
  return { count: updated.length };
}
