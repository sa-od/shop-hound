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
  /** Total tries before the store is recorded as unverified (status 'retrying' only). */
  maxAttempts?: number;
  /** status 'running' only: the step in progress (see lib/run-steps.ts). */
  step?: RunStep;
  /** When that step began (ISO). */
  stepStartedAt?: string;
  /** Short live text for the step, written for the user ("312 products so far"). */
  detail?: string;
  /** No previous snapshot: a first check saves a baseline instead of comparing. */
  baseline?: boolean;
}

/** The steps of one analysis, in order. */
export type RunStep = 'reading' | 'comparing' | 'grounding' | 'writing' | 'safety';

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
    /** The step a failed run stopped at. */
    failedStep?: RunStep;
    briefId: string | null;
    /** The store has no readable catalogue: show the "request by email" option (see contactEmail). */
    needsManualRead?: boolean;
    /** Platform, message (show as-is) and ready-made email (use email.mailto). */
    manualRead?: {
      platform: string;
      platformName: string;
      message: string;
      /** mailto: default mail app · gmail: Gmail web compose, same email (absent on older data) */
      email: { to: string; subject: string; body: string; mailto: string; gmail?: string };
    };
  } | null;
  lastBrief: { id: string; weekOf: string; greenLight: boolean; createdAt: string; competitorCount: number } | null;
  totalBriefs: number;
  /** Where users request a manual read of a store we can't read automatically. */
  contactEmail?: string;
}

/** One readable run of a store (some store was verified or saved as a baseline). Newest first in lists. */
export interface RunSummary {
  id: string;
  createdAt: string;
  greenLight: boolean;
  status: 'verified' | 'first_snapshot';
  /** Why it ran: added from the dashboard, or the weekly re-check. Absent on older briefs. */
  trigger?: 'added' | 'weekly';
  productCount: number;
  /** false when the read was cut off by time ("at least N"). */
  complete?: boolean;
  priceChanges: number;
  newSkus: number;
  removed: number;
  titleChanges: number;
}

/** One store on the Briefs page: its latest brief, run count, size and tracking. */
export interface StoreSummary {
  /** The domain, or "a.com, b.com" for an older multi-store brief. */
  store: string;
  competitorKey: string;
  /** Latest brief of any kind: the store name links here. */
  latestBriefId: string;
  latestAt: string;
  /** Readable runs only; unreadable checks aren't counted. */
  runCount: number;
  /** Latest readable run's product count, and the change from the run before it. */
  productCount: number | null;
  productDelta: number | null;
  complete?: boolean;
  needsManualRead?: boolean;
  tracking: { tracked: boolean; trackedUntil: string | null; nextCheck: string | null; firstReadPending?: boolean };
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
