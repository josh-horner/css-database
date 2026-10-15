/**
 * Customer sign-in = proving you own a contact point (ADR-0004). A 6-digit code goes to the email (or phone);
 * verifying it marks every matching contact point verified and starts a session. Access to bookings is then
 * derived from the persons who own that contact point. Better Auth (ADR-0003) can replace the mechanics later.
 */
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, gt, inArray, isNotNull, isNull, schema, type DbOrTx } from "@css/db";
import { normalizeEmail, normalizePhone } from "@css/domain";
import type { Context, CustomerSession, Services } from "../context";
import { sendSms } from "./messaging";

export const CUSTOMER_COOKIE = "css_customer";
const SESSION_DAYS = 60;
const CODE_MINUTES = 15;
const MAX_ATTEMPTS = 5;
const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

export function normalizeContact(raw: string): { kind: "email" | "phone"; value: string } | null {
  const email = normalizeEmail(raw);
  if (email) return { kind: "email", value: email };
  const phone = normalizePhone(raw);
  return phone ? { kind: "phone", value: phone } : null;
}

/** Sends a sign-in code. In demo mode with no real email/SMS provider, the code is also returned for the UI. */
export async function sendCode(services: Services, contact: { kind: "email" | "phone"; value: string }) {
  const { db, integrations, config } = services;
  const [recent] = await db
    .select()
    .from(schema.verificationCodes)
    .where(and(eq(schema.verificationCodes.value, contact.value), gt(schema.verificationCodes.createdAt, new Date(Date.now() - 30_000))))
    .limit(1);
  if (recent) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "We just sent a code. Wait a few seconds and try again." });

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await db.insert(schema.verificationCodes).values({
    kind: contact.kind,
    value: contact.value,
    codeHash: sha256(`${contact.value}:${code}`),
    expiresAt: new Date(Date.now() + CODE_MINUTES * 60_000),
  });
  const text = `Your College Student Storage code is ${code}. It expires in ${CODE_MINUTES} minutes.`;
  let realDelivery: boolean;
  if (contact.kind === "email") {
    await integrations.email.send({ to: contact.value, subject: `Your CSS code: ${code}`, text });
    realDelivery = integrations.email.name !== "console";
  } else {
    await sendSms(services, { to: contact.value, body: `CSS: ${text}`, purpose: "verification", author: "system" });
    realDelivery = integrations.sms.name !== "console";
  }
  return { sentTo: contact.value, kind: contact.kind, demoCode: config.demoMode && !realDelivery ? code : null };
}

export async function verifyCode(ctx: Context, contact: { kind: "email" | "phone"; value: string }, code: string): Promise<CustomerSession> {
  const { db } = ctx;
  const [row] = await db
    .select()
    .from(schema.verificationCodes)
    .where(and(eq(schema.verificationCodes.value, contact.value), isNull(schema.verificationCodes.usedAt), gt(schema.verificationCodes.expiresAt, new Date())))
    .orderBy(desc(schema.verificationCodes.createdAt))
    .limit(1);
  if (!row) throw new TRPCError({ code: "BAD_REQUEST", message: "That code has expired. Send a new one." });
  if (row.attempts >= MAX_ATTEMPTS) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Too many tries. Send a new code." });
  const expected = Buffer.from(row.codeHash);
  const actual = Buffer.from(sha256(`${contact.value}:${code.trim()}`));
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    await db.update(schema.verificationCodes).set({ attempts: row.attempts + 1 }).where(eq(schema.verificationCodes.id, row.id));
    throw new TRPCError({ code: "BAD_REQUEST", message: "That code isn't right. Check it and try again." });
  }
  await db.update(schema.verificationCodes).set({ usedAt: new Date() }).where(eq(schema.verificationCodes.id, row.id));
  await db
    .update(schema.contactPoints)
    .set({ verifiedAt: new Date() })
    .where(and(eq(schema.contactPoints.kind, contact.kind), eq(schema.contactPoints.value, contact.value), isNull(schema.contactPoints.verifiedAt)));
  return startSession(ctx, contact);
}

export async function startSession(ctx: Context, contact: { kind: "email" | "phone"; value: string }): Promise<CustomerSession> {
  const token = randomBytes(32).toString("base64url");
  const [session] = await ctx.db
    .insert(schema.customerSessions)
    .values({ tokenHash: sha256(token), kind: contact.kind, value: contact.value, expiresAt: new Date(Date.now() + SESSION_DAYS * 86_400_000) })
    .returning();
  ctx.cookies.set(CUSTOMER_COOKIE, token, SESSION_DAYS * 86_400);
  return { sessionId: session!.id, kind: contact.kind, value: contact.value };
}

export async function sessionFromToken(db: DbOrTx, token: string | undefined): Promise<CustomerSession | null> {
  if (!token) return null;
  const [row] = await db
    .select()
    .from(schema.customerSessions)
    .where(and(eq(schema.customerSessions.tokenHash, sha256(token)), isNull(schema.customerSessions.revokedAt), gt(schema.customerSessions.expiresAt, new Date())))
    .limit(1);
  return row ? { sessionId: row.id, kind: row.kind, value: row.value } : null;
}

export async function endSession(ctx: Context) {
  if (ctx.customer) await ctx.db.update(schema.customerSessions).set({ revokedAt: new Date() }).where(eq(schema.customerSessions.id, ctx.customer.sessionId));
  ctx.cookies.clear(CUSTOMER_COOKIE);
}

/** Persons who own the session's verified contact point. */
export async function sessionPersonIds(db: DbOrTx, session: CustomerSession): Promise<string[]> {
  const rows = await db
    .select({ personId: schema.contactPoints.personId })
    .from(schema.contactPoints)
    .where(and(eq(schema.contactPoints.kind, session.kind), eq(schema.contactPoints.value, session.value), isNotNull(schema.contactPoints.verifiedAt)));
  return [...new Set(rows.map((r) => r.personId))];
}

/** Bookings (not drafts) where one of the session's persons is a party, with that person's roles. */
export async function accessibleBookings(db: DbOrTx, session: CustomerSession) {
  const personIds = await sessionPersonIds(db, session);
  if (!personIds.length) return [];
  const parties = await db.select().from(schema.bookingParties).where(inArray(schema.bookingParties.personId, personIds));
  const roles = new Map<string, Set<string>>();
  for (const p of parties) {
    const set = roles.get(p.bookingId) ?? new Set<string>();
    p.roles.forEach((r) => set.add(r));
    roles.set(p.bookingId, set);
  }
  return [...roles.entries()].map(([bookingId, r]) => ({ bookingId, roles: [...r] }));
}

export async function requireBookingAccess(ctx: Context & { customer: CustomerSession }, bookingId: string, anyOf?: string[]) {
  const access = (await accessibleBookings(ctx.db, ctx.customer)).find((a) => a.bookingId === bookingId);
  if (!access) throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found" });
  if (anyOf && !access.roles.some((r) => anyOf.includes(r))) throw new TRPCError({ code: "FORBIDDEN", message: "Ask the parent or payer on this booking to do that" });
  return access;
}
