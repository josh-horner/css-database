/**
 * HTTP entry point: tRPC for all apps, staff login, crew photo uploads, and provider webhooks.
 * Web apps reach this through same-origin rewrites (/trpc, /auth, /photos), so cookies stay first-party.
 */
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { serve } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { accessibleBookings, appRouter, auth, createServices, CUSTOMER_COOKIE, deviceCrewForToday, recordInboundSms, sessionFromToken, type Context } from "@css/api";
import { eq, schema } from "@css/db";
import { verifyTwilioSignature } from "@css/integrations";

const repoRoot = resolve(import.meta.dirname, "../../..");
const services = await createServices(repoRoot);
const { db, config, integrations } = services;
const app = new Hono();

async function staffFromCookie(cookie: string | undefined) {
  const staffId = auth.readSessionToken(cookie, config.appSecret);
  if (!staffId) return null;
  const [staff] = await db.select().from(schema.staffUsers).where(eq(schema.staffUsers.id, staffId)).limit(1);
  return staff?.active ? { id: staff.id, name: staff.name, role: staff.role } : null;
}

async function deviceFromHeader(header: string | undefined) {
  const bearer = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  const device = await auth.deviceFromToken(db, bearer);
  if (!device) return null;
  const assignment = await deviceCrewForToday(services, device);
  return { id: device.id, crewId: assignment?.crewId ?? null };
}

app.get("/health", (c) => c.json({ ok: true }));

const secureCookies = config.portalUrl.startsWith("https");

app.all("/trpc/*", async (c) => {
  const staff = await staffFromCookie(getCookie(c, auth.SESSION_COOKIE));
  const device = await deviceFromHeader(c.req.header("authorization"));
  const customer = await sessionFromToken(db, getCookie(c, CUSTOMER_COOKIE));
  const written = new Map<string, string | null>();
  return fetchRequestHandler({
    endpoint: "/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext: ({ resHeaders }): Context => ({
      ...services,
      staff,
      device,
      customer,
      request: { ip: c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? null, userAgent: c.req.header("user-agent") ?? null },
      cookies: {
        // Cookies set during this request are visible to later reads in the same request.
        get: (name) => (written.has(name) ? (written.get(name) ?? undefined) : getCookie(c, name)),
        set: (name, value, maxAge) => {
          written.set(name, value);
          resHeaders.append("set-cookie", `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secureCookies ? "; Secure" : ""}`);
        },
        clear: (name) => {
          written.set(name, null);
          resHeaders.append("set-cookie", `${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secureCookies ? "; Secure" : ""}`);
        },
      },
    }),
    onError: ({ error, path }) => {
      if (error.code === "INTERNAL_SERVER_ERROR") console.error(`[trpc] ${path}:`, error.cause ?? error);
    },
  });
});

app.post("/auth/staff/login", async (c) => {
  const body = await c.req.json<{ email?: string; password?: string }>().catch(() => ({}) as { email?: string; password?: string });
  const email = body.email?.trim().toLowerCase() ?? "";
  const [staff] = await db.select().from(schema.staffUsers).where(eq(schema.staffUsers.email, email)).limit(1);
  if (!staff || !auth.verifyPassword(body.password ?? "", staff.passwordHash)) return c.json({ error: "Wrong email or password" }, 401);
  setCookie(c, auth.SESSION_COOKIE, auth.createSessionToken(staff.id, config.appSecret), {
    httpOnly: true,
    sameSite: "Lax",
    secure: config.adminUrl.startsWith("https"),
    path: "/",
    maxAge: 14 * 86400,
  });
  return c.json({ ok: true, name: staff.name });
});

app.post("/auth/staff/logout", (c) => {
  deleteCookie(c, auth.SESSION_COOKIE, { path: "/" });
  return c.json({ ok: true });
});

/** Crew tablet uploads a photo (item, room, delivery, signature). Idempotent by clientId. */
app.post("/crew/photos", async (c) => {
  const device = await deviceFromHeader(c.req.header("authorization"));
  if (!device?.crewId) return c.json({ error: "unauthorized" }, 401);
  const form = await c.req.formData();
  const file = form.get("file");
  const jobId = String(form.get("jobId") ?? "");
  const kind = String(form.get("kind") ?? "item") as (typeof schema.photoKind.enumValues)[number];
  const clientId = String(form.get("clientId") ?? randomUUID());
  const itemClientId = form.get("itemClientId") ? String(form.get("itemClientId")) : null;
  if (!(file instanceof File) || !schema.photoKind.enumValues.includes(kind)) return c.json({ error: "bad request" }, 400);
  if (file.size > 15 * 1024 * 1024) return c.json({ error: "photo too large" }, 413);

  const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId)).limit(1);
  if (!job || job.crewId !== device.crewId) return c.json({ error: "not your stop" }, 403);
  const [existing] = await db.select().from(schema.photos).where(eq(schema.photos.clientId, clientId)).limit(1);
  if (existing) return c.json({ id: existing.id });

  let itemId: string | null = null;
  if (itemClientId) {
    const [item] = await db.select().from(schema.items).where(eq(schema.items.clientId, itemClientId)).limit(1);
    if (!item || item.jobId !== jobId) return c.json({ error: "item not on this stop" }, 400);
    itemId = item.id;
  }
  const contentType = file.type || "image/jpeg";
  const key = `jobs/${jobId}/${clientId}.${contentType === "image/png" ? "png" : "jpg"}`;
  await integrations.files.put(key, new Uint8Array(await file.arrayBuffer()), contentType);
  const [photo] = await db
    .insert(schema.photos)
    .values({ jobId, itemId, kind, storageKey: key, contentType, takenAt: new Date(), clientId })
    .returning();
  return c.json({ id: photo!.id });
});

