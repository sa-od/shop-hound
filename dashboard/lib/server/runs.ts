import { MongoServerError } from 'mongodb';
import { db, RUNS, QUEUE_STATE } from './db';
import { competitorKeyOf } from './tracking';

/**
 * Pipeline runs, and the queue in front of them.
 *
 * Fluid Compute shares instances and scales to zero, so neither "is a run in
 * progress" nor "what is waiting" can live in process memory. Two unique
 * partial indexes (see db-setup) make the database enforce the rules:
 *   - one_active_run:        at most one run with status 'running'
 *   - one_active_per_store:  a store is queued or running at most once
 *
 * Lifecycle: queued → running → success | failed. A queued run is claimed
 * atomically (oldest first) by whichever request is draining the queue.
 * A run whose store refused us for now (429/403) goes running → retrying,
 * and is claimable again once its retryAt passes (see start-run.ts).
 */

export type RunStatus = 'queued' | 'running' | 'retrying' | 'success' | 'failed';
export type RunTrigger = 'dashboard' | 'cron' | 'cli';

export interface RunRecord {
  runId: string;
  trigger: RunTrigger;
  competitors: string[];
  /** The store set, canonicalised — matches the brief's key; drives tracking. */
  competitorKey: string;
  status: RunStatus;
  queuedAt: string;
  /** When it started running (null while queued). */
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  briefId: string | null;
  /** Attempts started so far (1 on the first run). */
  attempt: number;
  /** status 'retrying': when the next attempt may start, and why. */
  retryAt: string | null;
  retryReason: string | null;
  /** Finished, but its store refused us on the final attempt (not unreadable). */
  blocked: boolean;
  /** Finished, but the store has no readable catalogue: a manual read can be requested by email. */
  manualRead: boolean;
  /** Its platform, message and ready-made email. */
  manualReadInfo: import('./contact').ManualRead | null;
  /** While running: the step in progress, when it began, live detail, and whether it is a first (baseline) check. */
  step: RunStep | null;
  stepStartedAt: string | null;
  stepDetail: string | null;
  baseline: boolean | null;
  /** Failed runs: the step it failed in. */
  failedStep: RunStep | null;
  /** Whose fault a failed or store-limited run was (null: succeeded cleanly). See failure.ts. */
  failureKind: import('./failure').FailureKind | null;
  /** Our-side failures in a row for this run (each put it back without using a store attempt). */
  ourFailures: number;
}

import type { RunStep } from '../api';
export type { RunStep };

interface RunDoc {
  _id: string;
  trigger: RunTrigger;
  competitors: string[];
  competitorKey: string;
  status: RunStatus;
  queuedAt?: Date; // absent on runs from before the queue
  startedAt: Date | null;
  finishedAt: Date | null;
  error: string | null;
  briefId: string | null;
  /** Set while queued, running or retrying; the per-store uniqueness index keys on it. */
  active?: true;
  attempt?: number;
  retryAt?: Date | null;
  retryReason?: string | null;
  /** The store's own Retry-After: a user's re-add never starts the retry before this. */
  notBefore?: Date | null;
  blocked?: boolean;
  manualRead?: boolean;
  manualReadInfo?: import('./contact').ManualRead | null;
  step?: RunStep;
  stepStartedAt?: Date;
  stepDetail?: string;
  baseline?: boolean;
  failedStep?: RunStep | null;
  failureKind?: import('./failure').FailureKind | null;
  ourFailures?: number;
}

/**
 * A run still `running` this long after it started was killed by the
 * platform (Hobby functions stop at 300s) — it is swept to `failed`.
 */
export const STALE_RUN_MS = 6 * 60 * 1000;

/**
 * A run still `queued` this long was never picked up (nobody kept the queue
 * moving and no daily check came by) — it is swept to `failed`, so the UI
 * never shows it waiting forever. The daily cron drains the queue, so in
 * practice only a long outage gets here.
 */
export const STALE_QUEUED_MS = 26 * 60 * 60 * 1000;

/** At most this many runs waiting; beyond it adds get 429. */
export const MAX_QUEUED = 10;

