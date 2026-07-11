import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { scrapeShopifyCatalog, normalizeDomain } from '../lib/scraper';
import { normalizedProductSchema } from '../lib/types';

/**
 * tool:scrape-live (PRD §10) — agent-triggered real-time validation.
 * Lets the reasoning agent re-verify a data point against the live store
 * instead of speculating.
 */
export const scrapeLiveTool = createTool({
  id: 'scrape-live',
  description:
    'Fetch the LIVE public product catalog of a Shopify store (via /products.json). Use this to verify a current price or product before making a claim. Returns normalized products.',
  inputSchema: z.object({
    domain: z.string().describe('Store domain, e.g. "allbirds.com"'),
    query: z.string().optional().describe('Optional case-insensitive title filter'),
  }),
  outputSchema: z.object({
    competitor: z.string(),
    productCount: z.number(),
    products: z.array(normalizedProductSchema).describe('Up to 25 matching products'),
  }),
  execute: async (inputData) => {
    const competitor = normalizeDomain(inputData.domain);
    const all = await scrapeShopifyCatalog(competitor);
    const filtered = inputData.query
      ? all.filter(p => p.title.toLowerCase().includes(inputData.query!.toLowerCase()))
      : all;
    return { competitor, productCount: filtered.length, products: filtered.slice(0, 25) };
  },
});
