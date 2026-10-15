import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { and, eq, inArray, lte, schema, sql } from "@css/db";
import { PersonAnswer, Settings } from "@css/domain";
import { approveInvoice, collectionsList, reviewQueue, updateDraftLine } from "../services/billing";
import {
  addAppointment,
  addInvoiceLine,
  addNote,
  addParty,
  addService,
  bookingDetail,
  bookingsCsv,
  cancelAppointment,
  cancelBooking,
  chargeBalanceNow,
  createBookingByStaff,
  formLookups,
  listBookings,
  messageBooking,
  refundPayment,
  removeDraftLine,
  rescheduleAppointment,
  setWaiveCardFee,
  submitForReview,
  textPerson,
  updateBooking,
  updatePerson,
  voidDraftInvoice,
  writeOff,
} from "../services/bookings";
import { slotsFor } from "../services/capacity";
import { seasonFor, signupSeason } from "../services/catalog";
import { claimsQueue, resolveClaim, setClaimStatus } from "../services/claims";
import * as config from "../services/config";
import { getConversation, listConversations, recordInboundSms, setConversationStatus, staffReply } from "../services/conversations";
import { assignDevice, assignJobs, autoOrder, calendar, capacityGrid, copyCrews, createCrew, crewDay, publishDay, setMember, updateCrew } from "../services/crews-admin";
import { emailLead, funnelReport, hotLeads, recordOutreach, resumeLink, textLead } from "../services/leads";
import { labelsData } from "../services/portal-account";
import { REPORTS, runReport, type ReportKind } from "../services/reports";
import { getSettings } from "../services/settings";
import { markTipsPaid, tipsForPeriod } from "../services/tips";
import { latestCrewLocation } from "../services/tracking";
import { localDate, windowLabel } from "../services/time";
import { officeProcedure, ownerProcedure, roleProcedure, router, staffProcedure } from "../trpc";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const cents = z.number().int().min(0).max(10_000_000);
const dispatcherProcedure = roleProcedure("dispatcher", "office");
const warehouseProcedure = roleProcedure("warehouse", "office");
const REFUND_OWNER_THRESHOLD_CENTS = 10_000;

const lifecycleFilter = z.enum([...schema.lifecycle.enumValues, "active"]).nullish();

