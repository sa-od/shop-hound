import { createHash } from 'node:crypto';
import { db, toVector, SNAPSHOTS, SNAPSHOT_PARTS, PRODUCT_VECTORS, PRODUCT_VECTOR_INDEX } from './db';
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
  source: 'shopify' | 'shopify_relay' | 'firecrawl';
  /** false = time ran out before the last page (absent on older snapshots = complete). */
  complete?: boolean;
  productCount: number;
  /** All products — or empty when the snapshot is split into `parts` (see PART_SIZE). */
  products: NormalizedProduct[];
  parts?: number;
  createdAt: Date;
}

interface SnapshotPartDoc {
  _id: string;
  snapshotId: string;
  part: number;
  products: NormalizedProduct[];
}

// MongoDB caps a document at 16MB — about 27,000 products at ~590 bytes each.
// Snapshots bigger than this many products are stored in parts, so a
// catalogue of any size can be saved.
const PART_SIZE = 10_000;

/** A snapshot document's products, wherever they are stored. */
async function productsOf(doc: SnapshotDoc): Promise<NormalizedProduct[]> {
  if (!doc.parts) return doc.products;
  const parts = await db().collection<SnapshotPartDoc>(SNAPSHOT_PARTS).find({ snapshotId: doc._id }).sort({ part: 1 }).toArray();
  if (parts.length !== doc.parts) throw new Error(`snapshot ${doc._id}: ${parts.length} of ${doc.parts} parts found`);
  return parts.flatMap(p => p.products);
}

interface ProductVectorDoc {
  _id: string;
  competitor: string;
  snapshotDate: string;
  productId: string;
  title: string;
  price: number;
  /** Hash of the text that was embedded — lets the next run reuse the vector if it is unchanged. */
  textKey?: string;
  embedding: ReturnType<typeof toVector>;
}

/** Stable key for an embedding's input text. */
export const embeddingTextKey = (text: string) => createHash('sha1').update(text).digest('base64url');

const snapshotId = (competitor: string, date: string) => `${competitor}|${date}`;

// Keep embeddings for only the newest N snapshots per store: the lookup only
// ever reads the previous one, and vectors are most of the storage.
const KEEP_VECTOR_SNAPSHOTS = 2;
const VECTOR_WRITE_BATCH = 500;

/**
 * Save a snapshot and its product embeddings (idempotent — re-runs overwrite).
 * `vectors[i]` may be null (no time to embed it): that product just has no
 * vector, so it is never offered as a new product's closest match.
 */
export async function saveSnapshot(snapshot: CompetitorSnapshot, vectors: (number[] | null)[], textKeys: string[] = []): Promise<void> {
  const { competitor, snapshotDate } = snapshot;
  const id = snapshotId(competitor, snapshotDate);
  const split = snapshot.products.length > PART_SIZE;
  const partsColl = db().collection<SnapshotPartDoc>(SNAPSHOT_PARTS);
  // Parts first, then the document that points at them, so a reader never
  // sees a pointer to parts that aren't written yet. A same-day re-run
  // replaces both.
  await partsColl.deleteMany({ snapshotId: id });
  let parts = 0;
  if (split) {
    for (let i = 0; i < snapshot.products.length; i += PART_SIZE, parts++) {
      await partsColl.insertOne({ _id: `${id}#${parts}`, snapshotId: id, part: parts, products: snapshot.products.slice(i, i + PART_SIZE) });
    }
  }
  await db()
    .collection<SnapshotDoc>(SNAPSHOTS)
    .replaceOne(
      { _id: id },
      {
        competitor,
        snapshotDate,
        source: snapshot.source ?? 'shopify',
        complete: snapshot.complete !== false,
        productCount: snapshot.products.length,
        products: split ? [] : snapshot.products,
        ...(split ? { parts } : {}),
        createdAt: new Date(),
      },
      { upsert: true },
    );

  // Replace this snapshot's vectors wholesale: delete, then plain inserts.
  // Much faster than per-document upserts on a shared Atlas tier, and a
  // re-run's leftover vectors (products since removed) don't linger.
  const coll = db().collection<ProductVectorDoc>(PRODUCT_VECTORS);
  await coll.deleteMany({ competitor, snapshotDate });
  const docs = snapshot.products.flatMap((p, i) =>
    vectors[i]
      ? [{
          _id: `${competitor}|${snapshotDate}|${p.productId}`,
          competitor,
          snapshotDate,
          productId: p.productId,
          title: p.title,
          price: p.price,
          ...(textKeys[i] ? { textKey: textKeys[i] } : {}),
          embedding: toVector(vectors[i]!),
        }]
      : [],
  );
  for (let i = 0; i < docs.length; i += VECTOR_WRITE_BATCH) {
    await coll.insertMany(docs.slice(i, i + VECTOR_WRITE_BATCH), { ordered: false });
  }

  // Retention: drop vectors for all but the newest snapshots of this store.
  const keepDates = await coll
    .distinct('snapshotDate', { competitor })
    .then(dates => (dates as string[]).sort().slice(-KEEP_VECTOR_SNAPSHOTS));
  await coll.deleteMany({ competitor, snapshotDate: { $nin: keepDates } });
}

