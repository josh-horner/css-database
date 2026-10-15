/**
 * Owner settings with defaults. Stored as JSON rows (`settings` table); anything missing falls back here,
 * so adding a setting never needs a data migration.
 */
import { z } from "zod";

export const Settings = z.object({
  /** Pre-filled amount in each crew member's tip box. */
  tipDefaultCents: z.number().int().min(0).default(1000),
  /** Claims can be filed this many days after delivery. */
  claimWindowDays: z.number().int().min(1).default(7),
  /** Drafts idle this long are "abandoned": early steps / people+ steps. */
  abandonAfterHoursEarly: z.number().min(1).default(24),
  abandonAfterHoursLate: z.number().min(1).default(2),
  /** Send the one "finish your signup" reminder. */
  abandonmentEmail: z.boolean().default(true),
  /** Referral rewards (legacy rules, now config). */
  referralParentRewardCents: z.number().int().min(0).default(2500),
  referralStudentRefereeCents: z.number().int().min(0).default(1000),
  referralStudentReferrerCents: z.number().int().min(0).default(2500),
  /** AI replies sent without review for these intents (graduated autonomy). */
  aiAutoSendIntents: z.array(z.string()).default(["where_when", "packing_supplies"]),
  aiAutoSendMinConfidence: z.number().min(0).max(1).default(0.75),
  /** Owner-defined crew roles. */
  crewRoles: z.array(z.string().min(1)).default(["lead", "driver", "mover", "warehouse"]),
  /** Shown on the confirmation and in emails. */
  companyPhone: z.string().default("(303) 555-0100"),
  companyEmail: z.string().default("info@example.com"),
  /** Referral share text; {link} is replaced. */
  referralShareText: z
    .string()
    .default("I'm using College Student Storage for summer storage. Sign up with my link and we both save: {link}"),
});
export type Settings = z.infer<typeof Settings>;

export const DEFAULT_SETTINGS: Settings = Settings.parse({});

export function resolveSettings(rows: readonly { key: string; value: unknown }[]): Settings {
  const raw: Record<string, unknown> = {};
  for (const row of rows) raw[row.key] = row.value;
  const parsed = Settings.safeParse(raw);
  if (parsed.success) return parsed.data;
  // A bad stored value falls back per key rather than breaking the app.
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const [key, value] of Object.entries(raw)) {
    const one = Settings.shape[key as keyof Settings]?.safeParse(value);
    if (one?.success) out[key] = one.data;
  }
  return out as Settings;
}
