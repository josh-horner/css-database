import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { PersonAnswer, WIZARD_STEPS } from "@css/domain";
import { schema, eq } from "@css/db";
import { readSignedLinkToken, signedLinkToken } from "../auth";
import { payPage, payWithDemoCard } from "../services/billing";
import { activeSchools } from "../services/catalog";
import { endSession, normalizeContact, sendCode, verifyCode } from "../services/customer-auth";
import {
  acceptService,
  accountBooking,
  accountHome,
  customerClaim,
  customerInvite,
  customerReschedule,
  customerScheduleDelivery,
  customerSlots,
  labelsData,
} from "../services/portal-account";
import {
  applyCode,
  availability,
  cardSetup,
  catalog,
  completeSignup,
  DRAFT_COOKIE,
  getDraft,
  saveStep,
  selectServices,
  sendSignupCode,
  signupAgain,
  startSignup,
  trackView,
} from "../services/signup";
import { ratePage, submitRating } from "../services/tips";
import { trackingByToken } from "../services/tracking";

import { customerProcedure, publicProcedure, router } from "../trpc";

const token = z.string().min(8).max(64);
const step = z.enum(WIZARD_STEPS);

const signupRouter = router({
  draft: publicProcedure.query(({ ctx }) => getDraft(ctx)),
  schools: publicProcedure.query(({ ctx }) => activeSchools(ctx.db)),
  catalog: publicProcedure.input(z.object({ schoolId: z.uuid().nullish() })).query(({ ctx, input }) => catalog(ctx, { schoolId: input.schoolId })),
  start: publicProcedure
    .input(
      z.object({
        email: z.string().max(200).nullish(),
        signerRole: z.enum(["student", "guardian", "other"]),
        phone: z.string().max(30).nullish(),
        smsConsent: z.boolean(),
        marketingConsent: z.boolean(),
        code: z.string().max(40).nullish(),
        via: z.string().max(30).nullish(),
      }),
    )
    .mutation(({ ctx, input }) => startSignup(ctx, input)),
  services: publicProcedure.input(z.object({ serviceIds: z.array(z.uuid()).max(10) })).mutation(({ ctx, input }) => selectServices(ctx, input.serviceIds)),
  save: publicProcedure
    .input(z.object({ step, answers: z.record(z.string(), z.unknown()), signerRole: z.enum(["student", "guardian", "other"]).optional() }))
    .mutation(({ ctx, input }) => saveStep(ctx, input)),
  view: publicProcedure.input(z.object({ step })).mutation(({ ctx, input }) => trackView(ctx, input.step)),
  availability: publicProcedure.input(z.object({ fieldKey: z.string().max(60) })).query(({ ctx, input }) => availability(ctx, input.fieldKey)),
  applyCode: publicProcedure.input(z.object({ code: z.string().min(2).max(40) })).mutation(({ ctx, input }) => applyCode(ctx, input.code)),
  sendCode: publicProcedure.mutation(({ ctx }) => sendSignupCode(ctx)),
  verify: publicProcedure.input(z.object({ code: z.string().min(4).max(10) })).mutation(async ({ ctx, input }) => {
    const draft = await getDraft(ctx);
    if (!draft?.signer.email) throw new TRPCError({ code: "BAD_REQUEST" });
    await verifyCode(ctx, { kind: "email", value: draft.signer.email }, input.code);
    return { ok: true };
  }),
  cardSetup: publicProcedure.mutation(({ ctx }) => cardSetup(ctx)),
  complete: publicProcedure
    .input(z.object({ acceptTerms: z.boolean(), heardFrom: z.string().max(120).nullable(), demoToken: z.enum(["fake_tok_visa", "fake_tok_decline"]).nullish() }))
    .mutation(({ ctx, input }) => completeSignup(ctx, input)),
  /** Resume link from reminder emails and Hot leads outreach: sets the draft cookie. */
  resume: publicProcedure.input(z.object({ token: z.string().max(120) })).mutation(async ({ ctx, input }) => {
    const id = readSignedLinkToken("resume", input.token, ctx.config.appSecret);
    if (!id) throw new TRPCError({ code: "NOT_FOUND", message: "This link isn't valid" });
    const [booking] = await ctx.db.select().from(schema.bookings).where(eq(schema.bookings.id, id));
    if (!booking) throw new TRPCError({ code: "NOT_FOUND" });
    ctx.cookies.set(DRAFT_COOKIE, signedLinkToken("draft", id, ctx.config.appSecret), 60 * 86_400);
    return { lifecycle: booking.lifecycle };
  }),
  startOver: publicProcedure.mutation(({ ctx }) => {
    ctx.cookies.clear(DRAFT_COOKIE);
    return { ok: true };
  }),
});

