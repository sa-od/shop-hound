import { registerApiRoute } from '@mastra/core/server';
import { listRecentBriefs, getBrief } from '../lib/briefs-store';
import { normalizeDomain } from '../lib/scraper';

/**
 * Hono API Gateway routes (PRD §10) served by the Mastra server itself.
 * Read path for the Merchant Dashboard. CORS is open by default (ServerConfig
 * default origin '*'), so the hosted dashboard can fetch these cross-origin.
 *
 * NOTE: the `/api` prefix is reserved for Mastra's built-in routes, so these
 * live at the server root: /briefs, /briefs/:id, /status.
 */
export const apiRoutes = [
  // POST /run — fire-and-forget workflow start (truly async, returns 202 immediately)
  registerApiRoute('/run', {
    method: 'POST',
    openapi: {
      summary: 'Start a competitive analysis run (fire-and-forget)',
      tags: ['Dashboard'],
    },
    handler: async c => {
      try {
        const body = await c.req.json();
        const raw: string[] = body?.competitors ?? [];
        const competitors = raw.map(normalizeDomain).filter(Boolean);
        if (competitors.length === 0) {
          return c.json({ error: 'No valid competitors provided' }, 400);
        }
        const mastra = c.get('mastra');
        const workflow = mastra.getWorkflow('competitiveIntelWorkflow');
        const run = await workflow.createRun();
        // Fire-and-forget: start the workflow in the background, return 202 immediately
        run.start({ inputData: { competitors } }).catch((err: unknown) => {
          console.error('[/run] workflow failed:', err);
        });
        return c.json({ accepted: true, competitors }, 202);
      } catch (err) {
        console.error('[/run] error:', err);
        return c.json({ error: 'Failed to start run', code: 'INTERNAL' }, 500);
      }
    },
  }),

  // GET /briefs — list all archived weekly briefs (newest first, no markdown)
  registerApiRoute('/briefs', {
    method: 'GET',
    openapi: {
      summary: 'List growth briefs',
      tags: ['Dashboard'],
    },
    handler: async c => {
      try {
        const briefs = await listRecentBriefs();
        return c.json({ briefs });
      } catch (err) {
        console.error('[/briefs] error:', err);
        return c.json({ error: 'Failed to load briefs', code: 'INTERNAL' }, 500);
      }
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
      try {
        const brief = await getBrief(c.req.param('id'));
        if (!brief) return c.json({ error: 'not found' }, 404);
        return c.json({ brief });
      } catch (err) {
        console.error('[/briefs/:id] error:', err);
        return c.json({ error: 'Failed to load brief', code: 'INTERNAL' }, 500);
      }
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
      try {
        const mastra = c.get('mastra');
        const briefs = await listRecentBriefs();
        let active = 0;
        try {
          const runs = await Promise.race([
            mastra
              .getWorkflow('competitiveIntelWorkflow')
              .listActiveWorkflowRuns(),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('timeout')), 5000),
            ),
          ]);
          active = runs.runs.length;
        } catch {
          active = 0;
        }
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
      } catch (err) {
        console.error('[/status] error:', err);
        return c.json({ error: 'Failed to load status', code: 'INTERNAL' }, 500);
      }
    },
  }),
];
