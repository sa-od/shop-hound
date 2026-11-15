import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ChevronDown } from "lucide-react";
import { getBrief, listRuns, listStores } from "@/lib/server/briefs-store";
import { CONTACT_EMAIL } from "@/lib/server/contact";
import { movementRows } from "@/lib/brief";
import { Card, TrustLine } from "@/app/components/shelf";
import { LocalTime } from "@/app/components/LocalTime";
import { RunsTable } from "@/app/components/RunsTable";
import { StoreSection } from "@/app/components/StoreSection";
import { TrackingLine } from "@/app/components/TrackingLine";

export const dynamic = "force-dynamic";

/**
 * A competitor: what its latest check found, its catalogue, and every run.
 * Facts only; the per-run AI write-up stays on each run's own page.
 */
export default async function StorePage({ params }: { params: Promise<{ store: string }> }) {
  const key = decodeURIComponent((await params).store);
  const s = (await listStores()).find((x) => x.competitorKey === key);
  if (!s) notFound();
  const [brief, runs] = await Promise.all([getBrief(s.latestBriefId), s.runCount > 0 ? listRuns(key) : Promise.resolve([])]);
  if (!brief) notFound();

  const competitors = brief.competitors.map((c) => c.competitor);
  const rows = movementRows(brief);
  const latestRun = runs.find((r) => r.id === brief.id);
  const retryOn =
    s.tracking.tracked && s.tracking.firstReadPending
      ? new Date(Math.max(Date.parse(s.tracking.nextCheck ?? ""), Date.now()) || Date.now()).toISOString()
      : null;

  return (
    <main className="mx-auto w-full max-w-[1280px] flex-1 px-4 py-6 sm:px-8 sm:py-8">
      <Link href="/competitors" className="mb-3 inline-flex items-center gap-1.5 text-sm text-ink-2 hover:text-ink hover:underline">
        <ArrowLeft size={15} /> My competitors
      </Link>
      <h1 className="font-cond text-[32px] font-extrabold leading-tight tracking-tight [overflow-wrap:anywhere] sm:text-[36px]">{s.store}</h1>
      <p className="mt-1 text-[13px] text-ink-3">
        {latestRun ? (
          <>
            Read <LocalTime iso={latestRun.createdAt} />
          </>
        ) : (
          <>
            Last tried <LocalTime iso={s.latestAt} />
          </>
        )}
      </p>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <div className="min-w-0 space-y-6">
          {rows.map((r) => (
            <StoreSection
              key={r.competitor}
              brief={brief}
              row={r}
              notes={null}
              tracked={s.tracking.tracked}
              retryOn={retryOn}
              contactEmail={CONTACT_EMAIL}
              productDelta={latestRun?.productDelta}
              deltaSince={latestRun?.deltaSince}
              storePage
            />
          ))}

          {runs.length > 0 && (
            <section className="rounded-lg border border-edge bg-stock">
              <details className="group">
                <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-4 sm:px-6 [&::-webkit-details-marker]:hidden">
                  <ChevronDown size={16} className="transition-transform duration-150 group-open:rotate-180" />
                  <span className="whitespace-nowrap font-cond text-xl font-bold">
                    Runs <span className="text-ink-3">({runs.length})</span>
                  </span>
                  <span className="hidden text-xs text-ink-3 sm:inline">Every check of this store. Open one for its full brief.</span>
                </summary>
                <div className="border-t border-edge">
                  <RunsTable runs={runs} currentId={undefined} />
                </div>
              </details>
            </section>
          )}
        </div>

        <aside className="space-y-3 lg:sticky lg:top-20">
          <Card>
            <h2 className="font-cond text-xl font-bold">Watching</h2>
            <div className="mt-2 text-sm text-ink-2">
              {s.needsManualRead ? (
                <p>We can’t read this store automatically. Email us and we’ll read it by hand every week.</p>
              ) : (
                <TrackingLine
                  tracking={s.tracking}
                  competitors={competitors}
                  unreadable={brief.competitors.every((c) => c.status === "unverified")}
                />
              )}
            </div>
            {s.runCount > 0 && (
              <div className="mt-3 border-t border-[#eceef1] pt-3">
                <TrustLine brief={brief} />
              </div>
            )}
          </Card>
        </aside>
      </div>
    </main>
  );
}
