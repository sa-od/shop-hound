import { normalizedProductSchema, type NormalizedProduct } from './types';

/**
 * Firecrawl fallback ingestion (PRD §5.1 hybrid path) — AI extraction of product
 * catalogs from stores that do NOT expose Shopify's /products.json (non-Shopify
 * platforms, or Shopify stores with the endpoint disabled).
 *
 * Strategy (v2 API; /extract is deprecated and returns empty results):
 *   1. /map the site → discover URLs
 *   2. classify listing pages (collections/shop/category — dense) and product pages
 *   3. /batch/scrape the selected pages with a `json` format + product schema
 *   4. poll the batch job, then normalize every extracted product
 *
 * Raw REST via native fetch (no SDK dep — matches the codebase pattern).
 * Coverage is best-effort and page-budgeted (json extraction is credit-billed):
 * a partial catalog beats zero data, and the `source: 'firecrawl'` tag keeps
 * that transparent downstream.
 */

const FIRECRAWL_BASE_URL = 'https://api.firecrawl.dev/v2';
const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 5 * 60_000;
const MAX_PRODUCTS = 2500; // same ceiling as the Shopify scraper
// Page budget caps credit burn (json extraction costs credits per page).
// Override with FIRECRAWL_PAGE_BUDGET for deeper coverage on paid plans.
const DEFAULT_PAGE_BUDGET = 15;
const MAX_LISTING_PAGES = 6; // listing pages are dense — many products each

export function firecrawlEnabled(): boolean {
  return Boolean(process.env.FIRECRAWL_API_KEY);
}

interface ExtractedProduct {
  title?: string;
  price?: number | string;
  currency?: string;
  url?: string;
  category?: string;
  available?: boolean;
}

// Per-page extraction schema — works for both listing pages (many products)
// and single product pages (one product).
const pageProductsSchema = {
  type: 'object',
  properties: {
    products: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          price: { type: 'number' },
          currency: { type: 'string' },
          url: { type: 'string' },
          category: { type: 'string' },
          available: { type: 'boolean' },
        },
        required: ['title', 'price'],
      },
    },
  },
  required: ['products'],
};

const extractionPrompt =
  'Extract every purchasable product visible on this page: exact title, current numeric price, ' +
  'currency code, absolute product page URL, category, and availability. If this is a single ' +
  'product page, return that one product. Do NOT include blog posts, reviews, or navigation links. ' +
  'Return an empty products array if the page shows no purchasable products.';

async function firecrawlFetch(path: string, init?: RequestInit): Promise<any> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) throw new Error('FIRECRAWL_API_KEY is not set');

  // Retry transient network blips, same shape as briefs-store scroll
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`${FIRECRAWL_BASE_URL}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          ...init?.headers,
        },
        signal: AbortSignal.timeout(60_000),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(`Firecrawl ${path} → ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
      return body;
    } catch (err) {
      lastErr = err;
      await new Promise(r => setTimeout(r, attempt * 1000));
    }
  }
  throw lastErr;
}

const LISTING_PATTERN = /\/(collections?|shop|store|category|categories|catalog|all-products)(\/|$)/i;
const PRODUCT_PATTERN = /\/(products?|item|prod|p)\/[^/]+\/?$/i;

/** Pick which discovered URLs to spend the page budget on: listings first (dense), then product pages. */
function selectPages(links: string[], host: string, budget: number): string[] {
  const sameHost = links.filter(u => {
    try {
      return new URL(u).hostname.replace(/^www\./, '') === host.replace(/^www\./, '');
    } catch {
      return false;
    }
  });
  const listings = sameHost.filter(u => LISTING_PATTERN.test(new URL(u).pathname)).slice(0, MAX_LISTING_PAGES);
  const products = sameHost.filter(u => PRODUCT_PATTERN.test(new URL(u).pathname) && !listings.includes(u));
  const selected = [...listings, ...products].slice(0, budget);
  // Nothing recognizable → best effort: homepage + first links up to budget
  if (selected.length === 0) return [`https://${host}/`, ...sameHost.slice(0, budget - 1)];
  return selected;
}

