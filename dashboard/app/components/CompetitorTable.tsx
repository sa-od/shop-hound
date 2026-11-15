"use client";

import Link from "next/link";
import { ChevronDown, Loader2 } from "lucide-react";
import type { QueueItem, RunSummary, Status, StoreSummary } from "@/lib/api";
import { calendarDay, manualReadHref, productCountText, storeHref } from "@/lib/brief";
import { useLiveStatus } from "@/lib/status-client";
import { RUN_STEPS, stepLabel, stepNumber } from "@/lib/run-steps";
import { LocalTime, RetryPhrase } from "./LocalTime";
import { Delta } from "./RunsTable";
import { StoreActions } from "./StoreActions";

type Row = { store: StoreSummary; runs: RunSummary[] };

const TAG = "inline-block whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold leading-none";

/** What the latest check found, in a few words; or what's happening to the store right now. */
function Latest({ s, run, live }: { s: StoreSummary; run?: RunSummary; live?: QueueItem }) {
  if (live?.status === "running")
    return (
      <span className="inline-flex items-start gap-1.5 text-ink-2">
        <Loader2 size={14} className="mt-0.5 shrink-0 animate-spin" />
        <span>
          Reading…{" "}
          {live.step && (
            <span className="text-ink-3">
              {stepLabel(live.step, live.baseline)} ({stepNumber(live.step)} of {RUN_STEPS.length})
            </span>
          )}
        </span>
      </span>
    );
  if (live?.status === "queued") return <span className="text-ink-2">Waiting to be read</span>;
  if (live?.status === "retrying")
    return (
      <span className="text-warn">
        Store asked us to wait, <RetryPhrase iso={live.retryAt} before="trying again" />
      </span>
    );
  if (s.needsManualRead) return <span className={`${TAG} bg-shelf text-ink-2`}>Can’t read automatically</span>;
  if (!run) return <span className={`${TAG} bg-warn-soft text-warn`}>Not read yet</span>;
  if (run.withheld) return <span className={`${TAG} bg-shelf text-ink-2`}>Withheld</span>;
  if (run.status === "first_snapshot") return <span className={`${TAG} bg-info-soft text-info`}>First read</span>;
  const parts = [
    run.priceChanges && `${run.priceChanges} price change${run.priceChanges === 1 ? "" : "s"}`,
    run.newSkus && `${run.newSkus} new`,
    run.removed && `${run.removed} removed`,
    run.titleChanges && `${run.titleChanges} renamed`,
  ].filter(Boolean);
  if (parts.length === 0) return <span className="text-ink-3">No change since {calendarDay(run.deltaSince)}</span>;
  return <span>{parts.join(" · ")}</span>;
}

/** Live state from the poller when it has the store, else what the server saw when the page loaded. */
function serverLive(s: StoreSummary): QueueItem | undefined {
  const base = { runId: `server-${s.competitorKey}`, store: s.store, position: 0, queuedAt: "" };
  if (s.reading) return { ...base, status: "running", step: s.reading.step ?? undefined };
  if (s.retrying) return { ...base, status: "retrying", retryAt: s.retrying.retryAt, reason: s.retrying.reason ?? undefined };
  if (s.queued) return { ...base, status: "queued" };
  return undefined;
}

/** Whether and how the store is watched: weekly, indefinitely, until paused or removed. */
function Watching({ s, contactEmail }: { s: StoreSummary; contactEmail: string | null }) {
  const t = s.tracking;
  if (s.watching === "paused")
    return (
      <>
        Paused
        <span className="block text-xs text-ink-3">Not checked until you resume</span>
      </>
    );
  if (s.needsManualRead)
    return contactEmail ? (
      <a href={manualReadHref(contactEmail, s.store)} className="font-semibold underline underline-offset-2 hover:no-underline">
        Email us to track it
      </a>
    ) : (
      <span className="text-ink-2">Email us to track it</span>
    );
  // Never read yet (refused us, or still waiting): it's tried again, not "weekly".
  const next = s.nextCheck ?? t.nextCheck;
  if (s.watching === "active" && (t.firstReadPending || s.runCount === 0))
    return (
      <>
        Trying again
        {next && (
          <span className="block text-xs text-ink-3">
            Next try <LocalTime iso={next} format="shortdate" />
          </span>
        )}
      </>
    );
  if (s.watching === "active")
    return (
      <>
        Weekly
        {next && (
          <span className="block text-xs text-ink-3">
            Next on or after <LocalTime iso={next} format="shortdate" />
          </span>
        )}
      </>
    );
  return <span className="text-ink-3">Not watched</span>;
}

function ReadLine({ run }: { run?: RunSummary }) {
  return run ? (
    <>
      Read <LocalTime iso={run.createdAt} />
    </>
  ) : (
    <>Not read yet</>
  );
}

/**
 * The watched stores, one row each. A store being read shows its progress in
 * its own row; one just added (no brief yet) gets a temporary row at the top.
 */
