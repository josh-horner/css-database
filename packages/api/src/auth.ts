/**
 * Minimal auth for the demo slice: HMAC-signed staff session cookies and crew device bearer tokens.
 * ADR-0003 (Better Auth) replaces the staff/customer side when the portal signup lands.
 */
import { createHash, createHmac, scryptSync, timingSafeEqual } from "node:crypto";
import { eq, schema, type Db } from "@css/db";

export const SESSION_COOKIE = "css_staff";
const SESSION_DAYS = 14;

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split(":");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createSessionToken(staffId: string, secret: string, now = Date.now()): string {
  const payload = `${staffId}.${now + SESSION_DAYS * 86_400_000}`;
  return `${payload}.${sign(payload, secret)}`;
}

export function readSessionToken(token: string | undefined, secret: string, now = Date.now()): string | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [staffId, exp, sig] = parts as [string, string, string];
  const expected = sign(`${staffId}.${exp}`, secret);
  if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  if (Number(exp) < now) return null;
  return staffId;
}

export const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

export async function deviceFromToken(db: Db, bearer: string | undefined) {
  if (!bearer) return null;
  const [device] = await db.select().from(schema.devices).where(eq(schema.devices.tokenHash, sha256(bearer))).limit(1);
  if (!device) return null;
  await db.update(schema.devices).set({ lastSeenAt: new Date() }).where(eq(schema.devices.id, device.id));
  return device;
}

/** Signed, opaque tokens for customer links (pay links). */
export function signedLinkToken(kind: string, id: string, secret: string): string {
  return `${id}.${sign(`${kind}:${id}`, secret).slice(0, 22)}`;
}

export function readSignedLinkToken(kind: string, token: string | undefined, secret: string): string | null {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot < 1) return null;
  const id = token.slice(0, dot);
  const expected = signedLinkToken(kind, id, secret);
  if (expected.length !== token.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(token))) return null;
  return id;
}