export class RunAlreadyActiveError extends Error {
  constructor() {
    super('A run is already in progress');
  }
}

export class QueueFullError extends Error {
  constructor() {
    super(`The queue is full (${MAX_QUEUED} waiting)`);
  }
}

const runs = () => db().collection<RunDoc>(RUNS);

function toRecord(d: RunDoc): RunRecord {
  return {
    runId: d._id,
    trigger: d.trigger,
    competitors: d.competitors,
    competitorKey: d.competitorKey ?? competitorKeyOf(d.competitors),
    status: d.status,
    queuedAt: (d.queuedAt ?? d.startedAt ?? new Date(0)).toISOString(),
    startedAt: d.startedAt?.toISOString() ?? null,
    finishedAt: d.finishedAt?.toISOString() ?? null,
    error: d.error,
    briefId: d.briefId,
    attempt: d.attempt ?? 1,
    retryAt: d.retryAt?.toISOString() ?? null,
    retryReason: d.retryReason ?? null,
    blocked: d.blocked ?? false,
    manualRead: d.manualRead ?? false,
    manualReadInfo: d.manualReadInfo ?? null,
    step: d.step ?? null,
    stepStartedAt: d.stepStartedAt?.toISOString() ?? null,
    stepDetail: d.stepDetail ?? null,
    baseline: d.baseline ?? null,
    failedStep: d.failedStep ?? null,
    failureKind: d.failureKind ?? null,
    ourFailures: d.ourFailures ?? 0,
  };
}

const isDuplicateKey = (err: unknown): err is MongoServerError => err instanceof MongoServerError && err.code === 11000;

/** Fail runs that outlived the function limit or were never picked up. */
async function sweepStale(): Promise<void> {
  const now = Date.now();
  await Promise.all([
    runs().updateMany(
      { status: 'running', startedAt: { $lt: new Date(now - STALE_RUN_MS) } },
      { $set: { status: 'failed', finishedAt: new Date(), error: 'run did not finish within the function time limit', failureKind: 'ours' }, $unset: { active: '' } },
    ),
    runs().updateMany(
      { status: 'queued', queuedAt: { $lt: new Date(now - STALE_QUEUED_MS) } },
      { $set: { status: 'failed', finishedAt: new Date(), error: 'was never started — add the store again', failureKind: 'ours' }, $unset: { active: '' } },
    ),
    runs().updateMany(
      { status: 'retrying', retryAt: { $lt: new Date(now - STALE_QUEUED_MS) } },
      { $set: { status: 'failed', finishedAt: new Date(), error: 'the retry was never started — add the store again', failureKind: 'ours' }, $unset: { active: '' } },
    ),
  ]);
}

/**
 * Put a store set at the back of the queue. If the same set is already queued
 * or running, that run is returned instead (`existing: true`).
 *
 * A user re-adding a store that is waiting to RETRY brings the retry forward
 * to now (`expedited: true`) — but never before the store's own Retry-After,
 * which is honoured. The forced try counts as one of the run's attempts.
 *
 * Throws QueueFullError when MAX_QUEUED runs are already waiting.
 */
