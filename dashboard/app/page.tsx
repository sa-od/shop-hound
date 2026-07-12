import Link from "next/link";
import { ChevronRight, CalendarDays, Users, Inbox } from "lucide-react";
import { getBriefs, getStatus, briefTotals, type BriefSummary } from "@/lib/api";
import { Header } from "./components/Header";
import { VerifiedBadge, StatChip } from "./components/ui";
import { RunAnalysis } from "./components/RunAnalysis";

export const dynamic = "force-dynamic";

function formatWeek(weekOf: string) {
  const [y, m, d] = weekOf.split("-").map(Number);
  if (!y) return weekOf;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

export default async function Home() {
  const [briefs, status] = await Promise.all([getBriefs(), getStatus()]);

  return (
    <>
      <Header status={status} />
      <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-8">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">Weekly Growth Briefs</h1>
            <p className="mt-1 text-sm text-zinc-400">
              AI-generated competitor analysis — every brief fact-checked and safety-audited by Enkrypt AI before delivery.
            </p>
          </div>
        </div>

        <div className="mb-6">
          <RunAnalysis lastCreatedAt={status.lastBrief?.createdAt ?? null} />
        </div>

        {briefs.length === 0 ? (
          <EmptyState />
        ) : (
          <ul className="space-y-4">
            {briefs.map((b) => (
              <BriefCard key={`${b.weekOf}-${b.briefId}`} brief={b} />
            ))}
          </ul>
        )}
      </main>
      <footer className="border-t border-zinc-800/80 px-5 py-6 text-center text-xs text-zinc-600">
        Mastra · Enkrypt AI · Qdrant · Featherless
      </footer>
    </>
  );
}

function BriefCard({ brief }: { brief: BriefSummary }) {
  const totals = briefTotals(brief);
  const unverified = brief.competitors.filter((c) => c.status === "unverified").length;
  return (
    <li>
      <Link
        href={`/briefs/${brief.weekOf}`}
        className="group block rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 transition hover:border-zinc-700 hover:bg-zinc-900"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-zinc-100">
              <CalendarDays size={16} className="text-zinc-500" />
              <span className="text-lg font-semibold">{formatWeek(brief.weekOf)}</span>
            </div>
            <div className="mt-1 flex items-center gap-3 text-xs text-zinc-500">
              <span className="inline-flex items-center gap-1">
                <Users size={13} /> {brief.competitors.length} competitor{brief.competitors.length !== 1 ? "s" : ""}
              </span>
              {unverified > 0 && <span className="text-amber-400/80">{unverified} unverified</span>}
            </div>
          </div>
          <VerifiedBadge green={brief.greenLight} />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {brief.competitors.map((c) => (
            <span
              key={c.competitor}
              className="inline-flex items-center rounded-md border border-zinc-800 bg-zinc-950/60 px-2 py-0.5 font-mono text-xs text-zinc-300"
            >
              {c.competitor}
            </span>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <StatChip kind="price" value={totals.priceChanges} />
          <StatChip kind="new" value={totals.newSkus} />
          <StatChip kind="title" value={totals.titleChanges} />
          <ChevronRight
            size={18}
            className="ml-auto text-zinc-600 transition group-hover:translate-x-0.5 group-hover:text-zinc-400"
          />
        </div>
      </Link>
    </li>
  );
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/30 px-6 py-16 text-center">
      <Inbox size={28} className="mx-auto text-zinc-600" />
      <p className="mt-3 text-sm text-zinc-400">No briefs yet.</p>
      <p className="mt-1 text-xs text-zinc-600">Run the competitive-intel workflow to generate this week&apos;s brief.</p>
    </div>
  );
}
