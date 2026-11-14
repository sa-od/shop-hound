import { MongoClient, Binary, type Db } from 'mongodb';
import { attachDatabasePool } from '@vercel/functions';

/**
 * MongoDB Atlas — the one durable store: snapshots (diff baselines), product
 * vectors (closest-product lookup), briefs, and pipeline runs. Collections and
 * indexes are created by `scripts/db-setup.ts`, never at request time.
 */

export const SNAPSHOTS = 'snapshots';
/** A big snapshot's products, split across documents (MongoDB caps one at 16MB). */
export const SNAPSHOT_PARTS = 'snapshot_parts';
export const PRODUCT_VECTORS = 'product_vectors';
export const BRIEFS = 'briefs';
export const RUNS = 'runs';
/** Shared pauses after a rate limit (see throttle.ts). */
export const THROTTLE = 'throttle';

/** Atlas Vector Search index on product_vectors.embedding (see db-setup). */
export const PRODUCT_VECTOR_INDEX = 'product_vector_index';

let client: MongoClient | null = null;

export function mongo(): MongoClient {
  if (!client) {
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error('MONGODB_URI is not set');
    // Small pool: one function instance runs at most a handful of queries at once.
    client = new MongoClient(uri, { maxPoolSize: 10, maxIdleTimeMS: 5_000, appName: 'shophound' });
    // On Vercel Fluid, lets the instance close idle connections before it suspends.
    attachDatabasePool(client);
  }
  return client;
}

/** Database: MONGODB_DB, else the one named in the URI path, else "shophound". */
export function db(): Db {
  const fromUri = (process.env.MONGODB_URI ?? '').match(/^mongodb(?:\+srv)?:\/\/[^/]+\/([^?]+)/)?.[1];
  return mongo().db(process.env.MONGODB_DB || fromUri || 'shophound');
}

/** Close the client — for scripts, so the process can exit. */
export async function closeDb(): Promise<void> {
  if (client) await client.close();
  client = null;
}

/**
 * Embeddings are stored as BSON float32 vectors: 4 bytes per dimension,
 * versus ~14 for a plain array of doubles (BSON stores each array index as a
 * key). Atlas Vector Search indexes this type directly.
 */
export function toVector(values: number[]): Binary {
  return Binary.fromFloat32Array(new Float32Array(values));
}
