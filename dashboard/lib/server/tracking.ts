import { db, RUNS, BRIEFS, SNAPSHOTS } from './db';
import { INJECTION_DEMO_DOMAIN, normalizeDomain } from './scraper';
import type { WatchEntry } from './watchlist';

/**
 * Automatic tracking (the watchlist). Every store a user adds from the
 * dashboard is WATCHED INDEFINITELY — re-checked about weekly, so they get a
 * "what changed" feed without doing anything — until they pause or remove it.
 * What is watched is derived from dashboard runs; the user's choices live in
 * watchlist.ts.
 *
 * - A watched set is DUE when its latest brief is RECHECK_DAYS old (or it has
 *   none yet). The cron runs daily and works through due sets, oldest first.
 * - COMPETITOR_STORES, when set, is one extra set, watched the same way.
 * - Only stores that were scraped successfully at least once are tracked: a
 *   fake, dead or non-store site gets one brief explaining why, never a
 *   weekly bill. Exception — FIRST READ PENDING: a store that refused us for
 *   now (rate limit / block) on its last run stays tracked and is retried
 *   daily (PENDING_RECHECK_DAYS) instead of weekly, until a read succeeds or
 *   tracking ends.
 * - The watchlist (watchlist.ts) adjusts this per store: a PAUSED set stays
 *   listed but is never due; a REMOVED set is not watched at all.
 * - No cap on watched stores; the queue's MAX_QUEUED bounds a single day, and
 *   due stores that don't fit carry over to the next day.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export const RECHECK_DAYS = 7;
export const PENDING_RECHECK_DAYS = 1;

export interface TrackedSet {
  competitorKey: string;
  competitors: string[];
  /** 'user' = from dashboard runs; 'default' = COMPETITOR_STORES. */
  origin: 'user' | 'default';
  /** When a user last ran this set from the dashboard (null for the default set). */
  lastUserRunAt: string | null;
  /** The set's latest brief, from any trigger (null = none yet). */
  lastBriefAt: string | null;
  /** When the set is next due (approximate: a busy day pushes it to the next). */
  nextCheck: string;
  due: boolean;
  /** Never read yet because the store refused us for now; retried daily. */
  firstReadPending: boolean;
  /** Paused by the user: tracked, but the daily check skips it. */
  paused?: boolean;
}

export interface TrackingStatus {
  /** Watched: re-checked about weekly until paused or removed. false = can't be read (never scraped), or never added. */
  tracked: boolean;
  /** Next automatic check, "on or after" (null: paused or not watched). */
  nextCheck: string | null;
  /** Tracked, but never read yet: the store refused us for now. nextCheck is the next try. */
  firstReadPending?: boolean;
  /** Paused by the user: no automatic checks until resumed (nextCheck is null). */
  paused?: boolean;
}

/** How a store row reads: watched, paused by the user, or not watched (it can't be read — never by time). */
export type Watching = 'active' | 'paused' | 'ended';

export const watchingOf = (t: TrackingStatus): Watching => (!t.tracked ? 'ended' : t.paused ? 'paused' : 'active');

/** Canonical key for a store set — the same one briefs are stored under. */
export function competitorKeyOf(competitors: string[]): string {
  return [...new Set(competitors.map(c => c.trim().toLowerCase()).filter(Boolean))].sort().join(',');
}

// ── Pure core (unit-tested in tracking.test.ts) ──────────────────────────────

export interface UserRunFact {
  competitorKey: string;
  competitors: string[];
  lastUserRunAt: Date;
}

/**
 * Decide which sets are tracked and due. Pure: all inputs passed in.
 * `userRuns` = one entry per set: its most recent successful dashboard run.
 * `lastBriefAt` = latest brief time per competitorKey.
 */
