import { NextResponse } from 'next/server';
import { getStatus } from '@/lib/server/status';
import { drainInBackground, queueIsStalled } from '@/lib/server/start-run';

// A poll that finds the queue stalled restarts it in this route's `after()`.
export const maxDuration = 300;

/**
 * GET /api/status — queue (running + waiting), last finished run (with its
 * error, if it failed), latest brief.
 *
 * Each add drains the queue for up to 300s; if stores are left waiting with
 * nothing running (that time ran out), the next poll picks them up. The UI
 * polls every 5s while anything is queued, so the queue keeps moving while
 * someone is watching; otherwise the daily cron drains it.
 */
export async function GET() {
  try {
    if (await queueIsStalled()) drainInBackground({ wait: false });
    return NextResponse.json(await getStatus(), { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('[/api/status] error:', err);
    return NextResponse.json({ error: 'Failed to load status' }, { status: 500 });
  }
}
