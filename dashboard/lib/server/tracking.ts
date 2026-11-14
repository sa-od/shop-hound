import { db, RUNS, BRIEFS, SNAPSHOTS } from './db';
import { INJECTION_DEMO_DOMAIN, normalizeDomain } from './scraper';

/**
 * Automatic tracking. Every set of stores a user analyses from the dashboard
 * is re-checked about weekly, so they get a "what changed" brief without
 * doing anything. No watchlist: tracking is derived from what was run.
 *
 * - A set is TRACKED for TRACK_DAYS after a user last ran it from the
 *   dashboard. Automatic (cron) runs never extend it — otherwise every set
 *   would be tracked forever.
 * - A tracked set is DUE when its latest brief is RECHECK_DAYS old (or it has
 *   none yet). The cron runs daily and works through due sets, oldest first.
 * - COMPETITOR_STORES, when set, is one extra set tracked indefinitely.
 * - At most MAX_TRACKED_SETS user sets are tracked (most recently run first),
 *   which bounds the weekly spend.
 * - Only stores that were scraped successfully at least once are tracked: a
 *   fake, dead or non-store site gets one brief explaining why, never a
 *   weekly bill. Exception — FIRST READ PENDING: a store that refused us for
 *   now (rate limit / block) on its last run stays tracked and is retried
 *   daily (PENDING_RECHECK_DAYS) instead of weekly, until a read succeeds or
 *   tracking ends.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export const TRACK_DAYS = positiveInt(process.env.TRACK_DAYS, 28);
export const RECHECK_DAYS = 7;
export const PENDING_RECHECK_DAYS = 1;
export const MAX_TRACKED_SETS = positiveInt(process.env.MAX_TRACKED_SETS, 20);

export interface TrackedSet {
  competitorKey: string;
  competitors: string[];
  /** 'user' = from dashboard runs; 'default' = COMPETITOR_STORES. */
  origin: 'user' | 'default';
  /** When a user last ran this set from the dashboard (null for the default set). */
  lastUserRunAt: string | null;
  /** When tracking ends (null = indefinitely, for the default set). */
  trackedUntil: string | null;
  /** The set's latest brief, from any trigger (null = none yet). */
  lastBriefAt: string | null;
  /** When the set is next due (approximate: a busy day pushes it to the next). */
  nextCheck: string;
  due: boolean;
  /** Never read yet because the store refused us for now; retried daily. */
  firstReadPending: boolean;
}

export interface TrackingStatus {
  tracked: boolean;
  trackedUntil: string | null;
  nextCheck: string | null;
  /** Tracked, but never read yet: the store refused us for now. nextCheck is the next try. */
  firstReadPending?: boolean;
}

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
  defaultCompetitors: string[];
  now: Date;
  trackDays?: number;
  recheckDays?: number;
  maxSets?: number;
}): TrackedSet[] {
  const { now } = args;
  const trackMs = (args.trackDays ?? TRACK_DAYS) * DAY_MS;
  const recheckMs = (args.recheckDays ?? RECHECK_DAYS) * DAY_MS;
  const maxSets = args.maxSets ?? MAX_TRACKED_SETS;

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
      trackedUntil: lastUserRunAt ? new Date(lastUserRunAt.getTime() + trackMs).toISOString() : null,
      lastBriefAt: lastBrief?.toISOString() ?? null,
      nextCheck: next.toISOString(),
      due: next.getTime() <= now.getTime(),
      firstReadPending,
    };
  };

  const user = args.userRuns
    .filter(r => r.lastUserRunAt.getTime() + trackMs > now.getTime()) // still in window
    .filter(r => !r.competitors.includes(INJECTION_DEMO_DOMAIN)) // the honeypot is a demo, not a store
    .filter(r => r.competitors.length > 0)
    .map(r => ({ r, read: !args.scrapedStores || r.competitors.every(c => args.scrapedStores!.has(c)) }))
    .filter(({ r, read }) => read || (args.pendingKeys?.has(r.competitorKey) ?? false))
    .sort((a, b) => b.r.lastUserRunAt.getTime() - a.r.lastUserRunAt.getTime())
    .slice(0, maxSets)
    .map(({ r, read }) => entry(r.competitorKey, r.competitors, 'user', r.lastUserRunAt, !read));

  const sets = [...user];
  const defaultKey = competitorKeyOf(args.defaultCompetitors);
  if (defaultKey && !sets.some(s => s.competitorKey === defaultKey)) {
    sets.push(entry(defaultKey, defaultKey.split(','), 'default', null));
  }
  return sets;
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

/** Most recent successful dashboard run per set, within the tracking window. */
async function loadUserRuns(now: Date): Promise<UserRunFact[]> {
  const since = new Date(now.getTime() - TRACK_DAYS * DAY_MS);
  const rows = await db()
    .collection(RUNS)
    .aggregate<{ _id: string; competitors: string[]; lastUserRunAt: Date }>([
      { $match: { trigger: 'dashboard', status: 'success', startedAt: { $gte: since }, competitorKey: { $type: 'string' } } },
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
export async function listTrackedSets(now = new Date()): Promise<TrackedSet[]> {
  const userRuns = await loadUserRuns(now);
  const keys = [...userRuns.map(r => r.competitorKey), competitorKeyOf(defaultCompetitors())].filter(Boolean);
  const [lastBriefAt, scrapedStores, pendingKeys] = await Promise.all([
    loadLastBriefAt(keys),
    loadScrapedStores([...new Set(userRuns.flatMap(r => r.competitors))]),
    loadPendingKeys(userRuns.map(r => r.competitorKey)),
  ]);
  return computeTrackedSets({ userRuns, lastBriefAt, scrapedStores, pendingKeys, defaultCompetitors: defaultCompetitors(), now });
}

/** Tracked sets that are due now, longest-waiting first. */
export async function getDueSets(now = new Date()): Promise<TrackedSet[]> {
  return dueFirst(await listTrackedSets(now));
}

/**
 * Tracking status for one store set — for the brief page. When tracking has
 * lapsed, `trackedUntil` still says when it ended (so the UI can offer
 * "run again to resume"); it is null if a user never ran this set, or if it
 * was never scraped successfully (so it is not re-checked).
 */
export async function trackingFor(competitors: string[], now = new Date()): Promise<TrackingStatus> {
  const key = competitorKeyOf(competitors);
  const tracked = (await listTrackedSets(now)).find(s => s.competitorKey === key);
  if (tracked) {
    return {
      tracked: true,
      trackedUntil: tracked.trackedUntil,
      nextCheck: tracked.nextCheck,
      ...(tracked.firstReadPending ? { firstReadPending: true } : {}),
    };
  }

  const scraped = await loadScrapedStores(key.split(','));
  if (!key.split(',').every(c => scraped.has(c))) return { tracked: false, trackedUntil: null, nextCheck: null };

  const last = await db()
    .collection(RUNS)
    .find({ trigger: 'dashboard', status: 'success', competitorKey: key })
    .sort({ startedAt: -1 })
    .limit(1)
    .next();
  const trackedUntil = last ? new Date((last.startedAt as Date).getTime() + TRACK_DAYS * DAY_MS).toISOString() : null;
  return { tracked: false, trackedUntil, nextCheck: null };
}

function positiveInt(raw: string | undefined, fallback: number): number {
  const n = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
