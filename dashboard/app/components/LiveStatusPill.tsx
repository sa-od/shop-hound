"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import type { Status } from "@/lib/api";

// Poll fast only while a run is in flight; each poll is a function invocation
// plus database reads, so an idle open tab shouldn't hammer it.
const ACTIVE_POLL_MS = 5_000;
const IDLE_POLL_MS = 15_000;

/**
 * Live status pill — reflects the current run, or the last outcome. When a NEW
 * brief lands it refreshes the page, wherever the run was started from.
 */
export function LiveStatusPill({ initial }: { initial: Status }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>(initial);
  const lastSeenRef = useRef<string | null>(initial.lastBrief?.createdAt ?? null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      let running = status.running;
      try {
        const res = await fetch("/api/status", { cache: "no-store" });
        if (res.ok) {
          const s: Status = await res.json();
          if (cancelled) return;
          setStatus(s);
          running = s.running;
          const newest = s.lastBrief?.createdAt ?? null;
          if (newest && newest !== lastSeenRef.current) {
            const hadSeen = lastSeenRef.current !== null;
            lastSeenRef.current = newest;
            if (hadSeen) router.refresh(); // a new brief just landed — pull it into the list
          }
        }
      } catch {
        /* transient — keep polling */
      }
      if (!cancelled) timer = setTimeout(tick, running ? ACTIVE_POLL_MS : IDLE_POLL_MS);
    };
    timer = setTimeout(tick, status.running ? ACTIVE_POLL_MS : IDLE_POLL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // Restart the loop only when running flips, so the interval tracks it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, status.running]);

  if (status.running) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-500/30 bg-sky-500/10 px-3 py-1 text-xs text-sky-300">
        <Loader2 size={13} className="animate-spin" /> Run in progress
      </span>
    );
  }
  // A failed run newer than the latest brief: say so, instead of looking idle.
  const lastRunFailed =
    status.lastRun?.status === "failed" &&
    (!status.lastBrief || (status.lastRun.finishedAt ?? "") > status.lastBrief.createdAt);
  if (lastRunFailed) {
    return (
      <span
        title={status.lastRun?.error ?? undefined}
        className="inline-flex items-center gap-1.5 rounded-full border border-red-500/30 bg-red-500/10 px-3 py-1 text-xs text-red-300"
      >
        <AlertTriangle size={13} /> Last run failed
      </span>
    );
  }
  if (status.lastBrief) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1 text-xs text-zinc-300">
        <CheckCircle2 size={13} className="text-emerald-400" />
        Last run {status.lastBrief.weekOf}
      </span>
    );
  }
  return null;
}
