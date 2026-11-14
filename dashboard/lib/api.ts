// Shared types + pure helpers. Imported by client components, so it must stay
// free of server code: the server modules below are imported as TYPES only,
// which are erased at compile time and never reach the browser bundle.
import type { BriefSummary, BriefDetail, CompetitorSummary, Verdict } from './server/briefs-store';

export type { BriefSummary, BriefDetail, CompetitorSummary, Verdict };

/** One store waiting for, or going through, analysis. Position 1 is running now. */
export interface QueueItem {
  runId: string;
  store: string;
  /** 'retrying': the store refused us for now (rate limit / block); tried again at retryAt. */
  status: 'queued' | 'running' | 'retrying';
  position: number;
  queuedAt: string;
  /** status 'retrying' only. */
  retryAt?: string;
  /** Why it is retrying, written for the user ("the store is limiting automated requests right now"). */
  reason?: string;
  /** Attempts made so far (1 after the first try). */
  attempt?: number;
}

export interface Status {
  running: boolean;
  activeRun: { runId: string; competitors: string[]; startedAt: string } | null;
  /** Stores queued or running, in order. Optional until every server sends it. */
  queue?: QueueItem[];
  /** The most recent finished run — `error` is set when it failed. */
  lastRun: {
    runId: string;
    store?: string;
    status: 'success' | 'failed';
    finishedAt: string | null;
    error: string | null;
    briefId: string | null;
  } | null;
  lastBrief: { id: string; weekOf: string; greenLight: boolean; createdAt: string; competitorCount: number } | null;
  totalBriefs: number;
}

// Totals across all competitors in a brief — used for the card stat row.
export function briefTotals(b: BriefSummary) {
  return b.competitors.reduce(
    (acc, c) => ({
      priceChanges: acc.priceChanges + c.priceChanges,
      newSkus: acc.newSkus + c.newSkus,
      titleChanges: acc.titleChanges + c.titleChanges,
      verified: acc.verified + (c.status === 'verified' || c.status === 'first_snapshot' ? 1 : 0),
    }),
    { priceChanges: 0, newSkus: 0, titleChanges: 0, verified: 0 },
  );
}
