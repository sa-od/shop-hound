import Link from "next/link";
import { AlertTriangle, ArrowRight } from "lucide-react";
import type { BriefDetail } from "@/lib/api";
import { movementRows, priceTickets, splitBrief } from "@/lib/brief";
import { formatWeek } from "@/lib/utils";
import { MovementsTable } from "./MovementsTable";
import { Card, Rail, Ticket, TrustLine } from "./shelf";

/** Renders `**bold**` in the short summary and action lines; the rest is plain text. */
export function Inline({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
        part.startsWith("**") && part.endsWith("**") ? (
          <strong key={i} className="font-semibold text-ink">
            {part.slice(2, -2)}
          </strong>
        ) : (
          part.replace(/[*_`]/g, "")
        ),
      )}
    </>
  );
}

const TICKETS_SHOWN = 4;

/**
 * The week at a glance: what changed (summary + biggest price tickets), what
 * to do, and who moved. Shared by "This week" and the top of a brief.
 */
export function BriefOverview({
  brief,
  linkToFull,
  asideFooter,
}: {
  brief: BriefDetail;
  linkToFull: boolean;
  /** Extra quiet lines under the trust line (the brief page's tracking status). */
  asideFooter?: React.ReactNode;
}) {
  const { summary, recommendations } = splitBrief(brief.briefMarkdown);
  const tickets = priceTickets(brief);
  const rows = movementRows(brief);
  const diffed = rows.filter((r) => r.status === "verified").length;
  const allBaseline = rows.length > 0 && rows.every((r) => r.status !== "verified");

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_380px] lg:grid-rows-[auto_1fr] lg:gap-x-7">
      {/* Mobile order: summary, what to do, movements. Desktop: actions in a right column. */}
      <div className="min-w-0 space-y-6 lg:col-start-1 lg:row-start-1">
        {!brief.greenLight && (
          <div role="status" className="flex gap-3 rounded-lg border border-[#f0c9a0] bg-warn-soft p-4 text-sm text-warn">
            <AlertTriangle size={18} className="mt-0.5 shrink-0" />
            <p>
              <strong className="font-semibold">This brief didn’t pass the Enkrypt audit.</strong>{" "}
              {brief.grounding.violations[0] ?? brief.safety.violations[0] ?? "Read it with care."}{" "}
              <Link href={`/briefs/${brief.id}#audit`} className="underline">
                See the audit
              </Link>
            </p>
          </div>
        )}

        <Card>
          <h1 className="font-cond text-[32px] font-extrabold leading-[1.05] tracking-tight sm:text-[36px]">
            Week of {formatWeek(brief.weekOf)}
          </h1>
          {summary ? (
            <p className="mt-3 max-w-[70ch] text-base leading-relaxed text-ink-2">
              <Inline text={summary} />
            </p>
          ) : (
            <p className="mt-3 text-base text-ink-3">This brief has no summary.</p>
          )}

          {tickets.length > 0 ? (
            <>
              <div className="mt-6 flex items-baseline justify-between gap-4">
                <h2 className="font-cond text-xl font-bold">Biggest price moves</h2>
                <span className="text-xs text-ink-3">
                  {Math.min(TICKETS_SHOWN, tickets.length)} of {tickets.length}
                </span>
              </div>
              <Rail>
                {tickets.slice(0, TICKETS_SHOWN).map((t) => (
                  <Ticket key={`${t.competitor}-${t.url}`} t={t} />
                ))}
              </Rail>
            </>
          ) : (
            <p className="mt-6 rounded-lg bg-shelf px-4 py-3.5 text-sm text-ink-2">
              {allBaseline
                ? "Baseline week: catalogs captured for the first time. Price changes show from the next check."
                : `No price changes from ${diffed} store${diffed === 1 ? "" : "s"} this week.`}
            </p>
          )}

          {linkToFull && (
            <Link
              href={`/briefs/${brief.id}`}
              className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold hover:underline"
            >
              Open the full brief and every product change <ArrowRight size={15} />
            </Link>
          )}
        </Card>
      </div>

      <aside className="space-y-4 lg:sticky lg:top-20 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-start">
        <Card>
          <h2 className="font-cond text-xl font-bold">What to do</h2>
          {recommendations.length > 0 ? (
            <ol className="mt-1">
              {recommendations.map((r, i) => (
                <li key={i} className="flex gap-3 border-b border-[#eceef1] py-3.5 text-sm leading-relaxed text-ink-2 last:border-0 last:pb-0">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-[3px] bg-sticker font-cond text-[15px] font-extrabold text-ink">
                    {i + 1}
                  </span>
                  <span>
                    <Inline text={r} />
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-2 text-sm text-ink-3">No recommendations in this brief.</p>
          )}
        </Card>
        <div className="space-y-2.5 px-1">
          <TrustLine brief={brief} />
          {asideFooter}
        </div>
      </aside>

      <section className="min-w-0 lg:col-start-1 lg:row-start-2">
          <div className="mb-2.5 flex items-baseline justify-between gap-4">
            <h2 className="font-cond text-xl font-bold">Movements</h2>
            <span className="text-xs text-ink-3">
              {rows.length} store{rows.length === 1 ? "" : "s"} · sorted by size of change
            </span>
          </div>
          <MovementsTable rows={rows} briefId={brief.id} />
      </section>
    </div>
  );
}
