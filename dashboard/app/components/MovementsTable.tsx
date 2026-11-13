"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUpDown } from "lucide-react";
import { formatPct, slug, type MovementRow } from "@/lib/brief";
import { StatusTag } from "./shelf";

type Key = "total" | "priceChanges" | "biggest" | "newSkus" | "removed" | "titleChanges";

const COLS: { key: Exclude<Key, "total">; label: string; short: string }[] = [
  { key: "priceChanges", label: "Price changes", short: "Price" },
  { key: "biggest", label: "Biggest move", short: "Biggest" },
  { key: "newSkus", label: "New", short: "New" },
  { key: "removed", label: "Removed", short: "Removed" },
  { key: "titleChanges", label: "Renamed", short: "Renamed" },
];

const hasDiff = (r: MovementRow) => r.status === "verified";

function subline(r: MovementRow) {
  return r.status === "unverified"
    ? r.reason ?? "Couldn’t be checked this time"
    : `${r.productCount.toLocaleString()} products · ${r.source === "firecrawl" ? "via Firecrawl" : "Shopify"}`;
}

function noDiffText(r: MovementRow) {
  return r.status === "first_snapshot" ? "First check: baseline saved. Changes show from the next check." : "Not checked this time.";
}

function Cell({ r, k }: { r: MovementRow; k: Exclude<Key, "total"> }) {
  if (k !== "biggest") return <>{r[k]}</>;
  if (r.biggest === null) return <span className="font-normal text-ink-3">—</span>;
  return <span className={`font-semibold ${r.biggest < 0 ? "text-cut" : ""}`}>{formatPct(r.biggest)}</span>;
}

/** One row per store in the brief. Sorted by size of change; any number column re-sorts it. */
export function MovementsTable({ rows, briefId }: { rows: MovementRow[]; briefId: string }) {
  const [sortKey, setSortKey] = useState<Key>("total");

  const value = (r: MovementRow, k: Key) => (k === "biggest" ? Math.abs(r.biggest ?? 0) : r[k]);
  const sorted = [...rows].sort((a, b) => {
    if (hasDiff(a) !== hasDiff(b)) return hasDiff(a) ? -1 : 1; // stores without a diff stay last
    return value(b, sortKey) - value(a, sortKey);
  });
  const href = (r: MovementRow) => `/briefs/${briefId}#${slug(r.competitor)}`;

  return (
    <div className="rounded-lg border border-edge bg-stock">
      {/* Phones: one block per store, figures in a labelled row. */}
      <ul className="divide-y divide-[#eceef1] sm:hidden">
        {sorted.map((r) => (
          <li key={r.competitor} className="px-4 py-3.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Link href={href(r)} className="font-semibold hover:underline">
                  {r.competitor}
                </Link>
                <div className="mt-0.5 text-xs text-ink-3">{subline(r)}</div>
              </div>
              <StatusTag status={r.status} />
            </div>
            {hasDiff(r) ? (
              <dl className="mt-3 grid grid-cols-5 gap-2 text-sm">
                {COLS.map((c) => (
                  <div key={c.key}>
                    <dt className="text-[10px] uppercase tracking-[0.04em] text-ink-3">{c.short}</dt>
                    <dd className="mt-0.5">
                      <Cell r={r} k={c.key} />
                    </dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="mt-2 text-[13px] text-ink-3">{noDiffText(r)}</p>
            )}
          </li>
        ))}
      </ul>

      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-edge text-[11px] uppercase tracking-[0.04em] text-ink-3">
              <th scope="col" className="px-4 py-2.5 text-left font-semibold">
                Competitor
              </th>
              {COLS.map((c) => {
                const active = sortKey === c.key;
                return (
                  <th key={c.key} scope="col" aria-sort={active ? "descending" : "none"} className="px-4 py-1.5 text-right font-semibold">
                    <button
                      type="button"
                      onClick={() => setSortKey(active ? "total" : c.key)}
                      title={active ? "Back to sorting by size of change" : `Sort by ${c.label.toLowerCase()}`}
                      className={`group relative rounded py-1 uppercase transition-colors duration-150 hover:text-ink ${active ? "text-ink" : ""}`}
                    >
                      {c.label}
                      {/* Outside the label's box, so figures align under the header text. */}
                      <span className="absolute -left-4 top-1/2 -translate-y-1/2" aria-hidden>
                        {active ? <ArrowDown size={12} /> : <ArrowUpDown size={12} className="opacity-35 group-hover:opacity-100" />}
                      </span>
                    </button>
                  </th>
                );
              })}
              <th scope="col" className="px-4 py-2.5 text-right font-semibold">
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.competitor} className="border-b border-[#eceef1] last:border-0 hover:bg-[#fafafb]">
                <td className="px-4 py-3">
                  <Link href={href(r)} className="font-semibold hover:underline">
                    {r.competitor}
                  </Link>
                  <div className="mt-0.5 text-xs text-ink-3">{subline(r)}</div>
                </td>
                {hasDiff(r) ? (
                  COLS.map((c) => (
                    <td key={c.key} className="px-4 py-3 text-right">
                      <Cell r={r} k={c.key} />
                    </td>
                  ))
                ) : (
                  <td colSpan={5} className="px-4 py-3 text-right text-[13px] text-ink-3">
                    {noDiffText(r)}
                  </td>
                )}
                <td className="px-4 py-3 text-right">
                  <StatusTag status={r.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
