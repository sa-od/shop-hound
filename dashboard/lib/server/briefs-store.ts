import { ObjectId } from 'mongodb';
import { db, BRIEFS, RUNS } from './db';
import type { StructuredDiff } from './types';

/** Archived Growth Briefs — the dashboard's read path and the pipeline's trend history. */

export interface CompetitorSummary {
  competitor: string;
  status: string;
  /** shopify: own catalogue, direct · shopify_relay: own catalogue via Firecrawl · firecrawl: AI-read pages (partial) */
  source?: 'shopify' | 'shopify_relay' | 'firecrawl';
  /** false = time ran out before the catalogue's last page: productCount is a lower bound. */
  complete?: boolean;
  productCount: number;
  newSkus: number;
  priceChanges: number;
  titleChanges: number;
  reason?: string; // why a competitor is unverified, when known
  lastKnown?: { snapshotDate: string; productCount: number }; // unverified, but read on an earlier check
  /** No readable catalogue (AI reading off): `reason` tells the user to email for a manual read. */
  needsManualRead?: boolean;
  /** Platform, message and ready-made email for the "request by email" action. */
  manualRead?: Omit<import('./contact').ManualRead, 'platform' | 'email'> & {
    platform: string;
    email: Omit<import('./contact').ManualRead['email'], 'gmail'> & { gmail?: string }; // older briefs have no gmail link
  };
}

export interface Verdict {
  greenLight: boolean;
  /** false when the check couldn't run (then never green). Always present on read (see normalizeVerdict). */
  enabled: boolean;
  violations: string[];
  warnings?: string[];
  method?: string | null;
}

/** A verdict as stored: briefs from before the in-house guardrails may carry `enkryptEnabled`, or neither flag. */
type StoredVerdict = Omit<Verdict, 'enabled'> & { enabled?: boolean; enkryptEnabled?: boolean };

const COULD_NOT_RUN = /ENKRYPT_API_KEY not set|unavailable|could not run|UNAUDITED/i;

/**
 * Normalise a stored verdict on READ, so the UI only ever sees `enabled`:
 * `enabled`, else the old `enkryptEnabled`, else inferred — a check that
 * couldn't run always said so in its violations. Pure.
 */
export function normalizeVerdict(v: StoredVerdict | null | undefined): Verdict {
  const { enkryptEnabled, enabled, ...rest } = v ?? { greenLight: false, violations: [] };
  return {
    ...rest,
    greenLight: rest.greenLight ?? false,
    violations: rest.violations ?? [],
    enabled: enabled ?? enkryptEnabled ?? !(rest.violations ?? []).some(m => COULD_NOT_RUN.test(m)),
  };
}

/** Why a brief ran: a user added (or re-ran) the store, or the weekly re-check. Older briefs lack it. */
export type BriefTrigger = 'added' | 'weekly';

export interface BriefSummary {
  id: string;
  weekOf: string;
  createdAt: string;
  trigger?: BriefTrigger;
  greenLight: boolean;
  competitors: CompetitorSummary[];
  grounding: Verdict;
  safety: Verdict;
}

export interface BriefDetail extends BriefSummary {
  briefMarkdown: string;
  /** The deterministic diff the brief was written from: product-level proof. */
  diff: StructuredDiff | null;
}

interface BriefDoc {
  _id: ObjectId;
  weekOf: string;
  competitorKey: string;
  createdAt: Date;
  trigger?: BriefTrigger;
  greenLight: boolean;
  briefMarkdown: string;
  competitors: CompetitorSummary[];
  grounding: StoredVerdict;
  safety: StoredVerdict;
  diff: StructuredDiff;
}

const SUMMARY_PROJECTION = { briefMarkdown: 0, diff: 0 } as const;

