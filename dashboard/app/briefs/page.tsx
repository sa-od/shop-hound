import { listRecentBriefs } from "@/lib/server/briefs-store";
import { Card } from "../components/shelf";
import { StoreBriefRows, type ArchiveBrief } from "../components/StoreBriefRows";

export const dynamic = "force-dynamic";

export default async function BriefsArchive() {
  const briefs = await listRecentBriefs();
  // One row per store (older briefs with several stores group by the whole set), newest store first.
  const byStore = new Map<string, ArchiveBrief[]>();
  for (const b of briefs) {
    const key = b.competitors.map((c) => c.competitor).join(", ");
    byStore.set(key, [...(byStore.get(key) ?? []), b]);
  }
  const groups = [...byStore];

  return (
    <main className="mx-auto w-full max-w-[1280px] flex-1 px-4 py-6 sm:px-8 sm:py-8">
      <h1 className="font-cond text-[32px] font-extrabold leading-tight tracking-tight">Briefs</h1>
      <p className="mt-1 text-sm text-ink-2">One row per store, with its latest brief first. Open a store’s earlier briefs from its row.</p>

      {briefs.length === 0 ? (
        <Card className="mt-6">
          <p className="text-sm text-ink-2">No briefs yet. Press Add store in the top bar to analyse your first competitor.</p>
        </Card>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-lg border border-edge bg-stock">
          <table className="w-full min-w-[760px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-edge text-[11px] uppercase tracking-[0.04em] text-ink-3">
                <th scope="col" className="px-4 py-2.5 text-left font-semibold">Store</th>
                <th scope="col" className="px-4 py-2.5 text-left font-semibold">Latest brief</th>
                <th scope="col" className="px-4 py-2.5 text-right font-semibold">Price changes</th>
                <th scope="col" className="px-4 py-2.5 text-right font-semibold">New</th>
                <th scope="col" className="px-4 py-2.5 text-right font-semibold">Removed</th>
                <th scope="col" className="px-4 py-2.5 text-right font-semibold">Renamed</th>
                <th scope="col" className="px-4 py-2.5 text-right font-semibold">Audit</th>
              </tr>
            </thead>
            <tbody>
              {groups.map(([store, list]) => (
                <StoreBriefRows key={store} store={store} briefs={list} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
