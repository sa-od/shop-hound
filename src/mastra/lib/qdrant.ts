import { QdrantVector } from '@mastra/qdrant';
import { EMBEDDING_DIMENSION } from './embeddings';

// Long-term semantic memory (PRD §5.2): two collections
export const COMPETITOR_PRODUCTS = 'competitor_products';
export const GROWTH_BRIEFS = 'growth_briefs';

export const qdrant = new QdrantVector({
  id: 'qdrant-vector',
  url: process.env.QDRANT_URL ?? 'http://localhost:6333',
  apiKey: process.env.QDRANT_API_KEY,
});

let ensured = false;

/** Idempotently create both collections + the payload indexes we filter on. */
export async function ensureCollections(): Promise<void> {
  if (ensured) return;
  const existing = await qdrant.listIndexes();

  for (const indexName of [COMPETITOR_PRODUCTS, GROWTH_BRIEFS]) {
    if (!existing.includes(indexName)) {
      await qdrant.createIndex({ indexName, dimension: EMBEDDING_DIMENSION, metric: 'cosine' });
    }
  }

  // Payload indexes are required on Qdrant Cloud (strict mode) for filtering.
  const payloadIndexes: Array<[string, string, 'keyword']> = [
    [COMPETITOR_PRODUCTS, 'competitor', 'keyword'],
    [COMPETITOR_PRODUCTS, 'snapshotDate', 'keyword'],
    [GROWTH_BRIEFS, 'weekOf', 'keyword'],
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
