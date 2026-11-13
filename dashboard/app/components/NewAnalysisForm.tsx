"use client";

import { useState } from "react";
import { Loader2, Plus } from "lucide-react";
import type { Status } from "@/lib/api";
import { addStore, checkOneStore } from "@/lib/run-client";
import { useLiveStatus } from "@/lib/status-client";
import { QueueList } from "./QueueList";

/** Add one store at a time; each add joins the queue, so the next can be typed straight away. */
export function NewAnalysisForm({ initial, autoFocus = false }: { initial: Status; autoFocus?: boolean }) {
  const live = useLiveStatus(initial);
  const [value, setValue] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ text: string; code?: string } | null>(null);
  const [added, setAdded] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const raw = value.trim();
    if (!raw) return;
    const problem = checkOneStore(raw);
    if (problem) {
      setError({ text: problem, code: "multiple" });
      setAdded(null);
      return;
    }
    setPending(true);
    setError(null);
    setAdded(null);
    const r = await addStore(raw);
    setPending(false);
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
          {pending ? "Adding…" : "Add store"}
        </button>
      </div>
      <p
        id="analysis-help"
        className={`mt-2 text-[13px] leading-relaxed ${error ? (busy ? "text-warn" : "text-cut") : added ? "text-ink" : "text-ink-3"}`}
        aria-live="polite"
      >
        {error?.text ??
          (added ? (
            <>
              <span className="font-semibold">{added}</span> You can add the next one now.
            </>
          ) : (
            "Takes about a minute per store. Each store you add is re-checked automatically every week for 28 days."
          ))}
      </p>
      <QueueList live={live} />
    </form>
  );
}
