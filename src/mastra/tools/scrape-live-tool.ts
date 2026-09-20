import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { scrapeCatalog, normalizeDomain } from '../lib/scraper';
import { normalizedProductSchema } from '../lib/types';

/**
 * tool:scrape-live (PRD §10) — agent-triggered real-time validation.
 * Lets the reasoning agent re-verify a data point against the live store
 * instead of speculating.
 */
export const scrapeLiveTool = createTool({
  id: 'scrape-live',
  description:
    'Fetch the LIVE public product catalog of any online store (Shopify /products.json first, Firecrawl AI extraction as fallback for non-Shopify stores). Use this to verify a current price or product before making a claim. Returns normalized products.',
  inputSchema: z.object({
    domain: z.string().describe('Store domain, e.g. "allbirds.com"'),
    query: z.string().optional().describe('Optional case-insensitive title filter'),
  }),
  outputSchema: z.object({
    competitor: z.string(),
    source: z.enum(['shopify', 'firecrawl']).describe('Which ingestion path produced the data'),
    productCount: z.number(),
    products: z.array(normalizedProductSchema).describe('Up to 25 matching products'),
  }),
  execute: async (inputData) => {
    const competitor = normalizeDomain(inputData.domain);
    if (!competitor || competitor.length > 253 || !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,12}$/.test(competitor)) {
      throw new Error(`Invalid domain: "${inputData.domain}" — expected a store domain like "allbirds.com"`);
    }
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(competitor) || /^\[/.test(competitor)) {
      throw new Error(`Invalid domain: "${inputData.domain}" — IP addresses and localhost are not supported`);
    }
    const { products: all, source } = await scrapeCatalog(competitor);
    const filtered = inputData.query
      ? all.filter(p => p.title.toLowerCase().includes(inputData.query!.toLowerCase()))
      : all;
    return { competitor, source, productCount: filtered.length, products: filtered.slice(0, 25) };
  },
});
