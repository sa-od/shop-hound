"use client";

import { useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import type { QueueItem } from "@/lib/api";
import { RUN_STEPS, stepLabel } from "@/lib/run-steps";

/** "12s", "1m 05s": time spent on the current step, ticking each second. */
function Elapsed({ since }: { since: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (now === null) return null;
  const s = Math.max(0, Math.round((now - Date.parse(since)) / 1000));
  if (!Number.isFinite(s)) return null;
  const text = s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
  // Ticks every second: hidden from screen readers, which would announce each tick in the live queue list.
  return <span className="tabular-nums text-ink-3" aria-hidden> · {text}</span>;
}

/**
 * The store being analysed, step by step: done steps ticked, the current one
 * spinning with its live detail and time, the rest waiting in grey.
 */
export function RunSteps({ item }: { item: QueueItem }) {
  const current = item.step ? RUN_STEPS.indexOf(item.step) : -1;
  return (
    <ol className="mt-1.5 space-y-1" aria-label={`Progress for ${item.store}`}>
      {RUN_STEPS.map((step, i) => {
        const state = i < current ? "done" : i === current ? "now" : "next";
        return (
          <li key={step} className="flex items-start gap-2" aria-current={state === "now" ? "step" : undefined}>
            <span className="mt-[2px] grid h-3.5 w-3.5 shrink-0 place-items-center">
              {state === "done" ? (
                <Check size={14} className="text-ok" aria-label="done" />
              ) : state === "now" ? (
                <Loader2 size={14} className="animate-spin text-ink" aria-label="in progress" />
              ) : (
                <span className="h-1.5 w-1.5 rounded-full bg-[#c4c8cf]" aria-label="waiting" />
              )}
            </span>
            <span className={state === "next" ? "text-ink-3" : state === "now" ? "font-semibold text-ink" : "text-ink-2"}>
              {stepLabel(step, item.baseline)}
              {state === "now" && item.detail && <span className="font-normal text-ink-2"> · {item.detail}</span>}
              {state === "now" && item.stepStartedAt && <span className="font-normal"><Elapsed since={item.stepStartedAt} /></span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