export async function enqueueRun(args: { competitors: string[]; trigger: RunTrigger }): Promise<{ run: RunRecord; existing: boolean; expedited?: boolean }> {
  await sweepStale();
  const competitorKey = competitorKeyOf(args.competitors);
  const findExisting = () => runs().findOne({ competitorKey, active: true });

  const existing = await findExisting();
  if (existing?.status === 'retrying' && args.trigger === 'dashboard' && existing.retryAt) {
    const now = new Date();
    const earliest = existing.notBefore && existing.notBefore > now ? existing.notBefore : now;
    if (earliest < existing.retryAt) {
      const moved = await runs().findOneAndUpdate(
        { _id: existing._id, status: 'retrying' }, // still waiting (not claimed meanwhile)
        { $set: { retryAt: earliest } },
        { returnDocument: 'after' },
      );
      if (moved) return { run: toRecord(moved), existing: true, expedited: true };
    }
  }
  if (existing) return { run: toRecord(existing), existing: true };
  if ((await runs().countDocuments({ status: 'queued' })) >= MAX_QUEUED) throw new QueueFullError();

  const doc: RunDoc = {
    _id: `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    trigger: args.trigger,
    competitors: args.competitors,
    competitorKey,
    status: 'queued',
    queuedAt: new Date(),
    startedAt: null,
    finishedAt: null,
    error: null,
    briefId: null,
    active: true,
    attempt: 0,
  };
  try {
    await runs().insertOne(doc);
    return { run: toRecord(doc), existing: false };
  } catch (err) {
    if (!isDuplicateKey(err)) throw err;
    // The same store was added at the same moment by another request.
    const other = await findExisting();
    if (other) return { run: toRecord(other), existing: true };
    throw err;
  }
}

/**
 * Start a run immediately, skipping the queue (terminal use). Throws
 * RunAlreadyActiveError if a run is in progress or this store is queued.
 */
export async function startRunNow(args: { competitors: string[]; trigger: RunTrigger }): Promise<RunRecord> {
  await sweepStale();
  const now = new Date();
  const doc: RunDoc = {
    _id: `run-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
    trigger: args.trigger,
    competitors: args.competitors,
    competitorKey: competitorKeyOf(args.competitors),
    status: 'running',
    queuedAt: now,
    startedAt: now,
    finishedAt: null,
    error: null,
    briefId: null,
    active: true,
  };
  try {
    await runs().insertOne(doc);
  } catch (err) {
    if (isDuplicateKey(err)) throw new RunAlreadyActiveError();
    throw err;
  }
  return toRecord(doc);
}

/** Queued runs, and retries whose time has come. */
const CLAIMABLE = () => ({ $or: [{ status: 'queued' as const }, { status: 'retrying' as const, retryAt: { $lte: new Date() } }] });

/** Is there a run a drainer could start right now? (Not while the queue is paused.) */
export async function hasClaimableRun(): Promise<boolean> {
  if (await getQueuePause()) return false;
  return (await runs().countDocuments(CLAIMABLE(), { limit: 1 })) > 0;
}

const PROGRESS_FIELDS = { step: '', stepStartedAt: '', stepDetail: '', baseline: '' } as const;

/** Record a running run's progress. `newStep`: the step changed, so restart its clock. */
export async function reportProgress(runId: string, p: { step: RunStep; detail?: string; baseline?: boolean }, newStep: boolean): Promise<void> {
  await runs().updateOne(
    { _id: runId, status: 'running' },
    {
      $set: {
        step: p.step,
        ...(newStep ? { stepStartedAt: new Date() } : {}),
        ...(p.detail !== undefined ? { stepDetail: p.detail.slice(0, 120) } : {}),
        ...(p.baseline !== undefined ? { baseline: p.baseline } : {}),
      },
      // A new step without detail must not keep showing the previous step's text.
      ...(newStep && p.detail === undefined ? { $unset: { stepDetail: '' } } : {}),
    },
  );
}

/**
 * Put a running run back in line, to be tried again at `retryAt`.
 * `notBefore`: the store's own Retry-After, if it sent one.
 */
export async function scheduleRetry(runId: string, retryAt: Date, reason: string, notBefore: Date | null = null): Promise<void> {
  await runs().updateOne(
    { _id: runId, status: 'running' },
    { $set: { status: 'retrying', retryAt, retryReason: reason.slice(0, 300), notBefore, startedAt: null, failureKind: 'store', ourFailures: 0 }, $unset: PROGRESS_FIELDS },
  );
}

/**
 * Put a running run back after a failure on OUR side (see failure.ts): it is
 * retried at `retryAt` and the attempt it just used is given back, so it
 * never counts against the store. The whole queue pauses until then too —
 * whatever broke would break the next store's run the same way.
 */
export async function deferForOurFailure(runId: string, retryAt: Date, reason: string): Promise<void> {
  await Promise.all([
    runs().updateOne(
      { _id: runId, status: 'running' },
      {
        $set: { status: 'retrying', retryAt, retryReason: reason.slice(0, 300), startedAt: null, failureKind: 'ours' },
        $inc: { attempt: -1, ourFailures: 1 },
        $unset: PROGRESS_FIELDS,
      },
    ),
    pauseQueue(retryAt, reason),
  ]);
}

