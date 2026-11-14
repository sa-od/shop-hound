"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import type { RunSummary, StoreSummary } from "@/lib/api";
import { productCountText } from "@/lib/brief";
import { LocalTime } from "./LocalTime";
import { RunsTable } from "./RunsTable";

const COLS = 4;

/** Is it re-checked, until when, and when next. */
function Tracking({ s }: { s: StoreSummary }) {
  const t = s.tracking;
  if (s.needsManualRead) return <span className="text-ink-2">Email to track</span>;
  if (t.tracked && t.firstReadPending)
    return (
      <span className="text-warn">
        Waiting to read{t.nextCheck && <> · next try <LocalTime iso={t.nextCheck} format="shortdate" /></>}
      </span>
    );
  if (t.tracked)
    return (
      <>
        Weekly{t.trackedUntil && <> until <LocalTime iso={t.trackedUntil} format="shortdate" /></>}
        {t.nextCheck && (
          <span className="block text-xs text-ink-3">
            Next on or after <LocalTime iso={t.nextCheck} format="shortdate" />
          </span>
        )}
      </>
    );
  if (t.trackedUntil)
    return (
      <span className="text-ink-3">
        Ended <LocalTime iso={t.trackedUntil} format="shortdate" />
      </span>
    );
  return <span className="text-ink-3">Not tracked</span>;
}

function Products({ s }: { s: StoreSummary }) {
  if (s.productCount === null) return <span className="text-ink-3">—</span>;
  const d = s.productDelta;
  return (
    <>
      {productCountText(s.productCount, s.complete)}
      {d !== null && d !== 0 && (
        <span className={`ml-1.5 text-xs ${d < 0 ? "text-cut" : "text-ok"}`}>
          {d > 0 ? "+" : "−"}
          {Math.abs(d).toLocaleString()}
        </span>
      )}
    </>
  );
}

/** One store: name, run count, size and tracking; its runs open underneath. */
export function StoreBriefRows({ s, runs }: { s: StoreSummary; runs: RunSummary[] }) {
  const [open, setOpen] = useState(false);
  const id = `runs-${s.latestBriefId}`;

  return (
    <>
      <tr className={`border-b border-[#eceef1] ${open ? "bg-[#fafafb]" : "hover:bg-[#fafafb]"}`}>
        <td className="px-4 py-3 align-top">
          <Link href={`/briefs/${s.latestBriefId}`} className="font-cond text-lg font-bold hover:underline">
            {s.store}
          </Link>
          <div className="text-xs text-ink-3">
            Latest <LocalTime iso={s.latestAt} />
          </div>
        </td>
        <td className="px-4 py-3 align-top">
          {runs.length > 0 ? (
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              aria-controls={id}
              className="inline-flex items-center gap-1 font-semibold hover:underline"
            >
              {s.runCount} run{s.runCount === 1 ? "" : "s"}
              <ChevronDown size={14} className={`transition-transform duration-150 ${open ? "rotate-180" : ""}`} />
            </button>
          ) : (
            <span className="text-ink-3">No readable runs</span>
          )}
        </td>
        <td className="px-4 py-3 text-right align-top tabular-nums">
          <Products s={s} />
        </td>
        <td className="px-4 py-3 align-top text-ink-2">
          <Tracking s={s} />
        </td>
      </tr>
      {open && (
        <tr id={id} className="border-b border-[#eceef1]">
          <td colSpan={COLS} className="bg-[#fafafb] px-4 pb-4 pt-1">
            <div className="rounded-md border border-edge bg-stock">
              <RunsTable runs={runs} />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
