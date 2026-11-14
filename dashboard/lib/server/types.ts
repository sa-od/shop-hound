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
  source: z.enum(['shopify', 'shopify_relay', 'firecrawl']).optional(), // ingestion path (default shopify)
});
export type CompetitorSnapshot = z.infer<typeof competitorSnapshotSchema>;

// ── Structured diff (deterministic output of the Semantic Diff Engine) ──

export const priceChangeSchema = z.object({
  productId: z.string(),
  // Set when matched to last week's product under a different id (handle match)
  previousProductId: z.string().optional(),
  title: z.string(),
  url: z.string(),
  oldPrice: z.number(),
  newPrice: z.number(),
  changePct: z.number(), // negative = price drop
});

export const titleChangeSchema = z.object({
  productId: z.string(),
  previousProductId: z.string().optional(),
  url: z.string(),
  oldTitle: z.string(),
  newTitle: z.string(),
});

export const skuSummarySchema = z.object({
  productId: z.string(),
  title: z.string(),
  price: z.number(),
  url: z.string(),
  // For NEW SKUs: the competitor's semantically closest existing product
  // (vector search over last week's catalog) — positions the launch inside
  // their own catalog ("sits next to their Aviator line").
  closestExisting: z
    .object({ title: z.string(), price: z.number(), similarity: z.number() })
    .optional(),
});

const namedCountSchema = z.object({ name: z.string(), count: z.number() });
const productRefSchema = z.object({ title: z.string(), price: z.number(), url: z.string() });

/** What a store's catalogue looked like when it was read (see catalog.ts). */
export const catalogSummarySchema = z.object({
  productCount: z.number(),
  currency: z.string(),
  price: z.object({ min: z.number(), median: z.number(), max: z.number() }), // product.price = lowest variant price
  priceBands: z.array(z.object({ label: z.string(), min: z.number().nullable(), max: z.number().nullable(), count: z.number() })), // [min, max)
  // Stock and variants are left out when they weren't actually read (AI-read
  // catalogues have no real availability or variant data).
  inStock: z.number().optional(),
  soldOut: z.number().optional(),
  inStockPct: z.number().optional(), // whole percent, so the brief can cite it
  productTypes: z.array(namedCountSchema), // top 6; "" → "Uncategorised"
  vendors: z.array(namedCountSchema), // top 5
  avgVariants: z.number().optional(), // one decimal
  cheapest: z.array(productRefSchema), // 3, cheapest first
  priciest: z.array(productRefSchema), // 3, priciest first
});
export type CatalogSummary = z.infer<typeof catalogSummarySchema>;

export const competitorDiffSchema = z.object({
  competitor: z.string(),
  status: z.enum(['verified', 'unverified', 'first_snapshot']),
  source: z.enum(['shopify', 'shopify_relay', 'firecrawl']).optional(), // ingestion path (default shopify)
  previousSnapshotDate: z.string().nullable(),
  currentSnapshotDate: z.string(),
  productCount: z.number(),
  newSkus: z.array(skuSummarySchema),
  removedSkus: z.array(skuSummarySchema),
  priceChanges: z.array(priceChangeSchema),
  titleChanges: z.array(titleChangeSchema),
  /** Stores that were read (first_snapshot, verified): today's catalogue. */
  catalog: catalogSummarySchema.optional(),
  /** Unverified stores read on an earlier check: the latest snapshot we have. */
  lastKnown: z.object({ snapshotDate: z.string(), productCount: z.number() }).optional(),
});
export type CompetitorDiff = z.infer<typeof competitorDiffSchema>;

export const structuredDiffSchema = z.object({
  weekOf: z.string(),
  diffs: z.array(competitorDiffSchema),
  unverified: z.array(z.string()), // competitors whose scrape failed this week
  // Why each unverified competitor failed (scrape error, time budget, ...) —
  // shown on the audit trail so a refusal is never a blank.
  unverifiedReasons: z.record(z.string(), z.string()).optional(),
});
export type StructuredDiff = z.infer<typeof structuredDiffSchema>;

// ── Guardrail verdicts (Enkrypt AI sandwich) ──

export const guardrailVerdictSchema = z.object({
  checkpoint: z.enum(['grounding', 'safety']),
  greenLight: z.boolean(),
  enkryptEnabled: z.boolean(), // false when ENKRYPT_API_KEY is missing (never a green light)
  violations: z.array(z.string()),
  warnings: z.array(z.string()).optional(), // recorded, shown, never blocking
  detail: z.record(z.string(), z.unknown()).optional(),
});
export type GuardrailVerdict = z.infer<typeof guardrailVerdictSchema>;
