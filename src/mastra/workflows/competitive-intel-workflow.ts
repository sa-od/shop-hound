import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import {
  competitorSnapshotSchema,
  structuredDiffSchema,
  guardrailVerdictSchema,
  type CompetitorSnapshot,
} from '../lib/types';
import { scrapeShopifyCatalog, normalizeDomain } from '../lib/scraper';
import { embedProducts, embedText } from '../lib/embeddings';
import { qdrant, ensureCollections, COMPETITOR_PRODUCTS, GROWTH_BRIEFS } from '../lib/qdrant';
import { saveSnapshot, getPreviousSnapshot, saveBrief } from '../lib/intel-db';
import { diffSnapshots, verifyDiffAgainstPayload } from '../lib/diff-engine';
import { groundingCheck, safetyAudit } from '../lib/enkrypt';

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

// ── Step 1: Ingestion — scrape every competitor; failures become "unverified" ──

const scrapeStep = createStep({
  id: 'scrape-competitors',
  inputSchema: z.object({
    competitors: z.array(z.string()).describe('Competitor store domains, e.g. ["allbirds.com"]'),
  }),
  outputSchema: z.object({
    snapshots: z.array(competitorSnapshotSchema),
    unverified: z.array(z.string()),
    snapshotDate: z.string(),
  }),
  execute: async ({ inputData }) => {
    const snapshotDate = new Date().toISOString().slice(0, 10);
    const competitors = (inputData.competitors.length > 0 ? inputData.competitors : DEFAULT_COMPETITORS).map(
      normalizeDomain,
    );
    if (competitors.length === 0) {
      throw new Error('No competitors configured. Pass `competitors` or set COMPETITOR_STORES in .env');
    }

    const snapshots: CompetitorSnapshot[] = [];
    const unverified: string[] = [];

    for (const competitor of competitors) {
      try {
        const products = await scrapeShopifyCatalog(competitor);
        if (products.length === 0) throw new Error('empty catalog');
        snapshots.push({ competitor, snapshotDate, products });
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
      await qdrant.upsert({
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
      vectorsUpserted += vectors.length;
      await saveSnapshot(snapshot); // "Save Normalized Data" → Main DB
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
      const previous = await getPreviousSnapshot(snapshot.competitor, snapshot.snapshotDate);
      const diff = await diffSnapshots(snapshot, previous);
      // Deterministic grounding pre-check: numbers must map to the payload
      groundingErrors.push(...verifyDiffAgainstPayload(diff, snapshot, previous));
      diffs.push(diff);
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
    const diffText = JSON.stringify(inputData.diff);
    const verdict = await groundingCheck(diffText);

    // Merge the deterministic payload-mapping check into the verdict
    if (inputData.groundingErrors.length > 0) {
      verdict.greenLight = false;
      verdict.violations.push(...inputData.groundingErrors);
    }

    if (!verdict.greenLight && verdict.enkryptEnabled) {
      // Hard stop: unverified data must never reach the reasoning agent (PRD §5.3)
      throw new Error(`Grounding guardrail BLOCKED the diff: ${verdict.violations.join('; ')}`);
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
  }),
  execute: async ({ inputData, mastra }) => {
    const agent = mastra.getAgent('growthBriefAgent');
    const response = await agent.generate(
      `Here is this week's VERIFIED structured competitor diff. Write the weekly Growth Brief.\n\n\`\`\`json\n${JSON.stringify(inputData.diff, null, 2)}\n\`\`\``,
      {
        memory: {
          resource: 'merchant-default',
          thread: `growth-brief-${inputData.diff.weekOf}`,
        },
      },
    );
    return { ...inputData, brief: response.text };
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
    const safety = await safetyAudit(inputData.brief, JSON.stringify(inputData.diff));
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

    // Archive only green-lit briefs into long-term semantic memory
    if (inputData.greenLight) {
      await ensureCollections();
      const vector = await embedText(inputData.brief.slice(0, 8000));
      await qdrant.upsert({
        indexName: GROWTH_BRIEFS,
        vectors: [vector],
        metadata: [
          {
            weekOf: inputData.diff.weekOf,
            briefId,
            greenLight: true,
            summary: inputData.brief.slice(0, 2000),
          },
        ],
      });
    }

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
  inputSchema: z.object({
    competitors: z
      .array(z.string())
      .default([])
      .describe('Competitor Shopify store domains. Empty → COMPETITOR_STORES env var.'),
  }),
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
