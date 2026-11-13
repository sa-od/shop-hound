/**
 * Unit tests for store-input parsing and address safety (no network).
 *
 *   npx tsx --test lib/server/store-url.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStoreInput, isPrivateAddress } from './store-url';
import { normalizeDomain } from './scraper';
import { assertPublicUrl } from './safe-fetch';

const ok = (input: string, domain: string) => assert.deepEqual(parseStoreInput(input), { ok: true, domain }, input);
const bad = (input: unknown, code: string) => {
  const r = parseStoreInput(input);
  assert.equal(r.ok, false, String(input));
  assert.equal(!r.ok && r.code, code, String(input));
};

test('accepts the forms people paste, and cleans them to one domain', () => {
  for (const s of [
    'goodr.com', 'GOODR.COM', '  goodr.com  ', 'goodr.com/', 'goodr.com.',
    'http://goodr.com', 'https://goodr.com', 'HTTPS://GOODR.COM', 'www.goodr.com', 'https://www.goodr.com',
    'https://www.goodr.com/collections/x?y=1#z', 'goodr.com:443', 'goodr.com/products/og?variant=1',
  ]) ok(s, 'goodr.com');
  ok('shop.goodr.com', 'shop.goodr.com');
  ok('https://www.shop.goodr.co.uk/', 'shop.goodr.co.uk');
  ok('bücher.de', 'xn--bcher-kva.de');
  ok('injection-demo.test', 'injection-demo.test');
});

test('more than one store is rejected', () => {
  for (const s of ['goodr.com, magicspoon.com', 'goodr.com magicspoon.com', 'goodr.com;magicspoon.com', 'goodr.com,']) bad(s, 'multiple');
});

test('things that are not store websites are rejected', () => {
  for (const s of ['', '   ', 'goodr', 'localhost', 'http://localhost:3000', '192.168.1.1', 'http://127.0.0.1/', '[::1]', 'http://[::1]/',
    'foo.invalid', 'printer.local', 'my.internal', 'example.test', '-bad.com', 'bad-.com', 'a..com', 'goodr.c', 'goodr.123', 'x'.repeat(64) + '.com'])
    bad(s, 'invalid_url');
  for (const s of ['ftp://goodr.com', 'javascript:alert(1)', 'mailto:a@goodr.com', 'file:///etc/passwd', '//goodr.com', 'https://user:pass@goodr.com'])
    bad(s, 'invalid_url');
  for (const v of [undefined, null, 42, ['goodr.com'], { store: 'x' }]) bad(v, 'invalid_url');
});

test('private and internal addresses are recognised', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.0.10', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1',
    '::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '::ffff:7f00:1', '::ffff:a9fe:a9fe', '::127.0.0.1', 'not-an-ip'])
    assert.equal(isPrivateAddress(ip), true, ip);
  for (const ip of ['23.227.38.65', '172.15.0.1', '172.32.0.1', '8.8.8.8', '2606:4700::6810:85e5', '::ffff:8.8.8.8', '::ffff:808:808'])
    assert.equal(isPrivateAddress(ip), false, ip);
});

test('normalizeDomain (pipeline) matches the API canonical form', () => {
  for (const s of ['https://www.goodr.com/x?y', 'GOODR.com:443', 'goodr.com.']) assert.equal(normalizeDomain(s), 'goodr.com');
});

test('redirect targets: private IP literals and non-web schemes are refused', () => {
  for (const u of ['http://127.0.0.1/', 'http://169.254.169.254/latest/meta-data/', 'http://10.0.0.5:8080/x', 'http://[::1]/', 'http://[::ffff:127.0.0.1]/', 'file:///etc/passwd', 'ftp://goodr.com/'])
    assert.throws(() => assertPublicUrl(u), u);
  for (const u of ['https://goodr.com/products.json', 'http://8.8.8.8/', 'https://www.goodr.com/'])
    assert.doesNotThrow(() => assertPublicUrl(u), u);
});