const bookingsRouter = router({
  list: staffProcedure
    .input(
      z.object({
        q: z.string().max(100).optional(),
        seasonId: z.uuid().nullish(),
        schoolId: z.uuid().nullish(),
        serviceId: z.uuid().nullish(),
        lifecycle: lifecycleFilter,
        flag: z.string().max(40).nullish(),
        limit: z.number().int().min(1).max(200).optional(),
        offset: z.number().int().min(0).optional(),
      }),
    )
    .query(({ ctx, input }) => listBookings(ctx.db, input)),
  csv: staffProcedure
    .input(z.object({ q: z.string().max(100).optional(), seasonId: z.uuid().nullish(), schoolId: z.uuid().nullish(), serviceId: z.uuid().nullish(), lifecycle: lifecycleFilter, flag: z.string().max(40).nullish() }))
    .mutation(({ ctx, input }) => bookingsCsv(ctx.db, input)),
  /** Kept for the old quick search box. */
  search: staffProcedure.input(z.object({ q: z.string().max(100) })).query(async ({ ctx, input }) => (await listBookings(ctx.db, { q: input.q, limit: 20 })).rows),
  get: staffProcedure.input(z.object({ id: z.uuid() })).query(({ ctx, input }) => bookingDetail(ctx.db, input.id)),
  lookups: staffProcedure.query(({ ctx }) => formLookups(ctx.db)),
  update: officeProcedure
    .input(
      z.object({
        id: z.uuid(),
        flags: z.array(z.string().max(40)).max(20).optional(),
        storageUntil: isoDate.nullish(),
        room: z.string().max(40).nullish(),
        lifecycle: z.enum(schema.lifecycle.enumValues).optional(),
        reason: z.string().max(500).nullish(),
      }),
    )
    .mutation(({ ctx, input }) => updateBooking(ctx, { type: "staff", id: ctx.staff.id }, input.id, input)),
  setStorageLocation: warehouseProcedure
    .input(z.object({ id: z.uuid(), storageLocation: z.string().max(80).nullable(), checkIn: z.boolean().optional() }))
    .mutation(async ({ ctx, input }) => {
      await updateBooking(ctx, { type: "staff", id: ctx.staff.id }, input.id, { storageLocation: input.storageLocation });
      if (input.checkIn) {
        const [b] = await ctx.db.select().from(schema.bookings).where(eq(schema.bookings.id, input.id));
        if (b?.lifecycle === "picked_up") await updateBooking(ctx, { type: "staff", id: ctx.staff.id }, input.id, { lifecycle: "in_storage", reason: "Checked into warehouse" });
      }
    }),
  cancel: officeProcedure.input(z.object({ id: z.uuid(), reason: z.string().min(3).max(500) })).mutation(({ ctx, input }) => cancelBooking(ctx, { type: "staff", id: ctx.staff.id }, input.id, input.reason)),
  addNote: staffProcedure
    .input(z.object({ id: z.uuid(), body: z.string().min(1).max(4000), pinned: z.boolean().default(false) }))
    .mutation(({ ctx, input }) => addNote(ctx, ctx.staff.id, input.id, input.body, input.pinned)),
  updatePerson: officeProcedure
    .input(
      z.object({
        bookingId: z.uuid(),
        personId: z.uuid(),
        firstName: z.string().min(1).max(80),
        lastName: z.string().max(80),
        email: z.string().max(200).nullish(),
        phone: z.string().max(30).nullish(),
        smsConsent: z.boolean().optional(),
      }),
    )
    .mutation(({ ctx, input }) => updatePerson(ctx, { type: "staff", id: ctx.staff.id }, input)),
  addParty: officeProcedure
    .input(z.object({ bookingId: z.uuid(), role: z.enum(["guardian", "payer", "customer"]), person: PersonAnswer }))
    .mutation(({ ctx, input }) => addParty(ctx, { type: "staff", id: ctx.staff.id }, input.bookingId, input.role, input.person)),
  slots: staffProcedure.input(z.object({ bookingId: z.uuid(), type: z.enum(["pickup", "delivery"]) })).query(async ({ ctx, input }) => {
    const [b] = await ctx.db.select().from(schema.bookings).where(eq(schema.bookings.id, input.bookingId));
    if (!b?.schoolId) return [];
    const season = await seasonFor(ctx.db, b.seasonId);
    return slotsFor(ctx.db, { seasonId: season.id, schoolId: b.schoolId, type: input.type, campus: null, today: localDate(ctx.config.timeZone), leadDays: 0, staff: true });
  }),
  /** Windows for a school (new bookings by staff): staff see full and closed windows too. */
  schoolSlots: staffProcedure.input(z.object({ schoolId: z.uuid(), seasonId: z.uuid().nullish(), type: z.enum(["pickup", "delivery"]) })).query(async ({ ctx, input }) => {
    const seasonId = input.seasonId ?? (await signupSeason(ctx.db)).id;
    return slotsFor(ctx.db, { seasonId, schoolId: input.schoolId, type: input.type, campus: null, today: localDate(ctx.config.timeZone), leadDays: 0, staff: true });
  }),
  reschedule: officeProcedure
    .input(z.object({ appointmentId: z.uuid(), date: isoDate, windowId: z.string().max(10).nullable(), serviceDayId: z.uuid().nullable(), overbookReason: z.string().max(300).nullish(), notify: z.boolean() }))
    .mutation(({ ctx, input }) => rescheduleAppointment(ctx, { type: "staff", id: ctx.staff.id }, input)),
  addAppointment: officeProcedure
    .input(
      z.object({
        bookingId: z.uuid(),
        type: z.enum(["pickup", "delivery", "move", "service"]),
        date: isoDate,
        windowId: z.string().max(10).nullable(),
        serviceDayId: z.uuid().nullable(),
        overbookReason: z.string().max(300).nullish(),
        notes: z.string().max(500).nullish(),
      }),
    )
    .mutation(({ ctx, input }) => addAppointment(ctx, { type: "staff", id: ctx.staff.id }, input)),
  cancelAppointment: officeProcedure
    .input(z.object({ appointmentId: z.uuid(), reason: z.string().min(3).max(300) }))
    .mutation(({ ctx, input }) => cancelAppointment(ctx, { type: "staff", id: ctx.staff.id }, input.appointmentId, input.reason)),
  addService: officeProcedure
    .input(
      z.object({
        bookingId: z.uuid(),
        serviceId: z.uuid(),
        answers: z.record(z.string(), z.unknown()),
        reason: z.string().min(3).max(500),
        acceptanceRequired: z.boolean(),
        overbookReason: z.string().max(300).nullish(),
        notify: z.boolean(),
      }),
    )
    .mutation(({ ctx, input }) => addService(ctx, ctx.staff.id, input)),
  create: officeProcedure
    .input(z.object({ serviceIds: z.array(z.uuid()).min(1).max(10), answers: z.record(z.string(), z.unknown()), seasonId: z.uuid().nullish(), overbookReason: z.string().max(300).nullish(), notify: z.boolean() }))
    .mutation(({ ctx, input }) => createBookingByStaff(ctx, ctx.staff.id, input)),
  message: officeProcedure
    .input(z.object({ bookingId: z.uuid(), channel: z.enum(["sms", "email"]), subject: z.string().max(200).nullish(), body: z.string().min(1).max(2000), roles: z.array(z.string()).optional() }))
    .mutation(({ ctx, input }) => messageBooking(ctx, ctx.staff.id, input)),
  textPerson: officeProcedure
    .input(z.object({ personId: z.uuid(), bookingId: z.uuid().nullable(), body: z.string().min(1).max(600) }))
    .mutation(({ ctx, input }) => textPerson(ctx, ctx.staff.id, input)),
  labels: staffProcedure.input(z.object({ bookingId: z.uuid() })).query(({ ctx, input }) => labelsData(ctx, input.bookingId)),
});

