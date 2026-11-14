"use client";

import { useState } from "react";
import { Loader2, Plus } from "lucide-react";
import type { Status } from "@/lib/api";
import { addStore, checkOneStore, type ManualAnswer } from "@/lib/run-client";
import { useLiveStatus } from "@/lib/status-client";
import { QueueList } from "./QueueList";
import { ManualReadLink, PlatformTag } from "./ManualRead";

/** Add one store at a time; each add joins the queue, so the next can be typed straight away. */
export function NewAnalysisForm({ initial, autoFocus = false }: { initial: Status; autoFocus?: boolean }) {
  const live = useLiveStatus(initial);
  const [value, setValue] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ text: string; code?: string } | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  // The server checked the store and can't read it automatically: an option, not an error.
  const [manual, setManual] = useState<ManualAnswer | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const raw = value.trim();
    if (!raw) return;
    const problem = checkOneStore(raw);
    if (problem) {
      setError({ text: problem, code: "multiple" });
      setAdded(null);
      setManual(null);
      return;
    }
    setPending(true);
    setError(null);
    setAdded(null);
    setManual(null);
    const r = await addStore(raw);
    setPending(false);
    if (!r.ok && r.manual) {
      setManual(r.manual); // keep what they typed in the field
      return;
    }
    if (!r.ok) {
      setError({ text: r.error, code: r.code });
      return;
    }
    setValue("");
    setAdded(r.alreadyQueued ? `${r.store} is already in the queue.` : `${r.store} added.`);
  }

  // A full queue is a "wait a moment", not a mistake in what was typed.
  const busy = error?.code === "queue_full";

  return (
    <form onSubmit={submit} noValidate className="w-full">
      <label htmlFor="analysis-store" className="text-sm font-semibold">
        Store website
      </label>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <input
          id="analysis-store"
          name="store"
          type="text"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          autoFocus={autoFocus}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            if (error) setError(null);
            if (manual) setManual(null);
          }}
          placeholder="goodr.com"
          aria-invalid={error && !busy ? true : undefined}
          aria-describedby="analysis-help"
          className="h-10 w-full rounded-md border border-[#c4c8cf] bg-stock px-3 text-sm outline-none transition-colors duration-150 placeholder:text-ink-3 hover:border-ink-3 focus:border-ink aria-[invalid]:border-cut sm:flex-1"
        />
        <button
          type="submit"
          disabled={pending || !value.trim()}
          className="inline-flex h-10 items-center justify-center gap-1.5 rounded-md bg-ink px-4 text-sm font-semibold text-white transition-colors duration-150 hover:bg-[#2a2c30] disabled:cursor-not-allowed disabled:bg-[#9a9da4]"
        >
          {pending ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
          {pending ? "Checking the store…" : "Add store"}
        </button>
      </div>
      <div id="analysis-help" aria-live="polite">
        {manual ? (
          <div className="mt-3 rounded-md border border-edge bg-shelf px-3.5 py-3 text-[13px] leading-relaxed text-ink-2">
            <PlatformTag name={manual.platformName} className="mb-2" />
            <p>{manual.message}</p>
            <ManualReadLink mailto={manual.mailto} gmail={manual.gmail} email={manual.contactEmail ?? live.status.contactEmail} store={manual.store} className="mt-2" />
          </div>
        ) : (
          <p
            className={`mt-2 text-[13px] leading-relaxed ${error ? (busy ? "text-warn" : "text-cut") : added ? "text-ink" : "text-ink-3"}`}
          >
            {pending
              ? "Checking the store first. This usually takes a few seconds, and up to 20 for some sites."
              : (error?.text ??
                (added ? (
                  <>
                    <span className="font-semibold">{added}</span>
                  </>
                ) : (
                  "Takes about a minute per store. Each store you add is re-checked automatically every week for 28 days."
                )))}
          </p>
        )}
      </div>
      <QueueList live={live} />
    </form>
  );
}
