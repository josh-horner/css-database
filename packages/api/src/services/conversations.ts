/**
 * Inbound customer messages, the AI's first response, and the owner's conversations workspace
 * (docs/features/customer-communication.md). Graduated autonomy: only narrow intents are auto-answered;
 * everything else is escalated with a summary and a drafted reply.
 */
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, inArray, isNotNull, schema } from "@css/db";
import { bookingBalance, formatCents, type LedgerInvoice } from "@css/domain";
import type { Services } from "../context";
import { audit } from "./audit";
import { conversationForAddress, sendSms } from "./messaging";
import { getSettings } from "./settings";
import { localDate, windowLabel } from "./time";
import { queueForJob, queueSentence } from "./tracking";

export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return raw.startsWith("+") ? `+${digits}` : raw;
}

/** Stores an inbound SMS and queues the AI reply. Returns the message id. */
export async function recordInboundSms(services: Services, input: { from: string; body: string; providerId: string | null }) {
  const { db } = services;
  const from = normalizePhone(input.from);
  const [contact] = await db
    .select()
    .from(schema.contactPoints)
    .where(and(eq(schema.contactPoints.kind, "phone"), eq(schema.contactPoints.value, from)))
    .limit(1);

  if (/^\s*(stop|unsubscribe|cancel|end|quit)\s*$/i.test(input.body) && contact) {
    await db.update(schema.contactPoints).set({ smsOptOutAt: new Date() }).where(eq(schema.contactPoints.id, contact.id));
  }

  const bookingId = contact ? await mostRelevantBooking(services, contact.personId) : null;
  const conversation = await conversationForAddress(db, "sms", from, { personId: contact?.personId ?? null, bookingId }, "ai_handling");
  if (conversation.status === "resolved") {
    await db.update(schema.conversations).set({ status: "ai_handling" }).where(eq(schema.conversations.id, conversation.id));
  }
  const [message] = await db
    .insert(schema.messages)
    .values({
      conversationId: conversation.id,
      personId: contact?.personId ?? null,
      bookingId,
      channel: "sms",
      direction: "inbound",
      author: "customer",
      toAddress: services.integrations.sms.fromNumber,
      fromAddress: from,
      body: input.body,
      provider: services.integrations.sms.name,
      providerId: input.providerId,
      status: "received",
    })
    .returning();
  await db.update(schema.conversations).set({ lastMessageAt: new Date() }).where(eq(schema.conversations.id, conversation.id));
  await services.enqueue("ai.reply", { messageId: message!.id });
  return message!.id;
}

/** Today's stop if there is one, otherwise the most recent booking this person is on. */
async function mostRelevantBooking(services: Services, personId: string): Promise<string | null> {
  const { db } = services;
  const parties = await db.select().from(schema.bookingParties).where(eq(schema.bookingParties.personId, personId));
  if (!parties.length) return null;
  const ids = parties.map((p) => p.bookingId);
  const today = localDate(services.config.timeZone);
  const [todays] = await db
    .select({ bookingId: schema.appointments.bookingId })
    .from(schema.appointments)
    .where(and(inArray(schema.appointments.bookingId, ids), eq(schema.appointments.date, today)))
    .limit(1);
  if (todays) return todays.bookingId;
  const [latest] = await db.select().from(schema.bookings).where(inArray(schema.bookings.id, ids)).orderBy(desc(schema.bookings.createdAt)).limit(1);
  return latest?.id ?? null;
}

