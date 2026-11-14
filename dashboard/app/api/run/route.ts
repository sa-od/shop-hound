import { NextResponse } from 'next/server';
import { resolveStoreInput } from '@/lib/server/store-url';
import { probeCatalog, NO_CATALOGUE_REASON } from '@/lib/server/scraper';
import { aiReadEnabled, CONTACT_EMAIL, manualReadMessage } from '@/lib/server/contact';
import { queueRun } from '@/lib/server/start-run';
import { QueueFullError } from '@/lib/server/runs';

// Hobby's limit (default and maximum). The queue is drained in this route's
// `after()` — that is where the pipeline executes.
export const maxDuration = 300;

/**
 * POST /api/run { store: string } — add ONE store to the analysis queue.
 *
 * 202 { runId, store, position, existing }   store = cleaned domain; position 1 = running now / next
 * 200 { accepted: false, code: 'manual_read', store, message, contactEmail }
 *     the store has no catalogue we can read (and AI reading is off): nothing
 *     is queued; `message` tells the user, and they can email contactEmail.
 * 400 { error, code }   code: multiple | invalid_url | not_found | private_address
 * 429 { error, code: 'queue_full' }
 *
 * Adding a store that is already queued or running returns that run (202).
 * `error` is written for the user and is shown as-is.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { store?: unknown; competitors?: unknown } | null;
  if (Array.isArray(body?.competitors) || Array.isArray(body?.store)) {
    return NextResponse.json({ error: 'Add one store at a time', code: 'multiple' }, { status: 400 });
  }

  const parsed = await resolveStoreInput(body?.store);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error, code: parsed.code }, { status: 400 });

  // Answer at once when the store clearly has no catalogue we can read,
  // instead of queueing it and reporting a run later. Uncertain cases
  // (refused, slow, Shopify pausing us) are queued as usual.
  if (!aiReadEnabled()) {
    const probe = await probeCatalog(parsed.domain).catch(() => ({ kind: 'unknown' as const }));
    if (probe.kind === 'none') {
      return NextResponse.json({
        accepted: false,
        code: 'manual_read',
        store: parsed.domain,
        message: manualReadMessage(parsed.domain, NO_CATALOGUE_REASON),
        contactEmail: CONTACT_EMAIL,
      });
    }
  }

  try {
    const { run, position, existing } = await queueRun([parsed.domain], 'dashboard');
    return NextResponse.json({ accepted: true, runId: run.runId, store: parsed.domain, position, existing }, { status: 202 });
  } catch (err) {
    if (err instanceof QueueFullError) {
      return NextResponse.json(
        { error: 'The queue is full right now — try again in a few minutes', code: 'queue_full' },
        { status: 429 },
      );
    }
    console.error('[/api/run] failed to queue:', err);
    return NextResponse.json({ error: 'Couldn’t add the store — try again in a moment', code: 'server_error' }, { status: 500 });
  }
}
