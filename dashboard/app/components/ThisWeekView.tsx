import Link from "next/link";
import { MessageSquare, ShieldCheck } from "lucide-react";
import type { Change, ChangeKind, ChangeProduct } from "@/lib/api";
import { calendarDay, formatMoney, storeHref, type PriceTicket } from "@/lib/brief";
import { Card, Rail, Ticket } from "./shelf";

/**
 * The week across every watched competitor. Fact lines come from the backend's
 * templates (never written here, never by the AI); the only AI text is a
 * suggestion, shown in its own dashed box when present.
 */

/** INTERIM: the getThisWeek() shape agreed with backend; replaced by its type from lib/api when it lands. */
export interface ThisWeekData {
  window: { from: string; to: string };
  stores: { watched: number; read: number; unread: { store: string; reason: string }[] };
  changes: Change[];
  firstReads: { store: string; productCount: number; nextCheck: string | null }[];
}

/** Store-level status for the side list. */
export interface WatchedStore {
  store: string;
  competitorKey: string;
}

const TOP = 3;
// Phase 1: no sales or sold-out data yet; those groups stay hidden even if a change slips through.
const HIDDEN: ChangeKind[] = ["sale", "sold_out"];

function Evidence({ c }: { c: Change }) {
  return (
    <Link href={storeHref(c.store)} className="whitespace-nowrap text-[13px] text-ink-2 underline underline-offset-2 hover:text-ink">
      Evidence
    </Link>
  );
}

function StoreLabel({ store }: { store: string }) {
  return (
    <Link href={storeHref(store)} className="text-[11.5px] font-semibold uppercase tracking-[0.02em] text-ink-3 hover:text-ink hover:underline">
      {store}
    </Link>
  );
}

/** Advice, not data: dashed, labelled, and only ever the AI's. */
function Suggestion({ text }: { text: string }) {
  return (
    <div className="mt-2.5 flex gap-2.5 rounded-md border border-dashed border-[#b8bcc4] px-3 py-2.5 text-[13.5px] leading-relaxed text-ink-2">
      <MessageSquare size={15} className="mt-0.5 shrink-0 text-ink-3" aria-hidden />
      <p>
        <span className="block text-[11px] font-semibold text-ink-3">Suggestion · AI</span>
        {text}
      </p>
    </div>
  );
}

function TopMove({ c, n }: { c: Change; n: number }) {
  return (
    <li className="grid grid-cols-[24px_minmax(0,1fr)] gap-x-3.5 border-t border-[#eceef1] py-4 first:border-t-0 first:pt-1">
      <span className="grid h-6 w-6 place-items-center rounded-[3px] bg-ink font-cond text-[15px] font-extrabold text-white">{n}</span>
      <div className="min-w-0">
        <StoreLabel store={c.store} />
        <p className="text-[15px] leading-snug">
          {c.fact} <Evidence c={c} />
        </p>
        {c.suggestion && <Suggestion text={c.suggestion.text} />}
      </div>
    </li>
  );
}

function Group({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <Card>
      <h2 className="mb-2.5 font-cond text-xl font-bold">
        {title} <span className="text-ink-3">{count}</span>
      </h2>
      {children}
    </Card>
  );
}

function Row({ p, store, detail, value }: { p: ChangeProduct; store: string; detail?: React.ReactNode; value?: React.ReactNode }) {
  return (
    <li className="flex justify-between gap-4 border-t border-[#eceef1] py-2.5 text-sm first:border-t-0">
      <div className="min-w-0">
        <a href={p.url} target="_blank" rel="noopener noreferrer" className="font-medium hover:underline">
          {p.title}
        </a>
        <div className="text-xs text-ink-3">
          {store}
          {detail && <> · {detail}</>}
        </div>
      </div>
      {value !== undefined && <div className="whitespace-nowrap text-right font-semibold tabular-nums">{value}</div>}
    </li>
  );
}

const rowsOf = (changes: Change[]) => changes.flatMap((c) => c.products.map((p) => ({ c, p })));

