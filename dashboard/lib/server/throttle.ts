import { db, THROTTLE } from './db';

/**
 * Shopify throttles per client IP across ALL its stores: after one store
 * answers 429, the next store's read would almost certainly be refused too.
 * So a 429 pauses every Shopify read until its Retry-After passes. Kept in the
 * database because function instances don't share memory.
 */

const DEFAULT_COOLDOWN_MS = 60_000;
const MAX_COOLDOWN_MS = 60 * 60_000;

interface ThrottleDoc {
  _id: string;
  until: Date;
}

const coll = () => db().collection<ThrottleDoc>(THROTTLE);

/** Milliseconds left on the Shopify pause (0 = none). Never throws. */
export async function shopifyCooldownMs(): Promise<number> {
  try {
    const doc = await coll().findOne({ _id: 'shopify' });
    return doc ? Math.max(0, doc.until.getTime() - Date.now()) : 0;
  } catch {
    return 0;
  }
}

/** Pause Shopify reads for `retryAfterMs` (default 60s, at most 1h). Never shortens a pause. */
export async function startShopifyCooldown(retryAfterMs: number | null): Promise<void> {
  const ms = Math.min(MAX_COOLDOWN_MS, Math.max(DEFAULT_COOLDOWN_MS, retryAfterMs ?? 0));
  const until = new Date(Date.now() + ms);
  await coll()
    .updateOne({ _id: 'shopify' }, [{ $set: { until: { $max: [{ $ifNull: ['$until', until] }, until] } } }], { upsert: true })
    .catch(err => console.warn('[throttle] could not record cooldown:', err));
}
