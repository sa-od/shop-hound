import { normalizedProductSchema, type NormalizedProduct } from './types';

/**
 * Firecrawl fallback ingestion (PRD §5.1 hybrid path) — AI extraction of product
 * catalogs from stores that do NOT expose Shopify's /products.json (non-Shopify
 * platforms, or Shopify stores with the endpoint disabled). Uses the raw v2
 * /extract REST API via native fetch (no SDK dep — matches the codebase pattern).
 *
 * Coverage is best-effort on large sites: a partial catalog beats zero data, and
 * the `source: 'firecrawl'` tag keeps that transparent downstream.
 */

const FIRECRAWL_BASE_URL = 'https://api.firecrawl.dev/v2';
const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 5 * 60_000; // extraction of a whole store can take minutes
const MAX_PRODUCTS = 2500; // same ceiling as the Shopify scraper

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

const extractionSchema = {
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
        required: ['title', 'price', 'url'],
      },
    },
  },
  required: ['products'],
};

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
        signal: AbortSignal.timeout(30_000),
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
 * Extract a store's product catalog via Firecrawl /extract over https://host/*.
 * Async job: start → poll until completed (or timeout). Throws if nothing usable
 * comes back — the caller decides the competitor's fate (unverified).
 */
export async function extractCatalogWithFirecrawl(host: string): Promise<NormalizedProduct[]> {
  const started = await firecrawlFetch('/extract', {
    method: 'POST',
    body: JSON.stringify({
      urls: [`https://${host}/*`],
      includeSubdomains: false,
      prompt:
        "Extract every product in this online store's catalog: exact title, current numeric price, " +
        'currency code, canonical product page URL, category, and availability. ' +
        'Only include real purchasable products — no blog posts, collections, or navigation links.',
      schema: extractionSchema,
    }),
  });
  if (!started?.success || !started?.id) {
    throw new Error(`Firecrawl extract did not start: ${JSON.stringify(started).slice(0, 300)}`);
  }

  // Poll the job until it settles
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let data: { products?: ExtractedProduct[] } | undefined;
  for (;;) {
    if (Date.now() > deadline) throw new Error(`Firecrawl extract ${started.id} timed out after ${POLL_TIMEOUT_MS / 1000}s`);
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
    const status = await firecrawlFetch(`/extract/${started.id}`);
    if (status.status === 'completed') {
      data = status.data;
      break;
    }
    if (status.status === 'failed' || status.status === 'cancelled') {
      throw new Error(`Firecrawl extract ${started.id} ${status.status}: ${status.error ?? 'no detail'}`);
    }
    // 'processing' → keep polling
  }

  // Normalize into the pipeline's strict product schema; drop anything incomplete
  // (grounding > coverage — never let a partial extraction fabricate a field).
  const products: NormalizedProduct[] = [];
  const seenUrls = new Set<string>();
  for (const p of data?.products ?? []) {
    const price = typeof p.price === 'string' ? Number.parseFloat(p.price) : p.price;
    if (!p.title || !p.url || !Number.isFinite(price) || (price as number) <= 0) continue;
    if (seenUrls.has(p.url)) continue; // extraction can revisit pages
    seenUrls.add(p.url);
    try {
      products.push(
        normalizedProductSchema.parse({
          productId: p.url, // stable identity across weeks → exact diff match
          handle: handleFromUrl(p.url),
          title: p.title,
          vendor: host,
          productType: p.category ?? '',
          tags: [],
          price,
          maxPrice: price,
          currency: p.currency ?? 'USD',
          url: p.url,
          variantCount: 1,
          available: p.available ?? true,
        }),
      );
    } catch {
      continue; // skip malformed items rather than failing the whole extraction
    }
    if (products.length >= MAX_PRODUCTS) break;
  }

  if (products.length === 0) throw new Error(`Firecrawl extraction returned no usable products for ${host}`);
  return products;
}
