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
const POLL_INTERVAL_MS = 3_000;
// Wait up to this long for the batch, never past the run's deadline. Pages
// finished by then are kept (a partial read beats none); measured large
// stores took longer than the old 60s cap for 15 pages.
const POLL_TIMEOUT_MS = 120_000;
const MAX_PRODUCTS = 2500; // same ceiling as the Shopify scraper
// Page budget caps credit burn (json extraction costs credits per page).
// Override with FIRECRAWL_PAGE_BUDGET for deeper coverage on paid plans.
const DEFAULT_PAGE_BUDGET = 10;
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

const CALL_TIMEOUT_MS = 60_000;
const CALL_ATTEMPTS = 3;

/** Firecrawl answered with an HTTP error (as opposed to the request never arriving). */
class FirecrawlHttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/**
 * Was the request certainly never processed? Only then is re-sending a billed
 * POST safe: a timeout or a 5xx may mean Firecrawl started the job anyway, and
 * a second POST would start (and bill) a second one.
 */
export function safeToResend(err: unknown, method: string): boolean {
  if (method === 'GET') return true; // polling is read-only
  if (err instanceof FirecrawlHttpError) return err.status === 429; // rate-limited: rejected outright
  const e = err as { name?: string; cause?: { code?: string } };
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError') return false;
  // Connection never made: DNS failure, refused, reset before sending.
  return ['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'UND_ERR_CONNECT_TIMEOUT'].includes(e?.cause?.code ?? '');
}

/**
 * One Firecrawl API call. Each try's timeout is cut to fit `deadlineAt`, so a
 * slow Firecrawl can't carry the run past the function limit (where it would
 * be killed before recording any outcome).
 */
async function firecrawlFetch(path: string, init: RequestInit = {}, deadlineAt?: number): Promise<any> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) throw new Error('FIRECRAWL_API_KEY is not set');
  const method = (init.method ?? 'GET').toUpperCase();

  let lastErr: unknown;
  for (let attempt = 1; attempt <= CALL_ATTEMPTS; attempt++) {
    const left = deadlineAt === undefined ? CALL_TIMEOUT_MS : deadlineAt - Date.now();
    if (left < 2_000) throw lastErr ?? new Error(`Firecrawl ${path}: time budget exhausted`);
    try {
      const res = await fetch(`${FIRECRAWL_BASE_URL}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          ...init.headers,
        },
        signal: AbortSignal.timeout(Math.min(CALL_TIMEOUT_MS, left)),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new FirecrawlHttpError(`Firecrawl ${path} → ${res.status}: ${JSON.stringify(body).slice(0, 300)}`, res.status);
      return body;
    } catch (err) {
      lastErr = err;
      if (!safeToResend(err, method)) throw err;
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

/**
 * The product's URL, canonicalised, if it is an http(s) page on the store's
 * own site (or a subdomain of it); null otherwise. The AI's output is
 * untrusted — a page with injected text could make it return links to other
 * sites, which the brief would then show as the store's products.
 * Query and hash are stripped so the same product keeps one identity
 * (variant params like ?Material=… would otherwise split it).
 */
export function storeProductUrl(raw: string | undefined, host: string): string | null {
  try {
    const u = new URL(raw ?? '', `https://${host}/`);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    const site = host.replace(/^www\./, '');
    const h = u.hostname.replace(/^www\./, '');
    if (h !== site && !h.endsWith(`.${site}`)) return null;
    u.search = '';
    u.hash = '';
    return u.toString();
  } catch {
    return null;
  }
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
export async function extractCatalogWithFirecrawl(host: string, deadlineAt?: number): Promise<NormalizedProduct[]> {
  // Map + batch each take a Firecrawl round-trip; refuse to start when the
  // run's remaining budget cannot plausibly cover them.
  if (deadlineAt !== undefined && deadlineAt - Date.now() < 30_000) {
    throw new Error('time budget exhausted before Firecrawl extraction');
  }
  // 1. Discover the site's URLs
  const mapped = await firecrawlFetch('/map', {
    method: 'POST',
    body: JSON.stringify({ url: `https://${host}`, limit: 1000, includeSubdomains: false }),
  }, deadlineAt);
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
  }, deadlineAt);
  if (!batch?.success || !batch?.id) {
    throw new Error(`Firecrawl batch scrape did not start: ${JSON.stringify(batch).slice(0, 300)}`);
  }

  // 4. Poll the batch job until it settles
  // Poll until Firecrawl's own cap or the run's deadline, whichever is sooner
  // (a few seconds are held back so the caller can still record the outcome).
  const deadline = Math.min(Date.now() + POLL_TIMEOUT_MS, deadlineAt === undefined ? Infinity : deadlineAt - 5_000);
  let results: Array<{ json?: { products?: ExtractedProduct[] } }> = [];
  for (;;) {
    if (Date.now() > deadline) {
      if (results.some(r => (r?.json?.products ?? []).length > 0)) {
        console.warn(`[firecrawl] ${host}: batch still running at the deadline — keeping ${results.length} finished page(s)`);
        break;
      }
      throw new Error(`Firecrawl batch ${batch.id} timed out (poll budget exhausted)`);
    }
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    // A poll that fails near the deadline keeps the pages finished so far.
    const status = await firecrawlFetch(`/batch/scrape/${batch.id}`, {}, deadline).catch(err => {
      if (results.some(r => (r?.json?.products ?? []).length > 0)) return { status: 'deadline', data: results };
      throw err;
    });
    if (Array.isArray(status.data)) results = status.data; // pages finished so far
    if (status.status === 'completed' || status.status === 'deadline') break;
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
      const url = storeProductUrl(p.url, host);
      if (!url) continue;
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

/**
 * Fetch one URL through Firecrawl as-is (no AI extraction, 1 credit) and
 * return what the store answered. Used to read a Shopify store's own
 * /products.json when the store refuses our direct requests: same exact data,
 * fetched from Firecrawl's network.
 */
export async function fetchViaFirecrawl(
  url: string,
  timeoutMs: number,
): Promise<{ status: number; contentType: string; body: string }> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) throw new Error('FIRECRAWL_API_KEY is not set');
  const res = await fetch(`${FIRECRAWL_BASE_URL}/scrape`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, formats: ['rawHtml'], onlyMainContent: false, timeout: Math.max(5_000, timeoutMs - 3_000) }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const json: any = await res.json().catch(() => null);
  if (!res.ok || !json?.success) {
    throw new Error(`Firecrawl fetch → ${res.status}: ${JSON.stringify(json?.error ?? json).slice(0, 200)}`);
  }
  const meta = json.data?.metadata ?? {};
  return { status: Number(meta.statusCode) || 0, contentType: String(meta.contentType ?? ''), body: String(json.data?.rawHtml ?? '') };
}
