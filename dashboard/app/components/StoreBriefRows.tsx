"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { briefTotals, type BriefSummary } from "@/lib/api";
import { AuditTag } from "./shelf";
import { LocalTime } from "./LocalTime";

export type ArchiveBrief = BriefSummary & { removedTotal: number };

/** One store's briefs: the latest as the row, earlier ones underneath on request. */
export function StoreBriefRows({ store, briefs }: { store: string; briefs: ArchiveBrief[] }) {
  const [open, setOpen] = useState(false);
  const [latest, ...earlier] = briefs;
  const rowsId = `earlier-${latest.id}`;

  return (
    <>
      <tr className="border-b border-[#eceef1] hover:bg-[#fafafb]">
        <td className="px-4 py-3 align-top">
          <Link href={`/briefs/${latest.id}`} className="font-cond text-lg font-bold hover:underline">
            {store}
          </Link>
          {earlier.length > 0 && (
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              aria-controls={rowsId}
              className="mt-0.5 flex items-center gap-1 text-xs font-semibold text-ink-2 hover:text-ink"
            >
              <ChevronDown size={13} className={`transition-transform duration-150 ${open ? "rotate-180" : ""}`} />
              {open ? "Hide" : "Show"} {earlier.length} earlier brief{earlier.length === 1 ? "" : "s"}
            </button>
          )}
        </td>
        <Cells b={latest} />
      </tr>
      {open &&
        earlier.map((b, i) => (
          <tr key={b.id} id={i === 0 ? rowsId : undefined} className="border-b border-[#eceef1] bg-[#fafafb]">
            <td className="py-2.5 pl-9 pr-4 text-xs text-ink-3">Earlier brief</td>
            <Cells b={b} quiet />
          </tr>
        ))}
    </>
  );
}

function Cells({ b, quiet = false }: { b: ArchiveBrief; quiet?: boolean }) {
  const t = briefTotals(b);
  const unverified = b.competitors.filter((c) => c.status === "unverified").length;
  const pad = quiet ? "py-2.5" : "py-3";
  return (
    <>
      <td className={`px-4 ${pad} align-top`}>
        <Link href={`/briefs/${b.id}`} className="font-semibold hover:underline">
          <LocalTime iso={b.createdAt} format="date" />
        </Link>
        {/* Several briefs can share a day, so each also shows when it was written. */}
        <div className="text-xs text-ink-3">
          Written <LocalTime iso={b.createdAt} />
          {unverified > 0 && <span className="text-warn"> · {unverified} not checked</span>}
        </div>
      </td>
      <td className={`px-4 ${pad} text-right align-top`}>{t.priceChanges}</td>
      <td className={`px-4 ${pad} text-right align-top`}>{t.newSkus}</td>
      <td className={`px-4 ${pad} text-right align-top`}>{b.removedTotal}</td>
      <td className={`px-4 ${pad} text-right align-top`}>{t.titleChanges}</td>
      <td className={`px-4 ${pad} text-right align-top`}>
        <AuditTag passed={b.greenLight} />
      </td>
    </>
  );
}
