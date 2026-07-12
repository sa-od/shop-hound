import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import {
  competitorSnapshotSchema,
  structuredDiffSchema,
  guardrailVerdictSchema,
  type CompetitorSnapshot,
} from '../lib/types';
import { scrapeCatalog, normalizeDomain } from '../lib/scraper';
import { embedProducts, embedText } from '../lib/embeddings';
import { qdrant, ensureCollections, upsertBatched, COMPETITOR_PRODUCTS, GROWTH_BRIEFS } from '../lib/qdrant';
import { saveSnapshot, saveBrief } from '../lib/intel-db';
import { saveSnapshotRecord, getPreviousSnapshotRecord } from '../lib/snapshot-store';
import { diffSnapshots, verifyDiffAgainstPayload } from '../lib/diff-engine';
import { groundingCheck, safetyAudit } from '../lib/enkrypt';
import { listBriefs } from '../lib/briefs-store';

/**
 * Competitive Intelligence Workflow (PRD §7) — the linear high-integrity pipeline:
 * scrape → embed+snapshot (Qdrant) → deterministic diff → Enkrypt grounding →
 * reasoning agent → Enkrypt safety audit → persist + archive.
 *
 * Runs weekly via the declared cron schedule; also startable manually from
 * Studio or the API.
 */

const DEFAULT_COMPETITORS = (process.env.COMPETITOR_STORES ?? '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

// Shared input schema — same instance for the workflow and its first step so
// the chained types line up exactly.
const workflowInputSchema = z.object({
  competitors: z
    .array(z.string())
    .optional()
    .describe('Competitor Shopify store domains, e.g. ["allbirds.com"]. Empty → COMPETITOR_STORES env var.'),
});

// ── Step 1: Ingestion — scrape every competitor; failures become "unverified" ──

const scrapeStep = createStep({
  id: 'scrape-competitors',
  inputSchema: workflowInputSchema,
  outputSchema: z.object({
    snapshots: z.array(competitorSnapshotSchema),
    unverified: z.array(z.string()),
    snapshotDate: z.string(),
  }),
  execute: async ({ inputData }) => {
    const snapshotDate = new Date().toISOString().slice(0, 10);
    const requested = inputData.competitors ?? [];
    const competitors = (requested.length > 0 ? requested : DEFAULT_COMPETITORS).map(normalizeDomain);
    if (competitors.length === 0) {
      throw new Error('No competitors configured. Pass `competitors` or set COMPETITOR_STORES in .env');
    }

    const snapshots: CompetitorSnapshot[] = [];
    const unverified: string[] = [];

    for (const competitor of competitors) {
      try {
        // Shopify /products.json first, Firecrawl AI extraction as fallback
        const { products, source } = await scrapeCatalog(competitor);
        snapshots.push({ competitor, snapshotDate, products, source });
      } catch (err) {
        // Low-confidence fallback (PRD §5.3): never let the agent speculate
        unverified.push(competitor);
        console.warn(`[scrape] ${competitor} failed → marked unverified:`, err);
      }
    }
    return { snapshots, unverified, snapshotDate };
  },
});

// ── Step 2: Embed via text-embedding-3-small → upsert Qdrant + save official record ──

const embedAndSnapshotStep = createStep({
  id: 'embed-and-snapshot',
  inputSchema: scrapeStep.outputSchema,
  outputSchema: z.object({
    snapshots: z.array(competitorSnapshotSchema),
    unverified: z.array(z.string()),
    snapshotDate: z.string(),
    vectorsUpserted: z.number(),
  }),
  execute: async ({ inputData }) => {
    await ensureCollections();
    let vectorsUpserted = 0;

    for (const snapshot of inputData.snapshots) {
      const vectors = await embedProducts(snapshot.products);
      vectorsUpserted += await upsertBatched({
        indexName: COMPETITOR_PRODUCTS,
        vectors,
        metadata: snapshot.products.map(p => ({
          competitor: snapshot.competitor,
          snapshotDate: snapshot.snapshotDate,
          productId: p.productId,
          title: p.title,
          price: p.price,
          url: p.url,
          productType: p.productType,
        })),
      });
      await saveSnapshotRecord(snapshot); // durable diff baseline → Qdrant
      await saveSnapshot(snapshot).catch(err => console.warn('[intel-db] local mirror failed:', err)); // local relational mirror
    }
    return { ...inputData, vectorsUpserted };
  },
});

// ── Step 3: Deterministic Semantic Diff Engine ──

const diffStep = createStep({
  id: 'semantic-diff',
  inputSchema: embedAndSnapshotStep.outputSchema,
  outputSchema: z.object({
    diff: structuredDiffSchema,
    snapshots: z.array(competitorSnapshotSchema),
    groundingErrors: z.array(z.string()),
  }),
  execute: async ({ inputData }) => {
    const diffs = [];
    const groundingErrors: string[] = [];

    for (const snapshot of inputData.snapshots) {
      const previous = await getPreviousSnapshotRecord(snapshot.competitor, snapshot.snapshotDate);
      const diff = await diffSnapshots(snapshot, previous);
      // Deterministic grounding pre-check: numbers must map to the payload
      groundingErrors.push(...verifyDiffAgainstPayload(diff, snapshot, previous));
      diffs.push({ ...diff, source: snapshot.source ?? ('shopify' as const) });
    }

    for (const competitor of inputData.unverified) {
      diffs.push({
        competitor,
        status: 'unverified' as const,
        previousSnapshotDate: null,
        currentSnapshotDate: inputData.snapshotDate,
        productCount: 0,
        newSkus: [],
        removedSkus: [],
        priceChanges: [],
        titleChanges: [],
      });
    }

    return {
      diff: { weekOf: inputData.snapshotDate, diffs, unverified: inputData.unverified },
      snapshots: inputData.snapshots,
      groundingErrors,
    };
  },
});

// ── Step 4: Grounding Guardrail (Enkrypt AI — input side of the sandwich) ──

const groundingStep = createStep({
  id: 'grounding-guardrail',
  inputSchema: diffStep.outputSchema,
  outputSchema: z.object({
    diff: structuredDiffSchema,
    grounding: guardrailVerdictSchema,
  }),
  execute: async ({ inputData }) => {
    // Scan BOTH what the agent will see (the diff JSON) and the raw scraped
    // product titles — injection can hide in any untrusted string, including
    // ones that only reach the agent later via tools. (Enkrypt caps at 30k
    // chars; the diff comes first so agent-bound content is always covered.)
    const diffText = JSON.stringify(inputData.diff);
    const scrapedTitles = inputData.snapshots.flatMap(s => s.products.map(p => p.title)).join('\n');
    const verdict = await groundingCheck(`${diffText}\n${scrapedTitles}`);

    // Merge the deterministic payload-mapping check into the verdict
    if (inputData.groundingErrors.length > 0) {
      verdict.greenLight = false;
      verdict.violations.push(...inputData.groundingErrors);
    }

    // On failure we QUARANTINE rather than throw: the run continues, but the
    // agent is never invoked (see generate-brief) and the withheld brief is
    // archived with the full violation record — auditable, visible, blocked.
    if (!verdict.greenLight && verdict.enkryptEnabled) {
      console.warn(`[grounding] BLOCKED — agent will not run: ${verdict.violations.join('; ')}`);
    }
    return { diff: inputData.diff, grounding: verdict };
  },
});

// ── Step 5: Reasoning Agent generates the brief from the verified diff ──

const generateBriefStep = createStep({
  id: 'generate-brief',
  inputSchema: groundingStep.outputSchema,
  outputSchema: z.object({
    diff: structuredDiffSchema,
    grounding: guardrailVerdictSchema,
    brief: z.string(),
    // Serialized verified history handed to the agent — threaded onward so the
    // safety audit grounds trend claims against it too.
    history: z.string(),
  }),
  execute: async ({ inputData, mastra }) => {
    // Hard guarantee (PRD §5.3): data that failed the grounding guardrail
    // NEVER reaches the reasoning agent. The brief is withheld and the block
    // itself becomes the (fully audited) deliverable.
    if (!inputData.grounding.greenLight) {
      const brief = [
        '# ⛔ Growth Brief Withheld — Guardrail Block',
        '',
        "This week's scraped competitor data **failed the Enkrypt AI grounding guardrail** and was",
        'quarantined before it could reach the reasoning agent. No AI generation occurred.',
        '',
        '**Violations detected:**',
        ...inputData.grounding.violations.map(v => `- ${v}`),
        '',
        '_This is the 0%-hallucination guarantee working: untrusted or malicious input is blocked,_',
        '_never summarized._',
      ].join('\n');
      return { ...inputData, brief, history: '[]' };
    }

    // Week-over-week trend context from the Qdrant growth_briefs archive:
    // prior briefs that cover any of this run's competitors, newest first.
    // Verified payload data only — the agent may cite it, and the safety audit
    // grounds against it. Failure here must never block the brief.
    const runCompetitors = new Set(inputData.diff.diffs.map(d => d.competitor));
    let historyEntries: unknown[] = [];
    try {
      const past = await listBriefs();
      historyEntries = past
        .filter(b => b.competitors.some(c => runCompetitors.has(c.competitor)))
        .slice(0, 4)
        .map(b => ({
          weekOf: b.weekOf,
          createdAt: b.createdAt,
          greenLight: b.greenLight,
          competitors: b.competitors.filter(c => runCompetitors.has(c.competitor)),
        }));
    } catch (err) {
      console.warn('[generate-brief] history lookup failed, continuing without trends:', err);
    }
    const history = JSON.stringify(historyEntries);

    const agent = mastra.getAgent('growthBriefAgent');
    const trendBlock =
      historyEntries.length > 0
        ? `\n\nVERIFIED HISTORY (previous archived briefs for these competitors, from long-term Qdrant memory):\n\`\`\`json\n${history}\n\`\`\`\nInclude a "## Week-over-Week Trends" section comparing this week against the history above. Cite ONLY numbers present in the diff or the history.`
        : '';
    const response = await agent.generate(
      `Here is this week's VERIFIED structured competitor diff. Write the weekly Growth Brief.\n\n\`\`\`json\n${JSON.stringify(inputData.diff, null, 2)}\n\`\`\`${trendBlock}`,
      {
        memory: {
          resource: 'merchant-default',
          thread: `growth-brief-${inputData.diff.weekOf}`,
        },
      },
    );
    return { ...inputData, brief: response.text, history };
  },
});

// ── Step 6: Safety Audit (Enkrypt AI — output side of the sandwich) ──

const safetyAuditStep = createStep({
  id: 'safety-audit',
  inputSchema: generateBriefStep.outputSchema,
  outputSchema: z.object({
    diff: structuredDiffSchema,
    grounding: guardrailVerdictSchema,
    safety: guardrailVerdictSchema,
    brief: z.string(),
    greenLight: z.boolean(),
  }),
  execute: async ({ inputData }) => {
    // Quarantined upstream → nothing was generated, so there is nothing to
    // audit. Record the skip explicitly (the audit trail must never be blank).
    if (!inputData.grounding.greenLight) {
      const safety = {
        checkpoint: 'safety' as const,
        greenLight: false,
        enkryptEnabled: true,
        violations: ['audit skipped — grounding guardrail blocked the input upstream, agent never ran'],
        detail: { skipped: true },
      };
      return { ...inputData, safety, greenLight: false };
    }

    // Grounding context = diff + the verified history the agent was shown, so
    // trend numbers audit as grounded. Spread keeps `diffs` at the top level —
    // the deterministic numeric check derives its section counts from it.
    const auditContext = JSON.stringify({ ...inputData.diff, history: JSON.parse(inputData.history) });
    const safety = await safetyAudit(inputData.brief, auditContext);
    const greenLight = inputData.grounding.greenLight && safety.greenLight;

    if (!safety.greenLight && safety.enkryptEnabled) {
      console.warn(`[safety-audit] Brief FAILED audit: ${safety.violations.join('; ')}`);
    }
    return { ...inputData, safety, greenLight };
  },
});

// ── Step 7: Persist official record + archive to Qdrant growth_briefs ──

const persistStep = createStep({
  id: 'persist-and-archive',
  inputSchema: safetyAuditStep.outputSchema,
  outputSchema: z.object({
    briefId: z.number(),
    greenLight: z.boolean(),
    brief: z.string(),
    weekOf: z.string(),
    auditLog: z.object({
      grounding: guardrailVerdictSchema,
      safety: guardrailVerdictSchema,
    }),
  }),
  execute: async ({ inputData }) => {
    const briefId = await saveBrief({
      weekOf: inputData.diff.weekOf,
      briefMarkdown: inputData.brief,
      greenLight: inputData.greenLight,
      grounding: inputData.grounding,
      safety: inputData.safety,
      diff: inputData.diff,
    });

    // Archive EVERY brief (green or not) into long-term memory — Qdrant is the
    // durable read source for the dashboard (intel.db is ephemeral in the cloud).
    await ensureCollections();
    // A brief is identified by (week, competitor set). Re-running the SAME
    // competitors in a week replaces that card; a different set makes a new one.
    const competitorKey = inputData.diff.diffs
      .map(c => c.competitor)
      .sort()
      .join(',');
    // Dedupe re-runs of this same competitor set for the week before writing.
    await qdrant
      .deleteVectors({
        indexName: GROWTH_BRIEFS,
        filter: { weekOf: inputData.diff.weekOf, competitorKey },
      })
      .catch(() => {});
    const vector = await embedText(inputData.brief.slice(0, 8000));
    await qdrant.upsert({
      indexName: GROWTH_BRIEFS,
      vectors: [vector],
      metadata: [
        {
          briefId,
          weekOf: inputData.diff.weekOf,
          competitorKey,
          createdAt: new Date().toISOString(),
          greenLight: inputData.greenLight,
          briefMarkdown: inputData.brief, // full text — Qdrant is the durable archive
          competitors: inputData.diff.diffs.map(c => ({
            competitor: c.competitor,
            status: c.status,
            source: c.source ?? 'shopify',
            productCount: c.productCount,
            newSkus: c.newSkus.length,
            priceChanges: c.priceChanges.length,
            titleChanges: c.titleChanges.length,
          })),
          grounding: {
            greenLight: inputData.grounding.greenLight,
            violations: inputData.grounding.violations,
          },
          safety: {
            greenLight: inputData.safety.greenLight,
            violations: inputData.safety.violations,
            method: (inputData.safety.detail?.groundingMethod as string) ?? null,
          },
        },
      ],
    });

    return {
      briefId,
      greenLight: inputData.greenLight,
      brief: inputData.brief,
      weekOf: inputData.diff.weekOf,
      auditLog: { grounding: inputData.grounding, safety: inputData.safety },
    };
  },
});

// ── The pipeline ──

export const competitiveIntelWorkflow = createWorkflow({
  id: 'competitive-intel-workflow',
  inputSchema: workflowInputSchema,
  outputSchema: persistStep.outputSchema,
  schedule: {
    cron: '0 9 * * 1', // every Monday 09:00 — weekly cadence (PRD §13)
    timezone: 'UTC',
    inputData: { competitors: [] },
  },
})
  .then(scrapeStep)
  .then(embedAndSnapshotStep)
  .then(diffStep)
  .then(groundingStep)
  .then(generateBriefStep)
  .then(safetyAuditStep)
  .then(persistStep)
  .commit();
