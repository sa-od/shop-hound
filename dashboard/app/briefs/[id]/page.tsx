import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ShieldCheck, ShieldAlert, FileCheck2, Fingerprint } from "lucide-react";
import { getBrief, briefTotals } from "@/lib/api";
import { VerifiedBadge, StatChip, CompetitorChip } from "@/app/components/ui";
import { BriefMarkdown } from "@/app/components/BriefMarkdown";

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

export default async function BriefPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const brief = await getBrief(id);
  if (!brief) notFound();

  const totals = briefTotals(brief);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-8">
      <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-zinc-400 transition hover:text-zinc-200">
        <ArrowLeft size={15} /> All briefs
      </Link>

      <div className="mt-5 flex items-start justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">
          Growth Brief — {formatWeek(brief.weekOf)}
        </h1>
        <VerifiedBadge green={brief.greenLight} size="lg" />
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <StatChip kind="price" value={totals.priceChanges} />
        <StatChip kind="new" value={totals.newSkus} />
        <StatChip kind="title" value={totals.titleChanges} />
      </div>

      {/* Audit panel — the Enkrypt trust story */}
      <AuditPanel brief={brief} />

      {/* Per-competitor status */}
      <section className="mt-6">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Competitors</h2>
        <div className="space-y-2">
          {brief.competitors.map((c) => (
            <CompetitorChip key={c.competitor} c={c} />
          ))}
        </div>
      </section>

      {/* The brief */}
      <section className="mt-8 rounded-xl border border-zinc-800 bg-zinc-900/40 p-6">
        <BriefMarkdown markdown={brief.briefMarkdown} />
      </section>
    </main>
  );
}

function AuditPanel({ brief }: { brief: Awaited<ReturnType<typeof getBrief>> }) {
  if (!brief) return null;
  return (
    <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
        <Fingerprint size={14} /> Enkrypt AI Audit Trail
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <AuditRow
          icon={<FileCheck2 size={16} />}
          label="Grounding (input)"
          pass={brief.grounding.greenLight}
          detail={brief.grounding.violations.length ? brief.grounding.violations[0] : "All claims map to verified data"}
        />
        <AuditRow
          icon={<ShieldCheck size={16} />}
          label="Safety (output)"
          pass={brief.safety.greenLight}
          detail={brief.safety.violations.length ? brief.safety.violations[0] : "No bias / policy violations"}
        />
      </div>
      {brief.safety.method && (
        <p className="mt-3 border-t border-zinc-800 pt-3 text-[11px] text-zinc-600">Method: {brief.safety.method}</p>
      )}
    </section>
  );
}

function AuditRow({ icon, label, pass, detail }: { icon: React.ReactNode; label: string; pass: boolean; detail: string }) {
  return (
    <div className={`rounded-lg border p-3 ${pass ? "border-emerald-500/20 bg-emerald-500/5" : "border-amber-500/20 bg-amber-500/5"}`}>
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-sm text-zinc-200">
          <span className={pass ? "text-emerald-400" : "text-amber-400"}>{icon}</span>
          {label}
        </span>
        <span className={`inline-flex items-center gap-1 text-xs font-semibold ${pass ? "text-emerald-300" : "text-amber-300"}`}>
          {pass ? <ShieldCheck size={13} /> : <ShieldAlert size={13} />}
          {pass ? "PASS" : "FAIL"}
        </span>
      </div>
      <p className="mt-1.5 text-xs text-zinc-500">{detail}</p>
    </div>
  );
}
