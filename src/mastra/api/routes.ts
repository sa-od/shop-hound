import { registerApiRoute } from '@mastra/core/server';
import { listBriefs, getBrief } from '../lib/briefs-store';

/**
 * Hono API Gateway routes (PRD §10) served by the Mastra server itself.
 * Read path for the Merchant Dashboard. CORS is open by default (ServerConfig
 * default origin '*'), so the hosted dashboard can fetch these cross-origin.
 *
 * NOTE: the `/api` prefix is reserved for Mastra's built-in routes, so these
 * live at the server root: /briefs, /briefs/:id, /status.
 */
export const apiRoutes = [
  // GET /briefs — list all archived weekly briefs (newest first, no markdown)
  registerApiRoute('/briefs', {
    method: 'GET',
    openapi: {
      summary: 'List growth briefs',
      tags: ['Dashboard'],
    },
    handler: async c => {
      const briefs = await listBriefs();
      return c.json({ briefs });
    },
  }),

  // GET /briefs/:id — a single brief by weekOf (e.g. 2026-07-11) or briefId
  registerApiRoute('/briefs/:id', {
    method: 'GET',
    openapi: {
      summary: 'Get a single growth brief with full markdown + audit',
      tags: ['Dashboard'],
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
      ],
    },
    handler: async c => {
      const brief = await getBrief(c.req.param('id'));
      if (!brief) return c.json({ error: 'not found' }, 404);
      return c.json({ brief });
    },
  }),

  // GET /status — latest run summary + whether a run is currently in progress
  registerApiRoute('/status', {
    method: 'GET',
    openapi: {
      summary: 'Workflow status: last brief + active run flag',
      tags: ['Dashboard'],
    },
    handler: async c => {
      const mastra = c.get('mastra');
      const [briefs, active] = await Promise.all([
        listBriefs(),
        mastra
          .getWorkflow('competitiveIntelWorkflow')
          .listActiveWorkflowRuns()
          .then(r => r.runs.length)
          .catch(() => 0),
      ]);
      const last = briefs[0] ?? null;
      return c.json({
        running: active > 0,
        activeRuns: active,
        lastBrief: last
          ? {
              weekOf: last.weekOf,
              greenLight: last.greenLight,
              createdAt: last.createdAt,
              competitorCount: last.competitors.length,
            }
          : null,
        totalBriefs: briefs.length,
      });
    },
  }),
];
