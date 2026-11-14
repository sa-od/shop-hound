// Server-only: stores and their runs for the Briefs pages.
import 'server-only';
import type { RunSummary, StoreSummary } from '@/lib/api';
import { listRuns, listStores } from '@/lib/server/briefs-store';
import { competitorKeyOf } from '@/lib/server/tracking';

/** Every store, latest first, each with its readable runs (newest first). */
export async function storesWithRuns(): Promise<{ store: StoreSummary; runs: RunSummary[] }[]> {
  const stores = await listStores();
  return Promise.all(
    stores.map(async (store) => ({ store, runs: store.runCount > 0 ? await listRuns(store.competitorKey) : [] })),
  );
}

/** One store's readable runs, newest first. */
export function runsFor(competitors: string[]): Promise<RunSummary[]> {
  return listRuns(competitorKeyOf(competitors));
}
