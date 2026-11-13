"use client";

import Link from "next/link";
import { Check, Loader2, TriangleAlert } from "lucide-react";
import type { LiveState } from "@/lib/status-client";

/** Stores in the queue, then the ones that finished during this visit. */
export function QueueList({ live }: { live: LiveState }) {
  const { queue, outcomes } = live;
  if (queue.length === 0 && outcomes.length === 0) return null;

  return (
    <ul className="mt-3 divide-y divide-[#eceef1] border-y border-[#eceef1] text-[13px]" aria-live="polite">
      {queue.map((q) => (
        <li key={q.runId} className="flex items-center gap-2 py-2">
          {q.status === "running" ? (
            <Loader2 size={14} className="shrink-0 animate-spin text-ink-3" />
          ) : (
            <span className="w-3.5 shrink-0 text-center text-[11px] font-semibold text-ink-3">{q.position}</span>
          )}
          <span className="font-semibold">{q.store}</span>
          <span className="text-ink-3">{q.status === "running" ? "analysing…" : `queued (#${q.position})`}</span>
        </li>
      ))}
      {outcomes.map((o) => (
        <li key={o.runId} className="flex items-start gap-2 py-2">
          {o.status === "failed" ? (
            <TriangleAlert size={14} className="mt-[2px] shrink-0 text-warn" />
          ) : (
            <Check size={14} className="mt-[2px] shrink-0 text-ok" />
          )}
          <span className="min-w-0">
            <span className="font-semibold">{o.store}</span>{" "}
            {o.status === "failed" ? (
              <span className="text-warn">failed: {o.error ?? "unknown error"}</span>
            ) : o.briefId ? (
              <>
              <span className="text-ink-3">done · </span>
              <Link href={`/briefs/${o.briefId}`} className="font-semibold underline underline-offset-2 hover:no-underline">
                View brief
              </Link>
              </>
            ) : (
              <>
                <span className="text-ink-3">done · </span>
                <Link href="/briefs" className="font-semibold underline underline-offset-2 hover:no-underline">
                  See briefs
                </Link>
              </>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}
