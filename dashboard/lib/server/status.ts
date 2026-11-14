import 'server-only';
import { listRecentBriefs, countBriefs } from './briefs-store';
import { getQueue, getLastFinishedRun } from './runs';
import type { Status } from '@/lib/api';

/** Everything the top bar, the add-store form and the queue list need, in one read. */
export async function getStatus(): Promise<Status> {
  const [queue, lastRun, [latest], totalBriefs] = await Promise.all([
    getQueue(),
    getLastFinishedRun(),
    listRecentBriefs(1),
    countBriefs(),
  ]);
  const active = queue.find(r => r.status === 'running') ?? null;
  return {
    running: active !== null,
    activeRun: active ? { runId: active.runId, competitors: active.competitors, startedAt: active.startedAt ?? active.queuedAt } : null,
    queue: queue.map((r, i) => ({
      runId: r.runId,
      store: storeLabel(r.competitors),
      status: r.status === 'running' ? 'running' : r.status === 'retrying' ? 'retrying' : 'queued',
      position: i + 1,
      queuedAt: r.queuedAt,
      ...(r.status === 'retrying' && r.retryAt ? { retryAt: r.retryAt, reason: r.retryReason ?? undefined, attempt: r.attempt } : {}),
    })),
    lastRun: lastRun
      ? {
          runId: lastRun.runId,
          store: storeLabel(lastRun.competitors),
          status: lastRun.status === 'failed' ? 'failed' : 'success',
          finishedAt: lastRun.finishedAt,
          error: lastRun.status === 'failed' ? firstLine(lastRun.error) : null,
          briefId: lastRun.briefId,
        }
      : null,
    lastBrief: latest
      ? { id: latest.id, weekOf: latest.weekOf, greenLight: latest.greenLight, createdAt: latest.createdAt, competitorCount: latest.competitors.length }
      : null,
    totalBriefs,
  };
}

const storeLabel = (competitors: string[]) => competitors.join(', ');

/** A stack trace's first line is the message — enough for the UI; logs keep the rest. */
function firstLine(text: string | null): string | null {
  return text ? text.split('\n')[0].slice(0, 300) : null;
}
