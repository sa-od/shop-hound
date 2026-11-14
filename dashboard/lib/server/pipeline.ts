import { type CompetitorSnapshot, type CompetitorDiff, type StructuredDiff, type GuardrailVerdict } from './types';
import { scrapeCatalog, normalizeDomain, msUntil, StoreBlockedError, ManualReadNeededError } from './scraper';
import { embedProducts, productToEmbeddingText } from './embeddings';
import { saveSnapshot, getPreviousSnapshot, getLatestSnapshotInfo, isFullCatalog, loadReusableVectors, embeddingTextKey } from './snapshot-store';
import { summarizeCatalog } from './catalog';
import { diffSnapshots, verifyDiffAgainstPayload } from './diff-engine';
import { groundingCheck, safetyAudit, maskCompetitorDomains } from './enkrypt';
import { briefsForCompetitors, saveBrief } from './briefs-store';
import { generateGrowthBrief } from './agent';
import { detectPlatform } from './platform';
import { manualRead as manualReadInfo, type ManualRead } from './contact';

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
  /**
   * When every store was refused for now (429/403), stop before writing
   * anything and throw RunBlockedError, so the caller can retry later.
   * Off for the final attempt: then the brief records the stores as unverified.
   */
  retryBlocked?: boolean;
}

/** Every store refused us for now; nothing was saved. Retry after `retryAfterMs` (store's hint, if any). */
export class RunBlockedError extends Error {
  constructor(message: string, readonly retryAfterMs: number | null) {
    super(message);
  }
}

