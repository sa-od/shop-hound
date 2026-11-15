import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyFailure, OurSideError, ourFailureDelayMs, MAX_OUR_FAILURES } from './failure';

test('our-side failures: credentials, quota, database, model and API errors, bugs, time limit', () => {
  for (const m of [
    'AI_APICallError: token is not from a valid issuer',
    'Error: OPENAI_API_KEY not set',
    'AI_APICallError: Incorrect API key provided: sk-…',
    'AI_RetryError: Failed after 3 attempts. Last error: You exceeded your current quota',
    'MongoServerSelectionError: connection timed out',
    'MongoNetworkError: connection reset',
    'Firecrawl 402 Payment Required',
    'The injection screen could not run — input treated as unverified',
    'run did not finish within the function time limit',
    "TypeError: Cannot read properties of undefined (reading 'price')",
    'MONGODB_URI is not set',
  ]) assert.equal(classifyFailure(new Error(m)), 'ours', m);
  assert.equal(classifyFailure(new OurSideError('anything')), 'ours');
});

test('store-side failures: refused, unreadable, not a store', () => {
  for (const m of [
    'the store is limiting automated requests right now',
    'example.com is not a store we can read: no public catalogue',
    'The store refused us (403)',
    'The site couldn’t be read',
    'getaddrinfo ENOTFOUND nosuchstore-xyz.com',
    'This site has bot protection we don’t get past',
  ]) assert.equal(classifyFailure(new Error(m)), 'store', m);
});

test('our signals win over store-looking text; stored strings classify like errors', () => {
  assert.equal(classifyFailure('the store refused us: 401 Unauthorized from api.openai.com'), 'ours');
  assert.equal(classifyFailure('getaddrinfo ENOTFOUND api.openai.com'), 'ours');
  assert.equal(classifyFailure(null), 'ours');
});

test('our-side backoff: 10 min doubling, capped at 6 h; a bounded number of tries', () => {
  assert.deepEqual([1, 2, 3, 4].map(n => ourFailureDelayMs(n) / 60_000), [10, 20, 40, 80]);
  assert.equal(ourFailureDelayMs(20), 6 * 60 * 60_000);
  assert.ok(MAX_OUR_FAILURES >= 3);
});
