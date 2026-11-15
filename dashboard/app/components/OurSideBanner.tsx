"use client";

import { useEffect, useState } from "react";
import { TriangleAlert, X } from "lucide-react";
import type { Status } from "@/lib/api";
import { useLiveStatus } from "@/lib/status-client";
import { RetryPhrase } from "./LocalTime";

const KEY = "ourSideDismissed";

/**
 * Only failures on our side (credentials, quota, database, our model) get a
 * banner. Store-side problems show in that store's row instead.
 */
export function OurSideBanner({ initial }: { initial: Status }) {
  const { status, queue } = useLiveStatus(initial);
  const [dismissed, setDismissed] = useState<string | null>(null);

  useEffect(() => {
    try {
      setDismissed(sessionStorage.getItem(KEY));
    } catch {
      /* storage unavailable: the banner just shows */
    }
  }, []);

  const held = queue.filter((q) => q.status === "retrying" && q.failureKind === "ours");
  const last = status.lastRun;
  const failed = last && last.status === "failed" && last.failureKind === "ours" ? last : null;

  const paused = status.queuePaused;

  let store: string | undefined;
  let others = 0;
  let error: string | null = null;
  let id: string;
  if (held.length > 0 || paused) {
    store = held[0]?.store ?? failed?.store;
    others = Math.max(0, held.length - 1);
    error = failed?.error ?? paused?.reason ?? held[0]?.reason ?? null;
    id = `held-${paused?.until ?? ""}-${held.map((q) => q.runId).join(",")}`;
  } else if (failed) {
    store = failed.store;
    error = failed.error;
    id = failed.runId;
  } else return null;
  if (dismissed === id) return null;

  const key = id;
  function dismiss() {
    setDismissed(key);
    try {
      sessionStorage.setItem(KEY, key);
    } catch {
      /* fine */
    }
  }

  return <OurSideBannerView store={store} others={others} error={error} until={paused?.until} onDismiss={dismiss} />;
}

/** The banner itself, without the live status (also used by fixtures). */
export function OurSideBannerView({
  store,
  others = 0,
  error,
  until,
  onDismiss,
}: {
  store?: string;
  others?: number;
  error: string | null;
  /** Set while the queue is on hold: when reading starts again. */
  until?: string;
  onDismiss?: () => void;
}) {
  const who = store ? `${store}${others ? ` and ${others} more` : ""}` : "the last store";
  const plural = others > 0;
  return (
    <div role="status" className="border-b border-[#f0dca6] bg-warn-soft text-ink">
      <div className="mx-auto flex max-w-[1280px] items-start gap-3 px-4 py-2.5 text-sm sm:px-8">
        <TriangleAlert size={16} className="mt-0.5 shrink-0 text-warn" aria-hidden />
        <div className="min-w-0 flex-1">
          {until && !store ? (
            <p>
              <span className="font-semibold">Reading is on hold.</span> A problem on our side, not with your stores. Nothing is lost:{" "}
              <RetryPhrase iso={until} before="we start again" />.
            </p>
          ) : (
            <p>
              <span className="font-semibold">We couldn’t finish {who}.</span> A problem on our side, not with the store{plural ? "s" : ""}.{" "}
              {plural ? "They stay" : "It stays"} on your list and{" "}
              {until ? <RetryPhrase iso={until} before="we try again" /> : <>we’ll run {plural ? "them" : "it"} again once it’s fixed</>}.
            </p>
          )}
          {error && (
            <details className="mt-1 text-xs text-ink-2">
              <summary className="cursor-pointer underline underline-offset-2">Details</summary>
              <p className="mt-1 break-words font-mono text-[11.5px]">{error}</p>
            </details>
          )}
        </div>
        <button type="button" onClick={onDismiss} aria-label="Dismiss" className="grid h-7 w-7 shrink-0 place-items-center rounded text-ink-2 hover:bg-[#f7e6b3] hover:text-ink">
          <X size={15} />
        </button>
      </div>
    </div>
  );
}
