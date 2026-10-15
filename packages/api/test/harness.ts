/**
 * Test harness: a fresh Postgres database per test file (docker compose `db`), fake providers that record what
 * they send, and tRPC callers for crew, staff, and customer browsers (with a cookie jar).
 */
import postgres from "postgres";
import { createDb, runMigrations, schema, seed, type Db } from "@css/db";
import { createFakeAssistant, createFakeGateway, createLocalFileStore, type EmailProvider, type SmsProvider } from "@css/integrations";
import { appRouter } from "../src/root";
import type { Context, CookieJar, Services } from "../src/context";
import { CUSTOMER_COOKIE, sessionFromToken } from "../src/services/customer-auth";

export interface Harness {
  db: Db;
  services: Services;
  sent: { to: string; body: string }[];
  emails: { to: string; subject: string; text: string }[];
  queued: { name: string; data: Record<string, unknown> }[];
  crew: () => Promise<ReturnType<typeof appRouter.createCaller>>;
  staff: (email?: string) => Promise<ReturnType<typeof appRouter.createCaller>>;
  browser: () => Browser;
  close: () => Promise<void>;
}

export interface Browser {
  jar: Map<string, string>;
  call: () => Promise<ReturnType<typeof appRouter.createCaller>>;
}

export async function createHarness(dbName: string, opts: { minimal?: boolean } = {}): Promise<Harness> {
  const base = process.env.TEST_DATABASE_URL ?? "postgres://css:css@localhost:5544/css_test";
  const url = base.replace(/\/[^/]+$/, `/${dbName}`);
  const admin = postgres(base.replace(/\/[^/]+$/, "/css_dev"), { max: 1, onnotice: () => {} });
  const exists = await admin`select 1 from pg_database where datname = ${dbName}`;
  if (!exists.length) await admin.unsafe(`create database ${dbName}`);
  await admin.end();

  const db = createDb(url);
  await db.$sql`drop schema if exists public cascade`;
  await db.$sql`drop schema if exists drizzle cascade`;
  await db.$sql`create schema public`;
  await runMigrations(db);
  const payments = createFakeGateway();
  await seed(db, { payments, log: () => {}, minimal: opts.minimal ?? true });

  const sent: Harness["sent"] = [];
  const emails: Harness["emails"] = [];
  const queued: Harness["queued"] = [];
  const sms: SmsProvider = {
    name: "test",
    fromNumber: "+15555550100",
    async send(to, body) {
      sent.push({ to, body });
      return { provider: "test", providerId: null, status: "sent" };
    },
  };
  const email: EmailProvider = {
    name: "test",
    async send(msg) {
      emails.push({ to: msg.to, subject: msg.subject, text: msg.text });
      return { provider: "test", providerId: null, status: "sent" };
    },
  };
  const services: Services = {
    db,
    config: { apiUrl: "http://api.test", portalUrl: "http://portal.test", adminUrl: "http://admin.test", appSecret: "x".repeat(32), demoMode: true, timeZone: "America/Denver", stripePublishableKey: "" },
    integrations: { payments, sms, email, assistant: createFakeAssistant(), files: createLocalFileStore("/tmp/css-test-uploads") },
    enqueue: async (name, data) => {
      queued.push({ name, data });
    },
  };
  const noCookies: CookieJar = { get: () => undefined, set: () => {}, clear: () => {} };
  const base0 = { ...services, customer: null, cookies: noCookies, request: { ip: "127.0.0.1", userAgent: "vitest" } };

  return {
    db,
    services,
    sent,
    emails,
    queued,
    async crew() {
      const [device] = await db.select().from(schema.devices).limit(1);
      const ctx: Context = { ...base0, staff: null, device: { id: device!.id, crewId: device!.assignedCrewId } };
      return appRouter.createCaller(ctx);
    },
    async staff(emailAddr = "owner@example.com") {
      const rows = await db.select().from(schema.staffUsers);
      const staff = rows.find((r) => r.email === emailAddr)!;
      const ctx: Context = { ...base0, staff: { id: staff.id, name: staff.name, role: staff.role }, device: null };
      return appRouter.createCaller(ctx);
    },
    browser() {
      const jar = new Map<string, string>();
      return {
        jar,
        async call() {
          const cookies: CookieJar = { get: (n) => jar.get(n), set: (n, v) => void jar.set(n, v), clear: (n) => void jar.delete(n) };
          const customer = await sessionFromToken(db, jar.get(CUSTOMER_COOKIE));
          const ctx: Context = { ...base0, staff: null, device: null, customer, cookies };
          return appRouter.createCaller(ctx);
        },
      };
    },
    close: async () => {
      await db.$sql.end();
    },
  };
}
