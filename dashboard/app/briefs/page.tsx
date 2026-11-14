import { Card } from "../components/shelf";
import { StoreBriefRows } from "../components/StoreBriefRows";
import { storesWithRuns } from "./runs-data";

export const dynamic = "force-dynamic";

export default async function BriefsArchive() {
  // One row per store (older multi-store briefs group by their store set), latest first.
  const stores = await storesWithRuns();

  return (
    <main className="mx-auto w-full max-w-[1280px] flex-1 px-4 py-6 sm:px-8 sm:py-8">
      <h1 className="font-cond text-[32px] font-extrabold leading-tight tracking-tight">Briefs</h1>
      <p className="mt-1 text-sm text-ink-2">Every store you’ve added, latest first. Open a store’s runs to see each check.</p>

      {stores.length === 0 ? (
        <Card className="mt-6">
          <p className="text-sm text-ink-2">No briefs yet. Press Add store in the top bar to analyse your first competitor.</p>
        </Card>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-lg border border-edge bg-stock">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-edge text-[11px] uppercase tracking-[0.04em] text-ink-3">
                <th scope="col" className="px-4 py-2.5 text-left font-semibold">Store</th>
                <th scope="col" className="w-40 px-4 py-2.5 text-left font-semibold">Runs</th>
                <th scope="col" className="w-36 px-4 py-2.5 text-right font-semibold">Products</th>
                <th scope="col" className="w-72 px-4 py-2.5 text-left font-semibold">Tracking</th>
              </tr>
            </thead>
            <tbody>
              {stores.map(({ store, runs }) => (
                <StoreBriefRows key={store.competitorKey} s={store} runs={runs} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
