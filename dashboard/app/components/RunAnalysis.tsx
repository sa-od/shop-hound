"use client";

import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Play, Loader2, X, Plus } from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4111";

export function RunAnalysis({ lastCreatedAt }: { lastCreatedAt: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [domains, setDomains] = useState("voyageeyewear.com");
  const [phase, setPhase] = useState<"idle" | "running">("idle");
  const [note, setNote] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
  };

  const run = useCallback(async () => {
    const competitors = domains
      .split(",")
      .map((d) => d.trim())
      .filter(Boolean);
    if (competitors.length === 0) return;

    setPhase("running");
    setNote("Scraping catalogs & embedding… this takes ~2 minutes.");

    // Fire the workflow. It runs long (~2 min) and the HTTP call will likely
    // time out at the gateway — that's fine, the run continues server-side, so
    // we don't block the UI on this promise.
    fetch(`${API}/api/workflows/competitiveIntelWorkflow/start-async`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inputData: { competitors } }),
    }).catch(() => {});

    // Poll /status until a brief newer than the last one we knew about appears.
    const started = Date.now();
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${API}/status`, { cache: "no-store" });
        const s = await res.json();
        const newest: string | null = s?.lastBrief?.createdAt ?? null;
        if (newest && newest !== lastCreatedAt) {
          stopPolling();
          setPhase("idle");
          setOpen(false);
          setNote(null);
          router.refresh(); // pull the new brief into the list
        } else if (Date.now() - started > 6 * 60 * 1000) {
          stopPolling();
          setPhase("idle");
          setNote("Still running — refresh in a moment to see the result.");
        }
      } catch {
        /* transient — keep polling */
      }
    }, 5000);
  }, [domains, lastCreatedAt, router]);

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
          <button onClick={() => setOpen(false)} className="text-zinc-500 hover:text-zinc-300">
            <X size={16} />
          </button>
        )}
      </div>
      <label className="text-xs text-zinc-500">Competitor Shopify domains (comma-separated)</label>
      <div className="mt-1.5 flex flex-col gap-2 sm:flex-row">
        <input
          value={domains}
          onChange={(e) => setDomains(e.target.value)}
          disabled={phase === "running"}
          placeholder="voyageeyewear.com, another-store.com"
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
      {note && <p className="mt-2 text-xs text-zinc-400">{note}</p>}
      <p className="mt-2 text-[11px] text-zinc-600">
        Non-Shopify stores (e.g. Ray-Ban, Oakley) return &quot;Unverified&quot; — only /products.json stores scrape.
      </p>
    </div>
  );
}
