import 'server-only';
import { listRecentBriefs, countBriefs } from './briefs-store';
import { getQueue, getLastFinishedRun, getQueuePause } from './runs';
import { classifyFailure } from './failure';
import { MAX_ATTEMPTS } from './start-run';
import { CONTACT_EMAIL } from './contact';
import type { Status } from '@/lib/api';

/** Everything the top bar, the add-store form and the queue list need, in one read. */
export async function getStatus(): Promise<Status> {
  const [queue, lastRun, [latest], totalBriefs, queuePaused] = await Promise.all([
    getQueue(),
    getLastFinishedRun(),
    listRecentBriefs(1),
    countBriefs(),
    getQueuePause(),
  ]);
  // Older runs have no stored failureKind: derive it the same way.
  const failureKind = lastRun
    ? (lastRun.failureKind ?? (lastRun.status === 'failed' ? classifyFailure(lastRun.error) : lastRun.blocked || lastRun.manualRead ? 'store' : null))
    : null;
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
      ...(r.status === 'retrying' && r.retryAt ? { retryAt: r.retryAt, reason: r.retryReason ?? undefined, attempt: r.attempt, maxAttempts: MAX_ATTEMPTS, failureKind: r.failureKind === 'ours' ? 'ours' : 'store' } : {}),
      ...(r.status === 'running' && r.step
        ? {
            step: r.step,
            ...(r.stepStartedAt ? { stepStartedAt: r.stepStartedAt } : {}),
            ...(r.stepDetail ? { detail: r.stepDetail } : {}),
            ...(r.baseline !== null ? { baseline: r.baseline } : {}),
          }
        : {}),
    })),
    lastRun: lastRun
      ? {
          runId: lastRun.runId,
          store: storeLabel(lastRun.competitors),
          status: lastRun.status === 'failed' ? 'failed' : 'success',
          finishedAt: lastRun.finishedAt,
          error: lastRun.status === 'failed' ? firstLine(lastRun.error) : null,
          ...(lastRun.status === 'failed' && lastRun.failedStep ? { failedStep: lastRun.failedStep } : {}),
          ...(failureKind ? { failureKind } : {}),
          briefId: lastRun.briefId,
          ...(lastRun.manualRead ? { needsManualRead: true, ...(lastRun.manualReadInfo ? { manualRead: lastRun.manualReadInfo } : {}) } : {}),
        }
      : null,
    lastBrief: latest
      ? { id: latest.id, weekOf: latest.weekOf, greenLight: latest.greenLight, createdAt: latest.createdAt, competitorCount: latest.competitors.length }
      : null,
    totalBriefs,
    ...(queuePaused ? { queuePaused } : {}),
    contactEmail: CONTACT_EMAIL,
  };
}

const storeLabel = (competitors: string[]) => competitors.join(', ');

/** A stack trace's first line is the message — enough for the UI; logs keep the rest. */
function firstLine(text: string | null): string | null {
  return text ? text.split('\n')[0].slice(0, 300) : null;
}
