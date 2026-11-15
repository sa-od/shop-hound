import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changesFromCompetitorDiff, changesFromDiff, rankChanges, money, signedPct, changeTotals } from './changes';
import type { CompetitorDiff } from './types';

const diff = (over: Partial<CompetitorDiff> = {}): CompetitorDiff => ({
  competitor: 'goodr.com', status: 'verified', previousSnapshotDate: '2026-11-06', currentSnapshotDate: '2026-11-13',
  productCount: 429, newSkus: [], removedSkus: [], priceChanges: [], titleChanges: [], ...over,
});
const pc = (title: string, oldPrice: number, newPrice: number, changePct: number) => ({ productId: title, title, url: `https://x/${title}`, oldPrice, newPrice, changePct });

test('one price cut reads as its own sentence, exact figures and currency', () => {
  const [c] = changesFromCompetitorDiff(diff({ priceChanges: [pc('Pineapple Painkillers', 35, 30, -14.3)] }), 'b1');
  assert.equal(c.kind, 'price_cut');
  assert.equal(c.fact, 'Cut Pineapple Painkillers from $35.00 to $30.00 (−14.3%)');
  assert.deepEqual(c.figures, { oldPrice: 35, newPrice: 30, pct: -14.3, count: 1 });
  assert.equal(c.id, 'b1:goodr.com:price_cut');
});

test('several cuts aggregate into one change per kind; rises are separate', () => {
  const cs = changesFromCompetitorDiff(diff({ priceChanges: [pc('A', 35, 30, -14.3), pc('B', 5, 2, -60), pc('C', 10, 12, 20)] }), 'b1');
  const cut = cs.find(c => c.kind === 'price_cut')!;
  assert.equal(cut.fact, 'Cut 2 prices, up to 60%');
  assert.deepEqual(cut.figures, { count: 2, maxPct: 60 });
  assert.deepEqual(cut.products.map(p => p.title), ['B', 'A']); // largest first
  assert.equal(cs.find(c => c.kind === 'price_rise')!.fact, 'Raised C from $10.00 to $12.00 (+20%)');
});

test('removed, new and renamed templates; catalogue count leaves add-ons out', () => {
  const cs = changesFromCompetitorDiff(diff({
    productCount: 312,
    catalog: { productCount: 311, currency: 'USD', price: { min: 1, median: 2, max: 3 }, priceBands: [], productTypes: [], vendors: [], cheapest: [], priciest: [] },
    removedSkus: [{ productId: '1', title: 'Women’s Golf Dasher', price: 105, url: 'u1' }, { productId: '2', title: 'Men’s Wool Cruiser Waterproof', price: 98, url: 'u2' }, { productId: '3', title: 'Relay', price: 40.5, url: 'u3' }],
    newSkus: [{ productId: '4', title: 'No Regifts – Regular', price: 2, url: 'u4', closestExisting: { title: 'No Regifts – Large', price: 2, similarity: 0.97 } }],
    titleChanges: [{ productId: '5', url: 'u5', oldTitle: 'Old', newTitle: 'New' }],
  }), 'b2');
  assert.equal(cs.find(c => c.kind === 'removed')!.fact, 'Removed 3 products, including Women’s Golf Dasher ($105.00). Catalogue now 311.');
  assert.equal(cs.find(c => c.kind === 'new')!.fact, 'Added No Regifts – Regular at $2.00, next to No Regifts – Large ($2.00).');
  assert.equal(cs.find(c => c.kind === 'renamed')!.fact, 'Renamed Old to New.');
});

test('new products at different prices give the range; other currencies keep their symbol', () => {
  const [c] = changesFromCompetitorDiff(diff({
    catalog: { productCount: 10, currency: 'EUR', price: { min: 1, median: 2, max: 3 }, priceBands: [], productTypes: [], vendors: [], cheapest: [], priciest: [] },
    newSkus: [{ productId: '1', title: 'A', price: 12, url: 'a' }, { productId: '2', title: 'B', price: 30, url: 'b' }],
  }), 'b');
  assert.equal(c.fact, 'Added 2 products from €12.00 to €30.00.');
  assert.equal(money(1234.5, 'USD'), '$1,234.50');
  assert.equal(signedPct(-60), '−60%');
});

test('only verified diffs give changes (baselines, unverified, partial reads never do)', () => {
  for (const status of ['first_snapshot', 'unverified'] as const) {
    assert.deepEqual(changesFromCompetitorDiff(diff({ status, priceChanges: [pc('A', 2, 1, -50)] }), 'b'), []);
  }
});

test('ranking: cuts by %, then removals, launches, rises, renames; deterministic', () => {
  const b = (store: string, over: Partial<CompetitorDiff>) => changesFromCompetitorDiff(diff({ competitor: store, ...over }), store);
  const all = [
    ...b('a.com', { titleChanges: [{ productId: '1', url: 'u', oldTitle: 'x', newTitle: 'y' }] }),
    ...b('b.com', { priceChanges: [pc('Rise', 10, 20, 100)] }),
    ...b('c.com', { newSkus: [{ productId: '1', title: 'N', price: 1, url: 'u' }] }),
    ...b('d.com', { removedSkus: [{ productId: '1', title: 'R', price: 1, url: 'u' }] }),
    ...b('e.com', { priceChanges: [pc('Small', 10, 9, -10)] }),
    ...b('f.com', { priceChanges: [pc('Big', 10, 5, -50)] }),
  ];
  const ranked = rankChanges(all);
  assert.deepEqual(ranked.map(c => `${c.rank}:${c.store}:${c.kind}`), ['1:f.com:price_cut', '2:e.com:price_cut', '3:d.com:removed', '4:c.com:new', '5:b.com:price_rise', '6:a.com:renamed']);
  assert.deepEqual(rankChanges([...all].reverse()).map(c => c.id), ranked.map(c => c.id));
  assert.deepEqual(changeTotals(ranked), { total: 6, byKind: { price_cut: 2, removed: 1, new: 1, price_rise: 1, renamed: 1 } });
});

test('changesFromDiff ranks across a multi-store brief', () => {
  const cs = changesFromDiff({ diffs: [diff({ competitor: 'x.com', newSkus: [{ productId: '1', title: 'N', price: 1, url: 'u' }] }), diff({ priceChanges: [pc('A', 2, 1, -50)] })] }, 'b');
  assert.deepEqual(cs.map(c => [c.rank, c.kind]), [[1, 'price_cut'], [2, 'new']]);
});

test('a drop to $0 is not a price cut (the product stopped being sold online)', () => {
  assert.deepEqual(changesFromCompetitorDiff(diff({ priceChanges: [pc('Gone', 30, 0, -100)] }), 'b'), []);
});
