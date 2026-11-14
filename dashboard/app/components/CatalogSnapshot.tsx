import { formatMoney, type CatalogSummary } from "@/lib/brief";
import { ChangeRow } from "./shelf";

/**
 * A store's catalog as read on this check: what a first check can say before
 * there is anything to compare. Every figure comes from the snapshot.
 */
/** `partial`: read from web pages, where stock and variants aren't known (they read as defaults), so they're left out. */
export function CatalogSnapshot({ catalog: c, partial = false, complete }: { catalog: CatalogSummary; partial?: boolean; complete?: boolean }) {
  const m = (n: number) => formatMoney(n, c.currency);
  // Older web-page reads carry default stock figures; newer ones leave them out.
  const hasStock = !partial && c.inStock !== undefined && c.soldOut !== undefined;
  const stockPct = c.inStockPct ?? (c.productCount && c.inStock !== undefined ? Math.round((c.inStock / c.productCount) * 100) : 0);

  const stats = [
    {
      label: "Products",
      value: complete === false ? `${c.productCount.toLocaleString()}+` : c.productCount.toLocaleString(),
      note:
        complete === false
          ? "At least this many: the read ran out of time"
          : c.avgVariants && !partial
            ? `${c.avgVariants.toFixed(1)} variants each on average`
            : null,
    },
    { label: "Price range", value: `${m(c.price.min)}–${m(c.price.max)}`, note: "Each product at its lowest variant price" },
    { label: "Median price", value: m(c.price.median), note: null },
    ...(hasStock
      ? [
          {
            label: "In stock",
            value: `${stockPct}%`,
            note: `${c.inStock!.toLocaleString()} in stock · ${c.soldOut!.toLocaleString()} sold out`,
          },
        ]
      : []),
  ];
  const brands = c.vendors.length > 1 ? c.vendors : [];

  return (
    <div className="mt-4 max-w-[880px]">
      <dl className={`grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-edge bg-edge ${stats.length === 3 ? "sm:grid-cols-3" : "sm:grid-cols-4"}`}>
        {stats.map((s, i) => (
          // Three figures on a two-column phone grid: the last spans the row.
          <div key={s.label} className={`bg-shelf px-4 py-3 ${stats.length % 2 && i === stats.length - 1 ? "col-span-2 sm:col-span-1" : ""}`}>
            <dt className="text-[11px] font-semibold uppercase tracking-[0.04em] text-ink-3">{s.label}</dt>
            <dd className="mt-1 font-cond text-[22px] font-extrabold sm:text-[26px] leading-none tabular-nums text-ink">{s.value}</dd>
            {s.note && <dd className="mt-1.5 text-xs text-ink-3">{s.note}</dd>}
          </div>
        ))}
      </dl>
      {!!c.addOnsExcluded && (
        <p className="mt-2 text-xs text-ink-3">
          {c.addOnsExcluded === 1 ? "1 checkout add-on" : `${c.addOnsExcluded} checkout add-ons`} (like shipping protection or gift cards) not
          counted.
        </p>
      )}

      <div className="mt-5 grid gap-x-10 gap-y-5 sm:grid-cols-2">
        {c.productTypes.length > 0 && <Bars title="Product types" items={c.productTypes} total={c.productCount} />}
        {c.priceBands.length > 0 && (
          <Bars title="Price bands" items={c.priceBands.map((b) => ({ name: b.label, count: b.count }))} total={c.productCount} keepOrder />
        )}
        {brands.length > 0 && <Bars title="Brands" items={brands} total={c.productCount} />}
      </div>

      {(c.cheapest.length > 0 || c.priciest.length > 0) && (
        <div className="mt-5 grid gap-x-10 gap-y-5 sm:grid-cols-2">
          <Products title="Lowest-priced items" items={c.cheapest} money={m} />
          <Products title="Highest-priced items" items={c.priciest} money={m} />
        </div>
      )}
    </div>
  );
}

/** Counts as horizontal bars, scaled to the largest. Price bands keep their own order. */
function Bars({ title, items, total, keepOrder = false }: { title: string; items: { name: string; count: number }[]; total: number; keepOrder?: boolean }) {
  const rows = keepOrder ? items : [...items].sort((a, b) => b.count - a.count);
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className="min-w-0">
      <h4 className="text-sm font-semibold">{title}</h4>
      <ul className="mt-2 space-y-2">
        {rows.map((r) => (
          <li key={r.name} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_3.5rem] items-center gap-3 text-[13px]">
            <span className="truncate text-ink-2" title={r.name}>
              {r.name || "Uncategorised"}
            </span>
            <span className="h-2 rounded-full bg-[#eceef1]" aria-hidden>
              <span className="block h-full rounded-full bg-ink" style={{ width: `${(r.count / max) * 100}%` }} />
            </span>
            <span className="text-right tabular-nums text-ink">
              {r.count.toLocaleString()}
              <span className="sr-only"> of {total.toLocaleString()} products</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Products({ title, items, money }: { title: string; items: { title: string; price: number; url: string }[]; money: (n: number) => string }) {
  if (items.length === 0) return null;
  return (
    <div className="min-w-0">
      <h4 className="text-sm font-semibold">{title}</h4>
      <ul className="mt-1">
        {items.map((p) => (
          <ChangeRow key={p.url} title={p.title} href={p.url} value={money(p.price)} />
        ))}
      </ul>
    </div>
  );
}
