import { ModelRouterEmbeddingModel } from '@mastra/core/llm';
import { embedMany, embed } from 'ai';
import type { NormalizedProduct } from './types';

// PRD §5.1 / §6: ONE embedding model everywhere (ingestion, diffing, agent queries)
export const EMBEDDING_MODEL_ID = 'openai/text-embedding-3-small';
export const EMBEDDING_DIMENSION = 1536;

// Lazy: constructing the router validates OPENAI_API_KEY, which must not
// happen at import time (before env is loaded).
let _model: ModelRouterEmbeddingModel | null = null;
function embeddingModel(): ModelRouterEmbeddingModel {
  _model ??= new ModelRouterEmbeddingModel(EMBEDDING_MODEL_ID);
  return _model;
}

/**
 * Stable semantic identity for a product. Price is deliberately excluded so a
 * price change does not move the vector — semantic matching should keep
 * identifying the same product across weeks.
 */
export function productToEmbeddingText(p: NormalizedProduct): string {
  return [p.title, p.productType, p.vendor, p.tags.join(' ')].filter(Boolean).join(' | ');
}

export async function embedProducts(products: NormalizedProduct[]): Promise<number[][]> {
  if (products.length === 0) return [];
  const { embeddings } = await embedMany({
    model: embeddingModel(),
    values: products.map(productToEmbeddingText),
  });
  return embeddings;
}

export async function embedText(text: string): Promise<number[]> {
  const { embedding } = await embed({ model: embeddingModel(), value: text });
  return embedding;
}