export interface RunResult {
  briefId: string;
  weekOf: string;
  greenLight: boolean;
  brief: string;
  vectorsUpserted: number;
  auditLog: { grounding: GuardrailVerdict; safety: GuardrailVerdict };
  /** Stores that were refused for now (429/403) rather than unreadable. */
  blocked: string[];
  /** Stores with no readable catalogue, waiting for a manual read (requested by email). */
  manualRead: string[];
  /** Their platform, message and ready-made email (first store's, for the queue line). */
  manualReadInfo: ManualRead | null;
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
// Embedding stops this long before the deadline, leaving the diff, grounding,
// the model and the audit their time. Products left unembedded only lose the
// optional "closest existing product" context.
const AFTER_EMBED_MS = 60_000;
const EMBED_CHUNK = 1_024;

/**
 * Vectors for a snapshot's products: reused from the store's last embedded
 * snapshot when a product's embedding text is unchanged, otherwise embedded
 * now — products new to the store first (their vectors are the ones a diff
 * looks up), and only while time allows; the rest stay null.
 */
async function vectorsFor(snapshot: CompetitorSnapshot, embedUntil: number | undefined): Promise<{ vectors: (number[] | null)[]; textKeys: string[]; reused: number; skipped: number }> {
  const texts = snapshot.products.map(productToEmbeddingText);
  const textKeys = texts.map(embeddingTextKey);
  const reusable = await loadReusableVectors(snapshot.competitor).catch(() => new Map<string, { textKey: string; vector: number[] }>());
  const vectors: (number[] | null)[] = snapshot.products.map((p, i) => {
    const r = reusable.get(p.productId);
    return r && r.textKey === textKeys[i] ? r.vector : null;
  });
  const reused = vectors.filter(Boolean).length;
  const todo = snapshot.products
    .map((p, i) => ({ i, isNew: !reusable.has(p.productId) }))
    .filter(({ i }) => !vectors[i])
    .sort((a, b) => Number(b.isNew) - Number(a.isNew))
    .map(({ i }) => i);
  let done = 0;
  while (done < todo.length && msUntil(embedUntil) > 0) {
    const chunk = todo.slice(done, done + EMBED_CHUNK);
    const embedded = await embedProducts(chunk.map(i => snapshot.products[i]));
    chunk.forEach((i, k) => (vectors[i] = embedded[k]));
    done += chunk.length;
  }
  return { vectors, textKeys, reused, skipped: todo.length - done };
}

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
  const blocked = new Map<string, number | null>(); // store → its Retry-After
  const manualRead = new Map<string, ManualRead>();
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
        const { products, source, complete } = await scrapeCatalog(competitor, scrapeDeadline, { fallbackOnBlock: !opts.retryBlocked });
        snapshots.push({ competitor, snapshotDate, products, source, ...(complete === false ? { complete: false } : {}) });
        log(`[scrape] ${competitor}: ${products.length} products via ${source}${complete === false ? ' — INCOMPLETE (time ran out), will not be compared' : ''}`);
      } catch (err) {
        unverified.push(competitor);
        unverifiedReasons[competitor] = String(err instanceof Error ? err.message : err).slice(0, 300);
        if (err instanceof StoreBlockedError) blocked.set(competitor, err.retryAfterMs);
        if (err instanceof ManualReadNeededError) {
          const info = manualReadInfo(competitor, await detectPlatform(competitor));
          manualRead.set(competitor, info);
          unverifiedReasons[competitor] = info.message;
          log(`[scrape] ${competitor}: manual read needed (platform: ${info.platformName})`);
        }
        log(`[scrape] ${competitor} failed → unverified: ${unverifiedReasons[competitor]}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(SCRAPE_CONCURRENCY, competitors.length) }, scrapeWorker));
  // Keep input order so the brief lists competitors the way they were asked for.
  snapshots.sort((a, b) => competitors.indexOf(a.competitor) - competitors.indexOf(b.competitor));
  unverified.sort((a, b) => competitors.indexOf(a) - competitors.indexOf(b));

  if (opts.retryBlocked && snapshots.length === 0 && competitors.every(c => blocked.has(c))) {
    const hints = [...blocked.values()].filter((v): v is number => v !== null);
    log(`[scrape] every store refused for now — run will be retried`);
    throw new RunBlockedError(unverifiedReasons[competitors[0]] ?? 'the store is limiting automated requests', hints.length ? Math.max(...hints) : null);
  }

  // ── 2. Embed → save snapshot (next week's diff baseline) + product vectors ──
  // Previous snapshots are read BEFORE today's is written, so a re-run on the
  // same day still diffs against last week, never against itself.
  let vectorsUpserted = 0;
  const embedUntil = deadlineAt === undefined ? undefined : deadlineAt - AFTER_EMBED_MS;
  const vectorsByCompetitor = new Map<string, Map<string, number[]>>();
  const previousByCompetitor = new Map<string, CompetitorSnapshot | null>();
  for (const snapshot of snapshots) {
    // A partial read (AI-read, or time ran out) is never diffed: baseline only.
    previousByCompetitor.set(
      snapshot.competitor,
      isFullCatalog(snapshot.source, snapshot.complete) ? await getPreviousSnapshot(snapshot.competitor, snapshot.snapshotDate) : null,
    );
    const { vectors, textKeys, reused, skipped } = await vectorsFor(snapshot, embedUntil);
    await saveSnapshot(snapshot, vectors, textKeys);
    vectorsByCompetitor.set(
      snapshot.competitor,
      new Map(snapshot.products.flatMap((p, i): [string, number[]][] => (vectors[i] ? [[p.productId, vectors[i]!]] : []))),
    );
    const saved = vectors.filter(Boolean).length;
    vectorsUpserted += saved;
    log(`[embed] ${snapshot.competitor}: ${saved} vectors (${reused} reused${skipped ? `, ${skipped} skipped — out of time` : ''})`);
  }

  // ── 3. Deterministic diff ──
  const diffs: CompetitorDiff[] = [];
  const groundingErrors: string[] = [];
  for (const snapshot of snapshots) {
    const previous = previousByCompetitor.get(snapshot.competitor) ?? null;
    const diff = await diffSnapshots(snapshot, previous, vectorsByCompetitor.get(snapshot.competitor) ?? new Map());
    groundingErrors.push(...verifyDiffAgainstPayload(diff, snapshot, previous));
    diffs.push({ ...diff, source: snapshot.source ?? 'shopify', ...(snapshot.complete === false ? { complete: false } : {}), catalog: summarizeCatalog(snapshot.products, { stockAndVariantsKnown: snapshot.source !== 'firecrawl' }) });
  }
  for (const competitor of unverified) {
    // Today's failed read saved nothing, so the latest snapshot is an earlier check.
    const lastKnown = await getLatestSnapshotInfo(competitor).catch(() => null);
    diffs.push({
      ...(lastKnown ? { lastKnown } : {}),
      ...(manualRead.has(competitor) ? { needsManualRead: true, manualRead: manualRead.get(competitor) } : {}),
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
    const manual = diffs.filter(d => manualRead.has(d.competitor));
    brief = [
      // "## Summary" is where the brief page takes its headline text from.
      '## Summary',
      '',
      manual.length === diffs.length
        ? manual.map(d => unverifiedReasons[d.competitor]).join('\n\n')
        : `Nothing to report this time. We couldn't read ${stores} on this check, so this brief makes no claims about ${diffs.length > 1 ? 'them' : 'it'}.`,
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
      ...(c.complete === false ? { complete: false } : {}),
      productCount: c.productCount,
      newSkus: c.newSkus.length,
      priceChanges: c.priceChanges.length,
      titleChanges: c.titleChanges.length,
      ...(unverifiedReasons[c.competitor] ? { reason: unverifiedReasons[c.competitor] } : {}),
      ...(c.lastKnown ? { lastKnown: c.lastKnown } : {}),
      ...(c.needsManualRead ? { needsManualRead: true, manualRead: c.manualRead } : {}),
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

  return { briefId, weekOf: diff.weekOf, greenLight, brief, vectorsUpserted, auditLog: { grounding, safety }, blocked: [...blocked.keys()], manualRead: [...manualRead.keys()], manualReadInfo: [...manualRead.values()][0] ?? null };
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
  const isPartial = (d: CompetitorDiff) => d.source === 'firecrawl' || d.complete === false;
  const baseline = byStatus('first_snapshot').filter(d => !isPartial(d)).map(d => d.competitor);
  const partial = byStatus('first_snapshot')
    .filter(isPartial)
    .map(d => (d.complete === false ? `${d.competitor} — time ran out after ${d.productCount} products` : d.competitor));
  const unverified = byStatus('unverified').map(d => {
    // The summary above already carries the full manual-read message.
    if (d.needsManualRead) return `${d.competitor} — no readable product catalogue (manual read available on request)`;
    const reason = diff.unverifiedReasons?.[d.competitor];
    return reason ? `${d.competitor} — ${reason}` : d.competitor;
  });
  return [
    '## Data Confidence',
    line('Verified (week-over-week diff)', verified),
    line('Baseline only (first snapshot this week)', baseline),
    ...(partial.length > 0 ? [line('Partial read (not compared week over week)', partial)] : []),
    line('Unverified this week (no claims made)', unverified),
  ].join('\n');
}
