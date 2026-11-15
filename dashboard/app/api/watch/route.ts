import { NextResponse } from 'next/server';
import { normalizeDomain } from '@/lib/server/scraper';
import { competitorKeyOf, trackingFor, watchingOf } from '@/lib/server/tracking';
import { setWatchState } from '@/lib/server/watchlist';
import { queueRun } from '@/lib/server/start-run';
import { QueueFullError } from '@/lib/server/runs';

// checkNow drains the queue in this route's `after()`; Hobby allows 300s.
export const maxDuration = 300;

const ACTIONS = ['pause', 'resume', 'remove', 'checkNow'] as const;
type Action = (typeof ACTIONS)[number];

/**
 * POST /api/watch { store: string, action: 'pause' | 'resume' | 'remove' | 'checkNow' }
 *
 *  pause     no automatic checks until resumed; stays in My competitors
 *  resume    watched again (weekly)
 *  remove    stop watching and hide it from the lists; its briefs and data are
 *            kept. Adding the store again (POST /api/run) watches it again.
 *  checkNow  queue a check now (same as adding it: 202 with the run). Does
 *            not change paused/removed.
 *
 * 200 { ok: true, store, action, watching: 'active'|'paused'|'ended', nextCheck }   (remove: watching 'ended', nextCheck null)
 * 202 { ok: true, store, action: 'checkNow', runId, position, existing, status, retryAt?, expedited? }
 * 400 { error, code: 'invalid' }  ·  429 { error, code: 'queue_full' }
 * `store` is the store key from StoreSummary.competitorKey (a domain).
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { store?: unknown; action?: unknown } | null;
  const action = body?.action as Action;
  const raw = typeof body?.store === 'string' ? body.store : '';
  const key = competitorKeyOf(raw.split(',').map(normalizeDomain));
  if (!key || !ACTIONS.includes(action)) {
    return NextResponse.json({ error: 'Send a store and one of: pause, resume, remove, checkNow', code: 'invalid' }, { status: 400 });
  }

  try {
    if (action === 'checkNow') {
      const { run, position, existing, expedited } = await queueRun(key.split(','), 'dashboard');
      return NextResponse.json(
        {
          ok: true, store: key, action, runId: run.runId, position, existing, status: run.status,
          ...(run.status === 'retrying' && run.retryAt ? { retryAt: run.retryAt, expedited } : {}),
        },
        { status: 202 },
      );
    }
    await setWatchState(key, action === 'pause' ? 'paused' : action === 'remove' ? 'removed' : null);
    const t = await trackingFor(key.split(','));
    return NextResponse.json({ ok: true, store: key, action, watching: watchingOf(t), nextCheck: t.nextCheck });
  } catch (err) {
    if (err instanceof QueueFullError) {
      return NextResponse.json({ error: 'The queue is full right now — try again in a few minutes', code: 'queue_full' }, { status: 429 });
    }
    console.error('[/api/watch] failed:', err);
    return NextResponse.json({ error: 'Couldn’t update the store — try again in a moment', code: 'server_error' }, { status: 500 });
  }
}
