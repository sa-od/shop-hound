"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, X } from "lucide-react";
import type { Status } from "@/lib/api";
import { RUN_STARTED_EVENT, type RunStartedDetail } from "@/lib/run-client";
import { NewAnalysisForm } from "./NewAnalysisForm";

// Poll fast only while a run is in flight; an idle open tab shouldn't hammer the database.
const ACTIVE_POLL_MS = 5_000;
const IDLE_POLL_MS = 15_000;

function elapsed(since: string, now: number) {
  const s = Math.max(0, Math.floor((now - Date.parse(since)) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function shortDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * Run status and "New analysis". Follows any run (started here, from a brief's
 * "Run again", or by the daily job) and refreshes the page when a brief lands.
 */
export function RunControl({ initial }: { initial: Status }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>(initial);
  const [open, setOpen] = useState(false);
  // A failed analysis newer than the latest brief is shown plainly from the start.
  const [message, setMessage] = useState<string | null>(() =>
    initial.lastRun?.status === "failed" &&
    (!initial.lastBrief || (initial.lastRun.finishedAt ?? "") > initial.lastBrief.createdAt)
      ? `The last analysis failed: ${initial.lastRun.error ?? "unknown error"}`
      : null,
  );
  const [now, setNow] = useState(() => Date.now());
  const lastBriefRef = useRef<string | null>(initial.lastBrief?.createdAt ?? null);
  const lastRunRef = useRef<string | null>(initial.lastRun?.runId ?? null);

  // A run started anywhere on the page shows here at once.
  useEffect(() => {
    const onStarted = (e: Event) => {
      const { runId, competitors } = (e as CustomEvent<RunStartedDetail>).detail;
      setMessage(null);
      setNow(Date.now());
      setStatus((s) => ({ ...s, running: true, activeRun: { runId, competitors, startedAt: new Date().toISOString() } }));
    };
    window.addEventListener(RUN_STARTED_EVENT, onStarted);
    return () => window.removeEventListener(RUN_STARTED_EVENT, onStarted);
  }, []);

  // Status polling.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      let isRunning = status.running;
      try {
        const res = await fetch("/api/status", { cache: "no-store" });
        if (res.ok) {
          const s: Status = await res.json();
          if (cancelled) return;
          setStatus(s);
          isRunning = s.running;
          const newestRun = s.lastRun?.runId ?? null;
          if (newestRun && newestRun !== lastRunRef.current) {
            lastRunRef.current = newestRun;
            if (s.lastRun?.status === "failed") setMessage(`The last analysis failed: ${s.lastRun.error ?? "unknown error"}`);
          }
          const newestBrief = s.lastBrief?.createdAt ?? null;
          if (newestBrief && newestBrief !== lastBriefRef.current) {
            lastBriefRef.current = newestBrief;
            router.refresh(); // a new brief landed
          }
        }
      } catch {
        /* transient: keep polling */
      }
      if (!cancelled) timer = setTimeout(tick, isRunning ? ACTIVE_POLL_MS : IDLE_POLL_MS);
    };
    timer = setTimeout(tick, status.running ? ACTIVE_POLL_MS : IDLE_POLL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [router, status.running]);

  // Elapsed-time clock while running.
  useEffect(() => {
    if (!status.running) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [status.running]);

  const lastRunFailed =
    status.lastRun?.status === "failed" &&
    (!status.lastBrief || (status.lastRun.finishedAt ?? "") > status.lastBrief.createdAt);

  return (
    <>
      <div className="ml-auto flex items-center gap-3 text-[13px]">
        {status.running && status.activeRun ? (
          <span className="hidden items-center gap-1.5 text-[#d5d7db] md:inline-flex" aria-live="polite">
            Analysing {status.activeRun.competitors.length} store{status.activeRun.competitors.length === 1 ? "" : "s"} ·{" "}
            {elapsed(status.activeRun.startedAt, now)}
            <span className="text-[#a8abb2]">(usually 1–2 min)</span>
          </span>
        ) : lastRunFailed ? (
          <span className="hidden text-[#ffb4b4] md:inline">Last analysis failed</span>
        ) : status.lastBrief ? (
          <span className="hidden text-[#a8abb2] md:inline">Last brief {shortDate(status.lastBrief.createdAt)}</span>
        ) : null}

        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          disabled={status.running}
          aria-expanded={open}
          aria-controls="new-analysis-panel"
          className="inline-flex items-center gap-1.5 rounded-md bg-white px-3 py-1.5 text-[13px] font-semibold text-ink transition-colors duration-150 hover:bg-sticker disabled:cursor-not-allowed disabled:bg-[#3a3c40] disabled:text-[#c5c7cc]"
        >
          {status.running ? <Loader2 size={14} className="animate-spin" /> : open ? <X size={14} /> : <Plus size={14} />}
          {status.running ? (
            <>
              Analysing<span className="md:hidden">{status.activeRun ? ` ${elapsed(status.activeRun.startedAt, now)}` : ""}</span>
            </>
          ) : open ? (
            "Close"
          ) : (
            "New analysis"
          )}
        </button>
      </div>

      {open && !status.running && (
        <div id="new-analysis-panel" className="absolute inset-x-0 top-14 border-b border-edge bg-stock text-ink shadow-[0_8px_20px_rgb(17_17_17/0.08)]">
          <div className="mx-auto max-w-[1280px] px-4 py-5 sm:px-8">
            <div className="max-w-2xl">
              <NewAnalysisForm autoFocus onStarted={() => setOpen(false)} />
            </div>
          </div>
        </div>
      )}

      {message && !open && (
        <div role="alert" className="absolute inset-x-0 top-14 border-b border-[#f0c9a0] bg-warn-soft text-warn">
          <div className="mx-auto flex max-w-[1280px] items-start gap-3 px-4 py-2.5 text-[13px] sm:px-8">
            <p className="flex-1">{message}</p>
            <button type="button" onClick={() => setMessage(null)} aria-label="Dismiss" className="rounded p-0.5 hover:bg-[#ffe7a8]">
              <X size={15} />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
