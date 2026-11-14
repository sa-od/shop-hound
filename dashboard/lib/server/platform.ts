import { safeFetch } from './safe-fetch';
import { fetchViaFirecrawl, firecrawlEnabled } from './firecrawl';

/**
 * What a store we can't read automatically is built on — so the user is told
 * why in plain words ("runs on WooCommerce"), and the team knows what it is
 * dealing with when the manual-read request arrives.
 *
 * Detection is one request for the store's homepage: response headers and
 * well-known markers in the HTML (asset hosts, generator tags). Pure matching
 * lives in detectPlatformFromPage, so it is unit-tested without the network.
 */

export type PlatformId =
  | 'shopify_headless' // Shopify behind the scenes, custom storefront (no /products.json on this domain)
  | 'shopify_password' // Shopify store not open to the public yet
  | 'woocommerce'
  | 'magento'
  | 'bigcommerce'
  | 'squarespace'
  | 'wix'
  | 'salesforce'
  | 'prestashop'
  | 'shopware'
  | 'webflow'
  | 'wordpress' // WordPress without a shop plugin we recognise
  | 'custom' // a custom-built site (Next.js, Nuxt, …), no known shop platform
  | 'bot_protected' // the site turns away automated visitors, so we couldn't look
  | 'unknown';

export interface Platform {
  id: PlatformId;
  /** Display name, e.g. "WooCommerce". */
  name: string;
}

const NAMES: Record<PlatformId, string> = {
  shopify_headless: 'Shopify (custom storefront)',
  shopify_password: 'Shopify (password-protected)',
  woocommerce: 'WooCommerce',
  magento: 'Magento (Adobe Commerce)',
  bigcommerce: 'BigCommerce',
  squarespace: 'Squarespace',
  wix: 'Wix',
  salesforce: 'Salesforce Commerce Cloud',
  prestashop: 'PrestaShop',
  shopware: 'Shopware',
  webflow: 'Webflow',
  wordpress: 'WordPress',
  custom: 'a custom-built site',
  bot_protected: 'not known (the site blocks automated visitors)',
  unknown: 'not known',
};

const platform = (id: PlatformId): Platform => ({ id, name: NAMES[id] });

interface PageSignals {
  status: number;
  headers: { get(name: string): string | null };
  html: string;
  /** Final URL after redirects (a Shopify password page lives at /password). */
  url?: string;
}

/** Pure: what the homepage's headers and HTML say the store is built on. */
export function detectPlatformFromPage(page: PageSignals): Platform {
  const h = (n: string) => page.headers.get(n) ?? '';
  const html = page.html.slice(0, 400_000);
  const has = (re: RegExp) => re.test(html);

  // A bot check answered instead of the page: we can't see what it runs on.
  if (/challenge/i.test(h('x-vercel-mitigated')) || /challenge/i.test(h('cf-mitigated')) || ((page.status === 429 || page.status === 403) && html.length < 20_000 && !has(/cdn\.shopify\.com|wp-content|static\/version/))) {
    return platform('bot_protected');
  }

  const shopifyHeader = /shopify/i.test(h('powered-by')) || page.headers.get('x-shopid') !== null || page.headers.get('shopify-complexity-score') !== null;
  if (shopifyHeader || has(/cdn\.shopify\.com|Shopify\.theme|myshopify\.com/)) {
    if (/\/password(\?|$)/.test(page.url ?? '') || has(/<form[^>]+action="\/password"/i)) return platform('shopify_password');
    return platform('shopify_headless');
  }
  if (has(/wp-content\/plugins\/woocommerce|woocommerce-(no-)?js|class="[^"]*woocommerce|wc-block-|\/wc\/store\//i)) return platform('woocommerce');
  if (/magento/i.test(h('x-magento-tags') + h('x-magento-cache-debug')) || has(/Magento_|mage\/cookies|\/static\/version\d+\/|data-mage-init/)) return platform('magento');
  if (has(/cdn\d*\.bigcommerce\.com|BigCommerce|stencil-utils/i)) return platform('bigcommerce');
  if (/squarespace/i.test(h('server')) || has(/static1\.squarespace\.com|Static\.SQUARESPACE_CONTEXT/)) return platform('squarespace');
  if (page.headers.get('x-wix-request-id') !== null || has(/static\.wixstatic\.com|wix-bolt|_wixCssImports/)) return platform('wix');
  if (has(/demandware|\/on\/demandware\.store|dwanalytics|sfcc/i)) return platform('salesforce');
  if (has(/prestashop/i)) return platform('prestashop');
  if (has(/shopware/i)) return platform('shopware');
  if (has(/data-wf-site|webflow\.com\/css|assets\.website-files\.com/)) return platform('webflow');
  if (has(/wp-content\/|wp-includes\/|<meta name="generator" content="WordPress/i)) return platform('wordpress');
  if (has(/__NEXT_DATA__|\/_next\/static\/|__NUXT__|\/_nuxt\/|data-reactroot|ng-version=|__remixContext|astro-island/) || /next\.js|nuxt|express/i.test(h('x-powered-by'))) return platform('custom');
  return platform('unknown');
}

const DETECT_TIMEOUT_MS = 8_000;
const USER_AGENT = 'Mozilla/5.0 (compatible; CompetitiveIntelBot/1.0)';

/**
 * Detect a store's platform from its homepage. One direct request; if the
 * site turns us away and the relay is on, one relayed request (1 credit) — the
 * same route the catalogue read already uses. Never throws.
 */
export async function detectPlatform(host: string): Promise<Platform> {
  let direct: Platform | null = null;
  try {
    const res = await safeFetch(`https://${host}/`, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
      signal: AbortSignal.timeout(DETECT_TIMEOUT_MS),
    });
    const html = await res.text().catch(() => '');
    direct = detectPlatformFromPage({ status: res.status, headers: res.headers, html, url: res.url });
    if (direct.id !== 'bot_protected') return direct;
  } catch {
    // unreachable or slow: try the relay if allowed, else unknown
  }
  if (!firecrawlEnabled() || process.env.SHOPIFY_RELAY === 'off') return direct ?? platform('unknown');
  try {
    const r = await fetchViaFirecrawl(`https://${host}/`, 20_000);
    const relayed = detectPlatformFromPage({ status: r.status, headers: new Headers({ 'content-type': r.contentType }), html: r.body });
    return relayed.id === 'unknown' && direct ? direct : relayed;
  } catch {
    return direct ?? platform('unknown');
  }
}
