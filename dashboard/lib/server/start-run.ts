import 'server-only';
import { after } from 'next/server';
import { getDeadline } from '@vercel/functions';
import { runAnalysis } from './pipeline';
import { createRun, finishRun, getActiveRun, RunAlreadyActiveError, type RunRecord, type RunTrigger } from './runs';

/**
 * Hobby's function limit — both the default and the maximum. Route files that
 * start runs export `maxDuration = 300` (it must be a literal there).
 */
export const FUNCTION_LIMIT_S = 300;

// Held back from the platform deadline so a run can always record its outcome
// (success or failure) before the function is stopped.
const OUTCOME_MARGIN_MS = 10_000;

// A scheduled set needs at least this long to be worth starting: a real run
// takes 30–110s, and the pipeline itself reserves 90s after scraping.
const MIN_SET_MS = 120_000;

/** Absolute deadline for work started by the current request. */
function requestDeadline(requestStartedAt: number): number {
  // On Vercel the platform reports the real deadline; locally there is none,
  // so mirror the limit from the moment this request started.
  const platform = getDeadline()?.getTime() ?? requestStartedAt + FUNCTION_LIMIT_S * 1000;
  return platform - OUTCOME_MARGIN_MS;
}

/** Execute one recorded run to completion, recording success or failure. Never throws. */
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
 * Start one pipeline run in the background of the current request.
 *
 * Writes the run record first (the database rejects a second concurrent run),
 * then hands the work to `after()`, which keeps the function alive until the
 * run settles — up to the function limit. The caller returns immediately.
 *
 * Throws RunAlreadyActiveError if a run is in progress.
 */
export async function startRun(competitors: string[], trigger: RunTrigger): Promise<RunRecord> {
  const deadlineAt = requestDeadline(Date.now());
  const run = await createRun({ competitors, trigger });
  after(() => executeRun(run, deadlineAt));
  return run;
}

/**
 * Work through several store sets in the background of ONE request, one after
 * another (the run lock allows only one at a time). Each set gets its own run
 * record, so status, success and failure stay per set.
 *
 * Stops starting new sets once less than MIN_SET_MS remains, or if a user's
 * run takes the lock in between; whatever is left is still due and is picked
 * up by the next scheduled invocation.
 *
 * Throws RunAlreadyActiveError up front if a run is already in progress.
 */
export async function startScheduledRuns(sets: string[][], trigger: RunTrigger): Promise<void> {
  const deadlineAt = requestDeadline(Date.now());
  if (await getActiveRun()) throw new RunAlreadyActiveError();

  after(async () => {
    for (const [i, competitors] of sets.entries()) {
      const remaining = deadlineAt - Date.now();
      if (remaining < MIN_SET_MS) {
        console.log(`[scheduled] ${sets.length - i} set(s) deferred — ${Math.round(remaining / 1000)}s left`);
        return;
      }
      let run: RunRecord;
      try {
        run = await createRun({ competitors, trigger });
      } catch (err) {
        if (err instanceof RunAlreadyActiveError) {
          console.log(`[scheduled] a run started in between — ${sets.length - i} set(s) deferred`);
          return;
        }
        console.error('[scheduled] could not record run:', err);
        return;
      }
      await executeRun(run, deadlineAt);
    }
  });
}
