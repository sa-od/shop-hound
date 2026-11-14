import { NextResponse } from 'next/server';
import { getQueue } from '@/lib/server/runs';
import { drainInBackground } from '@/lib/server/start-run';

// The queue is drained in this function's `after()`; Hobby allows 300s.
export const maxDuration = 300;

/**
 * Hourly queue drain, invoked by Vercel Cron (dashboard/vercel.json: one
 * daily job per hour — Hobby allows only daily jobs, up to 100 of them, and
 * several may share a path).
 *
 * It only works through what is already waiting — due retries and stores
 * the daily check (or users) queued that didn't fit in one function run.
 * It never adds anything, so it costs nothing when the queue is empty.
 */
export async function GET(req: Request) {
  const auth = req.headers.get('authorization');
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    const queue = await getQueue();
    if (queue.length > 0) drainInBackground({ wait: true });
    return NextResponse.json({
      ok: true,
      waiting: queue.filter(r => r.status === 'queued').length,
      retrying: queue.filter(r => r.status === 'retrying').length,
      running: queue.some(r => r.status === 'running'),
    });
  } catch (err) {
    console.error('[cron/drain] failed:', err);
    return NextResponse.json({ ok: false, error: String(err instanceof Error ? err.message : err) }, { status: 500 });
  }
}
