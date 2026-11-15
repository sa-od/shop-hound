import { ChevronDown } from "lucide-react";
import dynamicImport from "next/dynamic";
import type { BriefDetail } from "@/lib/api";
import { diffFor, formatPct, formatMoney, isPartialRead, productCountText, sourceLabel, priceTickets, slug, type MovementRow, calendarDay } from "@/lib/brief";
import { CatalogSnapshot } from "./CatalogSnapshot";
import { LastRead } from "./LastRead";
import { LocalTime } from "./LocalTime";
import { ManualReadLink, PlatformTag } from "./ManualRead";
import { Card, ChangeRow, Rail, StatusTag, Ticket } from "./shelf";

const BriefMarkdown = dynamicImport(() => import("./BriefMarkdown").then((m) => m.BriefMarkdown));

const TICKETS_INLINE = 8;
const ROWS_INLINE = 8;

function Capped<T>({ items, render, noun }: { items: T[]; render: (item: T) => React.ReactNode; noun: string }) {
  return (
    <>
      <ul className="mt-1 max-w-[640px]">{items.slice(0, ROWS_INLINE).map(render)}</ul>
      {items.length > ROWS_INLINE && (
        <details className="max-w-[640px] text-sm">
          <summary className="mt-1 cursor-pointer py-1 font-semibold hover:underline">
            Show all {items.length} {noun}
          </summary>
          <ul>{items.slice(ROWS_INLINE).map(render)}</ul>
        </details>
      )}
    </>
  );
}

/**
 * `tracked`: whether the daily job will re-check this store (null when unknown).
 * `retryOn`: set when it was never read because it refused us for now; when it's tried again (ISO instant).
 */
