import { NextResponse } from 'next/server';
import { startScheduledRuns } from '@/lib/server/start-run';
import { RunAlreadyActiveError } from '@/lib/server/runs';
import { getDueSets } from '@/lib/server/tracking';

// The runs execute in this function's `after()`; Hobby allows 300s.
export const maxDuration = 300;

/**
 * Daily re-check, invoked by Vercel Cron (dashboard/vercel.json, 09:00 UTC).
 *
 * Every store set a user analysed from the dashboard is tracked for 28 days
 * (see lib/server/tracking.ts). Each day this re-runs the sets that are DUE —
 * latest brief 7+ days old — oldest first, one after another, as many as fit
 * in the function limit. So each set gets a new brief about weekly; a busy
 * day pushes the rest to tomorrow.
 *
 * The response says what was due and started; each run's outcome is
 * recorded on its run (see /api/status → lastRun).
 */
export async function GET(req: Request) {
  // Vercel sends `Authorization: Bearer <CRON_SECRET>`. Reject anything else
  // so strangers can't trigger (paid) analysis runs.
  const auth = req.headers.get('authorization');
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const due = await getDueSets();
    if (due.length === 0) {
      return NextResponse.json({ ok: true, due: 0, message: 'nothing due today' });
    }
    await startScheduledRuns(
      due.map(s => s.competitors),
      'cron',
    );
    return NextResponse.json({
      ok: true,
      due: due.length,
      // Started in this order; any that don't fit in the time limit stay due.
      queue: due.map(s => ({ competitors: s.competitors, lastBriefAt: s.lastBriefAt, origin: s.origin })),
    });
  } catch (err) {
    if (err instanceof RunAlreadyActiveError) {
      // A user's run is in flight; the due sets stay due for tomorrow.
      return NextResponse.json({ ok: false, error: 'a run is already in progress — due sets deferred' }, { status: 409 });
    }
    console.error('[cron/daily] failed:', err);
    return NextResponse.json({ ok: false, error: String(err instanceof Error ? err.message : err) }, { status: 500 });
  }
}
