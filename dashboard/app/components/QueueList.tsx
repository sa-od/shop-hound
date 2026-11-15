"use client";

import Link from "next/link";
import { Check, Clock, Info, Loader2, TriangleAlert } from "lucide-react";
import { ManualReadLink } from "./ManualRead";
import type { LiveState } from "@/lib/status-client";
import { RetryPhrase } from "./LocalTime";
import { RunSteps } from "./RunSteps";
import { stepLabel } from "@/lib/run-steps";

/** The server sends its cap (maxAttempts); 3 for servers that don't. */
const DEFAULT_MAX_ATTEMPTS = 3;

/**
 * Stores in the queue. Once the queue is empty, only the store that finished
 * last shows its result; earlier ones aren't kept here (they're in Briefs).
 */
/** `hideRunId`: a run whose result the add form already shows in its own line. */
export function QueueList({ live, hideRunId }: { live: LiveState; hideRunId?: string }) {
  const { queue, status } = live;
  const outcomes = queue.length === 0 ? live.outcomes.slice(0, 1).filter((o) => o.runId !== hideRunId) : [];
  if (queue.length === 0 && outcomes.length === 0) return null;

  return (
    <ul className="mt-3 divide-y divide-[#eceef1] border-y border-[#eceef1] text-[13px]" aria-live="polite">
      {queue.map((q) => (
        <li key={q.runId} className="flex items-start gap-2 py-2">
          {q.status === "running" ? (
            // With steps, the spinner sits on the current step instead.
            q.step ? (
              <span className="mt-[1px] w-3.5 shrink-0 text-center text-[11px] font-semibold text-ink-3">1</span>
            ) : (
              <Loader2 size={14} className="mt-[2px] shrink-0 animate-spin text-ink-3" />
            )
          ) : q.status === "retrying" ? (
            <Clock size={14} className="mt-[2px] shrink-0 text-warn" />
          ) : (
            <span className="mt-[1px] w-3.5 shrink-0 text-center text-[11px] font-semibold text-ink-3">{q.position}</span>
          )}
          <span className="min-w-0">
            <span className="font-semibold">{q.store}</span>{" "}
            {q.status === "retrying" && q.failureKind === "ours" ? (
              <span className="text-warn">on hold: a problem on our side, we’ll run it once it’s fixed</span>
            ) : q.status === "retrying" ? (
              <>
                <span className="text-warn">
                  <RetryPhrase iso={q.retryAt} before="waiting to try again" />
                  {q.attempt ? ` (try ${q.attempt + 1} of ${q.maxAttempts ?? DEFAULT_MAX_ATTEMPTS})` : ""}
                </span>
                {q.reason && <span className="block text-xs text-ink-3">{capitalise(q.reason)}.</span>}
              </>
            ) : (
              <>
                <span className="text-ink-3">{q.status === "running" ? (q.step ? "" : "analysing…") : `queued (#${q.position})`}</span>
                {q.status === "running" && q.step && <RunSteps item={q} />}
              </>
            )}
          </span>
        </li>
      ))}
      {outcomes.map((o) => (
        <li key={o.runId} className="flex items-start gap-2 py-2">
          {o.status === "failed" ? (
            <TriangleAlert size={14} className="mt-[2px] shrink-0 text-warn" />
          ) : o.needsManualRead ? (
            <Info size={14} className="mt-[2px] shrink-0 text-ink-3" />
          ) : (
            <Check size={14} className="mt-[2px] shrink-0 text-ok" />
          )}
          <span className="min-w-0">
            {o.needsManualRead ? (
              <>
                <span className="text-ink-2">
                  <span className="font-semibold text-ink">{o.store}</span>: we’ll read it by hand and track it weekly once you email us.
                </span>{" "}
                <ManualReadLink mailto={o.manualRead?.email.mailto} gmail={o.manualRead?.email.gmail} email={status.contactEmail} store={o.store} />
              </>
            ) : (
            <>
            <span className="font-semibold">{o.store}</span>{" "}
            {o.status === "failed" ? (
              <span className="text-warn">
                failed{o.failedStep ? ` at “${stepLabel(o.failedStep)}”` : ""}: {o.error ?? "unknown error"}
              </span>
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
            </>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

function capitalise(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
