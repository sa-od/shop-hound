// Browser-side: one shared /api/status poller for the whole page, so the top
// bar and every queue list show the same state. Polls every 5s while stores
// are queued or running, every 15s otherwise (including while stores only
// wait to retry: the poll is also what restarts them when their time comes).
import { useState, useSyncExternalStore } from 'react';
import type { QueueItem, Status } from './api';

const BUSY_POLL_MS = 5_000;
const IDLE_POLL_MS = 15_000;

/** A store that left the queue during this visit. */
export interface Outcome {
  runId: string;
  store: string;
  status: 'success' | 'failed' | 'done'; // done: finished, but another run finished after it before we looked
  error: string | null;
  briefId: string | null;
  /** Finished, but the store can't be read automatically: offer the email request. */
  needsManualRead?: boolean;
}

export interface LiveState {
  status: Status;
  queue: QueueItem[];
  outcomes: Outcome[]; // newest first
}

const MAX_OUTCOMES = 6;

let state: LiveState | null = null;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | undefined;

function queueOf(s: Status): QueueItem[] {
  if (s.queue) return s.queue;
  // Older servers: one active run, no queue.
  return s.activeRun
    ? [{ runId: s.activeRun.runId, store: s.activeRun.competitors.join(', '), status: 'running', position: 1, queuedAt: s.activeRun.startedAt }]
    : [];
}

function emit() {
  for (const l of listeners) l();
}

function apply(next: Status) {
  const prevQueue = state?.queue ?? [];
  const queue = queueOf(next);
  const still = new Set(queue.map((q) => q.runId));
  const left = prevQueue.filter((q) => !still.has(q.runId));
  const outcomes = [...(state?.outcomes ?? [])];
  for (const q of left) {
    const r = next.lastRun?.runId === q.runId ? next.lastRun : null;
    outcomes.unshift({
      runId: q.runId,
      store: r?.store ?? q.store,
      status: r ? r.status : 'done',
      error: r?.error ?? null,
      briefId: r?.briefId ?? null,
      ...(r?.needsManualRead ? { needsManualRead: true } : {}),
    });
  }
  state = { status: next, queue, outcomes: outcomes.slice(0, MAX_OUTCOMES) };
  emit();
}

async function poll() {
  try {
    const res = await fetch('/api/status', { cache: 'no-store' });
    if (res.ok) apply((await res.json()) as Status);
  } catch {
    /* transient: keep polling */
  }
  schedule();
}

function schedule(delay?: number) {
  clearTimeout(timer);
  if (listeners.size === 0) return;
  const busy = state?.queue.some((q) => q.status !== 'retrying');
  timer = setTimeout(poll, delay ?? (busy ? BUSY_POLL_MS : IDLE_POLL_MS));
}

function subscribe(l: () => void) {
  listeners.add(l);
  if (listeners.size === 1) schedule();
  return () => {
    listeners.delete(l);
    if (listeners.size === 0) clearTimeout(timer);
  };
}

/**
 * Seed from the server-rendered status once, then follow the poller. The shared
 * state only lives in the browser: on the server this module is shared across
 * requests, so server renders use their own status.
 */
export function useLiveStatus(initial: Status): LiveState {
  const [seed] = useState<LiveState>(() => ({ status: initial, queue: queueOf(initial), outcomes: [] }));
  if (typeof window !== 'undefined' && !state) state = seed;
  return useSyncExternalStore(subscribe, () => state ?? seed, () => seed);
}

/** "2:20 PM" today, "Nov 15, 2:20 PM" otherwise; "shortly" once the time has passed. */
export function retryTime(iso: string | undefined): string {
  if (!iso) return 'later';
  const d = new Date(iso);
  if (d.getTime() <= Date.now()) return 'shortly';
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString()
    ? `at ${time}`
    : `on ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${time}`;
}

/** Show a just-added store at once. Returns true when it was already queued or running. */
export function addToQueue(item: { runId: string; store: string; position: number }): boolean {
  if (!state) return false;
  if (state.queue.some((q) => q.runId === item.runId)) return true;
  const entry: QueueItem = {
    runId: item.runId,
    store: item.store,
    status: item.position === 1 ? 'running' : 'queued',
    position: item.position,
    queuedAt: new Date().toISOString(),
  };
  state = { ...state, queue: [...state.queue, entry].sort((a, b) => a.position - b.position) };
  emit();
  schedule(BUSY_POLL_MS);
  return false;
}
