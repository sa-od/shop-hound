"use client";

import { useState } from "react";
import { CalendarClock, Loader2 } from "lucide-react";
import { addStore } from "@/lib/run-client";

export interface Tracking {
  tracked: boolean;
  trackedUntil: string | null;
  nextCheck: string | null;
}

function day(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/**
 * When this store is checked again. The daily job picks up stores whose last
 * brief is 7+ days old, and a busy day can push one to the next, so the next
 * check is "on or after" a date, never a time. `unreadable`: no store in the
 * brief could be read, which is why it was never tracked.
 */
export function TrackingLine({ tracking, competitors, unreadable }: { tracking: Tracking; competitors: string[]; unreadable: boolean }) {
  const [pending, setPending] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  // A due set waiting for today's job shows today, not a past date.
  const next = tracking.nextCheck ? new Date(Math.max(Date.parse(tracking.nextCheck), Date.now())).toISOString() : null;

  async function runAgain() {
    setPending(true);
    setNote(null);
    // One store per analysis: older briefs with several stores add each one to the queue.
    const results = [];
    for (const c of competitors) results.push(await addStore(c));
    setPending(false);
    const failed = results.find((r) => !r.ok);
    setNote(
      failed && !failed.ok
        ? failed.error
        : "Added to the queue. The new brief appears in Briefs when it’s ready.",
    );
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
  } else if (unreadable) {
    text = <>Not re-checked: we couldn’t read {competitors.length === 1 ? "this store" : "these stores"}.</>;
  } else {
    return null;
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
                Run again to resume
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
