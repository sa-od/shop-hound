/**
 * When a store refuses us for now (429/403, a bot check), the run is retried
 * after these delays — or later, if the store's Retry-After asks for longer —
 * before it finishes with the store unverified. Attempts = delays + 1.
 *
 * Waiting runs start when something drains the queue: an add, a status poll
 * while the page is open, or the hourly drain cron (Hobby: each cron job runs
 * at most daily and anywhere within its hour, so a retry can start up to
 * ~1h after its retryAt when nobody is watching).
 */
export const RETRY_DELAYS_MS = [15 * 60_000, 60 * 60_000];

/** Total tries for a store that refuses us for now (shown in the queue). */
export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;

/** Should a blocked run be retried after this attempt (1-based)? Off on the final attempt. */
export const hasRetriesLeft = (attempt: number): boolean => attempt <= RETRY_DELAYS_MS.length;

/** How long to wait before retrying after `attempt`, or null when it was the final one. */
export function retryDelayMs(attempt: number, retryAfterMs: number | null): number | null {
  if (!hasRetriesLeft(attempt)) return null;
  return Math.max(RETRY_DELAYS_MS[Math.max(0, attempt - 1)], retryAfterMs ?? 0);
}
