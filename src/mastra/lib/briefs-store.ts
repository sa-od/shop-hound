import { QdrantClient } from '@qdrant/js-client-rest';
import { GROWTH_BRIEFS } from './qdrant';

/**
 * Read path for the dashboard (PRD §5.4). Lists/reads archived Growth Briefs
 * from the durable Qdrant `growth_briefs` collection. Uses the raw QdrantClient
 * because the @mastra/qdrant `QdrantVector` wrapper exposes no scroll/list API.
 */

let _client: QdrantClient | null = null;
function client(): QdrantClient {
  _client ??= new QdrantClient({
    url: process.env.QDRANT_URL ?? 'http://localhost:6333',
    apiKey: process.env.QDRANT_API_KEY,
  });
  return _client;
}

export interface CompetitorSummary {
  competitor: string;
  status: string;
  source?: 'shopify' | 'firecrawl';
  productCount: number;
  newSkus: number;
  priceChanges: number;
  titleChanges: number;
}

export interface BriefSummary {
  briefId: number;
  weekOf: string;
  createdAt: string;
  greenLight: boolean;
  competitors: CompetitorSummary[];
  grounding: { greenLight: boolean; violations: string[] };
  safety: { greenLight: boolean; violations: string[]; method: string | null };
}

export interface BriefDetail extends BriefSummary {
  briefMarkdown: string;
}

function toDetail(payload: Record<string, unknown>): BriefDetail {
  return {
    briefId: Number(payload.briefId ?? 0),
    weekOf: String(payload.weekOf ?? ''),
    createdAt: String(payload.createdAt ?? ''),
    greenLight: Boolean(payload.greenLight),
    briefMarkdown: String(payload.briefMarkdown ?? ''),
    competitors: (payload.competitors as CompetitorSummary[]) ?? [],
    grounding: (payload.grounding as BriefDetail['grounding']) ?? { greenLight: false, violations: [] },
    safety:
      (payload.safety as BriefDetail['safety']) ?? { greenLight: false, violations: [], method: null },
  };
}

async function scrollPage(offset: string | number | undefined) {
  // Retry transient network blips (flaky DNS on the Qdrant cloud host)
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      return await client().scroll(GROWTH_BRIEFS, {
        limit: 100,
        with_payload: true,
        with_vector: false,
        offset: offset ?? undefined,
      });
    } catch (err) {
      lastErr = err;
      await new Promise(r => setTimeout(r, attempt * 500));
    }
  }
  throw lastErr;
}

/** Scroll every archived brief, newest first, deduped by weekOf (keep newest createdAt). */
async function scrollAll(): Promise<BriefDetail[]> {
  const briefs: BriefDetail[] = [];
  let offset: string | number | undefined | null = undefined;

  do {
    const res = await scrollPage(offset ?? undefined);
    for (const p of res.points) {
      if (p.payload) briefs.push(toDetail(p.payload as Record<string, unknown>));
    }
    offset = res.next_page_offset as typeof offset;
  } while (offset !== null && offset !== undefined);

  // dedupe by (weekOf + competitor set) → keep the most recent createdAt.
  // A re-run of the same competitors in a week replaces its card; a different
  // set is its own card. Derive the key from competitors so points written
  // before `competitorKey` existed still dedupe correctly.
  const byKey = new Map<string, BriefDetail>();
  for (const b of briefs) {
    const competitorKey = b.competitors.map(c => c.competitor).sort().join(',');
    const key = `${b.weekOf}|${competitorKey}`;
    const existing = byKey.get(key);
    if (!existing || b.createdAt > existing.createdAt) byKey.set(key, b);
  }
  return [...byKey.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function listBriefs(): Promise<BriefSummary[]> {
  const all = await scrollAll();
  // strip the heavy markdown for the list view
  return all.map(({ briefMarkdown, ...summary }) => summary);
}

/**
 * Look up a single brief. The canonical key is the createdAt epoch (unique per
 * run, and URL-safe — raw ISO timestamps with ':' and '.' break Next/Vercel
 * dynamic-route matching). Falls back to the raw createdAt / weekOf / briefId
 * for older links — those may be ambiguous now that a week can hold several
 * briefs, so the newest match (scrollAll is sorted desc) wins.
 */
export async function getBrief(id: string): Promise<BriefDetail | null> {
  const all = await scrollAll();
  return (
    all.find(b => String(Date.parse(b.createdAt)) === id) ??
    all.find(b => b.createdAt === id) ??
    all.find(b => b.weekOf === id || String(b.briefId) === id) ??
    null
  );
}