function toSummary(d: Omit<BriefDoc, 'briefMarkdown' | 'diff'>): BriefSummary {
  return {
    id: d._id.toHexString(),
    weekOf: d.weekOf,
    createdAt: d.createdAt.toISOString(),
    ...(d.trigger ? { trigger: d.trigger } : {}),
    greenLight: d.greenLight,
    competitors: d.competitors,
    grounding: normalizeVerdict(d.grounding),
    safety: normalizeVerdict(d.safety),
  };
}

/** Save a brief. Every run gets its own brief (re-runs never replace one). Returns its id. */
export async function saveBrief(brief: Omit<BriefDoc, '_id' | 'createdAt'>): Promise<string> {
  const _id = new ObjectId();
  await db().collection<BriefDoc>(BRIEFS).insertOne({ ...brief, _id, createdAt: new Date() });
  return _id.toHexString();
}

/** Newest briefs first, without the heavy markdown/diff; removed-product totals are counted in the database. */
export async function listRecentBriefs(limit = 50): Promise<(BriefSummary & { removedTotal: number })[]> {
  const docs = await db()
    .collection<BriefDoc>(BRIEFS)
    .aggregate<Omit<BriefDoc, 'briefMarkdown' | 'diff'> & { removedTotal: number }>([
      { $sort: { createdAt: -1 } },
      { $limit: limit },
      {
        $addFields: {
          removedTotal: {
            $sum: {
              $map: { input: { $ifNull: ['$diff.diffs', []] }, as: 'd', in: { $size: { $ifNull: ['$$d.removedSkus', []] } } },
            },
          },
        },
      },
      { $project: SUMMARY_PROJECTION },
    ])
    .toArray();
  return docs.map(d => ({ ...toSummary(d), removedTotal: d.removedTotal }));
}

/**
 * Recent briefs covering any of the given competitors — trend context for the
 * agent. One per day (the latest), from days before `beforeDay` only, so a
 * day's many re-runs don't crowd out the earlier weeks.
 */
export async function briefsForCompetitors(competitors: string[], limit = 4, beforeDay?: string): Promise<BriefSummary[]> {
  const docs = await db()
    .collection<BriefDoc>(BRIEFS)
    .find(
      { 'competitors.competitor': { $in: competitors }, ...(beforeDay ? { weekOf: { $lt: beforeDay } } : {}) },
      { projection: SUMMARY_PROJECTION },
    )
    .sort({ createdAt: -1 })
    .limit(limit * 10)
    .toArray();
  const seen = new Set<string>();
  return docs
    .filter(d => {
      const day = `${d.competitorKey}|${d.weekOf}`;
      if (seen.has(day)) return false;
      seen.add(day);
      return true;
    })
    .slice(0, limit)
    .map(toSummary);
}

export async function getBrief(id: string): Promise<BriefDetail | null> {
  if (!ObjectId.isValid(id)) return null;
  const d = await db().collection<BriefDoc>(BRIEFS).findOne({ _id: new ObjectId(id) });
  if (!d) return null;
  return { ...toSummary(d), briefMarkdown: d.briefMarkdown, diff: d.diff ?? null };
}

/** The newest brief, in full — the home page's "This week". */
export async function getLatestBrief(): Promise<BriefDetail | null> {
  const d = await db().collection<BriefDoc>(BRIEFS).find({}).sort({ createdAt: -1 }).limit(1).next();
  return d ? { ...toSummary(d), briefMarkdown: d.briefMarkdown, diff: d.diff ?? null } : null;
}

// ── Stores and their runs (the Briefs list and the brief page) ───────────────

/** A store was actually read in this brief (not unverified / a manual-read case). */
const isReadable = (c: Pick<CompetitorSummary, 'status'>) => c.status === 'verified' || c.status === 'first_snapshot';

