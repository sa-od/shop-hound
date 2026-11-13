// Browser-side: start an analysis run. The top bar's RunControl listens for
// RUN_STARTED_EVENT so it shows the run at once, wherever it was started.
import { isValidDomain } from './utils';

export const MAX_STORES_PER_RUN = 6;
export const RUN_STARTED_EVENT = 'growthbriefs:run-started';

export type RunStartedDetail = { runId: string; competitors: string[] };

export function parseDomains(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split(/[\s,]+/)
        .map((d) => d.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/:\d+$/, ''))
        .filter(Boolean),
    ),
  ];
}

/** Client-side check, so most mistakes are caught before a request. The server checks again. */
export function checkDomains(domains: string[]): string | null {
  if (domains.length === 0) return 'Enter at least one store domain, like example.com.';
  if (domains.length > MAX_STORES_PER_RUN) return `One analysis covers up to ${MAX_STORES_PER_RUN} stores; you entered ${domains.length}.`;
  const invalid = domains.filter((d) => !isValidDomain(d));
  if (invalid.length) return `${invalid.join(', ')} ${invalid.length > 1 ? 'aren’t valid store domains' : 'isn’t a valid store domain'}. Use a format like example.com.`;
  return null;
}

export async function startRun(competitors: string[]): Promise<{ ok: true; runId: string } | { ok: false; error: string }> {
  try {
    const res = await fetch('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ competitors }),
    });
    const body = (await res.json().catch(() => ({}))) as { runId?: string; error?: string };
    if (res.status === 409) return { ok: false, error: 'An analysis is already running. Wait for it to finish, then try again.' };
    if (!res.ok || !body.runId) return { ok: false, error: body.error ?? `Couldn’t start the analysis (HTTP ${res.status}). Try again in a moment.` };
    window.dispatchEvent(new CustomEvent<RunStartedDetail>(RUN_STARTED_EVENT, { detail: { runId: body.runId, competitors } }));
    return { ok: true, runId: body.runId };
  } catch {
    return { ok: false, error: 'Couldn’t reach the server. Check your connection and try again.' };
  }
}
