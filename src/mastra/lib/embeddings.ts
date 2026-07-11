import { embedMany, embed } from 'ai';
import { featherlessEmbeddingModel, FEATHERLESS_EMBEDDING_MODEL } from './featherless';
import type { NormalizedProduct } from './types';

// PRD §5.1 / §6: ONE embedding model everywhere (ingestion, diffing, agent queries)
export const EMBEDDING_MODEL_ID = FEATHERLESS_EMBEDDING_MODEL;

let _dimension: number | null = null;

/**
 * Embedding dimension probed from the live model (cached). Keeps the Qdrant
 * collection schema locked to whatever the configured model actually returns —
 * a silent model/dimension mismatch can never happen.
 */
export async function embeddingDimension(): Promise<number> {
  if (_dimension === null) {
    const probe = await embedText('dimension probe');
    _dimension = probe.length;
  }
  return _dimension;
}

/**
 * Stable semantic identity for a product. Price is deliberately excluded so a
 * price change does not move the vector — semantic matching should keep
 * identifying the same product across weeks.
 */
export function productToEmbeddingText(p: NormalizedProduct): string {
  return [p.title, p.productType, p.vendor, p.tags.join(' ')].filter(Boolean).join(' | ');
}

const EMBED_BATCH = 64; // small chunks: fast per call, cheap to retry, resilient to blips
const EMBED_CONCURRENCY = 4; // parallel batches — tune to the Featherless plan's concurrency limit
const EMBED_RETRIES = 4;

async function embedChunk(chunk: string[]): Promise<number[][]> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= EMBED_RETRIES; attempt++) {
    try {
      const { embeddings } = await embedMany({ model: featherlessEmbeddingModel(), values: chunk });
      return embeddings;
    } catch (err) {
      lastErr = err;
      await new Promise(r => setTimeout(r, attempt * 1500)); // backoff for transient DNS/rate blips
    }
  }
  throw lastErr;
}

async function embedValues(values: string[]): Promise<number[][]> {
  const batches: string[][] = [];
  for (let i = 0; i < values.length; i += EMBED_BATCH) batches.push(values.slice(i, i + EMBED_BATCH));

  const results: number[][][] = new Array(batches.length);
  let next = 0;
  async function worker() {
    while (next < batches.length) {
      const idx = next++;
      results[idx] = await embedChunk(batches[idx]); // order preserved via index
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(EMBED_CONCURRENCY, batches.length) }, () => worker()),
  );
  return results.flat();
}

export async function embedProducts(products: NormalizedProduct[]): Promise<number[][]> {
  if (products.length === 0) return [];
  return embedValues(products.map(productToEmbeddingText));
}

export async function embedText(text: string): Promise<number[]> {
  const { embedding } = await embed({
    model: featherlessEmbeddingModel(),
    value: text,
    maxRetries: 4,
  });
  return embedding;
}
