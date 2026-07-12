// Read-path client for the Mastra Hono API (served at the server root: /briefs, /status).
const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4111';

export interface CompetitorSummary {
  competitor: string;
  status: 'verified' | 'unverified' | 'first_snapshot' | string;
  source?: 'shopify' | 'firecrawl';
  productCount: number;
  newSkus: number;
  priceChanges: number;
  titleChanges: number;
}

export interface Verdict {
  greenLight: boolean;
  violations: string[];
  method?: string | null;
}

export interface BriefSummary {
  briefId: number;
  weekOf: string;
  createdAt: string;
  greenLight: boolean;
  competitors: CompetitorSummary[];
  grounding: Verdict;
  safety: Verdict;
}

export interface BriefDetail extends BriefSummary {
  briefMarkdown: string;
}

export interface Status {
  running: boolean;
  activeRuns: number;
  totalBriefs: number;
  lastBrief: { weekOf: string; greenLight: boolean; createdAt: string; competitorCount: number } | null;
}

async function get<T>(path: string, fallback: T): Promise<T> {
  try {
    const res = await fetch(`${API}${path}`, { cache: 'no-store' });
    if (!res.ok) return fallback;
    return (await res.json()) as T;
  } catch {
    return fallback;
  }
}

export async function getBriefs(): Promise<BriefSummary[]> {
  const data = await get<{ briefs: BriefSummary[] }>('/briefs', { briefs: [] });
  return data.briefs ?? [];
}

export async function getBrief(id: string): Promise<BriefDetail | null> {
  const data = await get<{ brief: BriefDetail | null }>(`/briefs/${encodeURIComponent(id)}`, { brief: null });
  return data.brief ?? null;
}

export async function getStatus(): Promise<Status> {
  return get<Status>('/status', { running: false, activeRuns: 0, totalBriefs: 0, lastBrief: null });
}

// Totals across all competitors in a brief — used for the card stat row.
export function briefTotals(b: BriefSummary) {
  return b.competitors.reduce(
    (acc, c) => ({
      priceChanges: acc.priceChanges + c.priceChanges,
      newSkus: acc.newSkus + c.newSkus,
      titleChanges: acc.titleChanges + c.titleChanges,
      verified: acc.verified + (c.status === 'verified' || c.status === 'first_snapshot' ? 1 : 0),
    }),
    { priceChanges: 0, newSkus: 0, titleChanges: 0, verified: 0 },
  );
}
