import 'server-only';
import { after } from 'next/server';
import { getDeadline } from '@vercel/functions';
import { runAnalysis } from './pipeline';
import { claimNextRun, enqueueRun, finishRun, getActiveRun, getQueue, type RunRecord, type RunTrigger } from './runs';

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

/** Absolute deadline for work started by the current request. */
function requestDeadline(requestStartedAt: number): number {
  // On Vercel the platform reports the real deadline; locally there is none,
  // so mirror the limit from the moment this request started.
  const platform = getDeadline()?.getTime() ?? requestStartedAt + FUNCTION_LIMIT_S * 1000;
  return platform - OUTCOME_MARGIN_MS;
}

/** Execute one claimed run to completion, recording success or failure. Never throws. */
async function executeRun(run: RunRecord, deadlineAt: number): Promise<void> {
  try {
    const result = await runAnalysis({
      competitors: run.competitors,
      deadlineAt,
      log: m => console.log(`[${run.runId}] ${m}`),
    });
    await finishRun(run.runId, { status: 'success', briefId: result.briefId });
  } catch (err) {
    const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
    console.error(`[${run.runId}] failed:`, message);
    await finishRun(run.runId, { status: 'failed', error: message }).catch(e =>
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
        continue;
      }
      // Nothing claimed: either the queue is empty, or another run is going.
      if (!wait || (await getQueue()).every(r => r.status !== 'queued')) return;
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
export async function queueRun(competitors: string[], trigger: RunTrigger): Promise<{ run: RunRecord; position: number; existing: boolean }> {
  const { run, existing } = await enqueueRun({ competitors, trigger });
  drainInBackground({ wait: true });
  const queue = await getQueue();
  const index = queue.findIndex(r => r.runId === run.runId);
  return { run, existing, position: index === -1 ? 1 : index + 1 };
}

/** Is anything waiting while nothing runs? (cheap check for /api/status) */
export async function queueIsStalled(): Promise<boolean> {
  const queue = await getQueue();
  return queue.length > 0 && queue.every(r => r.status === 'queued') && !(await getActiveRun());
}