const billingRouter = router({
  addLine: officeProcedure
    .input(
      z.object({
        bookingId: z.uuid(),
        bookingServiceId: z.uuid(),
        kind: z.enum(["charge", "discount", "adjustment"]),
        rateCardItemId: z.uuid().nullish(),
        description: z.string().max(200).nullish(),
        quantity: z.number().int().min(1).max(1000),
        unitPriceCents: cents.nullish(),
        reason: z.string().max(300).nullish(),
      }),
    )
    .mutation(({ ctx, input }) => addInvoiceLine(ctx, ctx.staff.id, input)),
  removeLine: officeProcedure.input(z.object({ lineId: z.uuid(), reason: z.string().min(3).max(300) })).mutation(({ ctx, input }) => removeDraftLine(ctx, ctx.staff.id, input.lineId, input.reason)),
  updateLine: officeProcedure
    .input(z.object({ lineId: z.uuid(), unitPriceCents: cents.optional(), quantity: z.number().int().min(1).optional() }))
    .mutation(({ ctx, input }) => updateDraftLine(ctx, ctx.staff.id, input.lineId, input)),
  waiveCardFee: officeProcedure.input(z.object({ invoiceId: z.uuid(), waive: z.boolean() })).mutation(({ ctx, input }) => setWaiveCardFee(ctx, ctx.staff.id, input.invoiceId, input.waive)),
  submit: officeProcedure.input(z.object({ invoiceId: z.uuid() })).mutation(({ ctx, input }) => submitForReview(ctx, ctx.staff.id, input.invoiceId)),
  approve: officeProcedure.input(z.object({ invoiceId: z.uuid() })).mutation(({ ctx, input }) => approveInvoice(ctx, ctx.staff.id, input.invoiceId)),
  charge: officeProcedure.input(z.object({ invoiceId: z.uuid() })).mutation(({ ctx, input }) => chargeBalanceNow(ctx, ctx.staff.id, input.invoiceId)),
  void: officeProcedure.input(z.object({ invoiceId: z.uuid(), reason: z.string().min(3).max(300) })).mutation(({ ctx, input }) => voidDraftInvoice(ctx, ctx.staff.id, input.invoiceId, input.reason)),
  refund: officeProcedure.input(z.object({ paymentId: z.uuid(), amountCents: cents, reason: z.string().min(3).max(300) })).mutation(({ ctx, input }) => {
    if (input.amountCents > REFUND_OWNER_THRESHOLD_CENTS && ctx.staff.role !== "owner") throw new TRPCError({ code: "FORBIDDEN", message: "Refunds over $100 need the owner" });
    return refundPayment(ctx, ctx.staff.id, input);
  }),
  writeOff: ownerProcedure.input(z.object({ bookingId: z.uuid(), reason: z.string().min(3).max(500) })).mutation(({ ctx, input }) => writeOff(ctx, ctx.staff.id, input)),
});

