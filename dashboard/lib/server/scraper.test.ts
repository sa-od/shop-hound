import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readShopifyCatalog, parseRelayPage, StoreBlockedError, StoreUnreachableError, type CatalogPage, type PageFetcher } from './scraper';

const product = (id: number) => ({ id, handle: `p-${id}`, title: `Product ${id}`, variants: [{ price: '10.00', available: true }] });
const catalog = (from: number, n: number): CatalogPage => ({
  status: 200,
  retryAfterMs: null,
  data: { products: Array.from({ length: n }, (_, i) => product(from + i)) },
});
/** A fake store: answers per (base, page) from the table, 404 otherwise. */
const store = (pages: Record<string, CatalogPage | Error>): PageFetcher & { calls: string[] } => {
  const calls: string[] = [];
  const f = (async (base: string, page: number) => {
    calls.push(`${base}#${page}`);
    const r = pages[`${base}#${page}`];
    if (r instanceof Error) throw r;
    return r ?? { status: 404, retryAfterMs: null, data: null };
  }) as unknown as PageFetcher & { calls: string[] };
  f.calls = calls;
  return f;
};

test('reads every page until a short one', async () => {
  const f = store({ 'a.com#1': catalog(1, 250), 'a.com#2': catalog(251, 10) });
  const products = await readShopifyCatalog('a.com', f, ['a.com']);
  assert.equal(products.length, 260);
  assert.deepEqual(f.calls, ['a.com#1', 'a.com#2']);
});

test('falls back to www. when the bare domain has no catalogue', async () => {
  const f = store({ 'www.a.com#1': catalog(1, 3) });
  const products = await readShopifyCatalog('a.com', f, ['a.com', 'www.a.com']);
  assert.equal(products.length, 3);
});

test('429 is a temporary block carrying the Retry-After, and www. is not tried', async () => {
  const f = store({ 'a.com#1': { status: 429, retryAfterMs: 30_000, data: null } });
  await assert.rejects(readShopifyCatalog('a.com', f, ['a.com', 'www.a.com']), (e: unknown) => {
    assert.ok(e instanceof StoreBlockedError);
    assert.equal(e.status, 429);
    assert.equal(e.retryAfterMs, 30_000);
    return true;
  });
  assert.deepEqual(f.calls, ['a.com#1']);
});

test('a bot-check page is a block, not "not a Shopify store"', async () => {
  const f = store({ 'a.com#1': { status: 200, retryAfterMs: null, data: null, challenged: true } });
  await assert.rejects(readShopifyCatalog('a.com', f, ['a.com']), (e: unknown) => {
    assert.ok(e instanceof StoreBlockedError);
    assert.match(e.message, /bot check/);
    return true;
  });
});

test('a block on a later page is still a block', async () => {
  const f = store({ 'a.com#1': catalog(1, 250), 'a.com#2': { status: 429, retryAfterMs: null, data: null } });
  await assert.rejects(readShopifyCatalog('a.com', f, ['a.com']), StoreBlockedError);
});

test('reachable but no catalogue → plain error (not blocked, not unreachable)', async () => {
  const f = store({ 'a.com#1': { status: 200, retryAfterMs: null, data: null } });
  await assert.rejects(readShopifyCatalog('a.com', f, ['a.com', 'www.a.com']), (e: unknown) => {
    assert.ok(!(e instanceof StoreBlockedError) && !(e instanceof StoreUnreachableError));
    assert.match((e as Error).message, /not a Shopify catalogue/);
    return true;
  });
});

test('no connection on any origin → unreachable (skips the paid fallback)', async () => {
  const down = Object.assign(new Error('fetch failed'), { cause: { code: 'ENOTFOUND' } });
  const f = store({ 'a.com#1': down, 'www.a.com#1': down });
  await assert.rejects(readShopifyCatalog('a.com', f, ['a.com', 'www.a.com']), StoreUnreachableError);
});

test('relay: bare JSON and <pre>-wrapped JSON both parse', () => {
  const json = JSON.stringify({ products: [product(1)] });
  assert.equal(parseRelayPage(200, json).data?.products.length, 1);
  const wrapped = `<html><body><pre style="x">${json.replace(/"/g, '&quot;').replace(/&quot;Product/, '&quot;A &amp; B Product')}</pre></body></html>`;
  const page = parseRelayPage(200, wrapped);
  assert.equal(page.data?.products[0].title, 'A & B Product 1');
  assert.equal(page.challenged, undefined);
});

test('relay: an HTML page instead of JSON is a bot check', () => {
  const page = parseRelayPage(200, '<html><title>Just a moment...</title></html>');
  assert.equal(page.challenged, true);
  assert.equal(page.data, null);
});

test('relay: JSON that is not a catalogue, and a 404, are "no catalogue" (not a bot check)', () => {
  assert.deepEqual(parseRelayPage(200, '{"error":"nope"}'), { status: 200, retryAfterMs: null, data: null });
  assert.deepEqual(parseRelayPage(404, '<html>Not found</html>'), { status: 404, retryAfterMs: null, data: null });
});
