/**
 * One-time MongoDB setup — collections, indexes, and the Atlas Vector Search
 * index. Idempotent; safe to re-run. Not called from the request path.
 *
 *   npx tsx --env-file=.env.local scripts/db-setup.ts
 */
import { db, closeDb, SNAPSHOTS, PRODUCT_VECTORS, BRIEFS, RUNS, PRODUCT_VECTOR_INDEX } from '../lib/server/db';
import { EMBEDDING_DIMENSIONS } from '../lib/server/openai';

async function ensureCollection(name: string) {
  const exists = await db().listCollections({ name }, { nameOnly: true }).hasNext();
  if (!exists) {
    await db().createCollection(name);
    console.log(`created collection ${name}`);
  }
}

async function main() {
  for (const name of [SNAPSHOTS, PRODUCT_VECTORS, BRIEFS, RUNS]) await ensureCollection(name);

  // Diff baseline lookup: latest snapshot for a competitor before a date.
  await db().collection(SNAPSHOTS).createIndex({ competitor: 1, snapshotDate: -1 });
  // Retention sweep + distinct dates per competitor.
  await db().collection(PRODUCT_VECTORS).createIndex({ competitor: 1, snapshotDate: 1 });
  // One brief per (week, competitor set) — re-runs overwrite.
  await db().collection(BRIEFS).createIndex({ weekOf: 1, competitorKey: 1 }, { unique: true });
  await db().collection(BRIEFS).createIndex({ createdAt: -1 });
  await db().collection(BRIEFS).createIndex({ 'competitors.competitor': 1, createdAt: -1 });
  // At most ONE running run, enforced by the database: a second insert with
  // status 'running' fails with a duplicate-key error.
  await db()
    .collection(RUNS)
    .createIndex({ status: 1 }, { unique: true, partialFilterExpression: { status: 'running' }, name: 'one_active_run' });
  await db().collection(RUNS).createIndex({ startedAt: -1 });
  // Queue: a store is queued or running at most once (see runs.ts).
  await db()
    .collection(RUNS)
    .createIndex({ competitorKey: 1 }, { unique: true, partialFilterExpression: { active: true }, name: 'one_active_per_store' });
  // Queue: claim the oldest queued run; status/last-finished lookups.
  await db().collection(RUNS).createIndex({ status: 1, queuedAt: 1 });
  await db().collection(RUNS).createIndex({ finishedAt: -1 });
  // Tracking: latest successful dashboard run per store set.
  await db().collection(RUNS).createIndex({ trigger: 1, status: 1, startedAt: -1 });
  // Tracking: latest brief per store set (decides when a set is due).
  await db().collection(BRIEFS).createIndex({ competitorKey: 1, createdAt: -1 });
  console.log('indexes ok');

  // Atlas Vector Search index (Atlas only — not available on self-hosted mongod).
  const vectors = db().collection(PRODUCT_VECTORS);
  const existing = await vectors.listSearchIndexes(PRODUCT_VECTOR_INDEX).toArray();
  if (existing.length === 0) {
    await vectors.createSearchIndex({
      name: PRODUCT_VECTOR_INDEX,
      type: 'vectorSearch',
      definition: {
        fields: [
          { type: 'vector', path: 'embedding', numDimensions: EMBEDDING_DIMENSIONS, similarity: 'cosine' },
          { type: 'filter', path: 'competitor' },
          { type: 'filter', path: 'snapshotDate' },
        ],
      },
    });
    console.log(`created vector index ${PRODUCT_VECTOR_INDEX} — Atlas builds it in the background (~1 min)`);
  } else {
    const idx = existing[0] as { status?: string; queryable?: boolean };
    console.log(`vector index ${PRODUCT_VECTOR_INDEX}: status=${idx.status} queryable=${idx.queryable}`);
  }
  console.log('done');
}

main()
  .catch(err => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(closeDb);