const crewsRouter = router({
  day: staffProcedure.input(z.object({ date: isoDate })).query(({ ctx, input }) => crewDay(ctx.db, input.date)),
  create: dispatcherProcedure.input(z.object({ date: isoDate, name: z.string().max(40).nullish(), vehicle: z.string().max(60).nullish() })).mutation(({ ctx, input }) => createCrew(ctx, ctx.staff.id, input)),
  update: dispatcherProcedure
    .input(z.object({ crewId: z.uuid(), name: z.string().min(1).max(40).optional(), vehicle: z.string().max(60).nullish(), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional() }))
    .mutation(({ ctx, input }) => updateCrew(ctx, ctx.staff.id, input.crewId, { name: input.name, vehicle: input.vehicle, color: input.color })),
  copy: dispatcherProcedure.input(z.object({ from: isoDate, to: isoDate })).mutation(({ ctx, input }) => copyCrews(ctx, ctx.staff.id, input.from, input.to)),
  setMember: dispatcherProcedure.input(z.object({ crewId: z.uuid(), employeeId: z.uuid(), role: z.string().max(40).nullable() })).mutation(({ ctx, input }) => setMember(ctx, ctx.staff.id, input)),
  assign: dispatcherProcedure
    .input(z.object({ crewId: z.uuid().nullable(), jobIds: z.array(z.uuid()).max(200), overrideHoldReason: z.string().max(300).nullish() }))
    .mutation(({ ctx, input }) => assignJobs(ctx, ctx.staff.id, input)),
  autoOrder: dispatcherProcedure.input(z.object({ crewId: z.uuid() })).mutation(({ ctx, input }) => autoOrder(ctx, ctx.staff.id, input.crewId)),
  publish: dispatcherProcedure.input(z.object({ date: isoDate })).mutation(({ ctx, input }) => publishDay(ctx, ctx.staff.id, input.date)),
  assignDevice: dispatcherProcedure.input(z.object({ deviceId: z.uuid(), crewId: z.uuid().nullable() })).mutation(({ ctx, input }) => assignDevice(ctx, ctx.staff.id, input.deviceId, input.crewId)),
  calendar: staffProcedure.input(z.object({ from: isoDate, to: isoDate, schoolId: z.uuid().nullish() })).query(({ ctx, input }) => calendar(ctx.db, input.from, input.to, input.schoolId)),
});