export function computeTrackedSets(args: {
  userRuns: UserRunFact[];
  lastBriefAt: Map<string, Date>;
  /** Stores with at least one full-catalogue snapshot; omitted = don't filter. */
  scrapedStores?: Set<string>;
  /** Never-read sets whose last run was refused for now (still worth retrying). */
  pendingKeys?: Set<string>;
  /** Per-key user choices: paused / removed. */
  watch?: Map<string, WatchEntry>;
  defaultCompetitors: string[];
  now: Date;
  recheckDays?: number;
}): TrackedSet[] {
  const { now } = args;
  const recheckMs = (args.recheckDays ?? RECHECK_DAYS) * DAY_MS;

  const entry = (
    competitorKey: string,
    competitors: string[],
    origin: TrackedSet['origin'],
    lastUserRunAt: Date | null,
    firstReadPending = false,
  ): TrackedSet => {
    const lastBrief = args.lastBriefAt.get(competitorKey) ?? null;
    const interval = firstReadPending ? PENDING_RECHECK_DAYS * DAY_MS : recheckMs;
    const next = lastBrief ? new Date(lastBrief.getTime() + interval) : now;
    return {
      competitorKey,
      competitors,
      origin,
      lastUserRunAt: lastUserRunAt?.toISOString() ?? null,
      lastBriefAt: lastBrief?.toISOString() ?? null,
      nextCheck: next.toISOString(),
      due: next.getTime() <= now.getTime(),
      firstReadPending,
    };
  };

  const watch = args.watch ?? new Map<string, WatchEntry>();
  const removed = (key: string) => watch.get(key)?.state === 'removed';

  const user = args.userRuns
    .filter(r => !removed(r.competitorKey))
    .filter(r => !r.competitors.includes(INJECTION_DEMO_DOMAIN)) // the honeypot is a demo, not a store
    .filter(r => r.competitors.length > 0)
    .map(r => ({ r, read: !args.scrapedStores || r.competitors.every(c => args.scrapedStores!.has(c)) }))
    .filter(({ r, read }) => read || (args.pendingKeys?.has(r.competitorKey) ?? false))
    .sort((a, b) => b.r.lastUserRunAt.getTime() - a.r.lastUserRunAt.getTime())
    .map(({ r, read }) => entry(r.competitorKey, r.competitors, 'user', r.lastUserRunAt, !read));

  const sets = [...user];
  const defaultKey = competitorKeyOf(args.defaultCompetitors);
  if (defaultKey && !removed(defaultKey) && !sets.some(s => s.competitorKey === defaultKey)) {
    sets.push(entry(defaultKey, defaultKey.split(','), 'default', null));
  }
  // Paused: still tracked (listed, window running), never due.
  return sets.map(s => (watch.get(s.competitorKey)?.state === 'paused' ? { ...s, due: false, paused: true } : s));
}

/** Due sets, the longest-waiting first (never-briefed sets lead). */
export function dueFirst(sets: TrackedSet[]): TrackedSet[] {
  return sets.filter(s => s.due).sort((a, b) => a.nextCheck.localeCompare(b.nextCheck));
}

// ── Database-backed API ──────────────────────────────────────────────────────

function defaultCompetitors(): string[] {
  // Same cleanup the pipeline applies, so the key matches the briefs' key
  // ("https://www.Goodr.com" → "goodr.com"); otherwise the set never finds
  // its last brief and is due every day.
  return (process.env.COMPETITOR_STORES ?? '').split(',').map(normalizeDomain).filter(Boolean);
}

/** Most recent successful dashboard run per set (any age: watching is indefinite). */
async function loadUserRuns(): Promise<UserRunFact[]> {
  const rows = await db()
    .collection(RUNS)
    .aggregate<{ _id: string; competitors: string[]; lastUserRunAt: Date }>([
      { $match: { trigger: 'dashboard', status: 'success', competitorKey: { $type: 'string' } } },
      { $sort: { startedAt: -1 } },
      { $group: { _id: '$competitorKey', competitors: { $first: '$competitors' }, lastUserRunAt: { $first: '$startedAt' } } },
    ])
    .toArray();
  return rows.map(r => ({ competitorKey: r._id, competitors: r.competitors, lastUserRunAt: r.lastUserRunAt }));
}