/**
 * Only full catalogues (the store's own /products.json, read directly or via
 * the relay) can be compared week over week. An AI read covers a few pages,
 * so diffing against one invents hundreds of "removed" products and price
 * changes from misreads — all labelled verified, and all passing grounding.
 */
export const isFullCatalog = (source: string | undefined, complete?: boolean) => source !== 'firecrawl' && complete !== false;

/**
 * Most recent FULL-catalogue snapshot for a competitor strictly BEFORE the
 * given date (AI reads in between are skipped — see isFullCatalog).
 */
export async function getPreviousSnapshot(competitor: string, beforeDate: string): Promise<CompetitorSnapshot | null> {
  const doc = await db()
    .collection<SnapshotDoc>(SNAPSHOTS)
    .find({ competitor, snapshotDate: { $lt: beforeDate }, source: { $ne: 'firecrawl' }, complete: { $ne: false } })
    .sort({ snapshotDate: -1 })
    .limit(1)
    .next();
  if (!doc) return null;
  try {
    return competitorSnapshotSchema.parse({
      competitor,
      snapshotDate: doc.snapshotDate,
      products: await productsOf(doc),
      source: doc.source,
      ...(doc.complete === false ? { complete: false } : {}),
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

/**
 * Vectors from the store's latest embedded snapshot, keyed by product id, for
 * reuse: a product whose embedding text is unchanged keeps its vector instead
 * of being embedded again — on a big catalogue, embedding is most of a run.
 */
export async function loadReusableVectors(competitor: string): Promise<Map<string, { textKey: string; vector: number[] }>> {
  const coll = db().collection<ProductVectorDoc>(PRODUCT_VECTORS);
  const latest = await coll.find({ competitor, textKey: { $exists: true } }, { projection: { snapshotDate: 1 } }).sort({ snapshotDate: -1 }).limit(1).next();
  if (!latest) return new Map();
  const out = new Map<string, { textKey: string; vector: number[] }>();
  for await (const d of coll.find({ competitor, snapshotDate: latest.snapshotDate, textKey: { $exists: true } }, { projection: { productId: 1, textKey: 1, embedding: 1 } })) {
    out.set(d.productId, { textKey: d.textKey!, vector: Array.from(d.embedding.toFloat32Array()) });
  }
  return out;
}

/**
 * Date and size of a store's latest FULL-catalogue snapshot, without loading
 * its products. Partial reads (AI-read, or cut off by time) are skipped: their
 * product count is not the store's size.
 */
export async function getLatestSnapshotInfo(competitor: string): Promise<{ snapshotDate: string; productCount: number } | null> {
  const [doc] = await db()
    .collection<SnapshotDoc>(SNAPSHOTS)
    .aggregate<{ snapshotDate: string; productCount: number }>([
      { $match: { competitor, source: { $ne: 'firecrawl' }, complete: { $ne: false } } },
      { $sort: { snapshotDate: -1 } },
      { $limit: 1 },
      // productCount is stored on every snapshot (and is the only count for one split into parts).
      { $project: { _id: 0, snapshotDate: 1, productCount: { $ifNull: ['$productCount', { $size: { $ifNull: ['$products', []] } }] } } },
    ])
    .toArray();
  return doc ?? null;
}
