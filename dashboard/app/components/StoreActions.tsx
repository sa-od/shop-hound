"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, MoreHorizontal } from "lucide-react";
import type { Watching } from "@/lib/api";
import { addToQueue } from "@/lib/status-client";

type Action = "pause" | "resume" | "remove" | "checkNow";

/**
 * A watched store's menu: Pause watching / Resume · Check now · Remove.
 * Remove keeps the store's data; adding it again brings it back.
 */
export function StoreActions({
  competitorKey,
  store,
  watching,
  variant = "menu",
}: {
  competitorKey: string;
  store: string;
  watching: Watching;
  /** "menu": the ⋯ button in a row. "bar": buttons on the store page. */
  variant?: "menu" | "bar";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [pending, setPending] = useState<Action | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) {
        setOpen(false);
        setConfirmRemove(false);
      }
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  async function act(action: Action) {
    setPending(action);
    setNote(null);
    try {
      const res = await fetch("/api/watch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ store: competitorKey, action }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; runId?: string; position?: number };
      if (!res.ok || body.ok === false) {
        setNote(body.error ?? "That didn’t work. Try again in a moment.");
        return;
      }
      if (action === "checkNow" && body.runId) addToQueue({ runId: body.runId, store, position: body.position ?? 1 });
      setOpen(false);
      setConfirmRemove(false);
      if (action === "remove" && variant === "bar") router.push("/competitors");
      else router.refresh();
    } catch {
      setNote("Couldn’t reach the server. Check your connection and try again.");
    } finally {
      setPending(null);
    }
  }

  const paused = watching === "paused";
  const item =
    "flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm hover:bg-shelf disabled:cursor-not-allowed disabled:opacity-60";
  const spin = (a: Action) => pending === a && <Loader2 size={13} className="animate-spin" />;

  if (variant === "bar")
    return (
      <div className="flex flex-col items-start gap-1 sm:items-end">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => act(paused ? "resume" : "pause")}
            disabled={!!pending}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-edge bg-stock px-3 text-sm font-semibold hover:border-ink-3 disabled:opacity-60"
          >
            {spin(paused ? "resume" : "pause")}
            {paused ? "Resume watching" : "Pause watching"}
          </button>
          <button
            type="button"
            onClick={() => act("checkNow")}
            disabled={!!pending}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-edge bg-stock px-3 text-sm font-semibold hover:border-ink-3 disabled:opacity-60"
          >
            {spin("checkNow")}
            Check now
          </button>
          {confirmRemove ? (
            <span className="inline-flex h-9 items-center gap-2 text-sm">
              Remove {store}?
              <button type="button" onClick={() => act("remove")} disabled={!!pending} className="font-semibold underline underline-offset-2">
                {spin("remove")}Remove
              </button>
              <button type="button" onClick={() => setConfirmRemove(false)} className="text-ink-2 underline underline-offset-2">
                Cancel
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmRemove(true)}
              className="inline-flex h-9 items-center rounded-md px-2 text-sm text-ink-2 underline underline-offset-2 hover:text-ink"
            >
              Remove
            </button>
          )}
        </div>
        {note && (
          <p className="text-xs text-cut" aria-live="polite">
            {note}
          </p>
        )}
      </div>
    );

  return (
    <div ref={ref} className="relative inline-block text-left">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Actions for ${store}`}
        className="grid h-8 w-8 place-items-center rounded-md border border-edge bg-stock text-ink-2 hover:border-ink-3 hover:text-ink"
      >
        {pending ? <Loader2 size={15} className="animate-spin" /> : <MoreHorizontal size={16} />}
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-10 mt-1 w-56 rounded-lg border border-edge bg-stock p-1 shadow-[0_8px_20px_rgb(17_17_17/0.08)]">
          {confirmRemove ? (
            <div className="px-3 py-2 text-sm">
              <p>Stop watching {store}? Its history is kept; add it again any time.</p>
              <div className="mt-2 flex gap-3">
                <button type="button" onClick={() => act("remove")} disabled={!!pending} className="inline-flex items-center gap-1 font-semibold underline underline-offset-2">
                  {spin("remove")}Remove
                </button>
                <button type="button" onClick={() => setConfirmRemove(false)} className="text-ink-2 underline underline-offset-2">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <button type="button" role="menuitem" className={item} disabled={!!pending} onClick={() => act(paused ? "resume" : "pause")}>
                {spin(paused ? "resume" : "pause")}
                {paused ? "Resume watching" : "Pause watching"}
              </button>
              <button type="button" role="menuitem" className={item} disabled={!!pending} onClick={() => act("checkNow")}>
                {spin("checkNow")}
                Check now
              </button>
              <button type="button" role="menuitem" className={item} disabled={!!pending} onClick={() => setConfirmRemove(true)}>
                Remove
              </button>
            </>
          )}
          {note && <p className="px-3 pb-2 text-xs text-cut">{note}</p>}
        </div>
      )}
    </div>
  );
}
