import { findClosestProduct } from './snapshot-store';
import type { CompetitorDiff, CompetitorSnapshot, NormalizedProduct } from './types';

/**
 * Diff Engine — DETERMINISTIC, no LLM and no similarity threshold in the
 * matching path.
 *
 * 1. Match by productId → price changes, title changes.
 * 2. Match the leftovers by handle (the product's URL slug). A store that
 *    deletes and re-lists a product gets a new id but usually keeps the
 *    handle — this catches that case, which ID matching misses.
 * 3. Leftovers → genuinely new / removed SKUs. Each new SKU gets its closest
 *    existing product from last week's catalog (vector search) as context.
 *
 * Why not semantic matching in step 2, as before: on a real catalog, distinct
 * SKUs that differ by one word ("…Blizzard/Black Sole" vs "…Blizzard Sole")
 * scored 0.9968 cosine — higher than a renamed product against its own old
 * title. The threshold had to sit at 0.997 to avoid false merges, so it
 * effectively never fired. And a false merge is the worst outcome here: it
 * emits a fabricated price change that the grounding audit cannot catch,
 * because the number *is* in the diff. Handle matching has no such failure
 * mode; similarity is now used only for the non-load-bearing closestExisting.
 */

const CLOSEST_CONCURRENCY = 8;

export async function diffSnapshots(
  current: CompetitorSnapshot,
  previous: CompetitorSnapshot | null,
  /** Embeddings of `current.products`, keyed by productId (for closestExisting). */
  vectorsById: Map<string, number[]>,
): Promise<CompetitorDiff> {
  const base: Omit<CompetitorDiff, 'newSkus' | 'removedSkus' | 'priceChanges' | 'titleChanges'> = {
    competitor: current.competitor,
    status: previous ? 'verified' : 'first_snapshot',
    previousSnapshotDate: previous?.snapshotDate ?? null,
    currentSnapshotDate: current.snapshotDate,
    productCount: current.products.length,
    ...(previous ? { previousProductCount: previous.products.length } : {}),
  };

  if (!previous) {
    return { ...base, newSkus: [], removedSkus: [], priceChanges: [], titleChanges: [] };
  }

  const priceChanges: CompetitorDiff['priceChanges'] = [];
  const titleChanges: CompetitorDiff['titleChanges'] = [];
  const matchedPrevIds = new Set<string>();

  // Pass 1 — exact productId
  const prevById = new Map(previous.products.map(p => [p.productId, p]));
  const unmatched: NormalizedProduct[] = [];
  for (const cur of current.products) {
    const prev = prevById.get(cur.productId);
    if (!prev) {
      unmatched.push(cur);
      continue;
    }
    matchedPrevIds.add(prev.productId);
    recordChanges(cur, prev, priceChanges, titleChanges);
  }

  // Pass 2 — handle, among previous products not already matched. A handle
  // shared by several unmatched previous products is ambiguous: skip it
  // rather than guess.
  const prevByHandle = new Map<string, NormalizedProduct | null>();
  for (const p of previous.products) {
    if (matchedPrevIds.has(p.productId) || !p.handle) continue;
    prevByHandle.set(p.handle, prevByHandle.has(p.handle) ? null : p);
  }
  const genuinelyNew: NormalizedProduct[] = [];
  for (const cur of unmatched) {
    const prev = cur.handle ? prevByHandle.get(cur.handle) : undefined;
    if (prev && !matchedPrevIds.has(prev.productId)) {
      matchedPrevIds.add(prev.productId);
      recordChanges(cur, prev, priceChanges, titleChanges);
    } else {
      genuinelyNew.push(cur);
    }
  }

  // Closest existing product for each new SKU (bounded concurrency; results
  // keep input order so the diff is deterministic).
  const closest: Array<Awaited<ReturnType<typeof findClosestProduct>>> = new Array(genuinelyNew.length).fill(null);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CLOSEST_CONCURRENCY, genuinelyNew.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= genuinelyNew.length) return;
        const vector = vectorsById.get(genuinelyNew[i].productId);
        if (!vector) continue;
        try {
          closest[i] = await findClosestProduct(current.competitor, previous.snapshotDate, vector);
        } catch (err) {
          // Context only — never fail a diff over it.
          console.warn(`[diff] closest-product lookup failed for ${genuinelyNew[i].productId}:`, String(err).slice(0, 200));
        }
      }
    }),
  );

  const newSkus = genuinelyNew.map((p, i) => ({
    ...toSummary(p),
    ...(closest[i] ? { closestExisting: closest[i]! } : {}),
  }));
  const removedSkus = previous.products.filter(p => !matchedPrevIds.has(p.productId)).map(toSummary);

  return { ...base, newSkus, removedSkus, priceChanges, titleChanges };
}

function recordChanges(
  cur: NormalizedProduct,
  prev: NormalizedProduct,
  priceChanges: CompetitorDiff['priceChanges'],
  titleChanges: CompetitorDiff['titleChanges'],
) {
  // Matched under a different id (pass 2) → keep the old id so verification
  // can find the old price in last week's snapshot.
  const previousProductId = prev.productId !== cur.productId ? prev.productId : undefined;
  if (cur.price !== prev.price && prev.price > 0) {
    priceChanges.push({
      productId: cur.productId,
      ...(previousProductId ? { previousProductId } : {}),
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
      ...(previousProductId ? { previousProductId } : {}),
      url: cur.url,
      oldTitle: prev.title,
      newTitle: cur.title,
    });
  }
}

function toSummary(p: NormalizedProduct) {
  return { productId: p.productId, title: p.title, price: p.price, url: p.url };
}

/**
 * Deterministic grounding pre-check (runs before Enkrypt): every number in the
 * diff must map back to the scraped payloads it was derived from.
 */
export function verifyDiffAgainstPayload(
  diff: CompetitorDiff,
  current: CompetitorSnapshot,
  previous: CompetitorSnapshot | null,
): string[] {
  const errors: string[] = [];
  const curPrices = new Map(current.products.map(p => [p.productId, p.price]));
  const prevPrices = new Map((previous?.products ?? []).map(p => [p.productId, p.price]));
  const prevTitles = new Map((previous?.products ?? []).map(p => [p.productId, p.title]));

  for (const pc of diff.priceChanges) {
    const prevId = pc.previousProductId ?? pc.productId;
    if (curPrices.get(pc.productId) !== pc.newPrice) {
      errors.push(`price change ${pc.productId}: newPrice ${pc.newPrice} not found in scraped payload`);
    }
    if (prevPrices.get(prevId) !== pc.oldPrice) {
      errors.push(`price change ${pc.productId}: oldPrice ${pc.oldPrice} not found in previous snapshot`);
    }
  }
  for (const tc of diff.titleChanges) {
    if (prevTitles.get(tc.previousProductId ?? tc.productId) !== tc.oldTitle) {
      errors.push(`title change ${tc.productId}: oldTitle not found in previous snapshot`);
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
