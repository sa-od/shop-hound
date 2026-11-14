// Browser-side: add one store to the analysis queue.
import { addToQueue } from './status-client';

export type AddResult =
  | { ok: true; runId: string; store: string; position: number; alreadyQueued: boolean }
  | { ok: false; error: string; code?: string };

/** Light check only; the server cleans up and validates the address. */
export function checkOneStore(raw: string): string | null {
  return /,/.test(raw) || /\S\s+\S/.test(raw) ? 'Add one store at a time' : null;
}

export async function addStore(raw: string): Promise<AddResult> {
  try {
    const res = await fetch('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ store: raw.trim() }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      runId?: string;
      store?: string;
      position?: number;
      error?: string;
      code?: string;
      existing?: boolean;
    };
    if (!res.ok || !body.runId) {
      return { ok: false, error: body.error ?? `Couldn’t add the store (HTTP ${res.status}). Try again in a moment.`, code: body.code };
    }
    const store = body.store ?? raw.trim();
    const position = body.position ?? 1;
    // The server says when the store was already queued, running or retrying; the local check covers older servers.
    const seenHere = addToQueue({ runId: body.runId, store, position });
    const alreadyQueued = body.existing ?? seenHere;
    return { ok: true, runId: body.runId, store, position, alreadyQueued };
  } catch {
    return { ok: false, error: 'Couldn’t reach the server. Check your connection and try again.' };
  }
}
