import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { LibSQLStore } from '@mastra/libsql';
import { DuckDBStore } from '@mastra/duckdb';
import { MastraCompositeStore } from '@mastra/core/storage';
import { Observability, MastraStorageExporter, SensitiveDataFilter } from '@mastra/observability';
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
        // Storage exporter ONLY — writes spans to local storage. The platform
        // exporter is deliberately absent: it streams traces to a remote
        // endpoint, and Mastra Platform measures idleness by OUTBOUND traffic
        // ("a service is considered idle only after roughly 10 minutes with no
        // outbound packets"). A continuous trace stream keeps resetting that
        // timer, so the server never sleeps and bills CPU around the clock —
        // which is how a workflow that runs 65 seconds a week burned through
        // the 24-hour included quota doing nothing.
        // Trade-off: traces stop appearing in the Mastra platform UI. They are
        // still recorded locally and reachable via the server's own API.
        exporters: [new MastraStorageExporter()],
        spanOutputProcessors: [new SensitiveDataFilter()],
      },
    },
  }),
});