/** Facts about a booking, computed by our code, for the assistant and the owner's context panel. */
export async function bookingFacts(services: Services, bookingId: string) {
  const { db, config } = services;
  const [row] = await db
    .select({ booking: schema.bookings, person: schema.persons, school: schema.schools })
    .from(schema.bookings)
    .innerJoin(schema.persons, eq(schema.bookings.customerPersonId, schema.persons.id))
    .leftJoin(schema.schools, eq(schema.bookings.schoolId, schema.schools.id))
    .where(eq(schema.bookings.id, bookingId))
    .limit(1);
  if (!row) return { facts: [], links: [], summary: null };
  const facts: string[] = [
    `Booking #${row.booking.confirmationNumber} for ${row.person.firstName} ${row.person.lastName}${row.school ? ` (${row.school.shortName})` : ""}; status ${row.booking.lifecycle.replace("_", " ")}.`,
  ];
  const links: { label: string; url: string }[] = [];

  const appts = await db
    .select({ appointment: schema.appointments, job: schema.jobs })
    .from(schema.appointments)
    .leftJoin(schema.jobs, eq(schema.jobs.appointmentId, schema.appointments.id))
    .where(eq(schema.appointments.bookingId, bookingId))
    .orderBy(asc(schema.appointments.date));
  const today = localDate(config.timeZone);
  let queueText: string | null = null;
  for (const { appointment, job } of appts) {
    facts.push(`${appointment.type} on ${appointment.date}, ${windowLabel(appointment.windowId)}, at ${appointment.address}${appointment.room ? ` room ${appointment.room}` : ""}.`);
    if (job && appointment.date === today) {
      const q = await queueForJob(db, job.id, config.timeZone);
      if (q) {
        queueText = queueSentence(q);
        facts.push(`Queue: ${queueText}`);
      }
      links.push({ label: "Tracking", url: `${config.portalUrl}/t/${job.trackingToken}` });
    }
  }

  const invoices = await db.select().from(schema.invoices).where(eq(schema.invoices.bookingId, bookingId));
  const lines = invoices.length ? await db.select().from(schema.invoiceLines).where(inArray(schema.invoiceLines.invoiceId, invoices.map((i) => i.id))) : [];
  const payments = await db.select().from(schema.payments).where(eq(schema.payments.bookingId, bookingId));
  const ledgerInvoices: LedgerInvoice[] = invoices.map((i) => ({ id: i.id, status: i.status, lines: lines.filter((l) => l.invoiceId === i.id) }));
  const balance = bookingBalance({ invoices: ledgerInvoices, payments });
  facts.push(balance > 0 ? `Balance due: ${formatCents(balance)}.` : "No balance due right now.");
  if (invoices.some((i) => i.status === "pending_review")) facts.push("Pickup invoice is waiting for owner review; the card on file is charged once it's approved.");

  return { facts, links, summary: { confirmationNumber: row.booking.confirmationNumber, name: `${row.person.firstName} ${row.person.lastName}`, lifecycle: row.booking.lifecycle, balanceCents: balance, queueText } };
}

/** Worker job: draft (and maybe send) the AI's first response to an inbound message. */
export async function aiReply(services: Services, messageId: string) {
  const { db, integrations } = services;
  const [inbound] = await db.select().from(schema.messages).where(eq(schema.messages.id, messageId)).limit(1);
  if (!inbound?.conversationId || inbound.direction !== "inbound") return;
  const [conversation] = await db.select().from(schema.conversations).where(eq(schema.conversations.id, inbound.conversationId)).limit(1);
  if (!conversation) return;
  if (conversation.status === "escalated") return; // A person owns this thread now.

  const verified = inbound.personId
    ? (
        await db
          .select()
          .from(schema.contactPoints)
          .where(and(eq(schema.contactPoints.personId, inbound.personId), eq(schema.contactPoints.value, inbound.fromAddress ?? ""), isNotNull(schema.contactPoints.verifiedAt)))
          .limit(1)
      ).length > 0
    : false;
  const context = conversation.bookingId && verified ? await bookingFacts(services, conversation.bookingId) : { facts: [], links: [] };
  const history = await db
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.conversationId, conversation.id))
    .orderBy(desc(schema.messages.createdAt))
    .limit(11);

  const { reply, usage } = await integrations.assistant.reply(
    {
      customerMessage: inbound.body,
      history: history
        .filter((m) => m.id !== inbound.id)
        .reverse()
        .map((m) => ({ author: m.author, body: m.body })),
      bookingFacts: context.facts,
      verified,
      links: context.links,
    },
    await db
      .select({ title: schema.kbArticles.title, body: schema.kbArticles.body })
      .from(schema.kbArticles)
      .where(eq(schema.kbArticles.active, true))
      .orderBy(asc(schema.kbArticles.sortOrder)),
  );

  // Graduated autonomy: the owner chooses which intents are answered without a person (Settings).
  const settings = await getSettings(db);
  const autoSend = !reply.escalate && settings.aiAutoSendIntents.includes(reply.intent) && reply.confidence >= settings.aiAutoSendMinConfidence;
  const outboundBody = autoSend ? reply.reply : "Thanks for your message! Someone from CSS will get back to you shortly.";
  const sent = await sendSms(services, {
    to: conversation.externalAddress,
    body: outboundBody,
    purpose: autoSend ? "ai_reply" : "holding_reply",
    author: "ai",
    personId: inbound.personId,
    bookingId: conversation.bookingId,
    conversationId: conversation.id,
  });
  await db.insert(schema.aiReplies).values({
    conversationId: conversation.id,
    inboundMessageId: inbound.id,
    outboundMessageId: sent.id,
    model: integrations.assistant.model,
    promptVersion: integrations.assistant.promptVersion,
    intent: reply.intent,
    confidence: reply.confidence,
    escalate: !autoSend,
    reason: autoSend ? null : (reply.reason ?? (reply.escalate ? "Model escalated" : `Intent ${reply.intent} isn't auto-answered yet`)),
    autoSent: autoSend,
    usage: usage ?? null,
  });
  await db
    .update(schema.conversations)
    .set({ status: autoSend ? "resolved" : "escalated", intent: reply.intent, summary: reply.summary })
    .where(eq(schema.conversations.id, conversation.id));
  await audit(db, { type: "ai", id: integrations.assistant.model }, "conversation", conversation.id, autoSend ? "ai_answered" : "escalated", null, {
    intent: reply.intent,
    confidence: reply.confidence,
  });
}

