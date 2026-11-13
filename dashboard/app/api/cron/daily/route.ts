import { NextResponse } from 'next/server';
import { enqueueRun, QueueFullError } from '@/lib/server/runs';
import { drainInBackground } from '@/lib/server/start-run';
import { getDueSets } from '@/lib/server/tracking';

// The queue is drained in this function's `after()`; Hobby allows 300s.
export const maxDuration = 300;

/**
 * Daily re-check, invoked by Vercel Cron (dashboard/vercel.json, 09:00 UTC).
 *
 * Every store a user analysed from the dashboard is tracked for 28 days (see
 * lib/server/tracking.ts). Each day this queues the stores that are DUE —
 * latest brief 7+ days old — oldest first, behind anything users queued, and
 * works through the queue for as long as this function may run. Stores that
 * don't fit stay queued (the next status poll or tomorrow's run picks them
 * up) or stay due.
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
    const queued: string[] = [];
    const deferred: string[] = [];
    for (const set of due) {
      try {
        await enqueueRun({ competitors: set.competitors, trigger: 'cron' });
        queued.push(set.competitorKey);
      } catch (err) {
        if (!(err instanceof QueueFullError)) throw err;
        deferred.push(set.competitorKey); // still due tomorrow
      }
    }
    // Also picks up anything users left waiting.
    drainInBackground({ wait: true });
    return NextResponse.json({ ok: true, due: due.length, queued, deferred });
  } catch (err) {
    console.error('[cron/daily] failed:', err);
    return NextResponse.json({ ok: false, error: String(err instanceof Error ? err.message : err) }, { status: 500 });
  }
}