/** One tracked or analysed store (or an old multi-store set), newest first. */
export interface StoreSummary {
  /** Display name: the domain, or "a.com, b.com" for an old multi-store set. */
  store: string;
  competitorKey: string;
  /** The latest brief of any kind: the link target. */
  latestBriefId: string;
  latestAt: string;
  /** Briefs where the store was actually read; unreadable checks aren't counted. */
  runCount: number;
  /** Products in the latest readable run, checkout add-ons left out as on the brief page (null: never read). */
  productCount: number | null;
  /**
   * Change in products since the read the latest run was compared with —
   * about a week earlier (null: not compared yet). Raw catalogue counts on
   * both sides: the add-on-free count only exists since add-ons were left
   * out, so mixing the two would misstate the change.
   */
  productDelta: number | null;
  /** Date (YYYY-MM-DD, UTC) of the read productDelta is measured from. */
  deltaSince?: string;
  /** false: that latest read was cut off (productCount is a lower bound). */
  complete?: boolean;
  /** The latest brief is a manual-read case. */
  needsManualRead?: boolean;
  /** The latest brief was withheld: its data failed the grounding guardrail, so no brief was written. */
  withheld?: boolean;
  tracking: import('./tracking').TrackingStatus;
  /** active: checked about weekly, until paused or removed · paused: by the user, no automatic checks · ended: not watched (it can't be read). */
  watching: import('./tracking').Watching;
  /** Next automatic check, "on or after" (null: paused or not watched). Same as tracking.nextCheck. */
  nextCheck: string | null;
  /** Being read right now: the step and when it began. */
  reading?: { step: import('./runs').RunStep | null; stepStartedAt: string | null };
  /** Waiting to retry: the store refused us for now ('store'), or a problem on our side ('ours', shown as our banner, not the store's). */
  retrying?: { retryAt: string; reason: string | null; failureKind: import('./failure').FailureKind };
  /** Waiting in the queue. */
  queued?: true;
  /**
   * Products changed in the last 7 days, from the store's latest compared
   * read in that window (the same read "This week" uses). Counts per kind,
   * matching changes.ts (price_cut / price_rise / new / removed / renamed).
   */
  week: { total: number; byKind: Partial<Record<import('./changes').ChangeKind, number>>; briefId?: string };
}

/** One readable run of a store, for its history. */
export interface RunSummary {
  id: string;
  createdAt: string;
  greenLight: boolean;
  /** 'verified' when compared with an earlier check; 'first_snapshot' when it saved the baseline. */
  status: 'verified' | 'first_snapshot';
  trigger?: BriefTrigger;
  productCount: number;
  /** Change since the read this run was compared with, about a week earlier (raw counts). Absent on first checks. */
  productDelta?: number;
  /** Date (YYYY-MM-DD, UTC) of the read this run was compared with. */
  deltaSince?: string;
  complete?: boolean;
  priceChanges: number;
  newSkus: number;
  removed: number;
  titleChanges: number;
  /** Withheld: the data failed the grounding guardrail, so the analyst never ran. */
  withheld?: boolean;
}

/** What the store and run lists need from a brief: counts only, no brief text or product lists. */
type SlimBrief = Pick<BriefDoc, '_id' | 'competitorKey' | 'createdAt' | 'greenLight' | 'trigger'> & {
  competitors: Pick<CompetitorSummary, 'competitor' | 'status' | 'productCount' | 'complete' | 'newSkus' | 'priceChanges' | 'titleChanges' | 'needsManualRead'>[];
  diffs: { competitor: string; status?: string; previousProductCount?: number; previousSnapshotDate?: string | null; removedCount: number; catalogCount?: number; cuts: number; rises: number }[];
  readable: boolean;
  withheld: boolean;
};

/**
 * Withheld = grounding failed AND the safety audit was a skip. Stored verdicts
 * keep no `detail`, so the skip is recognised by the message the pipeline
 * writes ("audit skipped — grounding guardrail blocked the input upstream…"),
 * which older briefs carry too.
 */