/** Derive a slug-ish handle from a product URL (last meaningful path segment). */
function handleFromUrl(url: string): string {
  try {
    const segments = new URL(url).pathname.split('/').filter(Boolean);
    return segments[segments.length - 1] ?? url;
  } catch {
    return url;
  }
}

/**
 * Extract a store's product catalog via Firecrawl map → batch-scrape(json).
 * Throws if nothing usable comes back — the caller decides the competitor's
 * fate (unverified).
 */
export async function extractCatalogWithFirecrawl(host: string): Promise<NormalizedProduct[]> {
  // 1. Discover the site's URLs
  const mapped = await firecrawlFetch('/map', {
    method: 'POST',
    body: JSON.stringify({ url: `https://${host}`, limit: 1000, includeSubdomains: false }),
  });
  const links: string[] = (mapped?.links ?? [])
    .map((l: { url?: string } | string) => (typeof l === 'string' ? l : l.url))
    .filter(Boolean);
  if (links.length === 0) throw new Error(`Firecrawl map found no URLs for ${host}`);

  // 2. Spend the page budget on the densest pages
  const budget = Number.parseInt(process.env.FIRECRAWL_PAGE_BUDGET ?? '', 10) || DEFAULT_PAGE_BUDGET;
  const pages = selectPages(links, host, budget);
  console.log(`[firecrawl] ${host}: mapped ${links.length} URLs → scraping ${pages.length} pages (budget ${budget})`);

  // 3. Batch-scrape with JSON extraction
  const batch = await firecrawlFetch('/batch/scrape', {
    method: 'POST',
    body: JSON.stringify({
      urls: pages,
      formats: [{ type: 'json', schema: pageProductsSchema, prompt: extractionPrompt }],
      onlyMainContent: true,
      maxConcurrency: 5,
    }),
  });
  if (!batch?.success || !batch?.id) {
    throw new Error(`Firecrawl batch scrape did not start: ${JSON.stringify(batch).slice(0, 300)}`);
  }

  // 4. Poll the batch job until it settles
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let results: Array<{ json?: { products?: ExtractedProduct[] } }> = [];
  for (;;) {
    if (Date.now() > deadline) throw new Error(`Firecrawl batch ${batch.id} timed out after ${POLL_TIMEOUT_MS / 1000}s`);
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    const status = await firecrawlFetch(`/batch/scrape/${batch.id}`);
    if (status.status === 'completed') {
      results = status.data ?? [];
      break;
    }
    if (status.status === 'failed' || status.status === 'cancelled') {
      throw new Error(`Firecrawl batch ${batch.id} ${status.status}`);
    }
    // 'scraping' → keep polling
  }

  // 5. Normalize into the pipeline's strict product schema; drop anything
  // incomplete (grounding > coverage — never fabricate a field).
  const products: NormalizedProduct[] = [];
  const seenUrls = new Set<string>();
  for (const page of results) {
    for (const p of page?.json?.products ?? []) {
      const price = typeof p.price === 'string' ? Number.parseFloat(p.price) : p.price;
      if (!p.title || !Number.isFinite(price) || (price as number) <= 0) continue;
      // Resolve relative URLs and canonicalize: strip query/hash so the same
      // product keeps the same identity across weeks (variant params like
      // ?Material=... would otherwise fracture the diff's exact-ID matching).
      let url: string;
      try {
        const u = new URL(p.url ?? '', `https://${host}/`);
        u.search = '';
        u.hash = '';
        url = u.toString();
      } catch {
        continue;
      }
      if (seenUrls.has(url)) continue; // listing + product page can repeat items
      seenUrls.add(url);
      try {
        products.push(
          normalizedProductSchema.parse({
            productId: url, // stable identity across weeks → exact diff match
            handle: handleFromUrl(url),
            title: p.title,
            vendor: host,
            productType: p.category ?? '',
            tags: [],
            price,
            maxPrice: price,
            currency: p.currency ?? 'USD',
            url,
            variantCount: 1,
            available: p.available ?? true,
          }),
        );
      } catch {
        continue; // skip malformed items rather than failing the whole extraction
      }
      if (products.length >= MAX_PRODUCTS) return products;
    }
  }

  if (products.length === 0) throw new Error(`Firecrawl extraction returned no usable products for ${host}`);
  return products;
}