const configRouter = router({
  seasons: staffProcedure.query(({ ctx }) => config.listSeasons(ctx.db)),
  saveSeason: ownerProcedure
    .input(
      z.object({
        id: z.uuid().nullish(),
        name: z.string().min(2).max(60),
        kind: z.enum(["summer", "semester", "year_round"]),
        startsOn: isoDate,
        endsOn: isoDate,
        depositCents: cents,
        cardFeeBps: z.number().int().min(0).max(1000),
        leadDays: z.number().int().min(0).max(30),
        copyRateCardFrom: z.uuid().nullish(),
      }),
    )
    .mutation(({ ctx, input }) => config.saveSeason(ctx, ctx.staff.id, input)),
  schools: staffProcedure.query(({ ctx }) => config.listSchools(ctx.db)),
  saveSchool: ownerProcedure
    .input(
      z.object({
        id: z.uuid().nullish(),
        name: z.string().min(2).max(120),
        shortName: z.string().min(1).max(30),
        city: z.string().min(1).max(60),
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
        active: z.boolean(),
        allowsSpecialPickup: z.boolean(),
      }),
    )
    .mutation(({ ctx, input }) => config.saveSchool(ctx, ctx.staff.id, input)),
  saveResidence: ownerProcedure
    .input(
      z.object({
        id: z.uuid().nullish(),
        schoolId: z.uuid(),
        name: z.string().min(1).max(120),
        kind: z.enum(["dorm", "greek", "off_campus"]),
        address: z.string().min(1).max(200),
        lat: z.number(),
        lng: z.number(),
        active: z.boolean(),
      }),
    )
    .mutation(({ ctx, input }) => config.saveResidence(ctx, ctx.staff.id, input)),
  rateCard: staffProcedure.input(z.object({ seasonId: z.uuid() })).query(async ({ ctx, input }) => ({
    items: await config.rateCard(ctx.db, input.seasonId),
    suggestions: await config.rateCardSuggestions(ctx.db, input.seasonId),
  })),
  saveRateCardItem: ownerProcedure
    .input(
      z.object({
        id: z.uuid().nullish(),
        seasonId: z.uuid(),
        code: z.string().min(2).max(40),
        name: z.string().min(1).max(120),
        category: z.string().min(1).max(40),
        unit: z.enum(["each", "hour", "minute", "flat"]),
        unitPriceCents: cents,
        onContract: z.boolean(),
        active: z.boolean(),
      }),
    )
    .mutation(({ ctx, input }) => config.saveRateCardItem(ctx, ctx.staff.id, input)),
  services: staffProcedure.query(({ ctx }) => config.listServicesAdmin(ctx.db)),
  fieldLibrary: staffProcedure.query(({ ctx }) => config.fieldLibrary(ctx.db)),
  saveService: ownerProcedure
    .input(
      z.object({
        id: z.uuid().nullish(),
        code: z.string().min(2).max(40),
        name: z.string().min(2).max(120),
        description: z.string().max(1000).nullable(),
        family: z.string().max(40).nullable(),
        seasonId: z.uuid().nullable(),
        offeredFrom: z.date().nullable(),
        offeredUntil: z.date().nullable(),
        successorServiceId: z.uuid().nullable(),
        chargesDeposit: z.boolean(),
        baseRateCardCode: z.string().max(40).nullable(),
        instructions: z.string().max(1000).nullable(),
        staffOnly: z.boolean(),
        active: z.boolean(),
        schoolIds: z.array(z.uuid()),
      }),
    )
    .mutation(({ ctx, input }) => config.saveService(ctx, ctx.staff.id, input)),
  saveField: ownerProcedure
    .input(
      z.object({
        id: z.uuid().nullish(),
        serviceId: z.uuid(),
        key: z.string().max(40),
        type: z.string().max(30),
        label: z.string().min(1).max(200),
        help: z.string().max(500).nullable(),
        required: z.boolean(),
        config: z.record(z.string(), z.unknown()),
        showIf: z.object({ key: z.string(), equals: z.unknown() }).nullable(),
        active: z.boolean(),
      }),
    )
    .mutation(({ ctx, input }) => config.saveField(ctx, ctx.staff.id, input)),
  reorderFields: ownerProcedure.input(z.object({ serviceId: z.uuid(), fieldIds: z.array(z.uuid()) })).mutation(({ ctx, input }) => config.reorderFields(ctx, ctx.staff.id, input.serviceId, input.fieldIds)),
  capacity: staffProcedure
    .input(z.object({ seasonId: z.uuid(), schoolId: z.uuid(), type: z.enum(["pickup", "delivery"]) }))
    .query(({ ctx, input }) => capacityGrid(ctx.db, input)),
  generateDays: dispatcherProcedure
    .input(
      z.object({
        seasonId: z.uuid(),
        schoolIds: z.array(z.uuid()).min(1),
        type: z.enum(["pickup", "delivery"]),
        from: isoDate,
        to: isoDate,
        skipWeekdays: z.array(z.number().int().min(0).max(6)),
        windows: z.array(z.object({ campusScope: z.enum(["on", "off", "both"]), windowId: z.string().max(10).nullable(), capacity: z.number().int().min(0).max(500) })).min(1),
      }),
    )
    .mutation(({ ctx, input }) => config.generateServiceDays(ctx, ctx.staff.id, input)),
  updateDay: dispatcherProcedure
    .input(z.object({ id: z.uuid(), capacity: z.number().int().min(0).max(500).optional(), blocked: z.boolean().optional() }))
    .mutation(({ ctx, input }) => config.updateServiceDay(ctx, ctx.staff.id, input.id, input)),
  promotions: staffProcedure.query(({ ctx }) => config.listPromotions(ctx.db)),
  savePromotion: ownerProcedure
    .input(
      z.object({
        id: z.uuid().nullish(),
        code: z.string().min(3).max(30),
        description: z.string().min(2).max(200),
        amountCents: cents,
        seasonId: z.uuid().nullable(),
        validUntil: z.date().nullable(),
        maxUses: z.number().int().min(1).nullable(),
        active: z.boolean(),
      }),
    )
    .mutation(({ ctx, input }) => config.savePromotion(ctx, ctx.staff.id, input)),
  kb: staffProcedure.query(async ({ ctx }) => ({ articles: await config.listKb(ctx.db), suggestions: await config.faqSuggestions(ctx.db) })),
  saveKb: ownerProcedure
    .input(z.object({ id: z.uuid().nullish(), title: z.string().min(2).max(200), body: z.string().min(2).max(5000), public: z.boolean(), active: z.boolean() }))
    .mutation(({ ctx, input }) => config.saveKb(ctx, ctx.staff.id, input)),
  settings: staffProcedure.query(({ ctx }) => getSettings(ctx.db)),
  saveSettings: ownerProcedure.input(Settings.partial()).mutation(({ ctx, input }) => config.saveSettings(ctx, ctx.staff.id, input)),
  staff: ownerProcedure.query(({ ctx }) => config.listStaff(ctx.db)),
  saveStaff: ownerProcedure
    .input(
      z.object({
        id: z.uuid().nullish(),
        name: z.string().min(1).max(80),
        email: z.string().max(200),
        role: z.enum(config.STAFF_ROLES),
        active: z.boolean(),
        password: z.string().max(200).nullish(),
      }),
    )
    .mutation(({ ctx, input }) => config.saveStaff(ctx, ctx.staff.id, input)),
  employees: staffProcedure.query(({ ctx }) => config.listEmployees(ctx.db)),
  saveEmployee: dispatcherProcedure
    .input(z.object({ id: z.uuid().nullish(), firstName: z.string().min(1).max(60), lastName: z.string().max(60), phone: z.string().max(30), defaultRoles: z.array(z.string().max(40)), active: z.boolean() }))
    .mutation(({ ctx, input }) => config.saveEmployee(ctx, ctx.staff.id, input)),
  createDevice: ownerProcedure.input(z.object({ name: z.string().min(1).max(60) })).mutation(({ ctx, input }) => config.createDevice(ctx, ctx.staff.id, input.name)),
  revokeDevice: ownerProcedure.input(z.object({ deviceId: z.uuid() })).mutation(({ ctx, input }) => config.revokeDevice(ctx, ctx.staff.id, input.deviceId)),
  servicesAndCosts: staffProcedure.query(({ ctx }) => config.servicesAndCosts(ctx)),
});

