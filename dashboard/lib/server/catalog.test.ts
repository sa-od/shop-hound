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