export function ThisWeekView({ data, watched }: { data: ThisWeekData; watched: WatchedStore[] }) {
  const changes = [...data.changes].filter((c) => !HIDDEN.includes(c.kind)).sort((a, b) => a.rank - b.rank);
  const top = changes.slice(0, TOP);
  const of = (...kinds: ChangeKind[]) => changes.filter((c) => kinds.includes(c.kind));

  const tickets: PriceTicket[] = rowsOf(of("price_cut", "price_rise"))
    .filter(({ p }) => p.oldPrice !== undefined && p.newPrice !== undefined && p.pct !== undefined)
    .map(({ c, p }) => ({ competitor: c.store, title: p.title, url: p.url, oldPrice: p.oldPrice!, newPrice: p.newPrice!, changePct: p.pct! }))
    .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));
  const added = rowsOf(of("new"));
  const removed = rowsOf(of("removed"));
  const renamed = rowsOf(of("renamed"));

  const perStore = new Map<string, number>();
  for (const c of changes) perStore.set(c.store, (perStore.get(c.store) ?? 0) + Math.max(1, c.figures.count ?? c.products.length));
  const firstRead = new Set(data.firstReads.map((f) => f.store));
  const unread = new Map(data.stores.unread.map((u) => [u.store, u.reason]));
  const nextAfter = data.firstReads.map((f) => f.nextCheck).filter((d): d is string => !!d).sort()[0];

  return (
    <>
      <h1 className="font-cond text-[32px] font-extrabold leading-tight tracking-tight sm:text-[36px]">This week</h1>
      <p className="mt-1 text-[13px] text-ink-3">
        {calendarDay(data.window.from)} – {calendarDay(data.window.to)} · {data.stores.watched} competitor{data.stores.watched === 1 ? "" : "s"} watched ·{" "}
        {data.stores.read} read
        {data.stores.unread.length > 0 && (
          <>
            {" "}·{" "}
            <Link href="/competitors" className="underline underline-offset-2 hover:text-ink">
              {data.stores.unread.length} couldn’t be read
            </Link>
          </>
        )}
      </p>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <div className="min-w-0 space-y-5">
          {changes.length === 0 ? (
            <p className="rounded-lg bg-stock px-4 py-3.5 text-sm text-ink-2 ring-1 ring-edge">
              {data.firstReads.length > 0 && data.firstReads.length >= data.stores.read
                ? `We’ve saved a first read of ${data.firstReads.length === 1 ? "your competitor" : `all ${data.firstReads.length} stores`}. Changes show here after the next check${nextAfter ? `, on or after ${calendarDay(nextAfter)}` : ""}.`
                : `No changes from your ${data.stores.watched} competitor${data.stores.watched === 1 ? "" : "s"} since ${calendarDay(data.window.from)}.`}
            </p>
          ) : (
            <Card>
              <div className="mb-2 flex items-baseline justify-between gap-3">
                <h2 className="font-cond text-xl font-bold">Act on these</h2>
                <span className="text-xs text-ink-3">Ranked by size of change</span>
              </div>
              <ol>
                {top.map((c, i) => (
                  <TopMove key={c.id} c={c} n={i + 1} />
                ))}
              </ol>
            </Card>
          )}

          {tickets.length > 0 && (
            <Group title="Price moves" count={tickets.length}>
              <Rail>
                {tickets.map((t) => (
                  <Ticket key={`${t.competitor}-${t.url}`} t={t} />
                ))}
              </Rail>
            </Group>
          )}
          {added.length > 0 && (
            <Group title="New products" count={added.length}>
              <ul>
                {added.map(({ c, p }) => (
                  <Row
                    key={`${c.id}-${p.url}`}
                    p={p}
                    store={c.store}
                    detail={p.closest ? `next to ${p.closest.title} (${formatMoney(p.closest.price, c.currency)})` : undefined}
                    value={p.newPrice !== undefined ? formatMoney(p.newPrice, c.currency) : undefined}
                  />
                ))}
              </ul>
            </Group>
          )}
          {removed.length > 0 && (
            <Group title="Removed" count={removed.length}>
              <ul>
                {removed.map(({ c, p }) => (
                  <Row key={`${c.id}-${p.url}`} p={p} store={c.store} detail="last price" value={p.oldPrice !== undefined ? formatMoney(p.oldPrice, c.currency) : undefined} />
                ))}
              </ul>
            </Group>
          )}
          {renamed.length > 0 && (
            <Group title="Renamed" count={renamed.length}>
              <ul>
                {renamed.map(({ c, p }) => (
                  <Row key={`${c.id}-${p.url}`} p={p} store={c.store} detail={p.oldTitle ? `was “${p.oldTitle}”` : undefined} />
                ))}
              </ul>
            </Group>
          )}

          {changes.length > 0 && data.firstReads.length > 0 && (
            <p className="rounded-lg bg-stock px-4 py-3 text-[13px] text-ink-2 ring-1 ring-edge">
              First reads this week: {data.firstReads.map((f) => f.store).join(", ")}. Their catalogues are saved; changes show after the next check
              {nextAfter ? `, on or after ${calendarDay(nextAfter)}` : ""}.
            </p>
          )}
        </div>

        <aside className="lg:sticky lg:top-20">
          <Card>
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="font-cond text-xl font-bold">Competitors</h2>
              <Link href="/competitors" className="text-[13px] text-ink-2 underline underline-offset-2 hover:text-ink">
                Manage
              </Link>
            </div>
            <ul className="mt-2">
              {watched.map((w) => {
                const n = perStore.get(w.store);
                return (
                  <li key={w.competitorKey} className="flex items-baseline justify-between gap-3 border-t border-[#eceef1] py-2 text-[13.5px] first:border-t-0">
                    <Link href={storeHref(w.competitorKey)} className="min-w-0 truncate hover:underline">
                      {w.store}
                    </Link>
                    <span className="shrink-0 text-xs text-ink-3">
                      {unread.has(w.store) ? (
                        <span className="text-warn">Not read</span>
                      ) : n ? (
                        `${n} change${n === 1 ? "" : "s"}`
                      ) : firstRead.has(w.store) ? (
                        "First read"
                      ) : (
                        "No change"
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
            <p className="mt-3 flex gap-2 border-t border-[#eceef1] pt-3 text-xs leading-relaxed text-ink-2">
              <ShieldCheck size={14} className="mt-px shrink-0 text-ok" aria-hidden />
              <span>
                Facts come from comparing each catalogue with its read about a week earlier.
                {changes.some((c) => c.suggestion) && " Suggestions are written by AI and checked against our policy."}
              </span>
            </p>
          </Card>
        </aside>
      </div>
    </>
  );
}
