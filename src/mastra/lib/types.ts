import { z } from 'zod';

// ── Normalized product (the standardized schema every scrape is reduced to) ──

export const normalizedProductSchema = z.object({
  productId: z.string(),
  handle: z.string(),
  title: z.string(),
  vendor: z.string(),
  productType: z.string(),
  tags: z.array(z.string()),
  price: z.number(), // min variant price
  maxPrice: z.number(),
  currency: z.string(),
  url: z.string(),
  variantCount: z.number(),
  available: z.boolean(),
});
export type NormalizedProduct = z.infer<typeof normalizedProductSchema>;

export const competitorSnapshotSchema = z.object({
  competitor: z.string(), // domain, e.g. "allbirds.com"
  snapshotDate: z.string(), // ISO date (YYYY-MM-DD)
  products: z.array(normalizedProductSchema),
});
export type CompetitorSnapshot = z.infer<typeof competitorSnapshotSchema>;

// ── Structured diff (deterministic output of the Semantic Diff Engine) ──

export const priceChangeSchema = z.object({
  productId: z.string(),
  title: z.string(),
  url: z.string(),
  oldPrice: z.number(),
  newPrice: z.number(),
  changePct: z.number(), // negative = price drop
});

export const titleChangeSchema = z.object({
  productId: z.string(),
  url: z.string(),
  oldTitle: z.string(),
  newTitle: z.string(),
  similarity: z.number().optional(), // cosine score when matched semantically
});

export const skuSummarySchema = z.object({
  productId: z.string(),
  title: z.string(),
  price: z.number(),
  url: z.string(),
});

export const competitorDiffSchema = z.object({
  competitor: z.string(),
  status: z.enum(['verified', 'unverified', 'first_snapshot']),
  previousSnapshotDate: z.string().nullable(),
  currentSnapshotDate: z.string(),
  productCount: z.number(),
  newSkus: z.array(skuSummarySchema),
  removedSkus: z.array(skuSummarySchema),
  priceChanges: z.array(priceChangeSchema),
  titleChanges: z.array(titleChangeSchema),
});
export type CompetitorDiff = z.infer<typeof competitorDiffSchema>;

export const structuredDiffSchema = z.object({
  weekOf: z.string(),
  diffs: z.array(competitorDiffSchema),
  unverified: z.array(z.string()), // competitors whose scrape failed this week
});
export type StructuredDiff = z.infer<typeof structuredDiffSchema>;

// ── Guardrail verdicts (Enkrypt AI sandwich) ──

export const guardrailVerdictSchema = z.object({
  checkpoint: z.enum(['grounding', 'safety']),
  greenLight: z.boolean(),
  enkryptEnabled: z.boolean(), // false when ENKRYPT_API_KEY is missing (never a green light)
  violations: z.array(z.string()),
  detail: z.record(z.string(), z.unknown()).optional(),
});
export type GuardrailVerdict = z.infer<typeof guardrailVerdictSchema>;
