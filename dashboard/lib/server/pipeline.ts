import { type CompetitorSnapshot, type CompetitorDiff, type StructuredDiff, type GuardrailVerdict } from './types';
import { scrapeCatalog, normalizeDomain, msUntil } from './scraper';
import { embedProducts } from './embeddings';
import { saveSnapshot, getPreviousSnapshot } from './snapshot-store';
import { diffSnapshots, verifyDiffAgainstPayload } from './diff-engine';
import { groundingCheck, safetyAudit, maskCompetitorDomains } from './enkrypt';
import { briefsForCompetitors, saveBrief } from './briefs-store';
import { generateGrowthBrief } from './agent';

/**
 * Competitive Intelligence pipeline — the linear high-integrity run:
 * scrape → embed+snapshot (MongoDB) → deterministic diff → Enkrypt grounding →
 * reasoning agent → Enkrypt safety audit → archive.
 *
 * Plain functions, one after another. Runs inside a single Vercel function
 * invocation (300s on Hobby), so it takes a `deadlineAt` and degrades
 * honestly: a competitor that cannot be scraped inside the budget is marked
 * unverified — never guessed at — and the rest of the run still completes.
 */

export interface RunOptions {
  competitors: string[];
  /** Absolute epoch ms by which the whole run must finish. Omit for no limit (local runs). */
  deadlineAt?: number;
  log?: (message: string) => void;
}

export interface RunResult {
  briefId: string;
  weekOf: string;
  greenLight: boolean;
  brief: string;
  vectorsUpserted: number;
  auditLog: { grounding: GuardrailVerdict; safety: GuardrailVerdict };
}