export async function listConversations(services: Services, filter: "escalated" | "all") {
  const { db } = services;
  const rows = await db
    .select({ c: schema.conversations, person: schema.persons, booking: schema.bookings })
    .from(schema.conversations)
    .leftJoin(schema.persons, eq(schema.conversations.personId, schema.persons.id))
    .leftJoin(schema.bookings, eq(schema.conversations.bookingId, schema.bookings.id))
    .where(filter === "escalated" ? eq(schema.conversations.status, "escalated") : undefined)
    .orderBy(desc(schema.conversations.lastMessageAt))
    .limit(100);
  const ids = rows.map((r) => r.c.id);
  const lastMessages = ids.length
    ? await db.select().from(schema.messages).where(inArray(schema.messages.conversationId, ids)).orderBy(desc(schema.messages.createdAt))
    : [];
  return rows.map(({ c, person, booking }) => {
    const last = lastMessages.find((m) => m.conversationId === c.id);
    return {
      id: c.id,
      status: c.status,
      channel: c.channel,
      address: c.externalAddress,
      name: person ? `${person.firstName} ${person.lastName}` : null,
      confirmationNumber: booking?.confirmationNumber ?? null,
      intent: c.intent,
      summary: c.summary,
      lastMessage: last ? { body: last.body, author: last.author, at: last.createdAt } : null,
      lastMessageAt: c.lastMessageAt,
    };
  });
}

export async function getConversation(services: Services, id: string) {
  const { db } = services;
  const [c] = await db.select().from(schema.conversations).where(eq(schema.conversations.id, id)).limit(1);
  if (!c) throw new TRPCError({ code: "NOT_FOUND" });
  const messages = await db.select().from(schema.messages).where(eq(schema.messages.conversationId, id)).orderBy(asc(schema.messages.createdAt));
  const ai = await db.select().from(schema.aiReplies).where(eq(schema.aiReplies.conversationId, id)).orderBy(desc(schema.aiReplies.createdAt));
  const [person] = c.personId ? await db.select().from(schema.persons).where(eq(schema.persons.id, c.personId)) : [];
  const context = c.bookingId ? await bookingFacts(services, c.bookingId) : null;
  return {
    id: c.id,
    status: c.status,
    address: c.externalAddress,
    intent: c.intent,
    summary: c.summary,
    person: person ? { id: person.id, name: `${person.firstName} ${person.lastName}` } : null,
    bookingId: c.bookingId,
    context,
    messages: messages.map((m) => ({ id: m.id, direction: m.direction, author: m.author, body: m.body, at: m.createdAt, status: m.status, purpose: m.purpose })),
    lastAi: ai[0] ? { intent: ai[0].intent, confidence: ai[0].confidence, autoSent: ai[0].autoSent, reason: ai[0].reason, model: ai[0].model } : null,
  };
}

export async function staffReply(services: Services, staffId: string, conversationId: string, body: string, resolve: boolean) {
  const { db } = services;
  const [c] = await db.select().from(schema.conversations).where(eq(schema.conversations.id, conversationId)).limit(1);
  if (!c) throw new TRPCError({ code: "NOT_FOUND" });
  if (c.channel !== "sms") throw new TRPCError({ code: "BAD_REQUEST", message: "Only SMS replies are supported in the demo" });
  const msg = await sendSms(services, {
    to: c.externalAddress,
    body,
    purpose: "staff_reply",
    author: "staff",
    personId: c.personId,
    bookingId: c.bookingId,
    conversationId,
  });
  if (resolve) await db.update(schema.conversations).set({ status: "resolved" }).where(eq(schema.conversations.id, conversationId));
  await audit(db, { type: "staff", id: staffId }, "conversation", conversationId, resolve ? "replied_and_resolved" : "replied");
  return msg;
}

export async function setConversationStatus(services: Services, staffId: string, conversationId: string, status: "resolved" | "escalated") {
  await services.db.update(schema.conversations).set({ status }).where(eq(schema.conversations.id, conversationId));
  await audit(services.db, { type: "staff", id: staffId }, "conversation", conversationId, `marked_${status}`);
}
