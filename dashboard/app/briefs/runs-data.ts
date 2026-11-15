// Server-only: stores and their runs for the Briefs pages.
import 'server-only';
import type { RunSummary, StoreSummary } from '@/lib/api';
import { listRuns, listRunsForKeys, listStores } from '@/lib/server/briefs-store';
import { competitorKeyOf } from '@/lib/server/tracking';

/** Every store, latest first, each with its readable runs (newest first). */
export async function storesWithRuns(): Promise<{ store: StoreSummary; runs: RunSummary[] }[]> {
  const stores = await listStores();
  // One query for every store's runs.
  const runs = await listRunsForKeys(stores.filter((s) => s.runCount > 0).map((s) => s.competitorKey));
  return stores.map((store) => ({ store, runs: runs.get(store.competitorKey) ?? [] }));
}

/** One store's readable runs, newest first. */
export function runsFor(competitors: string[]): Promise<RunSummary[]> {
  return listRuns(competitorKeyOf(competitors));
}