const accountRouter = router({
  sendCode: publicProcedure.input(z.object({ contact: z.string().min(3).max(200) })).mutation(({ ctx, input }) => {
    const contact = normalizeContact(input.contact);
    if (!contact) throw new TRPCError({ code: "BAD_REQUEST", message: "Enter your email or a 10-digit phone number" });
    return sendCode(ctx, contact);
  }),
  verify: publicProcedure.input(z.object({ contact: z.string().min(3).max(200), code: z.string().min(4).max(10) })).mutation(async ({ ctx, input }) => {
    const contact = normalizeContact(input.contact);
    if (!contact) throw new TRPCError({ code: "BAD_REQUEST" });
    await verifyCode(ctx, contact, input.code);
    return { ok: true };
  }),
  signOut: publicProcedure.mutation(({ ctx }) => endSession(ctx)),
  session: publicProcedure.query(({ ctx }) => (ctx.customer ? { kind: ctx.customer.kind, value: ctx.customer.value } : null)),
  home: customerProcedure.query(({ ctx }) => accountHome(ctx)),
  booking: customerProcedure.input(z.object({ id: z.uuid() })).query(({ ctx, input }) => accountBooking(ctx, input.id)),
  slots: customerProcedure.input(z.object({ bookingId: z.uuid(), type: z.enum(["pickup", "delivery"]) })).query(({ ctx, input }) => customerSlots(ctx, input.bookingId, input.type)),
  reschedule: customerProcedure.input(z.object({ appointmentId: z.uuid(), serviceDayId: z.uuid() })).mutation(({ ctx, input }) => customerReschedule(ctx, input.appointmentId, input.serviceDayId)),
  scheduleDelivery: customerProcedure.input(z.object({ bookingId: z.uuid(), serviceDayId: z.uuid() })).mutation(({ ctx, input }) => customerScheduleDelivery(ctx, input.bookingId, input.serviceDayId)),
  invite: customerProcedure.input(z.object({ bookingId: z.uuid(), person: PersonAnswer })).mutation(({ ctx, input }) => customerInvite(ctx, input.bookingId, input.person)),
  claim: customerProcedure
    .input(
      z.object({
        bookingId: z.uuid(),
        kind: z.enum(["damage", "missing", "other"]),
        itemIds: z.array(z.uuid()).max(50),
        description: z.string().min(10, "Tell us a bit more").max(3000),
        photoKeys: z.array(z.string().max(200)).max(10),
      }),
    )
    .mutation(({ ctx, input }) => customerClaim(ctx, input)),
  acceptService: customerProcedure.input(z.object({ bookingServiceId: z.uuid() })).mutation(({ ctx, input }) => acceptService(ctx, input.bookingServiceId)),
  labels: customerProcedure.input(z.object({ bookingId: z.uuid() })).query(({ ctx, input }) => labelsData(ctx, input.bookingId)),
  signupAgain: customerProcedure.input(z.object({ bookingId: z.uuid() })).mutation(async ({ ctx, input }) => {
    const home = await accountHome(ctx);
    const parties = await ctx.db.select().from(schema.bookingParties).where(eq(schema.bookingParties.bookingId, input.bookingId));
    const me = parties.find((p) => home.personIds.includes(p.personId));
    if (!me) throw new TRPCError({ code: "NOT_FOUND" });
    return signupAgain(ctx, input.bookingId, me.personId);
  }),
});

export const portalRouter = router({
  signup: signupRouter,
  account: accountRouter,
  tracking: publicProcedure.input(z.object({ token })).query(async ({ ctx, input }) => {
    const data = await trackingByToken(ctx.db, input.token, ctx.config.timeZone);
    if (!data) throw new TRPCError({ code: "NOT_FOUND", message: "This tracking link isn't valid" });
    return data;
  }),
  payPage: publicProcedure.input(z.object({ token })).query(async ({ ctx, input }) => {
    const data = await payPage(ctx, input.token);
    if (!data) throw new TRPCError({ code: "NOT_FOUND", message: "This payment link isn't valid" });
    return data;
  }),
  payWithDemoCard: publicProcedure.input(z.object({ token })).mutation(({ ctx, input }) => payWithDemoCard(ctx, input.token)),
  ratePage: publicProcedure.input(z.object({ token })).query(async ({ ctx, input }) => {
    const data = await ratePage(ctx, input.token);
    if (!data) throw new TRPCError({ code: "NOT_FOUND", message: "This link isn't valid yet" });
    return data;
  }),
  rate: publicProcedure
    .input(
      z.object({
        token,
        rating: z.number().int().min(1).max(5),
        comment: z.string().max(1000).nullable(),
        tips: z.array(z.object({ employeeId: z.uuid(), amountCents: z.number().int().min(0).max(50_000) })).max(10),
      }),
    )
    .mutation(({ ctx, input }) => submitRating(ctx, input)),
});
