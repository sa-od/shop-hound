import 'server-only';
import { after } from 'next/server';
import { getDeadline } from '@vercel/functions';
import { runAnalysis } from './pipeline';
import { createRun, finishRun, type RunRecord, type RunTrigger } from './runs';

/**
 * Hobby's function limit — both the default and the maximum. Route files that
 * start runs export `maxDuration = FUNCTION_LIMIT_S` (it must be a literal
 * there, so the number is repeated in those files).
 */
export const FUNCTION_LIMIT_S = 300;

// Held back from the platform deadline so the run can always record its
// outcome (success or failure) before the function is stopped.
const OUTCOME_MARGIN_MS = 10_000;

/**
 * Start a pipeline run in the background of the current request.
 *
 * Writes the run record first (the database rejects a second concurrent run),
 * then hands the work to `after()`, which keeps the function alive until the
 * run settles — up to the function limit. The caller returns immediately.
 *
 * Throws RunAlreadyActiveError if a run is in progress.
 */
export async function startRun(competitors: string[], trigger: RunTrigger): Promise<RunRecord> {
  const requestStartedAt = Date.now();
  const run = await createRun({ competitors, trigger });

  // On Vercel the platform reports the real deadline; locally there is none,
  // so mirror the limit from the moment this request started.
  const platformDeadline = getDeadline()?.getTime() ?? requestStartedAt + FUNCTION_LIMIT_S * 1000;
  const deadlineAt = platformDeadline - OUTCOME_MARGIN_MS;

  after(async () => {
    try {
      const result = await runAnalysis({
        competitors,
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
  });

  return run;
}