const leadsRouter = router({
  list: staffProcedure.input(z.object({ includeAutomated: z.boolean(), includeWorked: z.boolean() })).query(({ ctx, input }) => hotLeads(ctx, input)),
  outcome: officeProcedure
    .input(z.object({ bookingId: z.uuid(), outcome: z.enum(["reached", "left_vm", "not_interested", "completed"]), note: z.string().max(2000).nullable() }))
    .mutation(({ ctx, input }) => recordOutreach(ctx, ctx.staff.id, input.bookingId, input.outcome, input.note)),
  email: officeProcedure
    .input(z.object({ bookingId: z.uuid(), subject: z.string().min(2).max(200), body: z.string().min(2).max(4000) }))
    .mutation(({ ctx, input }) => emailLead(ctx, ctx.staff.id, input.bookingId, input.subject, input.body)),
  text: officeProcedure.input(z.object({ bookingId: z.uuid(), body: z.string().min(2).max(500) })).mutation(({ ctx, input }) => textLead(ctx, ctx.staff.id, input.bookingId, input.body)),
  resumeLink: staffProcedure.input(z.object({ bookingId: z.uuid() })).query(({ ctx, input }) => resumeLink(ctx, input.bookingId)),
  funnel: staffProcedure.input(z.object({ from: isoDate, to: isoDate, schoolId: z.uuid().nullish() })).query(({ ctx, input }) => funnelReport(ctx.db, input)),
});

