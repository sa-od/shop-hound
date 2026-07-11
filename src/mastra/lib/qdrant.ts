import { QdrantVector } from '@mastra/qdrant';
import { EMBEDDING_DIMENSION } from './embeddings';

// Long-term memory (PRD §5.2): product vectors, brief archive, and durable
// snapshot records (diff baselines must survive redeploys — cloud disks are ephemeral)
export const COMPETITOR_PRODUCTS = 'competitor_products';
export const GROWTH_BRIEFS = 'growth_briefs';
export const SNAPSHOT_RECORDS = 'snapshot_records';

export const qdrant = new QdrantVector({
  id: 'qdrant-vector',
  url: process.env.QDRANT_URL ?? 'http://localhost:6333',
  apiKey: process.env.QDRANT_API_KEY,
});

let ensured = false;

const UPSERT_BATCH = 100;

/** Chunked upsert with retry — large single-shot upserts can hit flaky connects on cloud clusters. */
export async function upsertBatched(args: {
  indexName: string;
  vectors: number[][];
  metadata: Record<string, unknown>[];
}): Promise<number> {
  let upserted = 0;
  for (let i = 0; i < args.vectors.length; i += UPSERT_BATCH) {
    const vectors = args.vectors.slice(i, i + UPSERT_BATCH);
    const metadata = args.metadata.slice(i, i + UPSERT_BATCH);
    let lastErr: unknown;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await qdrant.upsert({ indexName: args.indexName, vectors, metadata });
        lastErr = undefined;
        break;
      } catch (err) {
        lastErr = err;
        await new Promise(r => setTimeout(r, attempt * 2000));
      }
    }
    if (lastErr) throw lastErr;
    upserted += vectors.length;
  }
  return upserted;
}

/** Idempotently create both collections + the payload indexes we filter on. */
export async function ensureCollections(): Promise<void> {
  if (ensured) return;
  const existing = await qdrant.listIndexes();

  for (const indexName of [COMPETITOR_PRODUCTS, GROWTH_BRIEFS, SNAPSHOT_RECORDS]) {
    if (!existing.includes(indexName)) {
      await qdrant.createIndex({ indexName, dimension: EMBEDDING_DIMENSION, metric: 'cosine' });
    }
  }

  // Payload indexes are required on Qdrant Cloud (strict mode) for filtering.
  const payloadIndexes: Array<[string, string, 'keyword']> = [
    [COMPETITOR_PRODUCTS, 'competitor', 'keyword'],
    [COMPETITOR_PRODUCTS, 'snapshotDate', 'keyword'],
    [GROWTH_BRIEFS, 'weekOf', 'keyword'],
    [SNAPSHOT_RECORDS, 'competitor', 'keyword'],
    [SNAPSHOT_RECORDS, 'snapshotDate', 'keyword'],
  ];
  for (const [indexName, fieldName, fieldSchema] of payloadIndexes) {
    try {
      await qdrant.createPayloadIndex({ indexName, fieldName, fieldSchema });
    } catch {
      // already exists — fine
    }
  }
  ensured = true;
}
