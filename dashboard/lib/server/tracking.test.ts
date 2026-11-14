/**
 * Unit tests for the tracking decision logic (no database).
 *
 *   npx tsx --test lib/server/tracking.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeTrackedSets, dueFirst, competitorKeyOf, type UserRunFact } from './tracking';

const DAY = 24 * 60 * 60 * 1000;
const now = new Date('2026-11-20T09:00:00Z');
const daysAgo = (n: number) => new Date(now.getTime() - n * DAY);
const run = (competitors: string[], ranDaysAgo: number): UserRunFact => ({
  competitorKey: competitorKeyOf(competitors),
  competitors,
  lastUserRunAt: daysAgo(ranDaysAgo),
});
const base = { defaultCompetitors: [] as string[], now, trackDays: 28, recheckDays: 7, maxSets: 20 };

test('competitorKeyOf is order-, case- and duplicate-insensitive', () => {
  assert.equal(competitorKeyOf(['b.com', 'A.com', 'b.com', ' ']), 'a.com,b.com');
});

test('a set with no brief yet is due now', () => {
  const [s] = computeTrackedSets({ ...base, userRuns: [run(['goodr.com'], 1)], lastBriefAt: new Map() });
  assert.equal(s.due, true);
  assert.equal(s.nextCheck, now.toISOString());
});

test('due exactly when the latest brief is 7 days old, not before', () => {
  const key = 'goodr.com';
  const at = (briefDaysAgo: number) =>
    computeTrackedSets({ ...base, userRuns: [run([key], 10)], lastBriefAt: new Map([[key, daysAgo(briefDaysAgo)]]) })[0];
  assert.equal(at(6.9).due, false);
  assert.equal(at(7).due, true);
  assert.equal(at(8).due, true);
  assert.equal(at(6).nextCheck, new Date(daysAgo(6).getTime() + 7 * DAY).toISOString());
});

test('tracking lasts 28 days after the last dashboard run, then stops', () => {
  const sets = computeTrackedSets({
    ...base,
    userRuns: [run(['fresh.com'], 27), run(['expired.com'], 29)],
    lastBriefAt: new Map(),
  });
  assert.deepEqual(sets.map(s => s.competitorKey), ['fresh.com']);
  assert.equal(sets[0].trackedUntil, new Date(daysAgo(27).getTime() + 28 * DAY).toISOString());
});

test('the honeypot is never tracked, even inside a mixed set', () => {
  const sets = computeTrackedSets({
    ...base,
    userRuns: [run(['injection-demo.test'], 1), run(['goodr.com', 'injection-demo.test'], 1), run(['goodr.com'], 1)],
    lastBriefAt: new Map(),
  });
  assert.deepEqual(sets.map(s => s.competitorKey), ['goodr.com']);
});

test('at most maxSets user sets, keeping the most recently run', () => {
  const userRuns = Array.from({ length: 5 }, (_, i) => run([`s${i}.com`], i + 1)); // s0 newest
  const sets = computeTrackedSets({ ...base, maxSets: 3, userRuns, lastBriefAt: new Map() });
  assert.deepEqual(sets.map(s => s.competitorKey), ['s0.com', 's1.com', 's2.com']);
});

test('COMPETITOR_STORES is an extra set, tracked indefinitely, not double-counted', () => {
  const sets = computeTrackedSets({
    ...base,
    defaultCompetitors: ['allbirds.com'],
    userRuns: [run(['goodr.com'], 1)],
    lastBriefAt: new Map(),
  });
  const def = sets.find(s => s.origin === 'default')!;
  assert.equal(def.competitorKey, 'allbirds.com');
  assert.equal(def.trackedUntil, null);

  const overlap = computeTrackedSets({ ...base, defaultCompetitors: ['goodr.com'], userRuns: [run(['goodr.com'], 1)], lastBriefAt: new Map() });
  assert.equal(overlap.length, 1);
  assert.equal(overlap[0].origin, 'user');
});

test('dueFirst: only due sets, longest-waiting first, never-briefed leading', () => {
  const sets = computeTrackedSets({
    ...base,
    userRuns: [run(['a.com'], 1), run(['b.com'], 2), run(['c.com'], 3), run(['d.com'], 4)],
    lastBriefAt: new Map([
      ['a.com', daysAgo(10)], // due since 3 days
      ['b.com', daysAgo(2)], // not due
      ['c.com', daysAgo(8)], // due since 1 day
      // d.com: never briefed → due now
    ]),
  });
  assert.deepEqual(dueFirst(sets).map(s => s.competitorKey), ['a.com', 'c.com', 'd.com']);
});

test('a store never scraped successfully is not tracked', () => {
  const sets = computeTrackedSets({
    ...base,
    userRuns: [run(['real.com'], 1), run(['dead.com'], 1), run(['real.com', 'dead.com'], 1)],
    lastBriefAt: new Map(),
    scrapedStores: new Set(['real.com']),
  });
  assert.deepEqual(sets.map(s => s.competitorKey), ['real.com']);
});

test('a blocked, never-read store stays tracked as first-read-pending, retried daily', () => {
  const sets = computeTrackedSets({
    ...base,
    userRuns: [run(['blocked.com'], 3), run(['dead.com'], 3)],
    lastBriefAt: new Map([['blocked.com', daysAgo(0.5)]]),
    scrapedStores: new Set(),
    pendingKeys: new Set(['blocked.com']),
  });
  assert.deepEqual(sets.map(s => s.competitorKey), ['blocked.com']);
  assert.equal(sets[0].firstReadPending, true);
  assert.equal(sets[0].due, false); // tried 12h ago
  assert.equal(sets[0].nextCheck, new Date(daysAgo(0.5).getTime() + DAY).toISOString());
  const dayLater = computeTrackedSets({ ...base, userRuns: [run(['blocked.com'], 3)], lastBriefAt: new Map([['blocked.com', daysAgo(1)]]), scrapedStores: new Set(), pendingKeys: new Set(['blocked.com']) });
  assert.equal(dayLater[0].due, true);
});