export const adminRouter = router({
  me: staffProcedure.query(({ ctx }) => ctx.staff),

  counts: staffProcedure.query(async ({ ctx }) => {
    const [review] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(schema.invoices).where(eq(schema.invoices.status, "pending_review"));
    const [escalated] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(schema.conversations).where(eq(schema.conversations.status, "escalated"));
    const [collections] = await ctx.db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.collectionsCases)
      .where(inArray(schema.collectionsCases.status, ["retrying", "collections"]));
    const [claims] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(schema.claims).where(inArray(schema.claims.status, ["submitted", "reviewing"]));
    const [leads] = await ctx.db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.bookings)
      .where(
        and(
          eq(schema.bookings.lifecycle, "draft"),
          inArray(schema.bookings.stepReached, ["review", "schedule", "details", "people"]),
          lte(schema.bookings.lastActivityAt, new Date(Date.now() - 2 * 3_600_000)),
          sql`${schema.bookings.outreachOutcome} is null`,
        ),
      );
    return { review: review?.n ?? 0, escalated: escalated?.n ?? 0, collections: collections?.n ?? 0, claims: claims?.n ?? 0, leads: leads?.n ?? 0 };
  }),

  /** Today at a glance. */
  dashboard: staffProcedure.query(async ({ ctx }) => {
    const today = localDate(ctx.config.timeZone);
    const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const rows = (await ctx.db.execute(sql`
      select
        (select count(*) from bookings where submitted_at >= ${weekAgo} and lifecycle <> 'cancelled')::int as signups_7d,
        (select count(*) from bookings where lifecycle = 'draft' and created_at >= ${weekAgo})::int as drafts_7d,
        (select count(*) from appointments a join bookings b on b.id = a.booking_id where a.date = ${today} and a.cancelled_at is null and b.lifecycle <> 'cancelled')::int as appts_today,
        (select count(*) from jobs j join appointments a on a.id = j.appointment_id where a.date = ${today} and j.status = 'completed')::int as done_today,
        (select coalesce(sum(case when kind = 'charge' then amount_cents else -amount_cents end), 0) from payments where status = 'succeeded' and created_at >= ${weekAgo})::int as revenue_7d,
        (select count(*) from messages where direction = 'inbound' and created_at >= ${weekAgo})::int as inbound_7d,
        (select count(*) from messages where author = 'ai' and purpose = 'ai_reply' and created_at >= ${weekAgo})::int as ai_answered_7d
    `)) as unknown as { signups_7d: number; drafts_7d: number; appts_today: number; done_today: number; revenue_7d: number; inbound_7d: number; ai_answered_7d: number }[];
    return { today, ...rows[0]! };
  }),

  invoices: router({
    reviewQueue: staffProcedure.query(({ ctx }) => reviewQueue(ctx)),
    updateLine: officeProcedure
      .input(z.object({ lineId: z.uuid(), unitPriceCents: z.number().int().min(0).optional(), quantity: z.number().int().min(1).optional() }))
      .mutation(({ ctx, input }) => updateDraftLine(ctx, ctx.staff.id, input.lineId, input)),
    approve: officeProcedure.input(z.object({ invoiceId: z.uuid() })).mutation(({ ctx, input }) => approveInvoice(ctx, ctx.staff.id, input.invoiceId)),
  }),

  collections: staffProcedure.query(({ ctx }) => collectionsList(ctx)),

  conversations: router({
    list: staffProcedure.input(z.object({ filter: z.enum(["escalated", "all"]) })).query(({ ctx, input }) => listConversations(ctx, input.filter)),
    get: staffProcedure.input(z.object({ id: z.uuid() })).query(({ ctx, input }) => getConversation(ctx, input.id)),
    reply: officeProcedure
      .input(z.object({ id: z.uuid(), body: z.string().min(1).max(1000), resolve: z.boolean() }))
      .mutation(({ ctx, input }) => staffReply(ctx, ctx.staff.id, input.id, input.body, input.resolve)),
    setStatus: officeProcedure
      .input(z.object({ id: z.uuid(), status: z.enum(["resolved", "escalated"]) }))
      .mutation(({ ctx, input }) => setConversationStatus(ctx, ctx.staff.id, input.id, input.status)),
    /** Demo only: pretend a customer texted us, for running the demo without Twilio. */
    simulateInbound: staffProcedure.input(z.object({ from: z.string().min(7), body: z.string().min(1).max(1000) })).mutation(async ({ ctx, input }) => {
      if (!ctx.config.demoMode) throw new TRPCError({ code: "FORBIDDEN" });
      return recordInboundSms(ctx, { from: input.from, body: input.body, providerId: null });
    }),
  }),

  /** A day's crews, stops, and live positions for the dispatch board. */
  dispatch: staffProcedure.input(z.object({ date: isoDate.optional() }).optional()).query(async ({ ctx, input }) => {
    const date = input?.date ?? localDate(ctx.config.timeZone);
    const day = await crewDay(ctx.db, date);
    const crews = [];
    for (const crew of day.crews) {
      crews.push({
        id: crew.id,
        name: crew.name,
        color: crew.color,
        location: await latestCrewLocation(ctx.db, crew.id),
        stops: crew.jobs.map((j) => ({
          jobId: j.jobId,
          sequence: j.sequence,
          status: j.status,
          window: windowLabel(j.windowId),
          address: j.address,
          lat: j.lat,
          lng: j.lng,
          confirmationNumber: j.confirmationNumber,
          name: j.name,
          bookingId: j.bookingId,
          onHold: j.onHold,
          trackingToken: j.trackingToken,
        })),
      });
    }
    return { date, crews, unassigned: day.unassigned.length };
  }),

  bookings: bookingsRouter,
  billing: billingRouter,
  crews: crewsRouter,
  config: configRouter,
  leads: leadsRouter,

  claims: router({
    list: staffProcedure.input(z.object({ status: z.enum(["open", "all"]) })).query(({ ctx, input }) => claimsQueue(ctx.db, input.status)),
    resolve: officeProcedure
      .input(z.object({ claimId: z.uuid(), outcome: z.enum(["refund", "credit", "payment", "denied"]), amountCents: cents.nullable(), paymentId: z.uuid().nullish(), note: z.string().min(3).max(2000) }))
      .mutation(({ ctx, input }) => {
        if (input.outcome === "refund" && (input.amountCents ?? 0) > REFUND_OWNER_THRESHOLD_CENTS && ctx.staff.role !== "owner")
          throw new TRPCError({ code: "FORBIDDEN", message: "Refunds over $100 need the owner" });
        return resolveClaim(ctx, ctx.staff.id, input);
      }),
    update: officeProcedure
      .input(z.object({ claimId: z.uuid(), status: z.literal("reviewing").optional(), urgent: z.boolean().optional() }))
      .mutation(({ ctx, input }) => setClaimStatus(ctx, ctx.staff.id, input.claimId, { status: input.status, urgent: input.urgent })),
  }),

  tips: router({
    period: staffProcedure.input(z.object({ from: isoDate, to: isoDate })).query(({ ctx, input }) => tipsForPeriod(ctx.db, input.from, input.to)),
    markPaid: ownerProcedure.input(z.object({ from: isoDate, to: isoDate })).mutation(({ ctx, input }) => markTipsPaid(ctx, ctx.staff.id, input.from, input.to)),
  }),

  reports: router({
    kinds: staffProcedure.query(() => Object.entries(REPORTS).map(([kind, def]) => ({ kind: kind as ReportKind, label: def.label, groups: [...def.groups] as string[] }))),
    run: staffProcedure
      .input(
        z.object({
          kind: z.enum(Object.keys(REPORTS) as [ReportKind, ...ReportKind[]]),
          from: isoDate,
          to: isoDate,
          groupBy: z.string().max(30),
          schoolId: z.uuid().nullish(),
          compareLastYear: z.boolean().optional(),
        }),
      )
      .query(({ ctx, input }) => runReport(ctx.db, input)),
  }),

  /** Warehouse: bookings with things on the shelf, and delivery pick lists by day. */
  warehouse: router({
    inStorage: staffProcedure.input(z.object({ q: z.string().max(100).optional(), seasonId: z.uuid().nullish() })).query(async ({ ctx, input }) => {
      const picked = await listBookings(ctx.db, { q: input.q, seasonId: input.seasonId, lifecycle: "picked_up", limit: 200 });
      const stored = await listBookings(ctx.db, { q: input.q, seasonId: input.seasonId, lifecycle: "in_storage", limit: 200 });
      const scheduled = await listBookings(ctx.db, { q: input.q, seasonId: input.seasonId, lifecycle: "delivery_scheduled", limit: 200 });
      return [...picked.rows, ...stored.rows, ...scheduled.rows];
    }),
    pickList: staffProcedure.input(z.object({ date: isoDate })).query(async ({ ctx, input }) => {
      const day = await crewDay(ctx.db, input.date);
      const deliveries = [...day.crews.flatMap((c) => c.jobs.map((j) => ({ ...j, crew: c.name }))), ...day.unassigned.map((j) => ({ ...j, crew: null as string | null }))].filter(
        (j) => j.type === "delivery",
      );
      const out = [];
      for (const d of deliveries) {
        const [b] = await ctx.db.select().from(schema.bookings).where(eq(schema.bookings.id, d.bookingId));
        const items = await ctx.db
          .select({ item: schema.items, rate: schema.rateCardItems })
          .from(schema.items)
          .leftJoin(schema.rateCardItems, eq(schema.items.rateCardItemId, schema.rateCardItems.id))
          .where(eq(schema.items.bookingId, d.bookingId));
        out.push({
          ...d,
          storageLocation: b?.storageLocation ?? null,
          items: items.map(({ item, rate }) => ({ name: rate?.name ?? item.description ?? "Other", quantity: item.quantity, status: item.status })),
        });
      }
      return out.sort((a, b) => (a.crew ?? "zz").localeCompare(b.crew ?? "zz") || (a.sequence ?? 0) - (b.sequence ?? 0));
    }),
  }),
});
