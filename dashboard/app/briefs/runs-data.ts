// Server-only: stores and their runs for the Briefs pages.
// INTERIM: built from the latest briefs until the backend's listStores() /
// listRuns() land; the shapes are the shared StoreSummary / RunSummary.
import 'server-only';
import { briefTotals, type BriefSummary, type RunSummary, type StoreSummary } from '@/lib/api';
import { listRecentBriefs } from '@/lib/server/briefs-store';
import { competitorKeyOf, trackingFor } from '@/lib/server/tracking';

const DEMO_STORE = 'injection-demo.test';
const WINDOW = 500;

type ArchiveBrief = BriefSummary & { removedTotal: number };
type Extra = { trigger?: 'added' | 'weekly'; complete?: boolean; needsManualRead?: boolean };

const isRead = (s: string) => s === 'verified' || s === 'first_snapshot';

/** A brief as a run, or null when no store in it could be read. */
function toRun(b: ArchiveBrief): RunSummary | null {
  const read = b.competitors.filter((c) => isRead(c.status));
  if (read.length === 0) return null;
  const t = briefTotals(b);
  return {
    id: b.id,
    createdAt: b.createdAt,
    greenLight: b.greenLight,
    status: read.some((c) => c.status === 'verified') ? 'verified' : 'first_snapshot',
    trigger: (b as Extra).trigger,
    productCount: read.reduce((n, c) => n + c.productCount, 0),
    complete: read.every((c) => (c as Extra).complete !== false) ? undefined : false,
    priceChanges: t.priceChanges,
    newSkus: t.newSkus,
    removed: b.removedTotal,
    titleChanges: t.titleChanges,
  };
}

async function grouped() {
  const briefs = await listRecentBriefs(WINDOW);
  const groups = new Map<string, ArchiveBrief[]>();
  for (const b of briefs) {
    const key = competitorKeyOf(b.competitors.map((c) => c.competitor));
    groups.set(key, [...(groups.get(key) ?? []), b]);
  }
  return groups; // insertion order = newest brief first
}

export async function storesWithRuns(): Promise<{ store: StoreSummary; runs: RunSummary[] }[]> {
  const out = [];
  for (const [key, list] of await grouped()) {
    const latest = list[0];
    const competitors = latest.competitors.map((c) => c.competitor);
    const runs = list.map(toRun).filter((r): r is RunSummary => r !== null);
    const tracking = competitors.includes(DEMO_STORE)
      ? { tracked: false, trackedUntil: null, nextCheck: null }
      : await trackingFor(competitors);
    out.push({
      store: {
        store: competitors.join(', '),
        competitorKey: key,
        latestBriefId: latest.id,
        latestAt: latest.createdAt,
        runCount: runs.length,
        productCount: runs[0]?.productCount ?? null,
        productDelta: runs.length > 1 ? runs[0].productCount - runs[1].productCount : null,
        complete: runs[0]?.complete,
        needsManualRead: latest.competitors.every((c) => (c as Extra).needsManualRead) || undefined,
        tracking,
      },
      runs,
    });
  }
  return out;
}

export async function runsFor(competitors: string[]): Promise<RunSummary[]> {
  const list = (await grouped()).get(competitorKeyOf(competitors)) ?? [];
  return list.map(toRun).filter((r): r is RunSummary => r !== null);
}
