import { qdrant, ensureCollections, SNAPSHOT_RECORDS } from './qdrant';
import { embedText } from './embeddings';
import { competitorSnapshotSchema, type CompetitorSnapshot } from './types';

/**
 * Snapshot store backed by Qdrant — the durable half of long-term memory.
 * One point per (competitor, snapshotDate) carrying the full normalized
 * product list as payload. Survives redeploys (cloud instance disks are
 * ephemeral), so week-over-week diffs never lose their baseline.
 */

function pointText(competitor: string, snapshotDate: string): string {
  return `catalog snapshot ${competitor} ${snapshotDate}`;
}

export async function saveSnapshotRecord(snapshot: CompetitorSnapshot): Promise<void> {
  await ensureCollections();
  const vector = await embedText(pointText(snapshot.competitor, snapshot.snapshotDate));
  await qdrant.upsert({
    indexName: SNAPSHOT_RECORDS,
    vectors: [vector],
    metadata: [
      {
        competitor: snapshot.competitor,
        snapshotDate: snapshot.snapshotDate,
        productCount: snapshot.products.length,
        productsJson: JSON.stringify(snapshot.products),
      },
    ],
  });
}

/** Most recent snapshot for a competitor strictly BEFORE the given date. */
export async function getPreviousSnapshotRecord(
  competitor: string,
  beforeDate: string,
): Promise<CompetitorSnapshot | null> {
  await ensureCollections();
  // Filter pins the competitor; the query vector is just a locator. Date
  // selection happens client-side over the (small, weekly) result set.
  const queryVector = await embedText(pointText(competitor, beforeDate));
  const results = await qdrant.query({
    indexName: SNAPSHOT_RECORDS,
    queryVector,
    topK: 52, // a year of weekly snapshots
    filter: { competitor },
  });

  const candidates = results
    .map(r => r.metadata as { competitor: string; snapshotDate: string; productsJson: string })
    .filter(m => m?.snapshotDate && m.snapshotDate < beforeDate)
    .sort((a, b) => b.snapshotDate.localeCompare(a.snapshotDate));

  const latest = candidates[0];
  if (!latest) return null;

  return competitorSnapshotSchema.parse({
    competitor,
    snapshotDate: latest.snapshotDate,
    products: JSON.parse(latest.productsJson),
  });
}
