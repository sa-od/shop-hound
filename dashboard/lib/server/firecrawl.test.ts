import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeToResend, storeProductUrl } from './firecrawl';

test('AI-read product links stay on the store site, canonicalised', () => {
  assert.equal(storeProductUrl('/products/sock?Size=M#top', 'bombas.com'), 'https://bombas.com/products/sock');
  assert.equal(storeProductUrl('https://www.bombas.com/products/sock', 'bombas.com'), 'https://www.bombas.com/products/sock');
  assert.equal(storeProductUrl('https://shop.bombas.com/p/1', 'bombas.com'), 'https://shop.bombas.com/p/1');
  assert.equal(storeProductUrl('https://evil.example/products/sock', 'bombas.com'), null);
  assert.equal(storeProductUrl('https://notbombas.com/p', 'bombas.com'), null);
  assert.equal(storeProductUrl('javascript:alert(1)', 'bombas.com'), null);
  assert.equal(storeProductUrl('data:text/html,hi', 'bombas.com'), null);
});

test('a billed POST is re-sent only when Firecrawl certainly never took it', () => {
  const timeout = Object.assign(new Error('t'), { name: 'TimeoutError' });
  const refused = Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
  const reset = Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNRESET' } });
  assert.equal(safeToResend(timeout, 'POST'), false); // may have started the job
  assert.equal(safeToResend(reset, 'POST'), false); // may have been received
  assert.equal(safeToResend(refused, 'POST'), true); // never connected
  assert.equal(safeToResend(timeout, 'GET'), true); // polling is read-only
});