interface QueueStateDoc { _id: 'queue'; pausedUntil: Date; reason: string }
const queueState = () => db().collection<QueueStateDoc>(QUEUE_STATE);

/** Hold every claim until `until` (after an our-side failure). */
export async function pauseQueue(until: Date, reason: string): Promise<void> {
  await queueState().updateOne({ _id: 'queue' }, { $set: { pausedUntil: until, reason: reason.slice(0, 300) } }, { upsert: true });
}

/** The queue's current pause, if one is in force. */
export async function getQueuePause(): Promise<{ until: string; reason: string } | null> {
  const d = await queueState().findOne({ _id: 'queue' });
  return d && d.pausedUntil > new Date() ? { until: d.pausedUntil.toISOString(), reason: d.reason } : null;
}

/**
 * Atomically take the oldest queued run and mark it running. Returns null
 * when the queue is empty, or when another run holds the lock (the claim is
 * rejected by one_active_run and the run stays queued).
 */
export async function claimNextRun(): Promise<RunRecord | null> {
  await sweepStale();
  if (await getQueuePause()) return null; // paused after a failure on our side
  try {
    const doc = await runs().findOneAndUpdate(
      CLAIMABLE(),
      { $set: { status: 'running', startedAt: new Date() }, $inc: { attempt: 1 } },
      { sort: { queuedAt: 1 }, returnDocument: 'after' },
    );
    return doc ? toRecord(doc) : null;
  } catch (err) {
    if (isDuplicateKey(err)) return null; // another run is in progress
    throw err;
  }
}

export async function finishRun(
  runId: string,
  outcome:
    | { status: 'success'; briefId: string; blocked?: boolean; manualRead?: boolean; manualReadInfo?: import('./contact').ManualRead | null }
    | { status: 'failed'; error: string; failedStep?: RunStep | null; failureKind: import('./failure').FailureKind },
): Promise<void> {
  await runs().updateOne(
    { _id: runId },
    {
      $set: {
        status: outcome.status,
        finishedAt: new Date(),
        error: outcome.status === 'failed' ? outcome.error.slice(0, 2000) : null,
        briefId: outcome.status === 'success' ? outcome.briefId : null,
        blocked: outcome.status === 'success' && outcome.blocked === true,
        manualRead: outcome.status === 'success' && outcome.manualRead === true,
        manualReadInfo: outcome.status === 'success' ? (outcome.manualReadInfo ?? null) : null,
        failedStep: outcome.status === 'failed' ? (outcome.failedStep ?? null) : null,
        // A finished run whose store refused us or can't be read is the store's doing.
        failureKind:
          outcome.status === 'failed' ? outcome.failureKind : outcome.blocked || outcome.manualRead ? 'store' : null,
        retryAt: null,
      },
      $unset: { active: '', ...PROGRESS_FIELDS },
    },
  );
}

/** The run in progress, if any. */
export async function getActiveRun(): Promise<RunRecord | null> {
  await sweepStale();
  const doc = await runs().findOne({ status: 'running' });
  return doc ? toRecord(doc) : null;
}

const QUEUE_ORDER: Record<string, number> = { running: 0, queued: 1, retrying: 2 };

/** Running, then queued (oldest first), then retrying (soonest first). */
export async function getQueue(): Promise<RunRecord[]> {
  const docs = await runs().find({ status: { $in: ['running', 'queued', 'retrying'] } }).toArray();
  return docs.map(toRecord).sort((a, b) => {
    if (a.status !== b.status) return QUEUE_ORDER[a.status] - QUEUE_ORDER[b.status];
    return a.status === 'retrying' ? (a.retryAt ?? '').localeCompare(b.retryAt ?? '') : a.queuedAt.localeCompare(b.queuedAt);
  });
}

/** The most recently finished run — lets the UI show a failure instead of silence. */
export async function getLastFinishedRun(): Promise<RunRecord | null> {
  const doc = await runs()
    .find({ status: { $in: ['success', 'failed'] } })
    .sort({ finishedAt: -1 })
    .limit(1)
    .next();
  return doc ? toRecord(doc) : null;
}
