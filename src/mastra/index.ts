import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { LibSQLStore } from '@mastra/libsql';
import { DuckDBStore } from '@mastra/duckdb';
import { MastraCompositeStore } from '@mastra/core/storage';
import {
  Observability,
  MastraStorageExporter,
  MastraPlatformExporter,
  SensitiveDataFilter,
} from '@mastra/observability';
import { competitiveIntelWorkflow } from './workflows/competitive-intel-workflow';
import { growthBriefAgent } from './agents/growth-brief-agent';
import { qdrant } from './lib/qdrant';
import { apiRoutes } from './api/routes';

export const mastra = new Mastra({
  workflows: { competitiveIntelWorkflow },
  agents: { growthBriefAgent },
  vectors: { qdrant },
  server: {
    apiRoutes, // Hono read-path for the dashboard: /api/briefs, /api/briefs/:id, /api/status
  },
  storage: new MastraCompositeStore({
    id: 'composite-storage',
    default: new LibSQLStore({
      id: 'mastra-storage',
      url: 'file:./mastra.db',
    }),
    domains: {
      observability: await new DuckDBStore().getStore('observability'),
    },
  }),
  logger: new PinoLogger({
    name: 'Mastra',
    level: 'info',
  }),
  observability: new Observability({
    configs: {
      default: {
        serviceName: 'competitive-intel',
        exporters: [new MastraStorageExporter(), new MastraPlatformExporter()],
        spanOutputProcessors: [new SensitiveDataFilter()],
      },
    },
  }),
});
