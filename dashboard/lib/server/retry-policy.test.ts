import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_ATTEMPTS, hasRetriesLeft, retryDelayMs } from './retry-policy';

const MIN = 60_000;

test('three attempts: retry after 15 min, then 60 min, then finish', () => {
  assert.equal(MAX_ATTEMPTS, 3);
  assert.equal(retryDelayMs(1, null), 15 * MIN);
  assert.equal(retryDelayMs(2, null), 60 * MIN);
  assert.equal(retryDelayMs(3, null), null);
  assert.deepEqual([1, 2, 3].map(hasRetriesLeft), [true, true, false]);
});

test("the store's Retry-After wins when it asks for longer", () => {
  assert.equal(retryDelayMs(1, 40 * MIN), 40 * MIN);
  assert.equal(retryDelayMs(1, 5 * MIN), 15 * MIN);
  assert.equal(retryDelayMs(3, 40 * MIN), null); // final attempt: no retry regardless
});