const DEFAULT_COMPETITORS = (process.env.COMPETITOR_STORES ?? '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

// Time held back from scraping for everything after it: embed → diff →
// grounding → agent → safety audit → archive. Measured runs put that work at
// 30–60s for ~800 products; 90s leaves margin for a slow model call.
const RESERVE_MS = 90_000;
// Don't start a store with less than this left over the reserve.
const MIN_SCRAPE_MS = 20_000;
const SCRAPE_CONCURRENCY = 3;

export async function runAnalysis(opts: RunOptions): Promise<RunResult> {
  const log = opts.log ?? ((m: string) => console.log(m));
  const { deadlineAt } = opts;
  const snapshotDate = new Date().toISOString().slice(0, 10);

  const competitors = [...new Set((opts.competitors.length > 0 ? opts.competitors : DEFAULT_COMPETITORS).map(normalizeDomain))].filter(Boolean);
  if (competitors.length === 0) {
    throw new Error('No competitors configured. Pass `competitors` or set COMPETITOR_STORES');
  }

  // ── 1. Ingestion — every competitor; failures become "unverified" ──
  const snapshots: CompetitorSnapshot[] = [];
  const unverified: string[] = [];
  const unverifiedReasons: Record<string, string> = {};
  const scrapeDeadline = deadlineAt === undefined ? undefined : deadlineAt - RESERVE_MS;

  let next = 0;
  const scrapeWorker = async () => {
    for (;;) {
      const i = next++;
      if (i >= competitors.length) return;
      const competitor = competitors[i];
      if (msUntil(scrapeDeadline) < MIN_SCRAPE_MS) {
        unverified.push(competitor);
        unverifiedReasons[competitor] = 'time budget exhausted before this store could be scraped';
        log(`[scrape] ${competitor} skipped — time budget exhausted`);
        continue;
      }
      try {
        const { products, source } = await scrapeCatalog(competitor, scrapeDeadline);
        snapshots.push({ competitor, snapshotDate, products, source });
        log(`[scrape] ${competitor}: ${products.length} products via ${source}`);
      } catch (err) {
        unverified.push(competitor);
        unverifiedReasons[competitor] = String(err instanceof Error ? err.message : err).slice(0, 300);
        log(`[scrape] ${competitor} failed → unverified: ${unverifiedReasons[competitor]}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(SCRAPE_CONCURRENCY, competitors.length) }, scrapeWorker));
  // Keep input order so the brief lists competitors the way they were asked for.
  snapshots.sort((a, b) => competitors.indexOf(a.competitor) - competitors.indexOf(b.competitor));
  unverified.sort((a, b) => competitors.indexOf(a) - competitors.indexOf(b));

  // ── 2. Embed → save snapshot (next week's diff baseline) + product vectors ──
  // Previous snapshots are read BEFORE today's is written, so a re-run on the
  // same day still diffs against last week, never against itself.
  let vectorsUpserted = 0;
  const vectorsByCompetitor = new Map<string, Map<string, number[]>>();
  const previousByCompetitor = new Map<string, CompetitorSnapshot | null>();
  for (const snapshot of snapshots) {
    previousByCompetitor.set(snapshot.competitor, await getPreviousSnapshot(snapshot.competitor, snapshot.snapshotDate));
    const vectors = await embedProducts(snapshot.products);
    await saveSnapshot(snapshot, vectors);
    vectorsByCompetitor.set(snapshot.competitor, new Map(snapshot.products.map((p, i) => [p.productId, vectors[i]])));
    vectorsUpserted += vectors.length;
  }
  log(`[embed] ${vectorsUpserted} product vectors saved`);

  // ── 3. Deterministic diff ──
  const diffs: CompetitorDiff[] = [];
  const groundingErrors: string[] = [];
  for (const snapshot of snapshots) {
    const previous = previousByCompetitor.get(snapshot.competitor) ?? null;
    const diff = await diffSnapshots(snapshot, previous, vectorsByCompetitor.get(snapshot.competitor) ?? new Map());
    groundingErrors.push(...verifyDiffAgainstPayload(diff, snapshot, previous));
    diffs.push({ ...diff, source: snapshot.source ?? 'shopify' });
  }
  for (const competitor of unverified) {
    diffs.push({
      competitor,
      status: 'unverified',
      previousSnapshotDate: null,
      currentSnapshotDate: snapshotDate,
      productCount: 0,
      newSkus: [],
      removedSkus: [],
      priceChanges: [],
      titleChanges: [],
    });
  }
  const diff: StructuredDiff = { weekOf: snapshotDate, diffs, unverified, unverifiedReasons };
  log(`[diff] ${diffs.length} competitors diffed (${unverified.length} unverified)`);

  // ── 4. Grounding guardrail (Enkrypt — input side) ──
  // Scan BOTH what the agent will see (the diff JSON) and the raw scraped
  // titles — injection can hide in any untrusted string. (Enkrypt caps at 30k
  // chars; the diff comes first so agent-bound content is always covered.)
  // Competitor domains are masked for the detector: its PII check tags bare
  // domains as emails (reproduced: "pipsnacks.com" → email, with no "@"
  // anywhere in the payload). A real address keeps its domain and is caught.
  const scrapedTitles = snapshots.flatMap(s => s.products.map(p => p.title));
  const diffJson = JSON.stringify(diff);
  const grounding = await groundingCheck(maskCompetitorDomains(`${diffJson}\n${scrapedTitles.join('\n')}`, diffJson));
  if (groundingErrors.length > 0) {
    grounding.greenLight = false;
    grounding.violations.push(...groundingErrors);
  }
  if (!grounding.greenLight && grounding.enkryptEnabled) {
    log(`[grounding] BLOCKED — agent will not run: ${grounding.violations.join('; ')}`);
  }

  // ── 5. Reasoning agent (only on green-lit input) ──
  let brief: string;
  let history = '[]';
  if (!grounding.greenLight) {
    // Hard guarantee: data that failed grounding NEVER reaches the agent. The
    // block itself becomes the (fully audited) deliverable.
    brief = [
      '# ⛔ Growth Brief Withheld — Guardrail Block',
      '',
      "This week's scraped competitor data **failed the Enkrypt AI grounding guardrail** and was",
      'quarantined before it could reach the reasoning agent. No AI generation occurred.',
      '',
      '**Violations detected:**',
      ...grounding.violations.map(v => `- ${v}`),
      '',
      '_This is the 0%-hallucination guarantee working: untrusted or malicious input is blocked,_',
      '_never summarized._',
    ].join('\n');
  } else if (diffs.every(d => d.status === 'unverified')) {
    // Nothing was read, so there is nothing to analyse. Don't ask the model:
    // it would write generic advice with no data behind it.
    const stores = diffs.map(d => d.competitor).join(', ');
    brief = [
      '# Nothing to report this time',
      '',
      `We couldn't read ${stores} on this check, so this brief makes no claims about ${diffs.length > 1 ? 'them' : 'it'}.`,
      '',
      dataConfidenceSection(diff),
    ].join('\n');
    log('[generate] skipped — no store could be read');
  } else {
    // Week-over-week trend context from the archive: prior briefs covering
    // any of this run's competitors, newest first. Failure here never blocks.
    const runCompetitors = new Set(diffs.map(d => d.competitor));
    let historyEntries: unknown[] = [];
    try {
      historyEntries = (await briefsForCompetitors([...runCompetitors], 4)).map(b => ({
          weekOf: b.weekOf,
          createdAt: b.createdAt,
          greenLight: b.greenLight,
          competitors: b.competitors.filter(c => runCompetitors.has(c.competitor)),
        }));
    } catch (err) {
      log(`[generate] history lookup failed, continuing without trends: ${err}`);
    }
    history = JSON.stringify(historyEntries);
    const trendBlock =
      historyEntries.length > 0
        ? `\n\nVERIFIED HISTORY (previous archived briefs for these competitors):\n\`\`\`json\n${history}\n\`\`\`\nInclude a "## Week-over-Week Trends" section comparing this week against the history above. Cite ONLY numbers present in the diff or the history.`
        : '';
    brief = await generateGrowthBrief(
      `Here is this week's VERIFIED structured competitor diff. Write the weekly Growth Brief.\n\n\`\`\`json\n${JSON.stringify(diff, null, 2)}\n\`\`\`${trendBlock}`,
      deadlineAt,
    );
    // Facts the code knows for certain are written by the code, not the model:
    // the model previously mislabelled stores' status here, and no audit
    // checks prose like "Unverified: x" against the diff.
    brief = `${stripModelDataConfidence(brief).trimEnd()}\n\n${dataConfidenceSection(diff)}`;
    log(`[generate] brief: ${brief.length} chars`);
  }

  // ── 6. Safety audit (Enkrypt — output side) ──
  let safety: GuardrailVerdict;
  if (!grounding.greenLight) {
    // Nothing was generated, so there is nothing to audit — record the skip
    // explicitly (the audit trail must never be blank).
    safety = {
      checkpoint: 'safety',
      greenLight: false,
      enkryptEnabled: true,
      violations: ['audit skipped — grounding guardrail blocked the input upstream, agent never ran'],
      detail: { skipped: true },
    };
  } else {
    // Audit context = diff + the verified history the agent was shown, so trend
    // numbers audit as grounded. `diffs` stays top-level for the numeric check.
    safety = await safetyAudit(brief, JSON.stringify({ ...diff, history: JSON.parse(history) }));
    if (!safety.greenLight && safety.enkryptEnabled) {
      log(`[safety] brief FAILED audit: ${safety.violations.join('; ')}`);
    }
  }
  const greenLight = grounding.greenLight && safety.greenLight;

  // ── 7. Archive EVERY brief (green or not) ──
  // Identified by (week, competitor set): a re-run of the same set this week
  // replaces its card in place.
  const briefId = await saveBrief({
    weekOf: diff.weekOf,
    competitorKey: diffs.map(c => c.competitor).sort().join(','),
    greenLight,
    briefMarkdown: brief,
    competitors: diffs.map(c => ({
      competitor: c.competitor,
      status: c.status,
      source: c.source ?? 'shopify',
      productCount: c.productCount,
      newSkus: c.newSkus.length,
      priceChanges: c.priceChanges.length,
      titleChanges: c.titleChanges.length,
      ...(unverifiedReasons[c.competitor] ? { reason: unverifiedReasons[c.competitor] } : {}),
    })),
    grounding: { greenLight: grounding.greenLight, violations: grounding.violations },
    safety: {
      greenLight: safety.greenLight,
      violations: safety.violations,
      warnings: safety.warnings ?? [],
      method: (safety.detail?.groundingMethod as string) ?? null,
    },
    diff,
  });
  log(`[archive] brief ${briefId} for ${diff.weekOf} (${greenLight ? 'GREEN' : 'not green'})`);

  return { briefId, weekOf: diff.weekOf, greenLight, brief, vectorsUpserted, auditLog: { grounding, safety } };
}

/** Remove a "Data Confidence" section if the model wrote one despite instructions. */
function stripModelDataConfidence(brief: string): string {
  return brief.replace(/\n#{1,6}\s*Data Confidence[\s\S]*?(?=\n#{1,2}\s|$)/i, '');
}

/** The Data Confidence section, derived from the diff alone. */
export function dataConfidenceSection(diff: StructuredDiff): string {
  const byStatus = (status: CompetitorDiff['status']) => diff.diffs.filter(d => d.status === status);
  const line = (label: string, items: string[]) => `- **${label}:** ${items.length > 0 ? items.join(', ') : 'none'}`;
  const verified = byStatus('verified').map(d => `${d.competitor} (vs ${d.previousSnapshotDate})`);
  const baseline = byStatus('first_snapshot').map(d => d.competitor);
  const unverified = byStatus('unverified').map(d => {
    const reason = diff.unverifiedReasons?.[d.competitor];
    return reason ? `${d.competitor} — ${reason}` : d.competitor;
  });
  return [
    '## Data Confidence',
    line('Verified (week-over-week diff)', verified),
    line('Baseline only (first snapshot this week)', baseline),
    line('Unverified this week (no claims made)', unverified),
  ].join('\n');
}
