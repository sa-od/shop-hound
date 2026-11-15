"use client";

import { useState } from "react";
import { CalendarClock, Loader2 } from "lucide-react";
import { addStore } from "@/lib/run-client";
import { LocalTime } from "./LocalTime";

export interface Tracking {
  tracked: boolean;
  nextCheck: string | null;
  /** Never read yet because the store refused us for now; retried daily. */
  firstReadPending?: boolean;
  /** Paused from My competitors: not checked until resumed. */
  paused?: boolean;
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
        ? failed.error // a manual-read answer carries its message here too
        : "Added. It’s read in a minute or so, then every week.",
    );
  }

  let text: React.ReactNode;
  let canRunAgain = false;
  if (tracking.paused) {
    text = <>Paused. Not checked until you resume it.</>;
  } else if (tracking.tracked && tracking.firstReadPending) {
    text = (
      <>
        We couldn’t read {competitors.length === 1 ? "this store" : "these stores"} yet.
        {next ? (
          <>
            {" "}We’ll try again on or after <LocalTime iso={next} format="date" />.
          </>
        ) : (
          " We’ll try again at the next daily check."
        )}
      </>
    );
  } else if (tracking.tracked) {
    text = (
      <>
        Checked every week until you remove it.
        {next && (
          <>
            {" "}Next check on or after <LocalTime iso={next} format="date" />.
          </>
        )}
      </>
    );
  } else if (unreadable) {
    text = <>Not re-checked: we couldn’t read {competitors.length === 1 ? "this store" : "these stores"}.</>;
    canRunAgain = true;
  } else {
    // Not watched (stopped, or from before watching was indefinite): adding it again starts it.
    text = <>Not being checked.</>;
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
                {unreadable ? "Add it again" : "Start watching"}
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