export function StoreSection({
  brief,
  row,
  notes,
  tracked = null,
  retryOn = null,
  contactEmail = null,
  productDelta,
  deltaSince,
  storePage = false,
}: {
  brief: BriefDetail;
  row: MovementRow;
  notes: string | null;
  tracked?: boolean | null;
  retryOn?: string | null;
  /** Where manual-read requests go (from the server's config). */
  contactEmail?: string | null;
  /** This run's change in product count, from the run history. */
  productDelta?: number;
  /** The date (YYYY-MM-DD) of the read that productDelta is measured against. */
  deltaSince?: string;
  /** On the store's own page: no repeated name, changes first, the catalogue folded below them. */
  storePage?: boolean;
}) {
  const d = diffFor(brief, row.competitor);
  // The catalogue's currency when we have it; plain figures otherwise (the diff carries none).
  const money = (n: number) => formatMoney(n, row.catalog?.currency);
  const tickets = priceTickets(brief)
    .filter((t) => t.competitor === row.competitor)
    .map((t) => ({ ...t, currency: row.catalog?.currency }));

  return (
    <Card className="scroll-mt-20">
      <div id={slug(row.competitor)} className="flex scroll-mt-20 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {storePage ? (
            <h2 className="font-cond text-[22px] font-bold leading-tight">
              {row.status === "verified" && d ? `Since ${calendarDay(d.previousSnapshotDate)}` : "Latest check"}
            </h2>
          ) : (
            <h3 className="font-cond text-[22px] font-bold leading-tight">{row.competitor}</h3>
          )}
          <p className="text-xs text-ink-3">
            {row.needsManualRead
              ? "No product catalogue we can read"
              : row.status === "unverified"
              ? row.reason ?? "Couldn’t be checked this time"
              : (
                  <>
                    {productCountText(row.catalog?.productCount ?? row.productCount, row.complete)} products · {sourceLabel(row.source)}
                    {d?.previousSnapshotDate && (
                      <>
                        {" "}· compared with <LocalTime iso={d.previousSnapshotDate} format="calendar" />
                        {typeof d.daysSincePrevious === "number" && d.daysSincePrevious < 7 && (
                          <> ({d.daysSincePrevious} day{d.daysSincePrevious === 1 ? "" : "s"} earlier)</>
                        )}
                      </>
                    )}
                  </>
                )}
          </p>
        </div>
        <StatusTag status={row.needsManualRead ? "manual" : row.status} />
      </div>

      {row.status !== "unverified" && isPartialRead(row.source) && (
        <p className="mt-3 rounded-md bg-warn-soft px-3 py-2 text-[13px] text-warn">
          Lower confidence: this store isn’t read from its own catalog, so we read its web pages instead. Some products may be missing and a price
          may be misread.
        </p>
      )}

      <div className={notes ? "mt-2 grid gap-x-8 lg:grid-cols-[minmax(0,1fr)_340px]" : "mt-2"}>
        <div className="min-w-0">
          {row.status === "first_snapshot" &&
            (row.catalog ? (
              <>
                <p className="mt-3 text-sm text-ink-2">First check: here’s their catalog today. Changes show from the next check.</p>
                <CatalogSnapshot catalog={row.catalog} partial={isPartialRead(row.source)} complete={row.complete} />
              </>
            ) : (
              <p className="mt-3 text-sm text-ink-2">First check for this store: its catalog is saved as the baseline. Changes show from the next check.</p>
            ))}
          {row.needsManualRead && (
            <div className="mt-3 text-sm text-ink-2">
              <PlatformTag name={row.manualRead?.platformName} className="mb-2" />
              <p>
                {row.manualRead?.message ??
                  "We can’t read this store automatically, but we can still track it: email us and we’ll read it by hand, send you the analysis, and keep tracking it every week like your other stores."}
              </p>
              <ManualReadLink mailto={row.manualRead?.email.mailto} gmail={row.manualRead?.email.gmail} email={contactEmail} store={row.competitor} className="mt-2" />
            </div>
          )}
          {row.status === "unverified" && !row.needsManualRead && (
            <p className="mt-3 text-sm text-ink-2">
              Nothing from this store is in the brief.
              {row.lastKnown && (
                <>
                  {" "}
                  <LastRead l={row.lastKnown} />.
                </>
              )}
              {retryOn
                ? <>{" "}We’ll try again on or after <LocalTime iso={retryOn} format="date" />.</>
                : tracked === true
                  ? " It’s tried again at the next check."
                  : tracked === false
                    ? " Add it again to retry."
                    : ""}
            </p>
          )}

          {d && row.status === "verified" && (
            <>
              {/* The store's catalog as read on this run, then what changed since the run before. */}
              {row.catalog && !storePage && (
                <>
                  <h4 className="mt-4 font-cond text-lg font-bold">Catalog</h4>
                  <CatalogSnapshot
                    catalog={row.catalog}
                    partial={isPartialRead(row.source)}
                    complete={row.complete}
                    delta={productDelta}
                    deltaSince={deltaSince}
                  />
                  <h4 className="mt-7 font-cond text-lg font-bold">Changes since {calendarDay(d.previousSnapshotDate)}</h4>
                </>
              )}
              {row.total === 0 && <p className="mt-3 text-sm text-ink-2">No changes since {calendarDay(d.previousSnapshotDate)}.</p>}

              {tickets.length > 0 && (
                <Block title="Price changes" count={tickets.length}>
                  <Rail>
                    {tickets.slice(0, TICKETS_INLINE).map((t) => (
                      <Ticket key={t.url} t={t} showStore={false} />
                    ))}
                  </Rail>
                  {tickets.length > TICKETS_INLINE && (
                    <Capped
                      items={tickets.slice(TICKETS_INLINE)}
                      noun="more price changes"
                      render={(t) => (
                        <ChangeRow
                          key={t.url}
                          title={t.title}
                          href={t.url}
                          detail={<>was <span className="line-through">{money(t.oldPrice)}</span></>}
                          value={`${money(t.newPrice)} · ${formatPct(t.changePct)}`}
                          valueClass={t.changePct < 0 ? "text-cut" : ""}
                        />
                      )}
                    />
                  )}
                </Block>
              )}

              {d.newSkus.length > 0 && (
                <Block title="New products" count={d.newSkus.length}>
                  <Capped
                    items={d.newSkus}
                    noun="new products"
                    render={(p) => (
                      <ChangeRow
                        key={p.productId}
                        title={p.title}
                        href={p.url}
                        detail={p.closestExisting ? `Sits next to ${p.closestExisting.title} (${money(p.closestExisting.price)})` : undefined}
                        value={money(p.price)}
                      />
                    )}
                  />
                </Block>
              )}

              {d.removedSkus.length > 0 && (
                <Block title="Removed products" count={d.removedSkus.length}>
                  <Capped
                    items={d.removedSkus}
                    noun="removed products"
                    render={(p) => (
                      <ChangeRow
                        key={p.productId}
                        title={p.title}
                        value={
                          <>
                            <span className="font-normal text-ink-3">last price </span>
                            {money(p.price)}
                          </>
                        }
                      />
                    )}
                  />
                </Block>
              )}

              {d.titleChanges.length > 0 && (
                <Block title="Renamed products" count={d.titleChanges.length}>
                  <Capped
                    items={d.titleChanges}
                    noun="renamed products"
                    render={(p) => <ChangeRow key={p.productId} title={p.newTitle} href={p.url} detail={`Was “${p.oldTitle}”`} />}
                  />
                </Block>
              )}

              {row.catalog && storePage && (
                <details className="group mt-6 border-t border-[#eceef1] pt-4">
                  <summary className="inline-flex cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden">
                    <ChevronDown size={16} className="transition-transform duration-150 group-open:rotate-180" />
                    <span className="whitespace-nowrap font-cond text-lg font-bold">Catalogue today</span>
                    <span className="hidden text-xs text-ink-3 sm:inline">
                      {productCountText(row.catalog.productCount, row.complete)} products · price range, stock, types
                    </span>
                  </summary>
                  <CatalogSnapshot
                    catalog={row.catalog}
                    partial={isPartialRead(row.source)}
                    complete={row.complete}
                    delta={productDelta}
                    deltaSince={deltaSince}
                  />
                </details>
              )}
            </>
          )}
        </div>

        {notes && (
          <aside className="mt-5 border-t border-[#eceef1] pt-4 lg:mt-3 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
            <h4 className="text-sm font-semibold">The analyst’s read</h4>
            <div className="mt-1 text-[13px]">
              <BriefMarkdown markdown={notes} compact />
            </div>
          </aside>
        )}
      </div>
    </Card>
  );
}

function Block({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <div className="mt-5">
      <h4 className="text-sm font-semibold">
        {title} <span className="font-normal text-ink-3">· {count}</span>
      </h4>
      {children}
    </div>
  );
}

