/**
 *   npx tsx --test lib/server/catalog.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeCatalog, bandEdges } from './catalog';
import type { NormalizedProduct } from './types';

const p = (title: string, price: number, o: Partial<NormalizedProduct> = {}): NormalizedProduct => ({
  productId: title, handle: title, title, vendor: 'Acme', productType: 'Shades', tags: [], price, maxPrice: price,
  currency: 'USD', url: `https://acme.com/products/${title}`, variantCount: 1, available: true, ...o,
});

test('empty catalogue → no summary', () => assert.equal(summarizeCatalog([]), undefined));

test('price stats, stock, types, vendors, extremes', () => {
  const c = summarizeCatalog([
    p('a', 12), p('b', 30, { productType: '' }), p('c', 45, { available: false, variantCount: 3 }),
    p('d', 80, { vendor: 'Other' }), p('e', 120, { productType: 'Hats' }),
  ])!;
  assert.deepEqual(c.price, { min: 12, median: 45, max: 120 });
  assert.equal(c.productCount, 5);
  assert.equal(c.inStock, 4); assert.equal(c.soldOut, 1); assert.equal(c.inStockPct, 80);
  assert.deepEqual(c.productTypes, [{ name: 'Shades', count: 3 }, { name: 'Hats', count: 1 }, { name: 'Uncategorised', count: 1 }]);
  assert.deepEqual(c.vendors, [{ name: 'Acme', count: 4 }, { name: 'Other', count: 1 }]);
  assert.equal(c.avgVariants, 1.4);
  assert.deepEqual(c.cheapest.map(x => x.title), ['a', 'b', 'c']);
  assert.deepEqual(c.priciest.map(x => x.title), ['e', 'd', 'c']);
  assert.deepEqual(c.priceBands.map(b => `${b.label}:${b.count}`), ['Under $25:1', '$25–50:2', '$50–100:1', '$100+:1']);
  assert.equal(c.priceBands.reduce((s, b) => s + b.count, 0), 5);
});

test('even median, and bands adapt to the store’s range', () => {
  assert.equal(summarizeCatalog([p('a', 10), p('b', 21)])!.price.median, 15.5);
  assert.deepEqual(bandEdges(300, 4000), [500, 1000, 2500]);
  assert.deepEqual(bandEdges(5, 9000).length, 4);
  assert.deepEqual(summarizeCatalog([p('a', 20), p('b', 20)])!.priceBands, [{ label: 'All prices', min: null, max: null, count: 2 }]);
});

test('non-USD currency gets its own symbol', () => {
  const c = summarizeCatalog([p('a', 20, { currency: 'EUR' }), p('b', 60, { currency: 'EUR' })])!;
  assert.equal(c.currency, 'EUR');
  assert.ok(c.priceBands[0].label.startsWith('Under €'));
});

test('AI-read catalogues leave out stock and variants instead of reporting 100% / 1.0', () => {
  const c = summarizeCatalog([p('a', 20), p('b', 40)], { stockAndVariantsKnown: false })!;
  for (const k of ['inStock', 'soldOut', 'inStockPct', 'avgVariants'] as const) assert.equal(c[k], undefined, k);
  assert.equal(c.productCount, 2);
  assert.deepEqual(c.price, { min: 20, median: 30, max: 40 });
});

test('only full catalogues are compared week over week', async () => {
  const { isFullCatalog } = await import('./snapshot-store');
  assert.equal(isFullCatalog('shopify'), true);
  assert.equal(isFullCatalog('shopify_relay'), true);
  assert.equal(isFullCatalog(undefined), true); // snapshots from before sources were recorded
  assert.equal(isFullCatalog('firecrawl'), false);
  assert.equal(isFullCatalog('shopify', false), false); // time ran out mid-read
  assert.equal(isFullCatalog('shopify', true), true);
});

test('checkout add-ons are left out of catalogue figures (allbirds "Free Returns Coverage")', async () => {
  const { isServiceAddOn } = await import('./catalog');
  const addOn = { ...p('returns', 0.8), title: 'Free Returns Coverage', productType: 'return,package_protection' };
  const c = summarizeCatalog([addOn, p('a', 95), p('b', 110), p('c', 140)])!;
  assert.equal(c.productCount, 3);
  assert.equal(c.addOnsExcluded, 1);
  assert.equal(c.price.min, 95);
  assert.equal(c.cheapest[0].price, 95);
  assert.ok(!c.priceBands.some(b => b.label.includes('0.8')));
  assert.equal(isServiceAddOn({ title: 'Shipping Protection', productType: '', vendor: 'Route' }), true);
  assert.equal(isServiceAddOn({ title: 'Digital Gift Card', productType: 'Gift Card', vendor: 'Allbirds' }), true);
  assert.equal(isServiceAddOn({ title: "Men's Tree Runners", productType: 'Shoes', vendor: 'Allbirds' }), false);
  assert.equal(isServiceAddOn({ title: 'Trail Runner Route', productType: 'Shoes', vendor: 'Allbirds' }), false);
});

test('in-stock share keeps one decimal: 311 of 312 is 99.7, not 100', () => {
  const products = Array.from({ length: 312 }, (_, i) => ({ ...p(`x${i}`, 50), available: i !== 0 }));
  assert.equal(summarizeCatalog(products)!.inStockPct, 99.7);
});

test('quoted names pair up in order: short quotes no longer produce a fake product', async () => {
  const { verifyProductGrounding } = await import('./guardrails');
  const diff = JSON.stringify({ diffs: [{ competitor: 'allbirds.com', newSkus: [{ title: "Men's Tree Runners", price: 98 }], removedSkus: [], priceChanges: [], titleChanges: [], catalog: { productTypes: [{ name: 'Shoes', count: 271 }, { name: 'Uncategorised', count: 37 }] } }] });
  const brief = 'The catalogue is primarily "Shoes" (271), followed by "Uncategorised" (37). New: "Men\'s Tree Runners" at $98.';
  assert.deepEqual(verifyProductGrounding(brief, diff), []);
  // a real invented product is still caught
  assert.equal(verifyProductGrounding('They launched "Cloud Walker Pro Max" today.', diff).length, 1);
});

test('vector retention keeps every snapshot a future run could compare with', async () => {
  const { vectorDatesToKeep } = await import('./snapshot-store');
  // today Nov 20: cutoff Nov 13 → keep the latest on/before it (Nov 12) and everything after
  assert.deepEqual(vectorDatesToKeep(['2026-11-01', '2026-11-05', '2026-11-12', '2026-11-15', '2026-11-20'], '2026-11-20'), ['2026-11-12', '2026-11-15', '2026-11-20']);
  // only recent reads: all kept
  assert.deepEqual(vectorDatesToKeep(['2026-11-14', '2026-11-15'], '2026-11-15'), ['2026-11-14', '2026-11-15']);
});

test('Data Confidence states the real gap, never assumes a week', async () => {
  const { dataConfidenceSection } = await import('./pipeline');
  const { daysBetween } = await import('./diff-engine');
  assert.equal(daysBetween('2026-11-13', '2026-11-14'), 1);
  assert.equal(daysBetween('2026-11-06', '2026-11-14'), 8);
  const d = (competitor: string, prev: string, days?: number) => ({ competitor, status: 'verified' as const, previousSnapshotDate: prev, currentSnapshotDate: '2026-11-14', productCount: 3, ...(days !== undefined ? { daysSincePrevious: days } : {}), newSkus: [], removedSkus: [], priceChanges: [], titleChanges: [] });
  const s = dataConfidenceSection({ weekOf: '2026-11-14', unverified: [], unverifiedReasons: {}, diffs: [d('allbirds.com', '2026-11-13', 1), d('goodr.com', '2026-11-06')] });
  assert.match(s, /allbirds\.com \(vs 2026-11-13, 1 day earlier\)/);
  assert.match(s, /goodr\.com \(vs 2026-11-06, 8 days earlier\)/); // older diffs: derived from the dates
  assert.doesNotMatch(s, /week/i);
});

test('"this week" is corrected when the comparison is under a week', async () => {
  const { notAWeek } = await import('./pipeline');
  const v = (prev: string, days: number) => ({ weekOf: '2026-11-14', unverified: [], unverifiedReasons: {}, diffs: [{ competitor: 'a.com', status: 'verified' as const, previousSnapshotDate: prev, currentSnapshotDate: '2026-11-14', productCount: 1, daysSincePrevious: days, newSkus: [], removedSkus: [], priceChanges: [], titleChanges: [] }] });
  assert.equal(notAWeek('No price changes reported this week. Week-over-week it shrank.', v('2026-11-13', 1)), 'No price changes reported since 2026-11-13. Since the earlier read it shrank.');
  assert.equal(notAWeek('No price changes in this week.', v('2026-11-13', 1)), 'No price changes since 2026-11-13.');
  assert.equal(notAWeek('No price changes this week.', v('2026-11-06', 8)), 'No price changes this week.'); // a real week: untouched
  assert.equal(notAWeek('Re-checked weekly.', v('2026-11-13', 1)), 'Re-checked weekly.');
});

test('products listed at $0 are left out of price figures and counted as unpriced (lunchly/drinkprime)', () => {
  const c = summarizeCatalog([p('a', 0), p('b', 0), p('c', 30), p('d', 45)])!;
  assert.equal(c.productCount, 4);
  assert.equal(c.unpriced, 2);
  assert.deepEqual(c.price, { min: 30, median: 37.5, max: 45 });
  assert.equal(c.cheapest[0].price, 30);
  const all = summarizeCatalog([p('a', 0), p('b', 0)])!;
  assert.equal(all.unpriced, 2);
  assert.equal(all.price.max, 0);
  assert.equal(summarizeCatalog([p('a', 5)])!.unpriced, undefined);
});
