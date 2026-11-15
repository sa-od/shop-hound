import { listStores } from "@/lib/server/briefs-store";
import { getThisWeek } from "@/lib/server/this-week";
import { getStatus } from "@/lib/server/status";
import type { Status } from "@/lib/api";
import { NewAnalysisForm } from "./components/NewAnalysisForm";
import { ThisWeekView } from "./components/ThisWeekView";
import { Card } from "./components/shelf";

export const dynamic = "force-dynamic";

/** The last 7 days across every watched competitor, ranked. */
export default async function Home() {
  const [week, stores] = await Promise.all([getThisWeek({ days: 7 }), listStores()]);
  const watched = stores.filter((s) => s.watching !== "ended");

  return (
    <main className="mx-auto w-full max-w-[1280px] flex-1 px-4 py-6 sm:px-8 sm:py-8">
      {watched.length === 0 ? (
        <FirstUse status={await getStatus()} />
      ) : (
        <ThisWeekView
          data={week}
          // Paused stores aren't part of This week (backend leaves them out); they stay on My competitors.
          watched={watched.filter((s) => s.watching === "active").map((s) => ({ store: s.store, competitorKey: s.competitorKey }))}
        />
      )}
    </main>
  );
}

function FirstUse({ status }: { status: Status }) {
  return (
    <Card className="mx-auto max-w-2xl">
      <h1 className="font-cond text-[32px] font-extrabold leading-tight tracking-tight">Watch your competitors</h1>
      <p className="mt-2 max-w-[60ch] text-base leading-relaxed text-ink-2">
        Add the stores you compete with. We read each one now, then again every week until you remove it, and list what changed: price
        moves, new and removed products, renames.
      </p>
      <div className="mt-6">
        <NewAnalysisForm initial={status} autoFocus label="Add a competitor" />
      </div>
    </Card>
  );
}
