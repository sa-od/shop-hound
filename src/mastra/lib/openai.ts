import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

/**
 * OpenAI — one OpenAI-compatible endpoint for both the reasoning model and
 * embeddings. Replaces Featherless, whose subscription lapsed and took the
 * weekly run down for a month (Aug 17 - Sep 7 2026) because every call 403'd.
 */

// Small tier on purpose: this workload is one brief a week plus short product
// strings, so cost and uptime matter far more than capability headroom.
// Override per-environment if a cheaper/newer small model appears.
export const OPENAI_CHAT_MODEL = process.env.OPENAI_CHAT_MODEL ?? 'gpt-4o-mini';
export const OPENAI_EMBEDDING_MODEL =
  process.env.OPENAI_EMBEDDING_MODEL ?? 'text-embedding-3-small';

/**
 * Pinned to 1024 — deliberately NOT text-embedding-3-small's native 1536.
 *
 * A Qdrant collection's vector width is fixed at creation, and all three of
 * ours were created at 1024 (the old Qwen3-Embedding-0.6B width). OpenAI's v3
 * embedding models support shortening via the `dimensions` request parameter,
 * so pinning here lets the existing collections keep working — which preserves
 * `snapshot_records` (whose payload holds the week-over-week diff baselines)
 * and the `growth_briefs` archive that feeds the trends section.
 *
 * Changing this number means recreating every collection and losing both.
 */
export const EMBEDDING_DIMENSIONS = 1024;

/**
 * providerOptions namespace for the `dimensions` parameter. 'openaiCompatible'
 * is the package's stable key — it does not depend on the provider `name`
 * below, so renaming the provider cannot silently drop the pin.
 */
export const EMBEDDING_PROVIDER_OPTIONS = {
  openaiCompatible: { dimensions: EMBEDDING_DIMENSIONS },
} as const;

let _provider: ReturnType<typeof createOpenAICompatible> | null = null;

function provider() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not set');
  _provider ??= createOpenAICompatible({
    name: 'openai',
    baseURL: process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
    apiKey,
  });
  return _provider;
}

export function openaiChatModel() {
  return provider().chatModel(OPENAI_CHAT_MODEL);
}

export function openaiEmbeddingModel() {
  return provider().textEmbeddingModel(OPENAI_EMBEDDING_MODEL);
}
