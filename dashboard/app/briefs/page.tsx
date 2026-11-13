import Link from "next/link";
import { briefTotals } from "@/lib/api";
import { listRecentBriefs } from "@/lib/server/briefs-store";
import { formatWeek } from "@/lib/utils";
import { AuditTag, Card } from "../components/shelf";

export const dynamic = "force-dynamic";

/** Several briefs can share a week, so each row also shows when it was written. */
function runTime(iso: string) {
  return `Written ${new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" })} UTC`;
}

export default async function BriefsArchive() {
  const briefs = await listRecentBriefs();

  return (
    <main className="mx-auto w-full max-w-[1280px] flex-1 px-4 py-6 sm:px-8 sm:py-8">
      <h1 className="font-cond text-[32px] font-extrabold leading-tight tracking-tight">Briefs</h1>
      <p className="mt-1 text-sm text-ink-2">Every brief, newest first. Each one compares the stores with their previous check.</p>

      {briefs.length === 0 ? (
        <Card className="mt-6">
          <p className="text-sm text-ink-2">No briefs yet. Press New analysis in the top bar and enter the competitor stores to check.</p>
        </Card>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-lg border border-edge bg-stock">
          <table className="w-full min-w-[760px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-edge text-[11px] uppercase tracking-[0.04em] text-ink-3">
                <th scope="col" className="px-4 py-2.5 text-left font-semibold">Week</th>
                <th scope="col" className="px-4 py-2.5 text-left font-semibold">Stores</th>
                <th scope="col" className="px-4 py-2.5 text-right font-semibold">Price changes</th>
                <th scope="col" className="px-4 py-2.5 text-right font-semibold">New</th>
                <th scope="col" className="px-4 py-2.5 text-right font-semibold">Removed</th>
                <th scope="col" className="px-4 py-2.5 text-right font-semibold">Renamed</th>
                <th scope="col" className="px-4 py-2.5 text-right font-semibold">Audit</th>
              </tr>
            </thead>
            <tbody>
              {briefs.map((b) => {
                const t = briefTotals(b);
                const unverified = b.competitors.filter((c) => c.status === "unverified").length;
                return (
                  <tr key={b.id} className="border-b border-[#eceef1] last:border-0 hover:bg-[#fafafb]">
                    <td className="px-4 py-3">
                      <Link href={`/briefs/${b.id}`} className="font-cond text-lg font-bold hover:underline">
                        {formatWeek(b.weekOf)}
                      </Link>
                      <div className="text-xs text-ink-3">{runTime(b.createdAt)}</div>
                    </td>
                    <td className="max-w-[380px] px-4 py-3 text-ink-2">
                      <span className="line-clamp-1">{b.competitors.map((c) => c.competitor).join(", ")}</span>
                      {unverified > 0 && <span className="block text-xs text-warn">{unverified} not checked</span>}
                    </td>
                    <td className="px-4 py-3 text-right">{t.priceChanges}</td>
                    <td className="px-4 py-3 text-right">{t.newSkus}</td>
                    <td className="px-4 py-3 text-right">{b.removedTotal}</td>
                    <td className="px-4 py-3 text-right">{t.titleChanges}</td>
                    <td className="px-4 py-3 text-right">
                      <AuditTag passed={b.greenLight} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
