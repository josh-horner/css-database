/**
 * End-to-end: a parent signs up for summer storage (+ in-room pickup) with a referral code, verifies their email,
 * pays the deposit, and lands in their account; a declined card doesn't consume a number; staff then work the
 * booking (add service, bill, cancel, re-create) and the funnel, hot leads, and reports see it all.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, schema } from "@css/db";
import { createHarness, type Harness } from "./harness";

let h: Harness;

beforeAll(async () => {
  h = await createHarness("css_signup_test");
}, 60_000);

afterAll(async () => {
  await h?.close();
});

describe("customer signup", () => {
  it("signs up a parent end to end, then staff work the booking", async () => {
    const { db } = h;
    const [referrer] = await db.select().from(schema.bookings).where(eq(schema.bookings.confirmationNumber, 101));
    const browser = h.browser();
    let api = await browser.call();

    // Step 1: email (+ phone with "CSS can text me"), referral code from the link.
    const started = await api.portal.signup.start({
      email: "Robin.Parent@Example.com",
      phone: "(303) 555-0177",
      smsConsent: true,
      marketingConsent: false,
      code: referrer!.referralCode,
      via: "whatsapp",
      signerRole: "guardian",
    });
    expect(started?.stepReached).toBe("services");
    expect(started?.code).toMatchObject({ kind: "referral", valid: true });
    expect(started?.signerRole).toBe("guardian");

    // Step 2: services offered now. Staff-only services aren't shown.
    const catalog = await api.portal.signup.catalog({});
    const storage = catalog.find((s) => s.code === "SUMMER_STORAGE")!;
    const inRoom = catalog.find((s) => s.code === "IN_ROOM_PICKUP")!;
    expect(catalog.some((s) => s.code === "SPECIAL_PICKUP")).toBe(false);
    let draft = await api.portal.signup.services({ serviceIds: [storage.id, inRoom.id] });
    expect(draft!.steps.map((s) => s.id)).toEqual(["contact", "services", "school", "people", "schedule", "details", "review", "done"]);
    expect(draft!.estimate.depositCents).toBe(5900);
    expect(draft!.estimate.lines.map((l) => l.description)).toEqual(["In-room pick-up", expect.stringContaining("Referral discount")]);

    // School: a dorm needs a room number.
    const schools = await api.portal.signup.schools();
    const cu = schools.find((s) => s.shortName === "CU Boulder")!;
    const farrand = cu.residences.find((r) => r.name === "Farrand Hall")!;
    const noRoom = await api.portal.signup.save({ step: "school", answers: { school: cu.id, residence: { residenceId: farrand.id } } });
    expect(noRoom.ok).toBe(false);
    expect(noRoom.errors).toEqual({ residence: "Enter your room number" });
    expect((await api.portal.signup.save({ step: "school", answers: { school: cu.id, residence: { residenceId: farrand.id, room: "301" } } })).ok).toBe(true);

    // People: the parent said at step 1 that they're filling it out.
    const people = await api.portal.signup.save({
      step: "people",
      answers: {
        student: { firstName: "Jesse", lastName: "Parent", email: "jesse.parent@example.com", phone: "303-555-0178", smsConsent: true },
        guardian: { firstName: "Robin", lastName: "Parent", email: "robin.parent@example.com", phone: "303-555-0177", smsConsent: true },
      },
    });
    expect(people.ok).toBe(true);

    // Pickup: capacity-managed windows at CU for a dorm (on campus).
    const { slots } = await api.portal.signup.availability({ fieldKey: "pickup" });
    expect(slots.length).toBeGreaterThan(5);
    expect(slots.every((s) => s.campusScope !== "off")).toBe(true);
    const slot = slots[0]!;
    expect((await api.portal.signup.save({ step: "schedule", answers: { pickup: { date: slot.date, windowId: slot.windowId, serviceDayId: slot.id } } })).ok).toBe(true);
    draft = (await api.portal.signup.save({ step: "details", answers: { delivery_plan: "deliver", access_notes: "3rd floor, elevator" } })).draft;
    expect(draft!.stepReached).toBe("review");

    // Review & pay: must verify the email first.
    await api.portal.signup.cardSetup();
    await expect(api.portal.signup.complete({ acceptTerms: true, heardFrom: "Friend or roommate", demoToken: "fake_tok_visa" })).rejects.toThrow(/code/);
    await api.portal.signup.sendCode();
    const code = /code is (\d{6})/.exec(h.emails.at(-1)!.text)![1]!;
    await expect(api.portal.signup.verify({ code: "000000" })).rejects.toThrow(/isn't right/);
    await api.portal.signup.verify({ code });
    api = await browser.call(); // the browser now carries the session cookie
    const done = await api.portal.signup.complete({ acceptTerms: true, heardFrom: "Friend or roommate", demoToken: "fake_tok_visa" });
    expect(done.confirmationNumber).toBe(100); // lowest free number in the new season

    // Records: parties, answers, appointment holding the window, an unassigned job, deposit paid, open bill.
    const detail = await (await h.staff()).admin.bookings.get({ id: done.bookingId });
    expect(detail.lifecycle).toBe("confirmed");
    expect(detail.people.find((p) => p.name === "Robin Parent")!.roles.sort()).toEqual(["guardian", "payer", "signer"]);
    expect(detail.people.find((p) => p.name === "Jesse Parent")!.roles.sort()).toEqual(["customer", "student"]);
    expect(detail.services.map((s) => s.name)).toEqual(["Summer storage", "In-room pick-up"]);
    expect(detail.appointments[0]).toMatchObject({ type: "pickup", date: slot.date, serviceDayId: slot.id, job: { status: "unassigned" } });
    expect(detail.ledger.payments).toMatchObject([{ kind: "charge", amountCents: 5900, status: "succeeded" }]);
    expect(detail.ledger.balanceCents).toBe(0);
    const open = detail.ledger.invoices.find((i) => i.status === "draft")!;
    expect(open.lines.map((l) => [l.description, l.kind])).toEqual([
      ["In-room pick-up", "charge"],
      [expect.stringContaining("Referral discount"), "discount"],
    ]);
    const [referral] = await db.select().from(schema.referrals).where(eq(schema.referrals.refereeBookingId, done.bookingId));
    expect(referral).toMatchObject({ kind: "parent", via: "whatsapp", referrerRewardKind: "credit" });
    const referrerLines = await db
      .select()
      .from(schema.invoiceLines)
      .innerJoin(schema.invoices, eq(schema.invoiceLines.invoiceId, schema.invoices.id))
      .where(and(eq(schema.invoices.bookingId, referrer!.id), eq(schema.invoiceLines.kind, "discount")));
    expect(referrerLines).toHaveLength(1);
    expect(h.emails.some((e) => e.subject.includes("confirmation #100"))).toBe(true);
    expect(h.sent.some((m) => m.to === "+13035550178" && m.body.includes("#100"))).toBe(true);

    // Their account: the booking, timeline, referral link.
    const home = await api.portal.account.home();
    expect(home.bookings.map((b) => b.confirmationNumber)).toEqual([100]);
    const mine = await api.portal.account.booking({ id: done.bookingId });
    expect(mine.timeline[0]).toMatchObject({ step: "confirmed", done: true });
    expect(mine.referral.link).toContain("/signup?ref=");
    expect(mine.appointments[0]!.canReschedule).toBe(true);

    // A second browser: the card declines; nothing is consumed and the draft shows as a hot lead.
    const other = h.browser();
    let o = await other.call();
    await o.portal.signup.start({ email: "decline@example.com", phone: null, smsConsent: false, marketingConsent: false, signerRole: "student" });
    await o.portal.signup.services({ serviceIds: [storage.id] });
    await o.portal.signup.save({ step: "school", answers: { school: cu.id, residence: { residenceId: farrand.id, room: "12" } } });
    await o.portal.signup.save({
      step: "people",
      answers: {
        student: { firstName: "Dee", lastName: "Cline", email: "decline@example.com", phone: "303-555-0190", smsConsent: false },
        guardian: { firstName: "Pat", lastName: "Cline", email: "pat.cline@example.com" },
      },
    });
    await o.portal.signup.save({ step: "schedule", answers: { pickup: { date: slot.date, windowId: slot.windowId, serviceDayId: slot.id } } });
    await o.portal.signup.sendCode();
    await o.portal.signup.verify({ code: /code is (\d{6})/.exec(h.emails.at(-1)!.text)![1]! });
    o = await other.call();
    await o.portal.signup.cardSetup();
    await expect(o.portal.signup.complete({ acceptTerms: true, heardFrom: null, demoToken: "fake_tok_decline" })).rejects.toThrow(/declined/);
    const stillDraft = await o.portal.signup.draft();
    expect(stillDraft!.lifecycle).toBe("draft");
    await db.update(schema.bookings).set({ lastActivityAt: new Date(Date.now() - 3 * 3_600_000) }).where(eq(schema.bookings.id, stillDraft!.id));
    const staff = await h.staff();
    const leads = await staff.admin.leads.list({ includeAutomated: false, includeWorked: false });
    expect(leads[0]).toMatchObject({ bookingId: stillDraft!.id, priority: "high", cardFailed: true, name: "Dee Cline" });

    // Staff: search, add a service with a reason, ad-hoc lines need a reason, cancel frees the number.
    const found = await staff.admin.bookings.list({ q: "jesse.parent" });
    expect(found.rows.map((r) => r.confirmationNumber)).toEqual([100]);
    const shipping = (await staff.admin.bookings.lookups()).services.find((s) => s.name === "Shipping")!;
    await staff.admin.bookings.addService({
      bookingId: done.bookingId,
      serviceId: shipping.id,
      answers: { ship_to: "12 Main St, Denver, CO 80202", ship_boxes: 3 },
      reason: "Parent called: ship 3 boxes home",
      acceptanceRequired: false,
      notify: true,
    });
    const after = await staff.admin.bookings.get({ id: done.bookingId });
    const shippingService = after.services.find((s) => s.name === "Shipping")!;
    expect(shippingService).toMatchObject({ source: "staff_addon", reason: "Parent called: ship 3 boxes home" });
    await expect(
      staff.admin.billing.addLine({ bookingId: done.bookingId, bookingServiceId: shippingService.id, kind: "charge", description: "Shipping", quantity: 3, unitPriceCents: 4500 }),
    ).rejects.toThrow(/reason/);
    await staff.admin.billing.addLine({ bookingId: done.bookingId, bookingServiceId: shippingService.id, kind: "charge", description: "UPS shipping, medium box", quantity: 3, unitPriceCents: 4500, reason: "UPS quote" });
    await staff.admin.bookings.cancel({ id: done.bookingId, reason: "Plans changed" });
    const recreated = await staff.admin.bookings.create({
      serviceIds: [storage.id],
      answers: { school: cu.id, residence: { residenceId: farrand.id, room: "5" }, student: { firstName: "Phone", lastName: "Signup" } },
      notify: false,
    });
    expect(recreated.confirmationNumber).toBe(100); // cancelled numbers are reused

    // Signed in already: no email to type, no code to confirm; their existing person signs.
    const returning = h.browser();
    let r = await returning.call();
    await r.portal.account.sendCode({ contact: "priya.patel@example.com" });
    await r.portal.account.verify({ contact: "priya.patel@example.com", code: /code is (\d{6})/.exec(h.emails.at(-1)!.text)![1]! });
    r = await returning.call();
    const signedIn = await r.portal.signup.start({ smsConsent: false, marketingConsent: false, signerRole: "guardian" });
    expect(signedIn).toMatchObject({ verified: true, signedIn: true, signer: { firstName: "Priya", email: "priya.patel@example.com" } });

    // Signed in first with an email we've never seen, then signs up: the booking shows in their account.
    const fresh = h.browser();
    let fr = await fresh.call();
    await fr.portal.account.sendCode({ contact: "brand.new@example.com" });
    await fr.portal.account.verify({ contact: "brand.new@example.com", code: /code is (\d{6})/.exec(h.emails.at(-1)!.text)![1]! });
    fr = await fresh.call();
    await fr.portal.signup.start({ smsConsent: false, marketingConsent: false, signerRole: "student" });
    await fr.portal.signup.services({ serviceIds: [storage.id] });
    await fr.portal.signup.save({ step: "school", answers: { school: cu.id, residence: { residenceId: farrand.id, room: "9" } } });
    await fr.portal.signup.save({
      step: "people",
      answers: {
        student: { firstName: "Bran", lastName: "New", email: "brand.new@example.com", phone: "303-555-0191", smsConsent: true },
        guardian: { firstName: "Old", lastName: "New", email: "old.new@example.com" },
      },
    });
    await fr.portal.signup.save({ step: "schedule", answers: { pickup: { date: slot.date, windowId: slot.windowId, serviceDayId: slot.id } } });
    await fr.portal.signup.cardSetup();
    const freshDone = await fr.portal.signup.complete({ acceptTerms: true, heardFrom: null, demoToken: "fake_tok_visa" });
    expect((await fr.portal.account.home()).bookings.map((b) => b.id)).toEqual([freshDone.bookingId]);

    // Reports and funnel see the season.
    const today = new Date().toISOString().slice(0, 10);
    const signups = await staff.admin.reports.run({ kind: "signups", from: "2020-01-01", to: today.replace(/^\d{4}/, (y) => String(Number(y) + 1)), groupBy: "school" });
    expect(signups.rows.find((r) => r.group === "CU Boulder")?.bookings).toBeGreaterThanOrEqual(7);
    const funnel = await staff.admin.leads.funnel({ from: "2020-01-01", to: "2100-01-01" });
    expect(funnel.find((f) => f.step === "review")!.errors).toBeGreaterThanOrEqual(1);
  }, 60_000);
});