export function CompetitorTable({
  initial,
  watched,
  notWatching,
  contactEmail,
}: {
  initial: Status;
  watched: Row[];
  notWatching: Row[];
  contactEmail: string | null;
}) {
  const { queue } = useLiveStatus(initial);
  const liveFor = (store: string) => queue.find((q) => q.store === store);
  const liveOf = (s: StoreSummary) => liveFor(s.store) ?? serverLive(s);
  const known = new Set([...watched, ...notWatching].map((r) => r.store.store));
  const pending = queue.filter((q) => !known.has(q.store));
  // A store being read again moves into the main list while it runs.
  const rows = [...watched, ...notWatching.filter((r) => liveOf(r.store))];
  const rest = notWatching.filter((r) => !liveOf(r.store));

  if (rows.length === 0 && pending.length === 0)
    return (
      <p className="mt-6 max-w-2xl rounded-lg bg-stock px-4 py-3.5 text-sm text-ink-2 ring-1 ring-edge">
        You’re not watching any stores yet. Add one above: we read it now, then again every week.
      </p>
    );

  return (
    <>
      {/* Phones: one block per store. */}
      <ul className="mt-6 divide-y divide-[#eceef1] rounded-lg border border-edge bg-stock sm:hidden">
        {pending.map((q) => (
          <li key={q.runId} className="px-4 py-3">
            <div className="font-cond text-lg font-bold">{q.store}</div>
            <div className="mt-0.5 text-[13px]">
              <Latest s={{ store: q.store } as StoreSummary} live={q} />
            </div>
          </li>
        ))}
        {rows.map(({ store: s, runs }) => (
          <li key={s.competitorKey} className="px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <Link href={storeHref(s.competitorKey)} className="font-cond text-lg font-bold hover:underline">
                {s.store}
              </Link>
              {s.watching !== "ended" && <StoreActions competitorKey={s.competitorKey} store={s.store} watching={s.watching} />}
            </div>
            <div className="mt-0.5 text-[13px]">
              <Latest s={s} run={runs[0]} live={liveOf(s)} />
            </div>
            <div className="mt-1 text-xs text-ink-3">
              {s.productCount !== null && (
                <>
                  {productCountText(s.productCount, s.complete)} products
                  <Delta d={s.productDelta} since={s.deltaSince} /> ·{" "}
                </>
              )}
              <Watching s={s} contactEmail={contactEmail} />
            </div>
          </li>
        ))}
      </ul>

      <div className="mt-6 hidden overflow-x-auto rounded-lg border border-edge bg-stock sm:block">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-edge text-[11px] uppercase tracking-[0.04em] text-ink-3">
              <th scope="col" className="px-4 py-2.5 text-left font-semibold">Store</th>
              <th scope="col" className="w-32 px-4 py-2.5 text-right font-semibold">Products</th>
              <th scope="col" className="px-4 py-2.5 text-left font-semibold">Latest check</th>
              <th scope="col" className="w-64 px-4 py-2.5 text-left font-semibold">Watching</th>
              <th scope="col" className="w-14 px-4 py-2.5"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {pending.map((q) => (
              <tr key={q.runId} className="border-b border-[#eceef1]">
                <td className="px-4 py-3 align-top">
                  <span className="font-cond text-lg font-bold">{q.store}</span>
                  <div className="text-xs text-ink-3">Just added</div>
                </td>
                <td className="px-4 py-3 text-right align-top text-ink-3">—</td>
                <td className="px-4 py-3 align-top">
                  <Latest s={{ store: q.store } as StoreSummary} live={q} />
                </td>
                <td className="px-4 py-3 align-top text-ink-3">Weekly once read</td>
                <td />
              </tr>
            ))}
            {rows.map(({ store: s, runs }) => (
              <tr key={s.competitorKey} className="border-b border-[#eceef1] last:border-0 hover:bg-[#fafafb]">
                <td className="px-4 py-3 align-top">
                  <Link href={storeHref(s.competitorKey)} className="font-cond text-lg font-bold hover:underline">
                    {s.store}
                  </Link>
                  <div className="text-xs text-ink-3">
                    <ReadLine run={runs[0]} />
                  </div>
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right align-top tabular-nums">
                  {s.productCount === null ? (
                    <span className="text-ink-3">—</span>
                  ) : (
                    <>
                      {productCountText(s.productCount, s.complete)}
                      <Delta d={s.productDelta} since={s.deltaSince} />
                    </>
                  )}
                </td>
                <td className="px-4 py-3 align-top">
                  <Latest s={s} run={runs[0]} live={liveOf(s)} />
                </td>
                <td className="px-4 py-3 align-top text-ink-2">
                  <Watching s={s} contactEmail={contactEmail} />
                </td>
                <td className="px-4 py-2.5 text-right align-top">
                  {s.watching !== "ended" && <StoreActions competitorKey={s.competitorKey} store={s.store} watching={s.watching} />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {rest.length > 0 && (
        <details className="group mt-4">
          <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 text-[13px] font-semibold text-ink-2 hover:text-ink [&::-webkit-details-marker]:hidden">
            <ChevronDown size={14} className="transition-transform duration-150 group-open:rotate-180" />
            Not watching ({rest.length})
          </summary>
          <ul className="mt-2 max-w-2xl divide-y divide-[#eceef1] rounded-lg border border-edge bg-stock">
            {rest.map(({ store: s, runs }) => (
              <li key={s.competitorKey} className="flex items-baseline justify-between gap-4 px-4 py-2.5 text-sm">
                <Link href={storeHref(s.competitorKey)} className="min-w-0 truncate font-medium hover:underline">
                  {s.store}
                </Link>
                <span className="shrink-0 text-xs text-ink-3">
                  {runs.length ? "Not watched" : "Couldn’t be read"}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-ink-3">Add a store again to start watching it.</p>
        </details>
      )}
    </>
  );
}
