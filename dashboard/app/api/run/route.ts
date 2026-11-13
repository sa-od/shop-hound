import { NextResponse } from 'next/server';
import { isValidDomain } from '@/lib/utils';
import { normalizeDomain } from '@/lib/server/scraper';
import { startRun } from '@/lib/server/start-run';
import { RunAlreadyActiveError } from '@/lib/server/runs';

// Hobby's limit (default and maximum). `after()` work in this route runs
// within it — that is where the pipeline executes.
export const maxDuration = 300;

// More stores than this cannot reliably fit the 300s budget, and each one is
// paid scraping + embedding + model work.
const MAX_COMPETITORS = 6;

/** POST /api/run { competitors: string[] } → 202 { runId } — starts a run in the background. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { competitors?: unknown } | null;
  const raw = Array.isArray(body?.competitors) ? body.competitors.filter((c): c is string => typeof c === 'string') : [];
  const competitors = [...new Set(raw.map(normalizeDomain).filter(Boolean))];

  if (competitors.length === 0) {
    return NextResponse.json({ error: 'Provide at least one competitor domain' }, { status: 400 });
  }
  if (competitors.length > MAX_COMPETITORS) {
    return NextResponse.json({ error: `At most ${MAX_COMPETITORS} competitors per run` }, { status: 400 });
  }
  // The honeypot store is a deliberate exception to domain validation (.test TLD).
  const invalid = competitors.filter(c => c !== 'injection-demo.test' && !isValidDomain(c));
  if (invalid.length > 0) {
    return NextResponse.json({ error: `Invalid domain: ${invalid.join(', ')}` }, { status: 400 });
  }

  try {
    const run = await startRun(competitors, 'dashboard');
    return NextResponse.json({ accepted: true, runId: run.runId, competitors }, { status: 202 });
  } catch (err) {
    if (err instanceof RunAlreadyActiveError) {
      return NextResponse.json({ error: 'A run is already in progress — wait for it to finish' }, { status: 409 });
    }
    console.error('[/api/run] failed to start:', err);
    return NextResponse.json({ error: 'Failed to start run' }, { status: 500 });
  }
}
