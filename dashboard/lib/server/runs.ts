import { MongoServerError } from 'mongodb';
import { db, RUNS } from './db';

/**
 * Pipeline run records. Fluid Compute shares instances and scales to zero, so
 * "is a run in progress" cannot live in process memory. A unique partial index
 * on `status: 'running'` (see db-setup) lets the database itself guarantee at
 * most one run at a time — two simultaneous starts cannot both succeed.
 */

export type RunStatus = 'running' | 'success' | 'failed';
export type RunTrigger = 'dashboard' | 'cron' | 'cli';

export interface RunRecord {
  runId: string;
  trigger: RunTrigger;
  competitors: string[];
  status: RunStatus;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
  briefId: string | null;
}

interface RunDoc {
  _id: string;
  trigger: RunTrigger;
  competitors: string[];
  status: RunStatus;
  startedAt: Date;
  finishedAt: Date | null;
  error: string | null;
  briefId: string | null;
}

/**
 * A run still `running` this long after it started was killed by the
 * platform (Hobby functions stop at 300s) — it is swept to `failed`.
 */
export const STALE_RUN_MS = 6 * 60 * 1000;

export class RunAlreadyActiveError extends Error {
  constructor() {
    super('A run is already in progress');
  }
}

const runs = () => db().collection<RunDoc>(RUNS);

function toRecord(d: RunDoc): RunRecord {
  return {
    runId: d._id,
    trigger: d.trigger,
    competitors: d.competitors,
    status: d.status,
    startedAt: d.startedAt.toISOString(),
    finishedAt: d.finishedAt?.toISOString() ?? null,
    error: d.error,
    briefId: d.briefId,
  };
}

/** Mark runs that outlived the function limit as failed, freeing the lock. */
async function sweepStale(): Promise<void> {
  await runs().updateMany(
    { status: 'running', startedAt: { $lt: new Date(Date.now() - STALE_RUN_MS) } },
    { $set: { status: 'failed', finishedAt: new Date(), error: 'run did not finish within the function time limit' } },
  );
}

/** Start a run, or throw RunAlreadyActiveError if one is in progress. */
export async function createRun(args: { competitors: string[]; trigger: RunTrigger }): Promise<RunRecord> {
  await sweepStale();
  const doc: RunDoc = {
    _id: `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    trigger: args.trigger,
    competitors: args.competitors,
    status: 'running',
    startedAt: new Date(),
    finishedAt: null,
    error: null,
    briefId: null,
  };
  try {
    await runs().insertOne(doc);
  } catch (err) {
    if (err instanceof MongoServerError && err.code === 11000) throw new RunAlreadyActiveError();
    throw err;
  }
  return toRecord(doc);
}

export async function finishRun(
  runId: string,
  outcome: { status: 'success'; briefId: string } | { status: 'failed'; error: string },
): Promise<void> {
  await runs().updateOne(
    { _id: runId },
    {
      $set: {
        status: outcome.status,
        finishedAt: new Date(),
        error: outcome.status === 'failed' ? outcome.error.slice(0, 2000) : null,
        briefId: outcome.status === 'success' ? outcome.briefId : null,
      },
    },
  );
}

/** The run in progress, if any. */
export async function getActiveRun(): Promise<RunRecord | null> {
  await sweepStale();
  const doc = await runs().findOne({ status: 'running' });
  return doc ? toRecord(doc) : null;
}

/** The most recent finished run — lets the UI show a failure instead of silence. */
export async function getLastFinishedRun(): Promise<RunRecord | null> {
  const doc = await runs()
    .find({ status: { $ne: 'running' } })
    .sort({ startedAt: -1 })
    .limit(1)
    .next();
  return doc ? toRecord(doc) : null;
}
