"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Loader2, Plus, X } from "lucide-react";
import type { Status } from "@/lib/api";
import { useLiveStatus } from "@/lib/status-client";
import { LocalTime, RetryPhrase } from "./LocalTime";
import { RUN_STEPS, stepLabel, stepNumber } from "@/lib/run-steps";
import { NewAnalysisForm } from "./NewAnalysisForm";

/**
 * Queue status and "Add store". Follows every store in the queue (added here,
 * from a brief's "Run again", or by the daily job) and refreshes the page when
 * a new brief lands.
 */
export function RunControl({ initial }: { initial: Status }) {
  const router = useRouter();
  const live = useLiveStatus(initial);
  const { status, queue, outcomes } = live;
  const [open, setOpen] = useState(false);
  // Opening a brief from the panel (View brief) or going anywhere else closes it.
  const pathname = usePathname();
  const [openedOn, setOpenedOn] = useState(pathname);
  if (pathname !== openedOn) {
    setOpenedOn(pathname);
    if (open) setOpen(false);
  }
  const [dismissed, setDismissed] = useState<string | null>(null);
  const lastBriefRef = useRef<string | null>(initial.lastBrief?.createdAt ?? null);

  useEffect(() => {
    const newest = status.lastBrief?.createdAt ?? null;
    if (newest && newest !== lastBriefRef.current) {
      lastBriefRef.current = newest;
      router.refresh(); // a new brief landed
    }
  }, [router, status.lastBrief?.createdAt]);

  const running = queue.find((q) => q.status === "running");
  const waiting = queue.filter((q) => q.status === "queued").length;
  const retrying = queue.filter((q) => q.status === "retrying");

  // A failure is shown in the strip until dismissed: one seen leaving the queue
  // during this visit, or (on load) a failed last run newer than the latest brief.
  const failedOutcome = outcomes.find((o) => o.status === "failed");
  const failedOnLoad =
    status.lastRun?.status === "failed" &&
    (!status.lastBrief || (status.lastRun.finishedAt ?? "") > status.lastBrief.createdAt)
      ? status.lastRun
      : null;
  const failure = failedOutcome
    ? { id: failedOutcome.runId, store: failedOutcome.store, error: failedOutcome.error }
    : failedOnLoad
      ? { id: failedOnLoad.runId, store: failedOnLoad.store, error: failedOnLoad.error }
      : null;
  const showFailure = failure && failure.id !== dismissed && !open;

  return (
    <>
      <div className="ml-auto flex items-center gap-3 text-[13px]">
        {running ? (
          <span className="hidden items-center gap-1.5 text-[#d5d7db] md:inline-flex" aria-live="polite">
            <Loader2 size={13} className="animate-spin" />
            Analysing {running.store}
            {running.step && (
              <span className="text-[#a8abb2]">
                · {stepLabel(running.step, running.baseline)} ({stepNumber(running.step)} of {RUN_STEPS.length})
              </span>
            )}
            {waiting > 0 && <span className="text-[#a8abb2]">· {waiting} queued</span>}
            {retrying.length > 0 && <span className="text-[#a8abb2]">· {retrying.length} waiting to retry</span>}
          </span>
        ) : retrying.length > 0 ? (
          <span className="hidden text-[#d5d7db] md:inline" aria-live="polite">
            {retrying.length === 1
              ? <>{retrying[0].store}: <RetryPhrase iso={retrying[0].retryAt} before="trying again" /></>
              : `${retrying.length} stores waiting to try again`}
          </span>
        ) : failure ? (
          <span className="hidden text-[#ffb4b4] md:inline">Last analysis failed</span>
        ) : status.lastBrief ? (
          <span className="hidden text-[#a8abb2] md:inline">Last brief <LocalTime iso={status.lastBrief.createdAt} format="shortdate" /></span>
        ) : null}

        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls="new-analysis-panel"
          className="inline-flex items-center gap-1.5 rounded-md bg-white px-3 py-1.5 text-[13px] font-semibold text-ink transition-colors duration-150 hover:bg-sticker"
        >
          {open ? <X size={14} /> : running ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          {open ? (
            "Close"
          ) : (
            <>
              Add store
              {queue.length > 0 && <span className="md:hidden"> · {queue.length} in queue</span>}
            </>
          )}
        </button>
      </div>

      {open && (
        <div id="new-analysis-panel" className="absolute inset-x-0 top-14 border-b border-edge bg-stock text-ink shadow-[0_8px_20px_rgb(17_17_17/0.08)]">
          <div className="mx-auto max-w-[1280px] px-4 py-5 sm:px-8">
            <div className="max-w-2xl">
              <NewAnalysisForm initial={initial} autoFocus />
            </div>
          </div>
        </div>
      )}

      {showFailure && (
        <div role="alert" className="absolute inset-x-0 top-14 border-b border-[#f0c9a0] bg-warn-soft text-warn">
          <div className="mx-auto flex max-w-[1280px] items-start gap-3 px-4 py-2.5 text-[13px] sm:px-8">
            <p className="flex-1">
              {failure.store ? `${failure.store} couldn’t be analysed` : "The last analysis failed"}: {failure.error ?? "unknown error"}
            </p>
            <button type="button" onClick={() => setDismissed(failure.id)} aria-label="Dismiss" className="rounded p-0.5 hover:bg-[#ffe7a8]">
              <X size={15} />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
