import Link from "next/link";
import type { RunSummary } from "@/lib/api";
import { calendarDay, productCountText } from "@/lib/brief";
import { AuditTag } from "./shelf";
import { LocalTime } from "./LocalTime";

/** "+2" / "−3" after a product count; nothing when unchanged or unknown. */
export function Delta({ d, since }: { d?: number | null; since?: string }) {
  if (d === undefined || d === null || d === 0) return null;
  const label = `since ${calendarDay(since)}`;
  return (
    <span title={label} className={`ml-1.5 text-xs ${d < 0 ? "text-cut" : "text-ok"}`}>
      {d > 0 ? "+" : "−"}
      {Math.abs(d).toLocaleString()}
      <span className="sr-only"> {label}</span>
    </span>
  );
}

/** Why a run happened: a first check, or added by the user, or the weekly re-check. */
export function runReason(r: RunSummary): string {
  if (r.status === "first_snapshot") return "First check";
  return r.trigger === "added" ? "Added by you" : r.trigger === "weekly" ? "Weekly check" : "—";
}

const FIGURES: { key: "priceChanges" | "newSkus" | "removed" | "titleChanges"; label: string }[] = [
  { key: "priceChanges", label: "Price changes" },
  { key: "newSkus", label: "New" },
  { key: "removed", label: "Removed" },
  { key: "titleChanges", label: "Renamed" },
];

/**
 * A store's readable runs, newest first. `currentId` marks the run being
 * viewed (not a link). A first check has nothing to compare, so it says
 * "Baseline" across the change columns instead of zeros.
 */
export function RunsTable({ runs, currentId }: { runs: RunSummary[]; currentId?: string }) {
  if (runs.length === 0) return <p className="px-4 py-3 text-sm text-ink-3">No readable runs yet.</p>;

  const when = (r: RunSummary, cls: string) =>
    r.id === currentId ? (
      <span className={cls}>
        <LocalTime iso={r.createdAt} />
      </span>
    ) : (
      <Link href={`/briefs/${r.id}`} className={`${cls} hover:underline`}>
        <LocalTime iso={r.createdAt} />
      </Link>
    );

  return (
    <>
      {/* Phones: one block per run. */}
      <ul className="divide-y divide-[#eceef1] sm:hidden">
        {runs.map((r) => (
          <li key={r.id} className={`px-4 py-3 ${r.id === currentId ? "bg-[#fafafb]" : ""}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                {when(r, "font-semibold")}
                <div className="mt-0.5 text-xs text-ink-3">
                  {runReason(r)} · {productCountText(r.productCount, r.complete)} products
                  {r.id === currentId && <span className="font-semibold text-ink"> · Viewing</span>}
                </div>
              </div>
              <AuditTag passed={r.greenLight} />
            </div>
            {r.status === "first_snapshot" ? (
              <p className="mt-2 text-[13px] text-ink-3">Baseline saved. Changes show from the next run.</p>
            ) : (
              <dl className="mt-2.5 grid grid-cols-4 gap-2 text-sm">
                {FIGURES.map((f) => (
                  <div key={f.key}>
                    <dt className="text-[10px] uppercase tracking-[0.04em] text-ink-3">{f.label.split(" ")[0]}</dt>
                    <dd className="mt-0.5 tabular-nums">{r[f.key]}</dd>
                  </div>
                ))}
              </dl>
            )}
          </li>
        ))}
      </ul>

      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-edge text-[11px] uppercase tracking-[0.04em] text-ink-3">
              <th scope="col" className="px-4 py-2.5 text-left font-semibold">Run</th>
              <th scope="col" className="px-4 py-2.5 text-left font-semibold">Why</th>
              <th scope="col" className="px-4 py-2.5 text-right font-semibold">Products</th>
              {FIGURES.map((f) => (
                <th key={f.key} scope="col" className="whitespace-nowrap px-4 py-2.5 text-right font-semibold">
                  {f.label}
                </th>
              ))}
              <th scope="col" className="px-4 py-2.5 text-right font-semibold">Checks</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr
                key={r.id}
                aria-current={r.id === currentId ? "page" : undefined}
                className={`border-b border-[#eceef1] last:border-0 ${r.id === currentId ? "bg-[#fafafb]" : "hover:bg-[#fafafb]"}`}
              >
                <td className="whitespace-nowrap px-4 py-2.5">
                  {when(r, "font-semibold")}
                  {r.id === currentId && <span className="ml-2 text-xs font-semibold text-ink-3">Viewing</span>}
                </td>
                <td className="whitespace-nowrap px-4 py-2.5 text-ink-2">{runReason(r)}</td>
                <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums">
                  {productCountText(r.productCount, r.complete)}
                  <Delta d={r.productDelta} since={r.deltaSince} />
                </td>
                {r.status === "first_snapshot" ? (
                  <td colSpan={FIGURES.length} className="px-4 py-2.5 text-right text-[13px] text-ink-3">
                    Baseline saved
                  </td>
                ) : (
                  FIGURES.map((f) => (
                    <td key={f.key} className="px-4 py-2.5 text-right tabular-nums">
                      {r[f.key]}
                    </td>
                  ))
                )}
                <td className="px-4 py-2.5 text-right">
                  <AuditTag passed={r.greenLight} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
