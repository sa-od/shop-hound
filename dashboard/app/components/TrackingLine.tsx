"use client";

import { useState } from "react";
import { CalendarClock, Loader2 } from "lucide-react";
import { startRun } from "@/lib/run-client";

export interface Tracking {
  tracked: boolean;
  trackedUntil: string | null;
  nextCheck: string | null;
}

function day(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/**
 * When this store set is checked again. The daily job picks up sets whose last
 * brief is 7+ days old, and a busy day can push one to the next, so the next
 * check is "on or after" a date, never a time.
 */
export function TrackingLine({ tracking, competitors }: { tracking: Tracking; competitors: string[] }) {
  const [pending, setPending] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  // A due set waiting for today's job shows today, not a past date.
  const next = tracking.nextCheck ? new Date(Math.max(Date.parse(tracking.nextCheck), Date.now())).toISOString() : null;

  async function runAgain() {
    setPending(true);
    setNote(null);
    const r = await startRun(competitors);
    setPending(false);
    setNote(r.ok ? "Started. The new brief appears here when it’s ready." : r.error);
  }

  let text: React.ReactNode;
  let canRunAgain = false;
  if (tracking.tracked) {
    text = (
      <>
        Re-checked automatically every week{tracking.trackedUntil ? ` until ${day(tracking.trackedUntil)}` : ""}.
        {next && ` Next check on or after ${day(next)}.`}
      </>
    );
  } else if (tracking.trackedUntil) {
    text = <>Tracking ended {day(tracking.trackedUntil)}.</>;
    canRunAgain = true;
  } else {
    text = <>These stores aren’t re-checked automatically.</>;
    canRunAgain = true;
  }

  return (
    <div className="text-xs leading-relaxed text-ink-2">
      <p className="flex items-start gap-1.5">
        <CalendarClock size={14} className="mt-[1px] shrink-0 text-ink-3" />
        <span>
          {text}
          {canRunAgain && (
            <>
              {" "}
              <button
                type="button"
                onClick={runAgain}
                disabled={pending}
                className="inline-flex items-center gap-1 font-semibold text-ink underline underline-offset-2 hover:no-underline disabled:cursor-not-allowed disabled:opacity-60"
              >
                {pending && <Loader2 size={12} className="animate-spin" />}
                {tracking.trackedUntil ? "Run again to resume" : "Run again to track them for 28 days"}
              </button>
            </>
          )}
        </span>
      </p>
      {note && (
        <p className="mt-1 pl-5 text-ink-3" aria-live="polite">
          {note}
        </p>
      )}
    </div>
  );
}
