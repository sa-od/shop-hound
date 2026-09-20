import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { LibSQLStore } from '@mastra/libsql';
import { MastraCompositeStore } from '@mastra/core/storage';
import { competitiveIntelWorkflow } from './workflows/competitive-intel-workflow';
import { growthBriefAgent } from './agents/growth-brief-agent';
import { scrapeLiveTool } from './tools/scrape-live-tool';
import { semanticQueryTool } from './tools/semantic-query-tool';
import { qdrant } from './lib/qdrant';
import { apiRoutes } from './api/routes';

export const mastra = new Mastra({
  workflows: { competitiveIntelWorkflow },
  agents: { growthBriefAgent },
  tools: { scrapeLiveTool, semanticQueryTool },
  vectors: { qdrant },
  server: {
    apiRoutes,
  },
  storage: new MastraCompositeStore({
    id: 'composite-storage',
    default: new LibSQLStore({
      id: 'mastra-storage',
      url: process.env.TURSO_URL ?? 'file:./mastra.db',
      authToken: process.env.TURSO_AUTH_TOKEN,
    }),
  }),
  logger: new PinoLogger({
    name: 'Mastra',
    level: 'info',
  }),
});
