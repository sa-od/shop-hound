import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { embedText } from '../lib/embeddings';
import { qdrant, COMPETITOR_PRODUCTS, GROWTH_BRIEFS, ensureCollections } from '../lib/qdrant';

/**
 * tool:semantic-query (PRD §10) — agent-triggered search of long-term semantic
 * memory in Qdrant. Same embedding model as ingestion, so query and stored
 * vectors share one origin (PRD §6 consistency requirement).
 */
export const semanticQueryTool = createTool({
  id: 'semantic-query',
  description:
    'Semantic search over long-term memory in Qdrant. Collection "competitor_products" holds historical product snapshots (filterable by competitor domain); "growth_briefs" holds past weekly briefs for trend analysis.',
  inputSchema: z.object({
    query: z.string().describe('Natural-language search query'),
    collection: z.enum([COMPETITOR_PRODUCTS, GROWTH_BRIEFS]).default(COMPETITOR_PRODUCTS),
    competitor: z.string().optional().describe('Restrict competitor_products search to one domain'),
    topK: z.number().min(1).max(20).default(5),
  }),
  outputSchema: z.object({
    results: z.array(
      z.object({
        score: z.number(),
        metadata: z.record(z.string(), z.unknown()),
      }),
    ),
  }),
  execute: async (inputData) => {
    await ensureCollections();
    const queryVector = await embedText(inputData.query);
    const results = await qdrant.query({
      indexName: inputData.collection,
      queryVector,
      topK: inputData.topK,
      filter:
        inputData.collection === COMPETITOR_PRODUCTS && inputData.competitor
          ? { competitor: inputData.competitor }
          : undefined,
    });
    return {
      results: results.map(r => ({ score: r.score, metadata: r.metadata ?? {} })),
    };
  },
});