const WITHHELD_EXPR = {
  $and: [
    { $eq: ['$grounding.greenLight', false] },
    {
      $anyElementTrue: [
        { $map: { input: { $ifNull: ['$safety.violations', []] }, as: 'v', in: { $regexMatch: { input: '$$v', regex: 'audit skipped|blocked the input upstream', options: 'i' } } } },
      ],
    },
  ],
};

const READABLE_EXPR = { $anyElementTrue: [{ $map: { input: '$competitors', as: 'c', in: { $in: ['$$c.status', ['verified', 'first_snapshot']] } } }] };

/**
 * Database-side projection to SlimBrief. Removed products are COUNTED here
 * ($size), so no product lists leave the database.
 */
const SLIM_STAGE = {
  $project: {
    competitorKey: 1, createdAt: 1, greenLight: 1, trigger: 1,
    competitors: {
      $map: {
        input: '$competitors', as: 'c',
        in: {
          competitor: '$$c.competitor', status: '$$c.status', productCount: '$$c.productCount', complete: '$$c.complete',
          newSkus: '$$c.newSkus', priceChanges: '$$c.priceChanges', titleChanges: '$$c.titleChanges', needsManualRead: '$$c.needsManualRead',
        },
      },
    },
    diffs: {
      $map: {
        input: { $ifNull: ['$diff.diffs', []] }, as: 'd',
        in: {
          competitor: '$$d.competitor', status: '$$d.status', previousProductCount: '$$d.previousProductCount', previousSnapshotDate: '$$d.previousSnapshotDate',
          removedCount: { $size: { $ifNull: ['$$d.removedSkus', []] } }, catalogCount: '$$d.catalog.productCount',
          cuts: { $size: { $filter: { input: { $ifNull: ['$$d.priceChanges', []] }, as: 'p', cond: { $lt: ['$$p.newPrice', '$$p.oldPrice'] } } } },
          rises: { $size: { $filter: { input: { $ifNull: ['$$d.priceChanges', []] }, as: 'p', cond: { $gt: ['$$p.newPrice', '$$p.oldPrice'] } } } },
        },
      },
    },
    readable: READABLE_EXPR,
    withheld: WITHHELD_EXPR,
  },
} as const;

/**
 * Products read in a brief. `shown`: the catalogue's count (checkout add-ons
 * left out, as the brief page shows it), falling back to the raw count.
 * `raw`: every product, measured the same way in every run — used for deltas.
 */
const readCount = (b: SlimBrief) => {
  const read = b.competitors.filter(isReadable);
  const catalogCount = (c: string) => b.diffs.find(d => d.competitor === c)?.catalogCount;
  return {
    shown: read.reduce((n, c) => n + (catalogCount(c.competitor) ?? c.productCount), 0),
    raw: read.reduce((n, c) => n + c.productCount, 0),
    complete: !read.some(c => c.complete === false),
  };
};

/**
 * Change since the read(s) this brief compared with: raw counts, verified
 * stores only. Older briefs without previousProductCount derive it from the
 * changes (previous = now − new + removed, exact for the id-matched diff).
 */
const compared = (b: SlimBrief) => {
  const diffs = b.diffs.filter(d => b.competitors.some(c => c.competitor === d.competitor && c.status === 'verified'));
  if (diffs.length === 0) return null;
  let delta = 0;
  for (const d of diffs) {
    const c = b.competitors.find(x => x.competitor === d.competitor)!;
    // Matching is one-to-one, so the earlier count is exactly now − new + removed.
    const previous = d.previousProductCount ?? c.productCount - c.newSkus + d.removedCount;
    delta += c.productCount - previous;
  }
  const since = diffs.map(d => d.previousSnapshotDate).filter((x): x is string => !!x).sort()[0];
  return { delta, ...(since ? { since } : {}) };
};

/** Days in the "this week" window (rolling). */
export const WEEK_DAYS = 7;

