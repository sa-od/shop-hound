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

export interface BriefSummary {
  id: string;
  weekOf: string;
  createdAt: string;
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

export async function countBriefs(): Promise<number> {
  return db().collection(BRIEFS).estimatedDocumentCount();
}