/** Photos for staff, the crew device, and customers with access to the booking (shared on purpose: it discourages false claims). */
app.get("/photos/:id", async (c) => {
  const staff = await staffFromCookie(getCookie(c, auth.SESSION_COOKIE));
  const device = staff ? null : await deviceFromHeader(c.req.header("authorization"));
  const customer = staff || device ? null : await sessionFromToken(db, getCookie(c, CUSTOMER_COOKIE));
  if (!staff && !device && !customer) return c.text("unauthorized", 401);
  const [photo] = await db.select().from(schema.photos).where(eq(schema.photos.id, c.req.param("id"))).limit(1);
  if (!photo) return c.text("not found", 404);
  if (customer) {
    const [row] = await db
      .select({ bookingId: schema.appointments.bookingId })
      .from(schema.jobs)
      .innerJoin(schema.appointments, eq(schema.jobs.appointmentId, schema.appointments.id))
      .where(eq(schema.jobs.id, photo.jobId));
    const access = await accessibleBookings(db, customer);
    if (!row || !access.some((a) => a.bookingId === row.bookingId)) return c.text("not found", 404);
  }
  const bytes = await integrations.files.get(photo.storageKey);
  if (!bytes) return c.text("not found", 404);
  return c.body(bytes as Uint8Array<ArrayBuffer>, 200, { "content-type": photo.contentType, "cache-control": "private, max-age=86400" });
});

/** Customer photo upload for claims. Returns a storage key the claim form submits. */
app.post("/portal/uploads", async (c) => {
  const customer = await sessionFromToken(db, getCookie(c, CUSTOMER_COOKIE));
  if (!customer) return c.json({ error: "Sign in first" }, 401);
  const form = await c.req.formData();
  const file = form.get("file");
  const bookingId = String(form.get("bookingId") ?? "");
  if (!(file instanceof File) || !file.type.startsWith("image/")) return c.json({ error: "Photos only" }, 400);
  if (file.size > 15 * 1024 * 1024) return c.json({ error: "Photo too large" }, 413);
  const access = await accessibleBookings(db, customer);
  if (!access.some((a) => a.bookingId === bookingId)) return c.json({ error: "not found" }, 404);
  const key = `claims/${bookingId}/${randomUUID()}.${file.type === "image/png" ? "png" : "jpg"}`;
  await integrations.files.put(key, new Uint8Array(await file.arrayBuffer()), file.type);
  return c.json({ key });
});

/** Customer-uploaded claim photos, for staff. */
app.get("/claim-photos/:claimId/:index", async (c) => {
  const staff = await staffFromCookie(getCookie(c, auth.SESSION_COOKIE));
  if (!staff) return c.text("unauthorized", 401);
  const [claim] = await db.select().from(schema.claims).where(eq(schema.claims.id, c.req.param("claimId"))).limit(1);
  const key = claim?.customerPhotoKeys[Number(c.req.param("index"))];
  if (!key) return c.text("not found", 404);
  const bytes = await integrations.files.get(key);
  if (!bytes) return c.text("not found", 404);
  return c.body(bytes as Uint8Array<ArrayBuffer>, 200, { "content-type": key.endsWith(".png") ? "image/png" : "image/jpeg", "cache-control": "private, max-age=86400" });
});

/** Twilio inbound SMS. Signature-checked when Twilio is configured. */
app.post("/webhooks/twilio/sms", async (c) => {
  const form = await c.req.parseBody();
  const params = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, String(v)]));
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (token) {
    const url = `${config.apiUrl}/webhooks/twilio/sms`;
    if (!verifyTwilioSignature(token, c.req.header("x-twilio-signature") ?? "", url, params)) return c.text("invalid signature", 403);
  }
  if (params.From && params.Body) await recordInboundSms(services, { from: params.From, body: params.Body, providerId: params.MessageSid ?? null });
  return c.body("<Response></Response>", 200, { "content-type": "text/xml" });
});

const port = Number(new URL(config.apiUrl).port || 4100);
serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, () => console.log(`api listening on :${port}`));

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await services.close();
    process.exit(0);
  });
}
