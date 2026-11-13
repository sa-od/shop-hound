import 'server-only';
import { listRecentBriefs, countBriefs } from './briefs-store';
import { getActiveRun, getLastFinishedRun } from './runs';
import type { Status } from '@/lib/api';

/** Everything the header pill and the run panel need, in one read. */
export async function getStatus(): Promise<Status> {
  const [active, lastRun, [latest], totalBriefs] = await Promise.all([
    getActiveRun(),
    getLastFinishedRun(),
    listRecentBriefs(1),
    countBriefs(),
  ]);
  return {
    running: active !== null,
    activeRun: active ? { runId: active.runId, competitors: active.competitors, startedAt: active.startedAt } : null,
    lastRun: lastRun
      ? {
          runId: lastRun.runId,
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

/** A stack trace's first line is the message — enough for the UI; logs keep the rest. */
function firstLine(text: string | null): string | null {
  return text ? text.split('\n')[0].slice(0, 300) : null;
}
