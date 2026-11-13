import Link from "next/link";
import { notFound } from "next/navigation";
import dynamicImport from "next/dynamic";
import { ArrowLeft, ShieldAlert, ShieldCheck } from "lucide-react";
import type { BriefDetail } from "@/lib/api";
import { getBrief } from "@/lib/server/briefs-store";
import { trackingFor } from "@/lib/server/tracking";
import { movementRows, splitBrief } from "@/lib/brief";
import { BriefOverview } from "@/app/components/BriefOverview";
import { TrackingLine } from "@/app/components/TrackingLine";
import { Card } from "@/app/components/shelf";
import { StoreSection } from "@/app/components/StoreSection";

const BriefMarkdown = dynamicImport(() => import("@/app/components/BriefMarkdown").then((m) => m.BriefMarkdown));

export const dynamic = "force-dynamic";

const DEMO_STORE = "injection-demo.test";

export default async function BriefPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const brief = await getBrief(id);
  if (!brief) notFound();

  const competitors = brief.competitors.map((c) => c.competitor);
  // The prompt-injection demo store is never tracked, so it gets no follow-up line.
  const tracking = competitors.includes(DEMO_STORE) ? null : await trackingFor(competitors);
  const { byStore, rest } = splitBrief(brief.briefMarkdown);
  const rows = movementRows(brief);

  return (
    <main className="mx-auto w-full max-w-[1280px] flex-1 px-4 py-6 sm:px-8 sm:py-8">
      <Link href="/briefs" className="mb-4 inline-flex items-center gap-1.5 text-sm text-ink-2 hover:text-ink hover:underline">
        <ArrowLeft size={15} /> All briefs
      </Link>

      <BriefOverview
        brief={brief}
        linkToFull={false}
        asideFooter={tracking && <TrackingLine tracking={tracking} competitors={competitors} />}
      />

      <div className="mt-10 space-y-6">
        <h2 className="font-cond text-[26px] font-extrabold tracking-tight">Changes by store</h2>
        {!brief.diff && <p className="text-sm text-ink-3">This brief was saved before product-level changes were stored.</p>}
        {rows.map((r) => (
          <StoreSection
            key={r.competitor}
            brief={brief}
            row={r}
            // Baseline and unchecked stores have nothing to read beyond "none"; the card says why.
            notes={r.status === "verified" ? notesFor(byStore, r.competitor) : null}
          />
        ))}

        {rest && (
          <Card>
            <h2 className="font-cond text-[22px] font-extrabold tracking-tight">More from the analyst</h2>
            <div className="mt-2 max-w-[72ch]">
              <BriefMarkdown markdown={rest} />
            </div>
          </Card>
        )}

        <AuditPanel brief={brief} />
      </div>
    </main>
  );
}

/** The analyst writes "### store.com"; match loosely (case, "Store.com", "Store"). */
function notesFor(byStore: Map<string, string>, domain: string): string | null {
  const root = domain.split(".")[0];
  for (const [name, text] of byStore) if (name === domain || name.startsWith(root)) return text;
  return null;
}

function AuditPanel({ brief }: { brief: BriefDetail }) {
  const warnings = brief.safety.warnings ?? [];
  const checks = [
    { label: "Grounding", what: "The data matches the scraped catalogs", v: brief.grounding, ok: "All claims map to verified data" },
    { label: "Safety", what: "The written brief", v: brief.safety, ok: "No bias or policy violations" },
  ];
  return (
    <Card className="scroll-mt-20">
      <h2 id="audit" className="scroll-mt-20 font-cond text-[22px] font-extrabold tracking-tight">
        Enkrypt AI audit
      </h2>
      <dl className="mt-3 grid divide-y divide-[#eceef1] border-y border-[#eceef1] sm:grid-cols-2 sm:divide-x sm:divide-y-0">
        {checks.map((c) => (
          <div key={c.label} className="py-3.5 sm:px-5 sm:first:pl-0 sm:last:pr-0">
            <dt className="flex items-center justify-between gap-3">
              <span className="text-sm font-semibold">{c.label}</span>
              <span className={`inline-flex items-center gap-1 text-xs font-semibold ${c.v.greenLight ? "text-ok" : "text-warn"}`}>
                {c.v.greenLight ? <ShieldCheck size={14} /> : <ShieldAlert size={14} />}
                {c.v.greenLight ? "Pass" : "Fail"}
              </span>
            </dt>
            <dd className="mt-0.5 text-xs text-ink-3">{c.what}</dd>
            <dd className="mt-1.5 text-[13px] text-ink-2">{c.v.violations[0] ?? c.ok}</dd>
          </div>
        ))}
      </dl>
      {warnings.length > 0 && (
        <div className="mt-4">
          <p className="text-[13px] font-semibold">Advisory notes (don’t affect verification)</p>
          <ul className="mt-1.5 list-disc space-y-1 pl-4 text-[13px] text-ink-2">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}
      {brief.safety.method && <p className="mt-3 text-xs text-ink-3">Method: {brief.safety.method}</p>}
    </Card>
  );
}
