import type { CatalogSummary, NormalizedProduct } from './types';

/**
 * A deterministic picture of a store's catalogue on the day it was read — so
 * a first check (no previous snapshot to diff against) is useful on its own.
 * Every number here is computed from the snapshot; the brief may cite them and
 * grounding checks them like any other diff value.
 */

// Price-band edges to choose from; a store gets the ones inside its range.
const LADDER = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000];
const MAX_EDGES = 4; // → at most 5 bands

const round2 = (n: number) => Math.round(n * 100) / 100;

function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return round2(sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2);
}

function symbol(currency: string): string {
  try {
    const part = new Intl.NumberFormat('en-US', { style: 'currency', currency, currencyDisplay: 'narrowSymbol' })
      .formatToParts(0)
      .find(p => p.type === 'currency');
    return part?.value ?? `${currency} `;
  } catch {
    return `${currency} `;
  }
}

function topCounts(values: string[], limit: number, empty: string): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const v of values) {
    const name = v.trim() || empty;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, limit);
}

/** Pick band edges that fall inside (min, max], thinned evenly to MAX_EDGES. */
export function bandEdges(min: number, max: number): number[] {
  const inside = LADDER.filter(e => e > min && e <= max);
  if (inside.length <= MAX_EDGES) return inside;
  return Array.from({ length: MAX_EDGES }, (_, i) => inside[Math.round((i * (inside.length - 1)) / (MAX_EDGES - 1))]);
}

// Checkout add-ons stores list as "products": package/shipping protection,
// returns coverage, shipping insurance, gift cards, warranties. They are not
// part of what the store sells — a $0.80 "Free Returns Coverage" set
// allbirds' cheapest product and its lowest price band.
const ADDON_TYPE = /package[ _-]?protection|shipping[ _-]?protection|shipping[ _-]?insurance|\binsurance\b|gift[ _-]?card|\bwarranty\b|\breturns?\b|\bdonation\b/i;
const ADDON_TITLE = /\b(package|shipping|order|delivery) (protection|insurance)\b|\breturns? (coverage|protection|insurance)\b|\bgift ?cards?\b|\be-?gift\b|\bextended warranty\b|\bprotection plan\b|\broute (package )?protection\b/i;
const ADDON_VENDOR = new Set(['route', 'extend', 'navidium', 'corso', 'redo', 're:do', 'seel', 'xcover', 'clyde', 'mulberry', 'shipaid', 'onward']);

/** A checkout add-on rather than merchandise (kept in diffs; left out of catalogue figures). */
export function isServiceAddOn(p: Pick<NormalizedProduct, 'title' | 'productType' | 'vendor'>): boolean {
  return ADDON_TYPE.test(p.productType) || ADDON_TITLE.test(p.title) || ADDON_VENDOR.has(p.vendor.trim().toLowerCase());
}

/**
 * Checkout add-ons (see isServiceAddOn) are left out of every figure here;
 * `addOnsExcluded` says how many.
 *
 * `stockAndVariantsKnown`: false for AI-read catalogues (source 'firecrawl'),
 * which default every product to in stock with one variant — those fields
 * are then left out, so neither the page nor the analyst can cite them.
 */
export function summarizeCatalog(allProducts: NormalizedProduct[], opts: { stockAndVariantsKnown?: boolean } = {}): CatalogSummary | undefined {
  const known = opts.stockAndVariantsKnown !== false;
  const products = allProducts.filter(p => !isServiceAddOn(p));
  const addOnsExcluded = allProducts.length - products.length;
  if (products.length === 0) return undefined;
  const currency = products[0].currency || 'USD';
  // Products listed at $0 aren't for sale online (lunchly.com lists all 11 at
  // $0, drinkprime.com 24 of 50): they'd make "$0" the cheapest price and the
  // lowest band. Price figures use priced products; `unpriced` counts the rest.
  // (If none is priced, the figures stay at 0 and unpriced says why.)
  const priced = products.filter(p => p.price > 0);
  const unpriced = products.length - priced.length;
  const forPrices = priced.length > 0 ? priced : products;
  const prices = forPrices.map(p => p.price).sort((a, b) => a - b);
  const min = prices[0];
  const max = prices[prices.length - 1];
  const sym = symbol(currency);

  const edges = bandEdges(min, max);
  const bounds = [Number.NEGATIVE_INFINITY, ...edges, Number.POSITIVE_INFINITY];
  const priceBands = bounds.slice(0, -1).map((lo, i) => {
    const hi = bounds[i + 1];
    const label =
      lo === Number.NEGATIVE_INFINITY
        ? hi === Number.POSITIVE_INFINITY ? 'All prices' : `Under ${sym}${hi}`
        : hi === Number.POSITIVE_INFINITY ? `${sym}${lo}+` : `${sym}${lo}–${hi}`;
    return {
      label,
      min: Number.isFinite(lo) ? lo : null,
      max: Number.isFinite(hi) ? hi : null,
      count: prices.filter(p => p >= lo && p < hi).length,
    };
  });

  const inStock = products.filter(p => p.available).length;
  const pick = (p: NormalizedProduct) => ({ title: p.title, price: p.price, url: p.url });
  const byPrice = [...forPrices].sort((a, b) => a.price - b.price || a.title.localeCompare(b.title));

  return {
    productCount: products.length,
    currency,
    price: { min, median: median(prices), max },
    priceBands,
    ...(known
      ? {
          inStock,
          soldOut: products.length - inStock,
          // One decimal: 311 of 312 is 99.7%, not a rounded-up "100%".
          inStockPct: Math.round((inStock / products.length) * 1000) / 10,
          avgVariants: Math.round((products.reduce((s, p) => s + p.variantCount, 0) / products.length) * 10) / 10,
        }
      : {}),
    productTypes: topCounts(products.map(p => p.productType), 6, 'Uncategorised'),
    vendors: topCounts(products.map(p => p.vendor), 5, 'Unknown'),
    cheapest: byPrice.slice(0, 3).map(pick),
    priciest: byPrice.slice(-3).reverse().map(pick),
    ...(addOnsExcluded > 0 ? { addOnsExcluded } : {}),
    ...(unpriced > 0 ? { unpriced } : {}),
  };
}
