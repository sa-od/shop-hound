import { qdrant, COMPETITOR_PRODUCTS } from './qdrant';
import { embedProducts } from './embeddings';
import type { CompetitorDiff, CompetitorSnapshot, NormalizedProduct } from './types';

/**
 * Semantic Diff Engine (PRD §5.2) — a DETERMINISTIC service, no LLM involved.
 *
 * 1. Exact matching by productId → price changes, title changes.
 * 2. For unmatched products, semantic matching via Qdrant cosine similarity
 *    against last week's snapshot vectors — catches retitled/rebranded SKUs
 *    that ID matching misses.
 * 3. Leftovers → genuinely new / removed SKUs.
 */

// Tuned for Qwen3-Embedding space: renamed-same-product ≈ 0.98, similar-but-
// different products ≈ 0.89. 0.93 gives margin on both sides.
const SEMANTIC_MATCH_THRESHOLD = 0.93;

export async function diffSnapshots(
  current: CompetitorSnapshot,
  previous: CompetitorSnapshot | null,
): Promise<CompetitorDiff> {
  const base: Omit<CompetitorDiff, 'newSkus' | 'removedSkus' | 'priceChanges' | 'titleChanges'> = {
    competitor: current.competitor,
    status: previous ? 'verified' : 'first_snapshot',
    previousSnapshotDate: previous?.snapshotDate ?? null,
    currentSnapshotDate: current.snapshotDate,
    productCount: current.products.length,
  };

  if (!previous) {
    return { ...base, newSkus: [], removedSkus: [], priceChanges: [], titleChanges: [] };
  }

  const prevById = new Map(previous.products.map(p => [p.productId, p]));
  const matchedPrevIds = new Set<string>();

  const priceChanges: CompetitorDiff['priceChanges'] = [];
  const titleChanges: CompetitorDiff['titleChanges'] = [];
  const unmatchedCurrent: NormalizedProduct[] = [];

  // Pass 1 — exact ID matching (deterministic)
  for (const cur of current.products) {
    const prev = prevById.get(cur.productId);
    if (!prev) {
      unmatchedCurrent.push(cur);
      continue;
    }
    matchedPrevIds.add(prev.productId);
    recordChanges(cur, prev, priceChanges, titleChanges);
  }

  // Pass 2 — semantic matching via Qdrant for products whose ID changed
  const stillUnmatched: NormalizedProduct[] = [];
  if (unmatchedCurrent.length > 0) {
    const vectors = await embedProducts(unmatchedCurrent);
    for (let i = 0; i < unmatchedCurrent.length; i++) {
      const cur = unmatchedCurrent[i];
      const results = await qdrant.query({
        indexName: COMPETITOR_PRODUCTS,
        queryVector: vectors[i],
        topK: 1,
        filter: { competitor: current.competitor, snapshotDate: previous.snapshotDate },
      });
      const hit = results[0];
      const prev =
        hit && hit.score >= SEMANTIC_MATCH_THRESHOLD
          ? previous.products.find(
              p => p.productId === (hit.metadata?.productId as string) && !matchedPrevIds.has(p.productId),
            )
          : undefined;

      if (prev) {
        matchedPrevIds.add(prev.productId);
        recordChanges(cur, prev, priceChanges, titleChanges, hit.score);
      } else {
        stillUnmatched.push(cur);
      }
    }
  }

  const newSkus = stillUnmatched.map(toSummary);
  const removedSkus = previous.products.filter(p => !matchedPrevIds.has(p.productId)).map(toSummary);

  return { ...base, newSkus, removedSkus, priceChanges, titleChanges };
}

function recordChanges(
  cur: NormalizedProduct,
  prev: NormalizedProduct,
  priceChanges: CompetitorDiff['priceChanges'],
  titleChanges: CompetitorDiff['titleChanges'],
  similarity?: number,
) {
  if (cur.price !== prev.price && prev.price > 0) {
    priceChanges.push({
      productId: cur.productId,
      title: cur.title,
      url: cur.url,
      oldPrice: prev.price,
      newPrice: cur.price,
      changePct: Math.round(((cur.price - prev.price) / prev.price) * 1000) / 10,
    });
  }
  if (cur.title !== prev.title) {
    titleChanges.push({
      productId: cur.productId,
      url: cur.url,
      oldTitle: prev.title,
      newTitle: cur.title,
      similarity,
    });
  }
}

function toSummary(p: NormalizedProduct) {
  return { productId: p.productId, title: p.title, price: p.price, url: p.url };
}

/**
 * Deterministic grounding pre-check (runs before Enkrypt): every number in the
 * diff must map back to the scraped payloads it was derived from (PRD §5.3).
 */
export function verifyDiffAgainstPayload(
  diff: CompetitorDiff,
  current: CompetitorSnapshot,
  previous: CompetitorSnapshot | null,
): string[] {
  const errors: string[] = [];
  const curPrices = new Map(current.products.map(p => [p.productId, p.price]));
  const prevPrices = new Map((previous?.products ?? []).map(p => [p.productId, p.price]));

  for (const pc of diff.priceChanges) {
    if (curPrices.get(pc.productId) !== pc.newPrice) {
      errors.push(`price change ${pc.productId}: newPrice ${pc.newPrice} not found in scraped payload`);
    }
    if (prevPrices.get(pc.productId) !== pc.oldPrice) {
      errors.push(`price change ${pc.productId}: oldPrice ${pc.oldPrice} not found in previous snapshot`);
    }
  }
  for (const sku of diff.newSkus) {
    if (!curPrices.has(sku.productId)) {
      errors.push(`new SKU ${sku.productId} not present in scraped payload`);
    }
  }
  for (const sku of diff.removedSkus) {
    if (!prevPrices.has(sku.productId)) {
      errors.push(`removed SKU ${sku.productId} not present in previous snapshot`);
    }
  }
  if (diff.productCount !== current.products.length) {
    errors.push(`productCount ${diff.productCount} != scraped count ${current.products.length}`);
  }
  return errors;
}