/**
 * Stores with at least one FULL catalogue read. AI-read (partial) snapshots
 * don't count: they are never compared week over week, so re-checking such a
 * store weekly would only repeat a partial snapshot.
 */
async function loadScrapedStores(stores: string[]): Promise<Set<string>> {
  if (stores.length === 0) return new Set();
  const found = await db()
    .collection(SNAPSHOTS)
    .distinct('competitor', { competitor: { $in: stores }, source: { $ne: 'firecrawl' }, complete: { $ne: false } });
  return new Set(found as string[]);
}

/** Of these keys, the ones whose latest finished run ended with the store refusing us. */
async function loadPendingKeys(keys: string[]): Promise<Set<string>> {
  if (keys.length === 0) return new Set();
  const rows = await db()
    .collection(RUNS)
    .aggregate<{ _id: string; blocked: boolean }>([
      { $match: { competitorKey: { $in: keys }, status: { $in: ['success', 'failed'] } } },
      { $sort: { finishedAt: -1 } },
      { $group: { _id: '$competitorKey', blocked: { $first: { $ifNull: ['$blocked', false] } } } },
    ])
    .toArray();
  return new Set(rows.filter(r => r.blocked).map(r => r._id));
}

async function loadLastBriefAt(keys: string[]): Promise<Map<string, Date>> {
  if (keys.length === 0) return new Map();
  const rows = await db()
    .collection(BRIEFS)
    .aggregate<{ _id: string; lastBriefAt: Date }>([
      { $match: { competitorKey: { $in: keys } } },
      { $group: { _id: '$competitorKey', lastBriefAt: { $max: '$createdAt' } } },
    ])
    .toArray();
  return new Map(rows.map(r => [r._id, r.lastBriefAt]));
}

/** Every tracked set, with when it is next due. */
export async function listTrackedSets(now = new Date(), watchlist?: Map<string, WatchEntry>): Promise<TrackedSet[]> {
  const { loadWatchlist } = await import('./watchlist');
  const [userRuns, watch] = await Promise.all([loadUserRuns(), watchlist ?? loadWatchlist()]);
  const userKeys = userRuns.map(r => r.competitorKey);
  const keys = [...userKeys, competitorKeyOf(defaultCompetitors())].filter(Boolean);
  const [lastBriefAt, scrapedStores, pendingKeys] = await Promise.all([
    loadLastBriefAt(keys),
    loadScrapedStores([...new Set(userKeys.flatMap(k => k.split(',')))]),
    loadPendingKeys(userKeys),
  ]);
  return computeTrackedSets({ userRuns, lastBriefAt, scrapedStores, pendingKeys, watch, defaultCompetitors: defaultCompetitors(), now });
}

/** Tracked sets that are due now, longest-waiting first. */
export async function getDueSets(now = new Date()): Promise<TrackedSet[]> {
  return dueFirst(await listTrackedSets(now));
}

/** Tracking status for one store set — for the brief page. */
export async function trackingFor(competitors: string[], now = new Date()): Promise<TrackingStatus> {
  const key = competitorKeyOf(competitors);
  return (await trackingForKeys([key], now)).get(key)!;
}

/** trackingFor for many store sets at once (the stores list): a fixed number of queries, not per set. */
export async function trackingForKeys(keys: string[], now = new Date(), watchlist?: Map<string, WatchEntry>): Promise<Map<string, TrackingStatus>> {
  const trackedSets = new Map((await listTrackedSets(now, watchlist)).map(s => [s.competitorKey, s]));
  return new Map(
    keys.map((key): [string, TrackingStatus] => {
      const t = trackedSets.get(key);
      if (!t) return [key, { tracked: false, nextCheck: null }];
      return [
        key,
        {
          tracked: true,
          nextCheck: t.paused ? null : t.nextCheck,
          ...(t.firstReadPending ? { firstReadPending: true } : {}),
          ...(t.paused ? { paused: true } : {}),
        },
      ];
    }),
  );
}
