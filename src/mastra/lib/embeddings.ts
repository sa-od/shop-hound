import { embedMany, embed } from 'ai';
import {
  openaiEmbeddingModel,
  OPENAI_EMBEDDING_MODEL,
  EMBEDDING_DIMENSIONS,
  EMBEDDING_PROVIDER_OPTIONS,
} from './openai';
import type { NormalizedProduct } from './types';

// PRD §5.1 / §6: ONE embedding model everywhere (ingestion, diffing, agent queries)
export const EMBEDDING_MODEL_ID = OPENAI_EMBEDDING_MODEL;

let _dimension: number | null = null;

/**
 * Embedding dimension probed from the live model (cached). We ask for
 * EMBEDDING_DIMENSIONS explicitly, but we still probe rather than trust the
 * constant: if a provider or model ever ignores the `dimensions` parameter we
 * want to fail here, loudly, instead of writing wrong-width vectors at every
 * Qdrant collection created from this number.
 */
export async function embeddingDimension(): Promise<number> {
  if (_dimension === null) {
    const probe = await embedText('dimension probe');
    if (probe.length !== EMBEDDING_DIMENSIONS) {
      throw new Error(
        `Embedding width mismatch: ${EMBEDDING_MODEL_ID} returned ${probe.length} dims, ` +
          `but ${EMBEDDING_DIMENSIONS} was requested. The Qdrant collections are fixed at ` +
          `${EMBEDDING_DIMENSIONS} — see EMBEDDING_DIMENSIONS in lib/openai.ts.`,
      );
    }
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

// OpenAI accepts up to 2048 inputs per embeddings call, so bigger batches and
// less parallelism means far fewer requests for the same work — which is what
// rate limits actually count. 256 short product strings is ~8k tokens, well
// under the per-request token ceiling, and still cheap to retry.
const EMBED_BATCH = 256;
const EMBED_CONCURRENCY = 2;
const EMBED_RETRIES = 4;

async function embedChunk(chunk: string[]): Promise<number[][]> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= EMBED_RETRIES; attempt++) {
    try {
      const { embeddings } = await embedMany({
        model: openaiEmbeddingModel(),
        values: chunk,
        providerOptions: EMBEDDING_PROVIDER_OPTIONS,
      });
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
    model: openaiEmbeddingModel(),
    value: text,
    maxRetries: 4,
    providerOptions: EMBEDDING_PROVIDER_OPTIONS,
  });
  return embedding;
}