/** Per-kind product counts of a brief's compared (verified) stores — what changes.ts would emit. */
export function weekTotals(b: Pick<SlimBrief, 'competitors' | 'diffs'>): StoreSummary['week'] {
  const byKind: StoreSummary['week']['byKind'] = {};
  const add = (k: keyof typeof byKind, n: number) => { if (n > 0) byKind[k] = (byKind[k] ?? 0) + n; };
  for (const d of b.diffs) {
    const c = b.competitors.find(x => x.competitor === d.competitor);
    if (!c || c.status !== 'verified') continue;
    add('price_cut', d.cuts ?? 0);
    add('price_rise', d.rises ?? 0);
    add('removed', d.removedCount);
    add('new', c.newSkus);
    add('renamed', c.titleChanges);
  }
  return { total: Object.values(byKind).reduce((n, v) => n + (v ?? 0), 0), byKind };
}

interface ActiveRunRow { status: 'queued' | 'running' | 'retrying'; step?: import('./runs').RunStep; stepStartedAt?: Date; retryAt?: Date | null; retryReason?: string | null; failureKind?: import('./failure').FailureKind | null }

/**
 * Every store set with a brief, newest latest brief first — except stores the
 * user removed. Grouped in the database, with each store's active run (reading
 * / retrying / queued) joined in the same query: one row per store comes back,
 * however many runs it has.
 */
export async function listStores(now = new Date()): Promise<StoreSummary[]> {
  const weekFrom = new Date(now.getTime() - WEEK_DAYS * 24 * 60 * 60 * 1000);
  const rows = await db()
    .collection<BriefDoc>(BRIEFS)
    .aggregate<{ _id: string; latest: SlimBrief; runCount: number; lastReadable: SlimBrief[]; weekBrief: (SlimBrief & { inWeek: boolean })[]; activeRun: ActiveRunRow[] }>([
      { $sort: { createdAt: -1 } },
      SLIM_STAGE,
      // A compared (verified) read inside the rolling week: the one "This week" uses.
      {
        $addFields: {
          inWeek: {
            $and: [
              { $gte: ['$createdAt', weekFrom] },
              { $anyElementTrue: [{ $map: { input: '$competitors', as: 'c', in: { $eq: ['$$c.status', 'verified'] } } }] },
            ],
          },
        },
      },
      {
        $group: {
          _id: '$competitorKey',
          latest: { $first: '$$ROOT' },
          runCount: { $sum: { $cond: ['$readable', 1, 0] } },
          // Readable briefs sort first, newest first: [0] is the latest readable one, if any.
          lastReadable: { $topN: { n: 1, sortBy: { readable: -1, createdAt: -1 }, output: '$$ROOT' } },
          weekBrief: { $topN: { n: 1, sortBy: { inWeek: -1, createdAt: -1 }, output: '$$ROOT' } },
        },
      },
      {
        $lookup: {
          from: RUNS,
          let: { key: '$_id' },
          pipeline: [
            { $match: { active: true, $expr: { $eq: ['$competitorKey', '$$key'] } } },
            { $project: { _id: 0, status: 1, step: 1, stepStartedAt: 1, retryAt: 1, retryReason: 1, failureKind: 1 } },
          ],
          as: 'activeRun',
        },
      },
      { $sort: { 'latest.createdAt': -1 } },
    ])
    .toArray();

  const [{ trackingForKeys, watchingOf }, { loadWatchlist }] = await Promise.all([import('./tracking'), import('./watchlist')]);
  const watch = await loadWatchlist();
  const visible = rows.filter(r => watch.get(r._id)?.state !== 'removed');
  const tracking = await trackingForKeys(visible.map(r => r._id), now, watch);

  return visible.map(({ _id: key, latest, runCount, lastReadable, weekBrief, activeRun }): StoreSummary => {
    const readableBrief = lastReadable[0]?.readable ? lastReadable[0] : null;
    const last = readableBrief ? readCount(readableBrief) : null;
    const change = readableBrief ? compared(readableBrief) : null;
    const t = tracking.get(key) ?? { tracked: false, nextCheck: null };
    const [run] = activeRun;
    const [wk] = weekBrief;
    return {
      store: key.split(',').join(', '),
      competitorKey: key,
      latestBriefId: latest._id.toHexString(),
      latestAt: latest.createdAt.toISOString(),
      runCount,
      productCount: last ? last.shown : null,
      productDelta: change ? change.delta : null,
      ...(change?.since ? { deltaSince: change.since } : {}),
      ...(last && !last.complete ? { complete: false } : {}),
      ...(latest.competitors.length > 0 && latest.competitors.every(c => c.needsManualRead) ? { needsManualRead: true } : {}),
      ...(latest.withheld ? { withheld: true } : {}),
      tracking: t,
      watching: watchingOf(t),
      nextCheck: t.nextCheck,
      ...(run?.status === 'running' ? { reading: { step: run.step ?? null, stepStartedAt: run.stepStartedAt?.toISOString() ?? null } } : {}),
      ...(run?.status === 'retrying' && run.retryAt ? { retrying: { retryAt: run.retryAt.toISOString(), reason: run.retryReason ?? null, failureKind: run.failureKind === 'ours' ? 'ours' : 'store' } } : {}),
      ...(run?.status === 'queued' ? { queued: true as const } : {}),
      week: wk?.inWeek ? { ...weekTotals(wk), briefId: wk._id.toHexString() } : { total: 0, byKind: {} },
    };
  });
}

