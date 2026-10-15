import type { Db } from "@css/db";
import type { Integrations } from "@css/integrations";
import type { AppConfig } from "./config";

export interface Services {
  db: Db;
  integrations: Integrations;
  config: AppConfig;
  /** Queue work for apps/worker (pg-boss). */
  enqueue: (name: string, data: Record<string, unknown>) => Promise<void>;
}

export interface CustomerSession {
  sessionId: string;
  kind: "email" | "phone";
  value: string;
}

/** Cookies the API sets on the web apps (same-origin through Next rewrites). */
export interface CookieJar {
  get(name: string): string | undefined;
  set(name: string, value: string, maxAgeSeconds: number): void;
  clear(name: string): void;
}

export interface Context extends Services {
  staff: { id: string; name: string; role: string } | null;
  device: { id: string; crewId: string | null } | null;
  customer: CustomerSession | null;
  cookies: CookieJar;
  request: { ip: string | null; userAgent: string | null };
}
