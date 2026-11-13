"use client";

import { useState } from "react";
import { Loader2, Play } from "lucide-react";
import { checkDomains, MAX_STORES_PER_RUN, parseDomains, startRun } from "@/lib/run-client";

/** Start an analysis of up to 6 competitor stores. */
export function NewAnalysisForm({ autoFocus = false, onStarted }: { autoFocus?: boolean; onStarted?: () => void }) {
  const [value, setValue] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const domains = parseDomains(value);
    const problem = checkDomains(domains);
    if (problem) {
      setError(problem);
      return;
    }
    setPending(true);
    setError(null);
    const result = await startRun(domains);
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setValue("");
    onStarted?.();
  }

  return (
    <form onSubmit={submit} noValidate className="w-full">
      <label htmlFor="analysis-domains" className="text-sm font-semibold">
        Competitor stores to analyse
      </label>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <input
          id="analysis-domains"
          name="domains"
          type="text"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          autoFocus={autoFocus}
          disabled={pending}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="store-one.com, store-two.com"
          aria-invalid={error ? true : undefined}
          aria-describedby="analysis-help"
          className="h-10 w-full rounded-md border border-[#c4c8cf] bg-stock px-3 text-sm outline-none transition-colors duration-150 placeholder:text-ink-3 hover:border-ink-3 focus:border-ink disabled:cursor-not-allowed disabled:bg-shelf aria-[invalid]:border-cut sm:flex-1"
        />
        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-10 items-center justify-center gap-1.5 rounded-md bg-ink px-4 text-sm font-semibold text-white transition-colors duration-150 hover:bg-[#2a2c30] disabled:cursor-not-allowed disabled:bg-[#9a9da4]"
        >
          {pending ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
          {pending ? "Starting…" : "Analyse"}
        </button>
      </div>
      <p id="analysis-help" className={`mt-2 text-[13px] leading-relaxed ${error ? "text-cut" : "text-ink-3"}`} aria-live="polite">
        {error ??
          `Up to ${MAX_STORES_PER_RUN} stores, separated by commas. Takes about 1–2 minutes. Each set you analyse is re-checked automatically every week for 28 days.`}
      </p>
    </form>
  );
}
