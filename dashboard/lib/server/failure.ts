/**
 * Whose fault a failed run is — which decides what happens next.
 *
 *  - 'ours':  our credentials, quota or billing, our database, our model or
 *             API calls, a bug, our time limit. The store did nothing wrong:
 *             the run is put back (it never uses up the store's retry
 *             attempts) and the queue pauses briefly. Only these get a banner.
 *  - 'store': the store refused us, can't be read, or isn't a store. Shown
 *             on the store's row with what to do.
 *
 * Store-side problems mostly never reach here as errors: the pipeline records
 * an unreadable store in its brief, and a refusal is retried (RunBlockedError).
 * So an error that doesn't look like the store's is treated as ours.
 */
export type FailureKind = 'ours' | 'store';

/** Thrown when one of our services couldn't do its part (a guardrail check, the model, the database). */
export class OurSideError extends Error {
  readonly failureKind = 'ours' as const;
}

const STORE = [
  /\bnot a (?:shopify )?store\b/i,
  /\bno (?:readable |public )?catalog(?:ue)?\b/i,
  /\b(?:store|site|server) (?:refused|blocked|is limiting|asked us to wait)\b/i,
  /\blimiting automated requests\b/i,
  /\bbot (?:check|protection|challenge)\b/i,
  /\bcould(?:n['’]t| not) be read\b/i,
  /\b(?:domain|address|site) (?:does not exist|doesn['’]t exist|not found)\b/i,
  /\bENOTFOUND (?!api\.openai|.*mongodb|.*firecrawl)/i,
  /\bprivate address\b/i,
];

const OURS = [
  /\b(?:api[_ ]?key|token|credential)s?\b/i,
  /not from a valid issuer/i,
  /\b(?:401|unauthori[sz]ed|invalid_api_key|insufficient_quota|quota|billing|payment required|402)\b/i,
  /\bOPENAI_|\bMONGODB_|\bFIRECRAWL_API_KEY\b/i,
  /\bMongo(?:Server|Network|ServerSelection|Topology)?Error\b/i,
  /\bAI_(?:APICall|RetryError|NoObjectGenerated|TypeValidation)/i,
  /\bcould not run\b/i,
  /\bfunction time limit\b/i,
];

/**
 * Classify a failure from its error (or its stored message). Pure.
 * Our-side signals win: a store page that 401s our model key is still ours.
 */
export function classifyFailure(err: unknown): FailureKind {
  if (err instanceof OurSideError) return 'ours';
  const text = err instanceof Error ? `${err.name}: ${err.message}` : String(err ?? '');
  if (OURS.some(re => re.test(text))) return 'ours';
  if (STORE.some(re => re.test(text))) return 'store';
  return 'ours';
}

/** How long the queue pauses after the n-th our-side failure in a row (1-based): 10 min, doubling, at most 6 h. */
export function ourFailureDelayMs(n: number): number {
  return Math.min(10 * 60_000 * 2 ** Math.max(0, n - 1), 6 * 60 * 60_000);
}

/** After this many our-side failures in a row, the run is recorded as failed (ours) instead of put back. */
export const MAX_OUR_FAILURES = 8;