function toRunSummary(d: SlimBrief): RunSummary {
  const read = d.competitors.filter(isReadable);
  const sum = (k: 'priceChanges' | 'newSkus' | 'titleChanges') => read.reduce((n, c) => n + c[k], 0);
  const { shown: productCount, complete } = readCount(d);
  const change = compared(d);
  return {
    id: d._id.toHexString(),
    createdAt: d.createdAt.toISOString(),
    greenLight: d.greenLight,
    status: read.some(c => c.status === 'verified') ? 'verified' : 'first_snapshot',
    ...(d.trigger ? { trigger: d.trigger } : {}),
    productCount,
    ...(change ? { productDelta: change.delta, ...(change.since ? { deltaSince: change.since } : {}) } : {}),
    ...(complete ? {} : { complete: false }),
    priceChanges: sum('priceChanges'),
    newSkus: sum('newSkus'),
    removed: d.diffs.filter(x => read.some(c => c.competitor === x.competitor)).reduce((n, x) => n + x.removedCount, 0),
    titleChanges: sum('titleChanges'),
    ...(d.withheld ? { withheld: true } : {}),
  };
}

/**
 * Readable runs for many store sets in ONE query (the Briefs list), newest
 * first, at most `limit` per set. Sets with no readable run are absent.
 */
export async function listRunsForKeys(competitorKeys: string[], limit = 50): Promise<Map<string, RunSummary[]>> {
  if (competitorKeys.length === 0) return new Map();
  const rows = await db()
    .collection<BriefDoc>(BRIEFS)
    .aggregate<{ _id: string; runs: SlimBrief[] }>([
      { $match: { competitorKey: { $in: competitorKeys }, 'competitors.status': { $in: ['verified', 'first_snapshot'] } } },
      { $sort: { createdAt: -1 } },
      SLIM_STAGE,
      { $group: { _id: '$competitorKey', runs: { $firstN: { n: limit, input: '$$ROOT' } } } },
    ])
    .toArray();
  return new Map(rows.map(r => [r._id, r.runs.map(toRunSummary)]));
}

/** A store set's readable runs, newest first (at most `limit`). */
export async function listRuns(competitorKey: string, limit = 50): Promise<RunSummary[]> {
  return (await listRunsForKeys([competitorKey], limit)).get(competitorKey) ?? [];
}

export async function countBriefs(): Promise<number> {
  return db().collection(BRIEFS).estimatedDocumentCount();
}
