/**
 * Declined-payment follow-up (docs/domain-model.md#billing-timing-and-collections).
 * On a decline: email (and SMS only with consent) with a pay-or-update-card link, retry on a schedule,
 * then hand the booking to the owner's Collections list.
 */
export const DEFAULT_RETRY_DAYS = [0, 3, 7] as const;

export type CollectionsStep =
  | { action: "retry_and_remind"; attempt: number; at: Date }
  | { action: "move_to_collections" };

/**
 * `failedAttempts` = failed charges so far for this invoice (the first decline counts as attempt 1, day 0).
 * Returns the next step relative to the first decline.
 */
export function nextCollectionsStep(
  firstDeclineAt: Date,
  failedAttempts: number,
  retryDays: readonly number[] = DEFAULT_RETRY_DAYS,
): CollectionsStep {
  if (failedAttempts < 1) throw new Error("no decline to follow up");
  if (failedAttempts >= retryDays.length) return { action: "move_to_collections" };
  const day = retryDays[failedAttempts]!;
  return { action: "retry_and_remind", attempt: failedAttempts + 1, at: new Date(firstDeclineAt.getTime() + day * 86_400_000) };
}
