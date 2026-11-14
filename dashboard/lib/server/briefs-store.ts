import { ObjectId } from 'mongodb';
import { db, BRIEFS } from './db';
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
  violations: string[];
  warnings?: string[];
  method?: string | null;
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
  grounding: Verdict;
  safety: Verdict;
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
    grounding: d.grounding,
    safety: d.safety,
  };
}

/**
 * Save a brief. Identified by (week, competitor set): re-running the same
 * competitors in a week replaces that card in place (same id, so links keep
 * working); a different set makes a new one. Returns the brief id.
 */
export async function saveBrief(brief: Omit<BriefDoc, '_id' | 'createdAt'>): Promise<string> {
  const doc = await db()
    .collection<BriefDoc>(BRIEFS)
    .findOneAndUpdate(
      { weekOf: brief.weekOf, competitorKey: brief.competitorKey },
      { $set: { ...brief, createdAt: new Date() } },
      { upsert: true, returnDocument: 'after', projection: { _id: 1 } },
    );
  if (!doc) throw new Error('saveBrief: upsert returned no document');
  return doc._id.toHexString();
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

/** Recent briefs covering any of the given competitors — trend context for the agent. */
export async function briefsForCompetitors(competitors: string[], limit = 4): Promise<BriefSummary[]> {
  const docs = await db()
    .collection<BriefDoc>(BRIEFS)
    .find({ 'competitors.competitor': { $in: competitors } }, { projection: SUMMARY_PROJECTION })
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();
  return docs.map(toSummary);
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
   * Change vs the readable run before it (null: none). Computed from the raw
   * catalogue counts, which were measured the same way in every run; the
   * add-on-free count only exists since add-ons were left out, so mixing the
   * two would misstate the change.
   */
  productDelta: number | null;
  /** false: that latest read was cut off (productCount is a lower bound). */
  complete?: boolean;
  /** The latest brief is a manual-read case. */
  needsManualRead?: boolean;
  tracking: import('./tracking').TrackingStatus;
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
  /** Change vs the run listed after it (raw counts; see StoreSummary.productDelta). Absent on the oldest run listed. */
  productDelta?: number;
  complete?: boolean;
  priceChanges: number;
  newSkus: number;
  removed: number;
  titleChanges: number;
}

type SlimBrief = Pick<BriefDoc, '_id' | 'competitorKey' | 'createdAt' | 'competitors'> & {
  diff?: { diffs?: { competitor: string; catalog?: { productCount?: number } }[] };
};

/** Fields listStores/listRuns need, without the heavy brief and product lists. */
const SLIM_PROJECTION = {
  competitorKey: 1, createdAt: 1, trigger: 1, greenLight: 1, competitors: 1,
  'diff.diffs.competitor': 1, 'diff.diffs.catalog.productCount': 1,
} as const;
const SLIM_PROJECTION_WITH_REMOVED = { ...SLIM_PROJECTION, removedTotal: 1 } as const;

/**
 * Products read in a brief. `shown`: the catalogue's count (checkout add-ons
 * left out, as the brief page shows it), falling back to the raw count.
 * `raw`: every product, measured the same way in every run — used for deltas.
 */
const readCount = (b: SlimBrief) => {
  const read = b.competitors.filter(isReadable);
  const catalogCount = (c: string) => b.diff?.diffs?.find(d => d.competitor === c)?.catalog?.productCount;
  return {
    shown: read.reduce((n, c) => n + (catalogCount(c.competitor) ?? c.productCount), 0),
    raw: read.reduce((n, c) => n + c.productCount, 0),
    complete: !read.some(c => c.complete === false),
  };
};

/** Every store set with a brief, newest latest brief first. */
export async function listStores(): Promise<StoreSummary[]> {
  const briefs = await db()
    .collection<BriefDoc>(BRIEFS)
    .find({}, { projection: SLIM_PROJECTION })
    .sort({ createdAt: -1 })
    .toArray() as SlimBrief[];

  const byKey = new Map<string, SlimBrief[]>();
  for (const b of briefs) {
    const list = byKey.get(b.competitorKey);
    if (list) list.push(b);
    else byKey.set(b.competitorKey, [b]);
  }
  const { trackingForKeys } = await import('./tracking');
  const tracking = await trackingForKeys([...byKey.keys()]);

  return [...byKey.entries()].map(([key, list]): StoreSummary => {
    const latest = list[0];
    const readableRuns = list.filter(b => b.competitors.some(isReadable));
    const last = readableRuns[0] ? readCount(readableRuns[0]) : null;
    const prev = readableRuns[1] ? readCount(readableRuns[1]) : null;
    return {
      store: key.split(',').join(', '),
      competitorKey: key,
      latestBriefId: latest._id.toHexString(),
      latestAt: latest.createdAt.toISOString(),
      runCount: readableRuns.length,
      productCount: last ? last.shown : null,
      productDelta: last && prev ? last.raw - prev.raw : null,
      ...(last && !last.complete ? { complete: false } : {}),
      ...(latest.competitors.length > 0 && latest.competitors.every(c => c.needsManualRead) ? { needsManualRead: true } : {}),
      tracking: tracking.get(key) ?? { tracked: false, trackedUntil: null, nextCheck: null },
    };
  });
}

/** A store set's readable runs, newest first (at most `limit`). */
export async function listRuns(competitorKey: string, limit = 50): Promise<RunSummary[]> {
  const docs = await db()
    .collection<BriefDoc>(BRIEFS)
    .aggregate<SlimBrief & Pick<BriefDoc, 'greenLight' | 'trigger'> & { removedTotal: number }>([
      { $match: { competitorKey, 'competitors.status': { $in: ['verified', 'first_snapshot'] } } },
      { $sort: { createdAt: -1 } },
      { $limit: limit },
      {
        $addFields: {
          removedTotal: {
            $sum: { $map: { input: { $ifNull: ['$diff.diffs', []] }, as: 'd', in: { $size: { $ifNull: ['$$d.removedSkus', []] } } } },
          },
        },
      },
      { $project: SLIM_PROJECTION_WITH_REMOVED },
    ])
    .toArray();
  return docs.map((d, i) => {
    const read = d.competitors.filter(isReadable);
    const older = docs[i + 1];
    const sum = (k: 'priceChanges' | 'newSkus' | 'titleChanges') => read.reduce((n, c) => n + c[k], 0);
    const { shown: productCount, complete } = readCount(d);
    return {
      id: d._id.toHexString(),
      createdAt: d.createdAt.toISOString(),
      greenLight: d.greenLight,
      status: read.some(c => c.status === 'verified') ? 'verified' : 'first_snapshot',
      ...(d.trigger ? { trigger: d.trigger } : {}),
      productCount,
      ...(older ? { productDelta: readCount(d).raw - readCount(older).raw } : {}),
      ...(complete ? {} : { complete: false }),
      priceChanges: sum('priceChanges'),
      newSkus: sum('newSkus'),
      removed: d.removedTotal,
      titleChanges: sum('titleChanges'),
    };
  });
}

export async function countBriefs(): Promise<number> {
  return db().collection(BRIEFS).estimatedDocumentCount();
}
