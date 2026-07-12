import { ShieldCheck, ShieldAlert, TrendingDown, PlusCircle, PencilLine, CircleDot } from "lucide-react";
import type { CompetitorSummary } from "@/lib/api";

// ── Verified / Unverified trust badge (the hero trust signal) ──
export function VerifiedBadge({ green, size = "md" }: { green: boolean; size?: "sm" | "md" | "lg" }) {
  const pad = size === "lg" ? "px-3.5 py-1.5 text-sm" : size === "sm" ? "px-2 py-0.5 text-xs" : "px-3 py-1 text-xs";
  const icon = size === "lg" ? 18 : 14;
  return green ? (
    <span className={`inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 font-medium text-emerald-300 ${pad}`}>
      <ShieldCheck size={icon} className="text-emerald-400" />
      Verified by Enkrypt AI
    </span>
  ) : (
    <span className={`inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 font-medium text-amber-300 ${pad}`}>
      <ShieldAlert size={icon} className="text-amber-400" />
      Unverified
    </span>
  );
}

// ── A single stat chip (price changes / new SKUs / title changes) ──
export function StatChip({ kind, value }: { kind: "price" | "new" | "title"; value: number }) {
  const cfg = {
    price: { icon: TrendingDown, label: "price changes", color: "text-sky-300", ring: "border-sky-500/20 bg-sky-500/5" },
    new: { icon: PlusCircle, label: "new SKUs", color: "text-emerald-300", ring: "border-emerald-500/20 bg-emerald-500/5" },
    title: { icon: PencilLine, label: "title changes", color: "text-violet-300", ring: "border-violet-500/20 bg-violet-500/5" },
  }[kind];
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs ${cfg.ring}`}>
      <Icon size={14} className={cfg.color} />
      <span className="font-mono font-semibold text-zinc-100">{value}</span>
      <span className="text-zinc-400">{cfg.label}</span>
    </span>
  );
}

// ── Per-competitor status chip ──
export function CompetitorChip({ c }: { c: CompetitorSummary }) {
  const map: Record<string, { label: string; cls: string }> = {
    verified: { label: "Verified", cls: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" },
    first_snapshot: { label: "Baseline", cls: "border-sky-500/30 bg-sky-500/10 text-sky-300" },
    unverified: { label: "Unverified", cls: "border-amber-500/30 bg-amber-500/10 text-amber-300" },
  };
  const s = map[c.status] ?? { label: c.status, cls: "border-zinc-700 bg-zinc-800 text-zinc-300" };
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2">
      <div className="flex items-center gap-2 min-w-0">
        <CircleDot size={14} className="shrink-0 text-zinc-500" />
        <span className="truncate font-mono text-sm text-zinc-200">{c.competitor}</span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {c.status !== "unverified" && (
          <span className="font-mono text-xs text-zinc-500">{c.productCount.toLocaleString()} products</span>
        )}
        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${s.cls}`}>{s.label}</span>
      </div>
    </div>
  );
}
