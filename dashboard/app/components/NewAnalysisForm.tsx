"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Loader2, Plus } from "lucide-react";
import type { Status } from "@/lib/api";
import { addStore, checkOneStore, type ManualAnswer } from "@/lib/run-client";
import { useLiveStatus, type LiveState, type Outcome } from "@/lib/status-client";
import { stepLabel } from "@/lib/run-steps";
import { QueueList } from "./QueueList";
import { RetryTime } from "./LocalTime";
import { ManualReadLink, PlatformTag } from "./ManualRead";

/** Add one store at a time; each add joins the queue, so the next can be typed straight away. */
export function NewAnalysisForm({ initial, autoFocus = false }: { initial: Status; autoFocus?: boolean }) {
  const live = useLiveStatus(initial);
  const [value, setValue] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ text: string; code?: string } | null>(null);
  // The store just added here: its line turns into the result once its run finishes.
  const [added, setAdded] = useState<{ text: React.ReactNode; runId: string; store: string } | null>(null);
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
    setAdded({
      text: r.expedited ? (
        !r.retryAt || Date.parse(r.retryAt) <= Date.now() + 5_000 ? (
          `Trying ${r.store} again now.`
        ) : (
          <>
            {r.store} asked us to wait, trying again <RetryTime iso={r.retryAt} />.
          </>
        )
      ) : r.alreadyQueued ? (
        `${r.store} is already in the queue.`
      ) : (
        `${r.store} added.`
      ),
      runId: r.runId,
      store: r.store,
    });
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
        ) : added && !pending && !error ? (
          <AddedLine added={added} live={live} />
        ) : (
          <p
            className={`mt-2 text-[13px] leading-relaxed ${error ? (busy ? "text-warn" : "text-cut") : "text-ink-3"}`}
          >
            {pending
              ? "Checking the store first. This usually takes a few seconds, and up to 20 for some sites."
              : (error?.text ??
                "Takes about a minute per store. Each store you add is re-checked automatically every week for 28 days.")}
          </p>
        )}
      </div>
      <QueueList live={live} hideRunId={added?.runId} />
    </form>
  );
}

/** The finished run for what was added, matched by runId only (no clock comparisons): seen leaving the queue, or the server's last run. */
function resultFor(added: { runId: string; store: string }, live: LiveState): Outcome | null {
  const seen = live.outcomes.find((o) => o.runId === added.runId);
  if (seen) return seen;
  const r = live.status.lastRun;
  if (!r || r.runId !== added.runId) return null;
  return {
    runId: r.runId,
    store: r.store ?? added.store,
    status: r.status,
    error: r.error,
    briefId: r.briefId,
    ...(r.failedStep ? { failedStep: r.failedStep } : {}),
    ...(r.needsManualRead ? { needsManualRead: true, manualRead: r.manualRead } : {}),
  };
}

function AddedLine({ added, live }: { added: { text: React.ReactNode; runId: string; store: string }; live: LiveState }) {
  const o = resultFor(added, live);
  if (!o) return <p className="mt-2 text-[13px] font-semibold leading-relaxed text-ink">{added.text}</p>;
  if (o.needsManualRead)
    return (
      <div className="mt-3 rounded-md border border-edge bg-shelf px-3.5 py-3 text-[13px] leading-relaxed text-ink-2">
        <PlatformTag name={o.manualRead?.platformName} className="mb-2" />
        <p>{o.manualRead?.message ?? `We can’t read ${o.store} automatically.`}</p>
        <ManualReadLink mailto={o.manualRead?.email.mailto} gmail={o.manualRead?.email.gmail} email={live.status.contactEmail} store={o.store} className="mt-2" />
      </div>
    );
  if (o.status === "failed")
    return (
      <p className="mt-2 text-[13px] leading-relaxed text-cut">
        <span className="font-semibold">{o.store} couldn’t be analysed</span>
        {o.failedStep ? ` at “${stepLabel(o.failedStep)}”` : ""}: {o.error ?? "unknown error"}
      </p>
    );
  return (
    <p className="mt-2 text-[13px] leading-relaxed text-ink">
      <span className="font-semibold">{o.store} is ready.</span>{" "}
      <Link
        href={o.briefId ? `/briefs/${o.briefId}` : "/briefs"}
        className="inline-flex items-center gap-1 font-semibold underline underline-offset-2 hover:no-underline"
      >
        See the brief <ArrowRight size={13} />
      </Link>
    </p>
  );
}
