import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyWeek } from './this-week';
import type { CompetitorDiff } from './types';

const d = (competitor: string, status: CompetitorDiff['status'], over: Partial<CompetitorDiff> = {}): CompetitorDiff => ({
  competitor, status, previousSnapshotDate: status === 'verified' ? '2026-11-08' : null, currentSnapshotDate: '2026-11-15',
  productCount: 10, newSkus: [], removedSkus: [], priceChanges: [], titleChanges: [], ...over,
});
const at = new Date('2026-11-15T09:00:00Z');
const set = (c: string, extra: object = {}) => ({ competitorKey: c, competitors: [c], nextCheck: '2026-11-22T09:00:00.000Z', lastBriefAt: at.toISOString(), ...extra });

test('a store never read in the window is unread with its reason — never read, never a first read (magicspoon)', () => {
  const w = classifyWeek({
    sets: [set('magicspoon.com', { lastBriefAt: null }), set('neutonic.com'), set('allbirds.com'), set('quiet.com')],
    rows: [
      { _id: 'magicspoon.com', best: { briefId: 'b1', createdAt: at, d: d('magicspoon.com', 'unverified') }, latest: { createdAt: at, status: 'unverified', reason: 'not a Shopify catalogue (HTTP 429)' } },
      { _id: 'neutonic.com', best: { briefId: 'b2', createdAt: at, d: d('neutonic.com', 'first_snapshot') }, latest: { createdAt: at, status: 'first_snapshot' } },
      { _id: 'allbirds.com', best: { briefId: 'b3', createdAt: at, d: d('allbirds.com', 'verified', { removedSkus: [{ productId: '1', title: 'Cruiser', price: 98, url: 'u' }] }) }, latest: { createdAt: at, status: 'verified' } },
    ],
    days: 7,
  });
  assert.deepEqual(w.stores, {
    watched: 4,
    read: 2,
    unread: [
      { store: 'magicspoon.com', reason: 'not a Shopify catalogue (HTTP 429)' },
      { store: 'quiet.com', reason: 'Not checked in the last 7 days' },
    ],
  });
  assert.deepEqual(w.firstReads.map(f => f.store), ['neutonic.com']);
  assert.deepEqual(w.changes.map(c => `${c.rank}:${c.store}:${c.kind}`), ['1:allbirds.com:removed']);
});
