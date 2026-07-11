import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

/**
 * Featherless AI — OpenAI-compatible inference for both the reasoning model
 * and embeddings. Replaces the OpenAI dependency entirely.
 */

// Llama-3.3-70B is gated on Featherless (requires HF connect); Qwen2.5-72B is
// ungated, equally strong at instruction-following, and answers without <think> blocks.
export const FEATHERLESS_CHAT_MODEL =
  process.env.FEATHERLESS_CHAT_MODEL ?? 'Qwen/Qwen2.5-72B-Instruct';
// 0.6B (not 8B): ~13x faster on the concurrency-limited plan, ample for matching
// short product titles. 8B took ~6min for 1000 products — unusable for weekly multi-competitor runs.
export const FEATHERLESS_EMBEDDING_MODEL =
  process.env.FEATHERLESS_EMBEDDING_MODEL ?? 'Qwen/Qwen3-Embedding-0.6B';

let _provider: ReturnType<typeof createOpenAICompatible> | null = null;

function provider() {
  const apiKey = process.env.FEATHERLESS_API_KEY;
  if (!apiKey) throw new Error('FEATHERLESS_API_KEY not set');
  _provider ??= createOpenAICompatible({
    name: 'featherless',
    baseURL: process.env.FEATHERLESS_BASE_URL ?? 'https://api.featherless.ai/v1',
    apiKey,
  });
  return _provider;
}

export function featherlessChatModel() {
  return provider().chatModel(FEATHERLESS_CHAT_MODEL);
}

export function featherlessEmbeddingModel() {
  return provider().textEmbeddingModel(FEATHERLESS_EMBEDDING_MODEL);
}
