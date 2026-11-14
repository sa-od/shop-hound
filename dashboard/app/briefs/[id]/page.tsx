import Link from "next/link";
import { notFound } from "next/navigation";
import dynamicImport from "next/dynamic";
import { ArrowLeft, ShieldAlert, ShieldCheck } from "lucide-react";
import type { BriefDetail } from "@/lib/api";
import { getBrief } from "@/lib/server/briefs-store";
import { trackingFor } from "@/lib/server/tracking";
import { CONTACT_EMAIL } from "@/lib/server/contact";
import { movementRows, readableViolation, splitBrief } from "@/lib/brief";
import { BriefOverview } from "@/app/components/BriefOverview";
import { TrackingLine } from "@/app/components/TrackingLine";
import { Card } from "@/app/components/shelf";
import { StoreSection } from "@/app/components/StoreSection";
import { ManualReadLink, PlatformTag } from "@/app/components/ManualRead";
import { RunsTable } from "@/app/components/RunsTable";
import { LocalTime } from "@/app/components/LocalTime";
import { runsFor } from "../runs-data";

const BriefMarkdown = dynamicImport(() => import("@/app/components/BriefMarkdown").then((m) => m.BriefMarkdown));

export const dynamic = "force-dynamic";

const DEMO_STORE = "injection-demo.test";

export default async function BriefPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const brief = await getBrief(id);
  if (!brief) notFound();

  const competitors = brief.competitors.map((c) => c.competitor);
  // One store per brief now ([store]); older briefs list several. The prompt-injection demo store is never tracked.
  const tracking = competitors.includes(DEMO_STORE) ? null : await trackingFor(competitors);
  const { byStore, rest } = splitBrief(brief.briefMarkdown);
  const rows = movementRows(brief);
  // This store's readable runs, newest first; the page shows the opened run's data.
  const runs = await runsFor(competitors);
  const latestRun = runs[0] && runs[0].id !== brief.id && runs[0].createdAt > brief.createdAt ? runs[0] : null;
  // Stores we can't read automatically: retrying gives the same result, so no tracking line or "Add it again".
  const manualOnly = brief.competitors.length > 0 && brief.competitors.every((c) => c.needsManualRead);
  // Never read because the store refused us for now: it's retried daily, so say when.
  const retryOn =
    tracking?.tracked && tracking.firstReadPending
      ? new Date(Math.max(Date.parse(tracking.nextCheck ?? ""), Date.now()) || Date.now()).toISOString()
      : null;

  return (
    <main className="mx-auto w-full max-w-[1280px] flex-1 px-4 py-6 sm:px-8 sm:py-8">
      <Link href="/briefs" className="mb-4 inline-flex items-center gap-1.5 text-sm text-ink-2 hover:text-ink hover:underline">
        <ArrowLeft size={15} /> All briefs
      </Link>

      {latestRun && (
        <p role="status" className="mb-4 rounded-md border border-edge bg-stock px-4 py-2.5 text-sm text-ink-2">
          This is an earlier run.{" "}
          <Link href={`/briefs/${latestRun.id}`} className="font-semibold text-ink underline underline-offset-2 hover:no-underline">
            See the latest (<LocalTime iso={latestRun.createdAt} format="shortdate" />)
          </Link>
        </p>
      )}

      <BriefOverview
        brief={brief}
        lower={
          manualOnly ? null : (
            <section>
              <div className="mb-2.5 flex items-baseline justify-between gap-4">
                <h2 className="font-cond text-xl font-bold">
                  Runs <span className="text-ink-3">({runs.length})</span>
                </h2>
                <span className="text-xs text-ink-3">Every readable check of this store, newest first</span>
              </div>
              <div className="rounded-lg border border-edge bg-stock">
                <RunsTable runs={runs} currentId={brief.id} />
              </div>
            </section>
          )
        }
        linkToFull={false}
        contactEmail={CONTACT_EMAIL}
        hideTrust={manualOnly}
        headlineFooter={
          manualOnly && (
            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
              {brief.competitors.map((c) => (
                <span key={c.competitor} className="inline-flex flex-wrap items-center gap-3">
                  <PlatformTag name={c.manualRead?.platformName} />
                  <ManualReadLink mailto={c.manualRead?.email.mailto} gmail={c.manualRead?.email.gmail} email={CONTACT_EMAIL} store={c.competitor} />
                </span>
              ))}
            </div>
          )
        }
        asideFooter={
          tracking && !manualOnly && (
            <TrackingLine
              tracking={tracking}
              competitors={competitors}
              unreadable={brief.competitors.every((c) => c.status === "unverified")}
            />
          )
        }
      />

      {/* No store data at all: only the headline and the email action. */}
      {!manualOnly && (
        <div className="mt-10 space-y-6">
          <h2 className="font-cond text-[26px] font-extrabold tracking-tight">
            Store data <span className="text-ink-3">· <LocalTime iso={brief.createdAt} format="date" /></span>
          </h2>
          {!brief.diff && <p className="text-sm text-ink-3">This brief was saved before product-level changes were stored.</p>}
          {rows.map((r) => (
            <StoreSection
              key={r.competitor}
              brief={brief}
              row={r}
              // Baseline and unchecked stores have nothing to read beyond "none"; the card says why.
              notes={r.status === "verified" ? notesFor(byStore, r.competitor) : null}
              tracked={tracking?.tracked ?? null}
              retryOn={retryOn}
              contactEmail={CONTACT_EMAIL}
              productDelta={runs.find((x) => x.id === brief.id)?.productDelta}
              deltaSince={runs.find((x) => x.id === brief.id)?.deltaSince}
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
      )}
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
      {!brief.greenLight && (
        <p role="status" className="mt-2 text-sm font-semibold text-warn">
          This brief didn’t pass the Enkrypt audit. Read it with care.
        </p>
      )}
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
            <dd className="mt-1.5 text-[13px] text-ink-2">{readableViolation(c.v.violations[0]) ?? c.ok}</dd>
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
