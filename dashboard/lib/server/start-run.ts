import 'server-only';
import { after } from 'next/server';
import { getDeadline } from '@vercel/functions';
import { runAnalysis, RunBlockedError } from './pipeline';
import { hasRetriesLeft, retryDelayMs } from './retry-policy';
import { claimNextRun, enqueueRun, finishRun, getActiveRun, getQueue, hasClaimableRun, reportProgress, scheduleRetry, type RunRecord, type RunStep, type RunTrigger } from './runs';
import type { RunProgress } from './pipeline';

// Detail-only progress (e.g. "500 products so far") is written at most this
// often; step changes are written at once.
const DETAIL_WRITE_MS = 1_000;

/**
 * Progress reporter for one run: writes to its run document (status reads
 * from the database), in order, never throwing. Remembers the current step
 * so a failure can say where it happened.
 */
function progressReporter(runId: string) {
  let step: RunStep | null = null;
  let lastWrite = 0;
  let chain = Promise.resolve();
  const report = (p: RunProgress) => {
    const newStep = p.step !== step;
    if (!newStep && p.baseline === undefined && Date.now() - lastWrite < DETAIL_WRITE_MS) return;
    step = p.step;
    lastWrite = Date.now();
    chain = chain.then(() => reportProgress(runId, p, newStep)).catch(err => console.warn(`[${runId}] progress write failed:`, String(err).slice(0, 120)));
  };
  return { report, current: () => step, flushed: () => chain };
}

/**
 * Hobby's function limit — both the default and the maximum. Route files that
 * drain the queue export `maxDuration = 300` (it must be a literal there).
 */
export const FUNCTION_LIMIT_S = 300;

// Held back from the platform deadline so a run can always record its outcome
// (success or failure) before the function is stopped.
const OUTCOME_MARGIN_MS = 10_000;

// A run needs at least this long to be worth starting: a store takes 5–60s,
// and the pipeline itself reserves 90s after scraping.
const MIN_RUN_MS = 120_000;

// While another request's run holds the lock, check back this often.
const WAIT_POLL_MS = 4_000;

export { MAX_ATTEMPTS } from './retry-policy';

// Gap between consecutive runs, so stores aren't read back to back.
const RUN_GAP_MS = 3_000;

/** Absolute deadline for work started by the current request. */
function requestDeadline(requestStartedAt: number): number {
  // On Vercel the platform reports the real deadline; locally there is none,
  // so mirror the limit from the moment this request started.
  const platform = getDeadline()?.getTime() ?? requestStartedAt + FUNCTION_LIMIT_S * 1000;
  return platform - OUTCOME_MARGIN_MS;
}

/** Execute one claimed run to completion, recording success or failure. Never throws. */
async function executeRun(run: RunRecord, deadlineAt: number): Promise<void> {
  const retriesLeft = hasRetriesLeft(run.attempt);
  const progress = progressReporter(run.runId);
  try {
    const result = await runAnalysis({
      competitors: run.competitors,
      deadlineAt,
      retryBlocked: retriesLeft,
      onProgress: progress.report,
      // dashboard = added or run again by a user; cron = the weekly re-check.
      ...(run.trigger === 'dashboard' ? { trigger: 'added' as const } : run.trigger === 'cron' ? { trigger: 'weekly' as const } : {}),
      log: m => console.log(`[${run.runId}] ${m}`),
    });
    await progress.flushed(); // so a late progress write can't land after the outcome
    await finishRun(run.runId, {
      status: 'success',
      briefId: result.briefId,
      blocked: result.blocked.length > 0,
      manualRead: result.manualRead.length > 0,
      manualReadInfo: result.manualReadInfo,
    });
  } catch (err) {
    await progress.flushed();
    if (err instanceof RunBlockedError && retriesLeft) {
      const retryAt = new Date(Date.now() + retryDelayMs(run.attempt, err.retryAfterMs)!);
      console.log(`[${run.runId}] blocked (${err.message}) — attempt ${run.attempt}, retrying at ${retryAt.toISOString()}`);
      const notBefore = err.retryAfterMs ? new Date(Date.now() + err.retryAfterMs) : null;
      await scheduleRetry(run.runId, retryAt, err.message, notBefore).catch(e => console.error(`[${run.runId}] could not schedule retry:`, e));
      return;
    }
    const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
    console.error(`[${run.runId}] failed:`, message);
    await finishRun(run.runId, { status: 'failed', error: message, failedStep: progress.current() }).catch(e =>
      console.error(`[${run.runId}] could not record failure:`, e),
    );
  }
}

/**
 * Work through the queue, one run at a time, until it is empty or this
 * request's time runs short. Never throws.
 *
 * `wait`: when another request's run holds the lock, keep checking back
 * (until our time runs short) so the queue keeps moving even if nobody is
 * watching. Without it, give up at once — for cheap, frequent callers.
 */
async function drainQueue(deadlineAt: number, wait: boolean): Promise<void> {
  try {
    for (;;) {
      if (deadlineAt - Date.now() < MIN_RUN_MS) return; // leftovers: next request or the daily cron
      const run = await claimNextRun();
      if (run) {
        await executeRun(run, deadlineAt);
        await new Promise(r => setTimeout(r, RUN_GAP_MS));
        continue;
      }
      // Nothing claimed: nothing startable (empty, or only future retries),
      // or another run is going.
      if (!wait || !(await hasClaimableRun())) return;
      await new Promise(r => setTimeout(r, WAIT_POLL_MS));
    }
  } catch (err) {
    console.error('[queue] drain stopped:', err);
  }
}

/** Keep the queue moving in the background of the current request. */
export function drainInBackground(opts: { wait: boolean }): void {
  const deadlineAt = requestDeadline(Date.now());
  after(() => drainQueue(deadlineAt, opts.wait));
}

/**
 * Add a store set to the queue and keep the queue moving in the background
 * of this request (it runs at once if nothing is ahead of it). Returns the
 * run and its 1-based position (1 = running now / next).
 *
 * Throws QueueFullError when the queue is full.
 */
export async function queueRun(competitors: string[], trigger: RunTrigger): Promise<{ run: RunRecord; position: number; existing: boolean; expedited: boolean }> {
  const { run, existing, expedited = false } = await enqueueRun({ competitors, trigger });
  drainInBackground({ wait: true });
  const queue = await getQueue();
  const index = queue.findIndex(r => r.runId === run.runId);
  return { run, existing, expedited, position: index === -1 ? 1 : index + 1 };
}

/** Is something startable waiting while nothing runs? (cheap check for /api/status) */
export async function queueIsStalled(): Promise<boolean> {
  return (await hasClaimableRun()) && !(await getActiveRun());
}
