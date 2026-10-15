/**
 * Outbound messages. Every send is a `messages` row with provider status, and SMS goes only to contact
 * points with recorded consent that haven't opted out (CLAUDE.md conventions).
 */
import { and, desc, eq, inArray, isNotNull, isNull, schema, type DbOrTx } from "@css/db";
import type { Services } from "../context";

export type Purpose =
  | "on_my_way"
  | "pickup_receipt"
  | "invoice_paid"
  | "payment_failed"
  | "ai_reply"
  | "staff_reply"
  | "holding_reply"
  | "verification"
  | "signup_confirmation"
  | "signup_reminder"
  | "service_added"
  | "appointment_changed"
  | "claim_update"
  | "crew_notice"
  | "staff_message"
  | "tip_receipt"
  | "access_invite";

/** Returns the SMS-able phone numbers of everyone on a booking, optionally limited to certain roles. */
export async function bookingSmsRecipients(db: DbOrTx, bookingId: string, roles?: string[]) {
  const parties = await db.select().from(schema.bookingParties).where(eq(schema.bookingParties.bookingId, bookingId));
  const personIds = parties.filter((p) => !roles || p.roles.some((r) => roles.includes(r))).map((p) => p.personId);
  if (!personIds.length) return [];
  return db
    .select({ personId: schema.contactPoints.personId, value: schema.contactPoints.value })
    .from(schema.contactPoints)
    .where(
      and(
        inArray(schema.contactPoints.personId, personIds),
        eq(schema.contactPoints.kind, "phone"),
        isNotNull(schema.contactPoints.smsConsentAt),
        isNull(schema.contactPoints.smsOptOutAt),
      ),
    );
}

export async function bookingEmailRecipients(db: DbOrTx, bookingId: string, roles?: string[]) {
  const parties = await db.select().from(schema.bookingParties).where(eq(schema.bookingParties.bookingId, bookingId));
  const personIds = parties.filter((p) => !roles || p.roles.some((r) => roles.includes(r))).map((p) => p.personId);
  if (!personIds.length) return [];
  return db
    .select({ personId: schema.contactPoints.personId, value: schema.contactPoints.value })
    .from(schema.contactPoints)
    .where(
      and(
        inArray(schema.contactPoints.personId, personIds),
        eq(schema.contactPoints.kind, "email"),
        isNull(schema.contactPoints.bouncedAt),
      ),
    );
}

/** One SMS conversation per phone number, so the owner sees our texts and the customer's replies together. */
export async function conversationForAddress(
  db: DbOrTx,
  channel: "sms" | "email" | "chat",
  address: string,
  link: { personId?: string | null; bookingId?: string | null },
  newStatus: "ai_handling" | "resolved" = "resolved",
) {
  const [existing] = await db
    .select()
    .from(schema.conversations)
    .where(and(eq(schema.conversations.channel, channel), eq(schema.conversations.externalAddress, address)))
    .orderBy(desc(schema.conversations.lastMessageAt))
    .limit(1);
  if (existing) {
    if ((link.personId && !existing.personId) || (link.bookingId && existing.bookingId !== link.bookingId)) {
      await db
        .update(schema.conversations)
        .set({ personId: existing.personId ?? link.personId ?? null, bookingId: link.bookingId ?? existing.bookingId })
        .where(eq(schema.conversations.id, existing.id));
    }
    return existing;
  }
  const [created] = await db
    .insert(schema.conversations)
    .values({
      channel,
      externalAddress: address,
      personId: link.personId ?? null,
      bookingId: link.bookingId ?? null,
      status: newStatus,
      lastMessageAt: new Date(),
    })
    .returning();
  return created!;
}

export async function sendSms(
  services: Services,
  input: {
    to: string;
    body: string;
    purpose: Purpose;
    author: "system" | "staff" | "ai";
    personId?: string | null;
    bookingId?: string | null;
    conversationId?: string;
  },
) {
  const { db, integrations } = services;
  const conversation = input.conversationId
    ? { id: input.conversationId }
    : await conversationForAddress(db, "sms", input.to, { personId: input.personId, bookingId: input.bookingId });
  const [row] = await db
    .insert(schema.messages)
    .values({
      conversationId: conversation.id,
      personId: input.personId ?? null,
      bookingId: input.bookingId ?? null,
      channel: "sms",
      direction: "outbound",
      author: input.author,
      purpose: input.purpose,
      toAddress: input.to,
      fromAddress: integrations.sms.fromNumber,
      body: input.body,
      provider: integrations.sms.name,
    })
    .returning();
  const result = await integrations.sms.send(input.to, input.body);
  await db
    .update(schema.messages)
    .set({ status: result.status, providerId: result.providerId, error: result.error ?? null })
    .where(eq(schema.messages.id, row!.id));
  await db
    .update(schema.conversations)
    .set({ lastMessageAt: new Date() })
    .where(eq(schema.conversations.id, conversation.id));
  return { ...row!, status: result.status };
}

export async function smsBooking(
  services: Services,
  bookingId: string,
  purpose: Purpose,
  body: string,
  roles?: string[],
) {
  const recipients = await bookingSmsRecipients(services.db, bookingId, roles);
  const seen = new Set<string>();
  for (const r of recipients) {
    if (seen.has(r.value)) continue;
    seen.add(r.value);
    await sendSms(services, { to: r.value, body, purpose, author: "system", personId: r.personId, bookingId });
  }
  return seen.size;
}

/** One email to one address, logged as a message row. */
export async function sendEmail(
  services: Services,
  input: { to: string; subject: string; text: string; purpose: Purpose; author?: "system" | "staff"; personId?: string | null; bookingId?: string | null },
) {
  const { db, integrations } = services;
  const [row] = await db
    .insert(schema.messages)
    .values({
      personId: input.personId ?? null,
      bookingId: input.bookingId ?? null,
      channel: "email",
      direction: "outbound",
      author: input.author ?? "system",
      purpose: input.purpose,
      toAddress: input.to,
      subject: input.subject,
      body: input.text,
      provider: integrations.email.name,
    })
    .returning();
  const result = await integrations.email.send({ to: input.to, subject: input.subject, text: input.text });
  await db
    .update(schema.messages)
    .set({ status: result.status, providerId: result.providerId, error: result.error ?? null })
    .where(eq(schema.messages.id, row!.id));
  return row!;
}

export async function emailBooking(
  services: Services,
  bookingId: string,
  purpose: Purpose,
  subject: string,
  text: string,
  roles?: string[],
) {
  const recipients = await bookingEmailRecipients(services.db, bookingId, roles);
  const seen = new Set<string>();
  for (const r of recipients) {
    if (seen.has(r.value)) continue;
    seen.add(r.value);
    await sendEmail(services, { to: r.value, subject, text, purpose, personId: r.personId, bookingId });
  }
  return seen.size;
}
