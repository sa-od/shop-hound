"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Play, Loader2, X, Plus } from "lucide-react";
import { isValidDomain } from "@/lib/utils";
import type { Status } from "@/lib/api";

const POLL_MS = 5_000;
// The run itself is capped at 300s by the platform; past this, stop waiting.
const GIVE_UP_MS = 7 * 60 * 1000;

export function RunAnalysis() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [domains, setDomains] = useState("goodr.com, magicspoon.com, deathwishcoffee.com");
  const [phase, setPhase] = useState<"idle" | "running">("idle");
  const [note, setNote] = useState<{ text: string; tone: "info" | "error" } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
  };
  useEffect(() => stopPolling, []);

  /** Follow one run by id until it finishes, then show its outcome. */
  const follow = useCallback(
    (runId: string) => {
      const started = Date.now();
      stopPolling();
      pollRef.current = setInterval(async () => {
        try {
          const res = await fetch("/api/status", { cache: "no-store" });
          if (!res.ok) return;
          const s: Status = await res.json();
          if (s.activeRun?.runId === runId) return; // still going
          if (s.lastRun?.runId === runId) {
            stopPolling();
            setPhase("idle");
            if (s.lastRun.status === "failed") {
              setNote({ text: `Run failed: ${s.lastRun.error ?? "unknown error"}`, tone: "error" });
            } else {
              setNote(null);
              setOpen(false);
            }
            router.refresh(); // the brief (or the failure state) is now on the server
            return;
          }
        } catch {
          /* transient — keep polling */
        }
        if (Date.now() - started > GIVE_UP_MS) {
          stopPolling();
          setPhase("idle");
          setNote({ text: "Lost track of the run — refresh in a moment to see the result.", tone: "info" });
        }
      }, POLL_MS);
    },
    [router],
  );

  const run = useCallback(async () => {
    const raw = domains
      .split(",")
      .map((d) => d.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/:\d+$/, ""))
      .filter(Boolean);
    if (raw.length === 0) return;

    const invalid = raw.filter((d) => d !== "injection-demo.test" && !isValidDomain(d));
    if (invalid.length > 0) {
      setNote({ text: `Invalid domain${invalid.length > 1 ? "s" : ""}: ${invalid.join(", ")}. Use formats like example.com.`, tone: "error" });
      return;
    }

    setPhase("running");
    setNote({ text: "Scraping catalogs, comparing, writing and auditing the brief… usually 1–2 minutes.", tone: "info" });
    try {
      const res = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ competitors: raw }),
      });
      const body = (await res.json().catch(() => ({}))) as { runId?: string; error?: string };
      if (!res.ok || !body.runId) {
        setPhase("idle");
        setNote({ text: body.error ?? `Could not start the run (HTTP ${res.status}).`, tone: "error" });
        return;
      }
      follow(body.runId);
    } catch (err) {
      setPhase("idle");
      setNote({ text: `Could not start the run: ${err instanceof Error ? err.message : err}`, tone: "error" });
    }
  }, [domains, follow]);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-sm font-medium text-emerald-300 transition hover:bg-emerald-500/20"
      >
        <Plus size={15} /> New analysis
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium text-zinc-200">Run a competitive analysis</span>
        {phase === "idle" && (
          <button onClick={() => setOpen(false)} className="text-zinc-500 hover:text-zinc-300" aria-label="Close">
            <X size={16} />
          </button>
        )}
      </div>
      <label htmlFor="competitor-domains" className="text-xs text-zinc-500">
        Competitor store domains (comma-separated, up to 6)
      </label>
      <div className="mt-1.5 flex flex-col gap-2 sm:flex-row">
        <input
          id="competitor-domains"
          value={domains}
          onChange={(e) => setDomains(e.target.value)}
          disabled={phase === "running"}
          placeholder="goodr.com, another-store.com"
          className="flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-100 outline-none focus:border-emerald-500/50 disabled:opacity-60"
        />
        <button
          onClick={run}
          disabled={phase === "running"}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {phase === "running" ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
          {phase === "running" ? "Running…" : "Run"}
        </button>
      </div>
      {note && <p className={`mt-2 text-xs ${note.tone === "error" ? "text-red-300" : "text-zinc-400"}`}>{note.text}</p>}
      <p className="mt-2 text-[11px] text-zinc-600">
        Shopify stores scrape instantly via /products.json. Non-Shopify stores fall back to Firecrawl AI
        extraction — slower and best-effort; a store that can&apos;t be read within the run&apos;s time budget is
        marked unverified rather than guessed at. Demo:{" "}
        <button
          type="button"
          onClick={() => setDomains("injection-demo.test")}
          className="font-mono text-zinc-400 underline decoration-dotted hover:text-zinc-200"
        >
          injection-demo.test
        </button>{" "}
        runs a store that hides a prompt-injection attack — watch the Enkrypt guardrail quarantine it.
      </p>
    </div>
  );
}
