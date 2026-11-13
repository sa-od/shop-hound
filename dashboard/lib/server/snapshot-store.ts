import { db, toVector, SNAPSHOTS, PRODUCT_VECTORS, PRODUCT_VECTOR_INDEX } from './db';
import { competitorSnapshotSchema, type CompetitorSnapshot, type NormalizedProduct } from './types';

/**
 * Snapshot store. One document per (competitor, snapshotDate) holding the full
 * normalized product list — the "before" side of next week's diff — plus one
 * small document per product carrying its embedding, used only to find a new
 * SKU's closest existing product.
 */

interface SnapshotDoc {
  _id: string;
  competitor: string;
  snapshotDate: string;
  source: 'shopify' | 'firecrawl';
  productCount: number;
  products: NormalizedProduct[];
  createdAt: Date;
}

interface ProductVectorDoc {
  _id: string;
  competitor: string;
  snapshotDate: string;
  productId: string;
  title: string;
  price: number;
  embedding: ReturnType<typeof toVector>;
}

const snapshotId = (competitor: string, date: string) => `${competitor}|${date}`;

// Keep embeddings for only the newest N snapshots per store: the lookup only
// ever reads the previous one, and vectors are most of the storage.
const KEEP_VECTOR_SNAPSHOTS = 2;
const VECTOR_WRITE_BATCH = 500;

/** Save a snapshot and its product embeddings (idempotent — re-runs overwrite). */
export async function saveSnapshot(snapshot: CompetitorSnapshot, vectors: number[][]): Promise<void> {
  const { competitor, snapshotDate } = snapshot;
  await db()
    .collection<SnapshotDoc>(SNAPSHOTS)
    .replaceOne(
      { _id: snapshotId(competitor, snapshotDate) },
      {
        competitor,
        snapshotDate,
        source: snapshot.source ?? 'shopify',
        productCount: snapshot.products.length,
        products: snapshot.products,
        createdAt: new Date(),
      },
      { upsert: true },
    );

  // Replace this snapshot's vectors wholesale: delete, then plain inserts.
  // Much faster than per-document upserts on a shared Atlas tier, and a
  // re-run's leftover vectors (products since removed) don't linger.
  const coll = db().collection<ProductVectorDoc>(PRODUCT_VECTORS);
  await coll.deleteMany({ competitor, snapshotDate });
  const docs = snapshot.products.map((p, i) => ({
    _id: `${competitor}|${snapshotDate}|${p.productId}`,
    competitor,
    snapshotDate,
    productId: p.productId,
    title: p.title,
    price: p.price,
    embedding: toVector(vectors[i]),
  }));
  for (let i = 0; i < docs.length; i += VECTOR_WRITE_BATCH) {
    await coll.insertMany(docs.slice(i, i + VECTOR_WRITE_BATCH), { ordered: false });
  }

  // Retention: drop vectors for all but the newest snapshots of this store.
  const keepDates = await coll
    .distinct('snapshotDate', { competitor })
    .then(dates => (dates as string[]).sort().slice(-KEEP_VECTOR_SNAPSHOTS));
  await coll.deleteMany({ competitor, snapshotDate: { $nin: keepDates } });
}

/** Most recent snapshot for a competitor strictly BEFORE the given date. */
export async function getPreviousSnapshot(competitor: string, beforeDate: string): Promise<CompetitorSnapshot | null> {
  const doc = await db()
    .collection<SnapshotDoc>(SNAPSHOTS)
    .find({ competitor, snapshotDate: { $lt: beforeDate } })
    .sort({ snapshotDate: -1 })
    .limit(1)
    .next();
  if (!doc) return null;
  try {
    return competitorSnapshotSchema.parse({
      competitor,
      snapshotDate: doc.snapshotDate,
      products: doc.products,
      source: doc.source,
    });
  } catch (err) {
    throw new Error(
      `Invalid snapshot for ${competitor} @ ${doc.snapshotDate}: ${err instanceof Error ? err.message : err}`,
    );
  }
}

export interface ClosestProduct {
  title: string;
  price: number;
  similarity: number;
}

/**
 * The competitor's semantically closest product in a given snapshot. Exact
 * (not approximate) search: the candidate set is one store's catalog, a few
 * hundred vectors, so exact costs nothing and is deterministic.
 */
export async function findClosestProduct(
  competitor: string,
  snapshotDate: string,
  vector: number[],
): Promise<ClosestProduct | null> {
  const [hit] = await db()
    .collection(PRODUCT_VECTORS)
    .aggregate<{ title: string; price: number; score: number }>([
      {
        $vectorSearch: {
          index: PRODUCT_VECTOR_INDEX,
          path: 'embedding',
          queryVector: toVector(vector),
          exact: true,
          limit: 1,
          filter: { competitor, snapshotDate },
        },
      },
      { $project: { _id: 0, title: 1, price: 1, score: { $meta: 'vectorSearchScore' } } },
    ])
    .toArray();
  if (!hit) return null;
  // Atlas normalises cosine scores to [0, 1] as (1 + cos) / 2; convert back
  // so "similarity" means cosine, as it did before.
  const cosine = 2 * hit.score - 1;
  return { title: hit.title, price: hit.price, similarity: Math.round(cosine * 100) / 100 };
}

/** Date and size of a store's latest snapshot, without loading its products. */
export async function getLatestSnapshotInfo(competitor: string): Promise<{ snapshotDate: string; productCount: number } | null> {
  const [doc] = await db()
    .collection<SnapshotDoc>(SNAPSHOTS)
    .aggregate<{ snapshotDate: string; productCount: number }>([
      { $match: { competitor } },
      { $sort: { snapshotDate: -1 } },
      { $limit: 1 },
      { $project: { _id: 0, snapshotDate: 1, productCount: { $size: { $ifNull: ['$products', []] } } } },
    ])
    .toArray();
  return doc ?? null;
}
