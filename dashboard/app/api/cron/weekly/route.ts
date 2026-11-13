import { NextResponse } from 'next/server';
import { startRun } from '@/lib/server/start-run';
import { RunAlreadyActiveError } from '@/lib/server/runs';

// The run executes in this function's `after()`; Hobby allows 300s.
export const maxDuration = 300;

/**
 * Weekly analysis, invoked by Vercel Cron (dashboard/vercel.json, Mondays
 * 09:00 UTC). Runs the pipeline in this same deployment — no separate
 * backend to wake. Empty competitors → COMPETITOR_STORES.
 *
 * The response only says whether the run STARTED; its outcome is recorded on
 * the run (see /api/status → lastRun), including the error if it failed.
 */
export async function GET(req: Request) {
  // Vercel sends `Authorization: Bearer <CRON_SECRET>`. Reject anything else
  // so strangers can't trigger (paid) analysis runs.
  const auth = req.headers.get('authorization');
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const run = await startRun([], 'cron');
    return NextResponse.json({ ok: true, runId: run.runId, startedAt: run.startedAt });
  } catch (err) {
    if (err instanceof RunAlreadyActiveError) {
      // Not a failure of the schedule: someone's run is in flight. Report it
      // as a conflict so the cron log shows the week was skipped, not lost.
      return NextResponse.json({ ok: false, error: 'a run is already in progress' }, { status: 409 });
    }
    console.error('[cron/weekly] failed to start:', err);
    return NextResponse.json({ ok: false, error: String(err instanceof Error ? err.message : err) }, { status: 500 });
  }
}
