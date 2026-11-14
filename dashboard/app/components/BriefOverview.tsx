import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { BriefDetail } from "@/lib/api";
import { formatMoney, movementRows, priceTickets, splitBrief, type CatalogSummary } from "@/lib/brief";
import { LocalTime } from "./LocalTime";
import { MovementsTable } from "./MovementsTable";
import { Card, Rail, Ticket, TrustLine } from "./shelf";

const EMAIL = /([\w.+-]+@[\w-]+(?:\.[\w-]+)+)/;

/** Renders `**bold**` in the short summary and action lines, and email addresses as links; the rest is plain text. */
export function Inline({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
        part.startsWith("**") && part.endsWith("**") ? (
          <strong key={i} className="font-semibold text-ink">
            {part.slice(2, -2)}
          </strong>
        ) : (
          part
            .replace(/[*_`]/g, "")
            .split(EMAIL)
            .map((bit, j) =>
              j % 2 ? (
                <a key={`${i}-${j}`} href={`mailto:${bit}`} className="font-semibold text-ink underline underline-offset-2 hover:no-underline">
                  {bit}
                </a>
              ) : (
                bit
              ),
            )
        ),
      )}
    </>
  );
}

const TICKETS_SHOWN = 4;

/** "429 products captured from goodr.com, priced $12.00–$98.00 (median $35.00)." */
function baselineSentence(store: string, c: CatalogSummary) {
  const m = (n: number) => formatMoney(n, c.currency);
  return `${c.productCount.toLocaleString()} products captured from ${store}, priced ${m(c.price.min)}–${m(c.price.max)} (median ${m(c.price.median)}).`;
}

/**
 * The week at a glance: what changed (summary + biggest price tickets), what
 * to do, and who moved. Shared by "This week" and the top of a brief.
 */
export function BriefOverview({
  brief,
  linkToFull,
  asideFooter,
  contactEmail = null,
  headlineFooter,
  hideTrust = false,
}: {
  brief: BriefDetail;
  linkToFull: boolean;
  /** Extra quiet lines under the trust line (the brief page's tracking status). */
  asideFooter?: React.ReactNode;
  /** Where manual-read requests go; email addresses in the summary become links. */
  contactEmail?: string | null;
  /** Extra content at the bottom of the headline card (the manual-read action). */
  headlineFooter?: React.ReactNode;
  /** No store data at all: no audit to point to. */
  hideTrust?: boolean;
}) {
  const { summary, recommendations } = splitBrief(brief.briefMarkdown);
  const tickets = priceTickets(brief);
  const rows = movementRows(brief);
  const diffed = rows.filter((r) => r.status === "verified").length;
  const baseline = diffed === 0 && rows.some((r) => r.status === "first_snapshot");
  // Nothing could be read: no claims, no advice, no table. Each store card says why.
  const noneRead = rows.length > 0 && rows.every((r) => r.status === "unverified");
  const baselineRows = rows.filter((r) => r.status === "first_snapshot" && r.catalog);
  const baselineText =
    baselineRows.length === 1
      ? `Baseline week: ${baselineSentence(baselineRows[0].competitor, baselineRows[0].catalog!)} Price changes show from the next check.`
      : baselineRows.length > 1
        ? `Baseline week: ${baselineRows.reduce((n, r) => n + r.catalog!.productCount, 0).toLocaleString()} products captured across ${baselineRows.length} stores. Price changes show from the next check.`
        : "Baseline week: catalogs captured for the first time. Price changes show from the next check.";

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_380px] lg:grid-rows-[auto_1fr] lg:gap-x-7">
      {/* Mobile order: summary, what to do, movements. Desktop: actions in a right column. */}
      <div className="min-w-0 space-y-6 lg:col-start-1 lg:row-start-1">
        <Card>
          <h1 className="font-cond text-[32px] font-extrabold leading-[1.05] tracking-tight sm:text-[36px]">
            Week of <LocalTime iso={brief.createdAt} format="date" />
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
          ) : noneRead ? null : (
            <p className="mt-6 rounded-lg bg-shelf px-4 py-3.5 text-sm text-ink-2">
              {baseline
                ? baselineText
                : `No price changes from ${diffed} store${diffed === 1 ? "" : "s"} this week.`}
            </p>
          )}

          {headlineFooter}

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
        {recommendations.length > 0 && (
          <Card>
            <h2 className="font-cond text-xl font-bold">What to do</h2>
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
          </Card>
        )}
        <div className="space-y-2.5 px-1">
          {!hideTrust && <TrustLine brief={brief} />}
          {asideFooter}
        </div>
      </aside>

      {!noneRead && (
        <section className="min-w-0 lg:col-start-1 lg:row-start-2">
          <div className="mb-2.5 flex items-baseline justify-between gap-4">
            <h2 className="font-cond text-xl font-bold">Movements</h2>
            <span className="text-xs text-ink-3">
              {rows.length} store{rows.length === 1 ? "" : "s"} · sorted by size of change
            </span>
          </div>
          <MovementsTable rows={rows} briefId={brief.id} contactEmail={contactEmail} />
        </section>
      )}
    </div>
  );
}
