import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectPlatformFromPage } from './platform';
import { manualRead } from './contact';

const page = (html: string, headers: Record<string, string> = {}, status = 200, url?: string) => ({ status, headers: new Headers(headers), html, url });
const id = (...a: Parameters<typeof page>) => detectPlatformFromPage(page(...a)).id;

test('recognises each platform from its markers', () => {
  assert.equal(id('<link href="/wp-content/plugins/woocommerce/assets/css/x.css">'), 'woocommerce');
  assert.equal(id('<script type="text/x-magento-init">{"*":{"Magento_Ui/js/core/app":{}}}</script>'), 'magento');
  assert.equal(id('<img src="https://cdn11.bigcommerce.com/s-abc/images/x.jpg">'), 'bigcommerce');
  assert.equal(id('<link href="https://static1.squarespace.com/static/x.css">'), 'squarespace');
  assert.equal(id('<html></html>', { 'x-wix-request-id': '1' }), 'wix');
  assert.equal(id('<form action="/on/demandware.store/Sites-x/Cart-Show">'), 'salesforce');
  assert.equal(id('<html data-wf-site="abc">'), 'webflow');
  assert.equal(id('<meta name="generator" content="WordPress 6.6">'), 'wordpress');
  assert.equal(id('<script id="__NEXT_DATA__" type="application/json">{}</script>'), 'custom');
  assert.equal(id('<html><body>hello</body></html>'), 'unknown');
});

test('Shopify that has no catalogue here: custom storefront, or password page', () => {
  assert.equal(id('<script src="//cdn.shopify.com/s/files/x.js"></script>'), 'shopify_headless');
  assert.equal(id('<html></html>', { 'powered-by': 'Shopify' }), 'shopify_headless');
  assert.equal(id('<form method="post" action="/password">', { 'powered-by': 'Shopify' }, 200, 'https://x.com/password'), 'shopify_password');
});

test("a bot check is reported as such, not guessed (bombas.com's Vercel challenge)", () => {
  assert.equal(id('<html>Vercel Security Checkpoint</html>', { server: 'Vercel', 'x-vercel-mitigated': 'challenge' }, 429), 'bot_protected');
  assert.equal(id('<html>Just a moment...</html>', { 'cf-mitigated': 'challenge' }, 403), 'bot_protected');
});

test('the message names the platform, promises weekly tracking, and the email is ready to send', () => {
  const m = manualRead('shop.example', { id: 'woocommerce', name: 'WooCommerce' });
  assert.match(m.message, /^shop\.example runs on WooCommerce, which we don't read automatically yet\./);
  assert.match(m.message, /keep tracking it every week like your other stores/);
  assert.match(m.message, new RegExp(m.email.to.replace(/[.]/g, '\\.')));
  assert.equal(m.email.subject, 'Please track shop.example for me');
  assert.match(m.email.body, /Platform: WooCommerce/);
  assert.ok(m.email.mailto.startsWith(`mailto:${m.email.to}?subject=Please%20track%20shop.example%20for%20me&body=`));
  const g = new URL(m.email.gmail);
  assert.equal(g.origin + g.pathname, 'https://mail.google.com/mail/');
  assert.equal(g.searchParams.get('view'), 'cm');
  assert.equal(g.searchParams.get('to'), m.email.to);
  assert.equal(g.searchParams.get('su'), m.email.subject);
  assert.equal(g.searchParams.get('body'), m.email.body);
});
