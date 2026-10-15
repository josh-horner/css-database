/**
 * End-to-end demo flow against a real Postgres test database (docker compose `db`, database css_test).
 * Fake payments/SMS/email/AI; real domain rules, SQL, and routers.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, schema, type Db } from "@css/db";
import { aiReply } from "../src/services/conversations";
import type { Services } from "../src/context";
import { createHarness, type Harness } from "./harness";

let h: Harness;
let db: Db;
let services: Services;
let sent: Harness["sent"];
let queued: Harness["queued"];

beforeAll(async () => {
  h = await createHarness("css_test"); // schedules the route on today (Denver)
  ({ db, services, sent, queued } = h);
}, 60_000);

afterAll(async () => {
  await h?.close();
});

const crewCaller = () => h.crew();
const staffCaller = () => h.staff();

describe("pickup day demo flow", () => {
  it("runs pickup → contract → approval → charge, declines → collections, and AI replies", async () => {
    const crew = await crewCaller();
    const staff = await staffCaller();
    const today = await crew.crew.today();
    expect(today.stops).toHaveLength(6);
    expect(today.nextJobId).toBe(today.stops[0]!.jobId);

    // On my way texts everyone on the booking with an ETA and tracking link.
    const first = today.stops[0]!;
    await crew.crew.onMyWay({ jobId: first.jobId });
    expect(sent.some((m) => m.body.includes("on the way") && m.body.includes("http://portal.test/t/"))).toBe(true);

    // Tracking for stop 3: 3 of 6, crew not heading there, so no live position.
    const tracking = await staff.portal.tracking({ token: "demo-stop-3" });
    expect(tracking.queue).toMatchObject({ position: 3, totalStops: 6, crewHeadingHere: false });
    expect(tracking.crewLocation).toBeNull();

    // Contract: 4 large boxes, a fridge, and an "Other" kayak.
    const rateCard = await crew.crew.rateCard();
    const lg = rateCard.find((r) => r.name === "Large box")!;
    const fridge = rateCard.find((r) => r.name === "Mini fridge")!;
    await crew.crew.arrive({ jobId: first.jobId });
    await crew.crew.saveItem({ jobId: first.jobId, clientId: "test-item-1", rateCardItemId: lg.id, description: null, quantity: 4, preExistingDamage: null });
    // Retried offline command is idempotent.
    await crew.crew.saveItem({ jobId: first.jobId, clientId: "test-item-1", rateCardItemId: lg.id, description: null, quantity: 4, preExistingDamage: null });
    await crew.crew.saveItem({ jobId: first.jobId, clientId: "test-item-2", rateCardItemId: fridge.id, description: null, quantity: 1, preExistingDamage: "dent" });
    await crew.crew.saveItem({ jobId: first.jobId, clientId: "test-item-3", rateCardItemId: null, description: "Kayak", quantity: 1, preExistingDamage: null });
    await expect(crew.crew.complete({ jobId: first.jobId, signedByName: null })).rejects.toThrow(/signature/);
    const { invoiceId } = await crew.crew.complete({ jobId: first.jobId, signedByName: "Maya Patel" });
    expect(invoiceId).toBeTruthy();

    // Owner review: Other line needs a price before approval.
    const [inv] = await staff.admin.invoices.reviewQueue();
    expect(inv).toMatchObject({ confirmationNumber: 101, subtotalCents: 4 * 5900 + 6900, ready: false });
    await expect(staff.admin.invoices.approve({ invoiceId: inv!.id })).rejects.toThrow(/price/);
    await staff.admin.invoices.updateLine({ lineId: inv!.lines.find((l) => l.needsPrice)!.id, unitPriceCents: 9900 });
    const charged = await staff.admin.invoices.approve({ invoiceId: inv!.id });
    // 236 + 69 + 99 = 404.00, plus 3% card fee 12.12
    expect(charged).toEqual({ status: "succeeded", amountCents: 41612 });
    const [paid] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, inv!.id));
    expect(paid!.status).toBe("paid");

    // Stop 5's card declines: collections case, customer notified with a pay link, then pays.
    const fifth = today.stops[4]!;
    await crew.crew.saveItem({ jobId: fifth.jobId, clientId: "test-item-5", rateCardItemId: lg.id, description: null, quantity: 2, preExistingDamage: null });
    await crew.crew.complete({ jobId: fifth.jobId, signedByName: "Ava Chen" });
    const [inv5] = await staff.admin.invoices.reviewQueue();
    const declined = await staff.admin.invoices.approve({ invoiceId: inv5!.id });
    expect(declined.status).toBe("failed");
    const [caseRow] = await staff.admin.collections();
    expect(caseRow).toMatchObject({ confirmationNumber: 105, status: "retrying", failedAttempts: 1, owedCents: 2 * 5900 + 354 });
    expect(sent.some((m) => m.body.includes("declined") && m.body.includes("/pay/"))).toBe(true);
    const token = caseRow!.payLink.split("/pay/")[1]!;
    const paidNow = await staff.portal.payWithDemoCard({ token });
    expect(paidNow.status).toBe("succeeded");
    expect((await staff.admin.collections())[0]!.status).toBe("resolved");

    // Customer at stop 3 asks when the crew is coming: answered automatically.
    await staff.admin.conversations.simulateInbound({ from: "+13035551103", body: "when are you coming?" });
    const job = queued.find((q) => q.name === "ai.reply")!;
    await aiReply(services, job.data.messageId as string);
    const all = await staff.admin.conversations.list({ filter: "all" });
    const sofia = all.find((c) => c.name === "Sofia Martinez")!;
    expect(sofia).toMatchObject({ status: "resolved", intent: "where_when" });
    expect(sofia.lastMessage?.body).toContain("stop 3 of 6");

    // A damage question is escalated to the owner.
    queued.length = 0;
    await staff.admin.conversations.simulateInbound({ from: "+13035551104", body: "my fridge got damaged" });
    await aiReply(services, queued[0]!.data.messageId as string);
    const escalated = await staff.admin.conversations.list({ filter: "escalated" });
    expect(escalated.map((c) => c.name)).toContain("Liam Okafor");
    expect((await staff.admin.counts()).escalated).toBe(1);
  }, 30_000);
});
