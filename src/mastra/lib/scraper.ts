import { normalizedProductSchema, type NormalizedProduct } from './types';

/**
 * Hybrid ingestion (PRD §5.1) — structured JSON from the public Shopify
 * /products.json endpoint. Firecrawl (JS-rendered/sentiment) can be layered in
 * later; the public endpoint covers catalog, pricing, and SKU data.
 */

const PAGE_LIMIT = 250;
const MAX_PAGES = 10; // cap: up to 2500 products per competitor (~2–3 min embed)

interface ShopifyProductsResponse {
  products: Array<{
    id: number;
    handle: string;
    title: string;
    vendor?: string;
    product_type?: string;
    tags?: string[] | string;
    variants: Array<{ price: string; available?: boolean }>;
  }>;
}

export function normalizeDomain(input: string): string {
  return input
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .toLowerCase();
}

export async function scrapeShopifyCatalog(domain: string): Promise<NormalizedProduct[]> {
  const host = normalizeDomain(domain);
  const products: NormalizedProduct[] = [];

  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `https://${host}/products.json?limit=${PAGE_LIMIT}&page=${page}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CompetitiveIntelBot/1.0)' },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      throw new Error(`GET ${url} → ${res.status}`);
    }
    const data = (await res.json()) as ShopifyProductsResponse;
    if (!Array.isArray(data.products)) {
      throw new Error(`GET ${url} → unexpected payload shape`);
    }

    for (const p of data.products) {
      const prices = p.variants.map(v => Number.parseFloat(v.price)).filter(n => Number.isFinite(n));
      if (prices.length === 0) continue;
      products.push(
        normalizedProductSchema.parse({
          productId: String(p.id),
          handle: p.handle,
          title: p.title,
          vendor: p.vendor ?? '',
          productType: p.product_type ?? '',
          tags: Array.isArray(p.tags) ? p.tags : (p.tags ?? '').split(',').map(t => t.trim()).filter(Boolean),
          price: Math.min(...prices),
          maxPrice: Math.max(...prices),
          currency: 'USD',
          url: `https://${host}/products/${p.handle}`,
          variantCount: p.variants.length,
          available: p.variants.some(v => v.available !== false),
        }),
      );
    }

    if (data.products.length < PAGE_LIMIT) break; // last page
  }

  return products;
}
