import { getStatus } from "@/lib/server/status";
import { CONTACT_EMAIL } from "@/lib/server/contact";
import { storesWithRuns } from "../briefs/runs-data";
import { CompetitorTable } from "../components/CompetitorTable";
import { NewAnalysisForm } from "../components/NewAnalysisForm";

export const dynamic = "force-dynamic";

const DEMO_STORE = "injection-demo.test";

export default async function MyCompetitors() {
  const [all, status] = await Promise.all([storesWithRuns(), getStatus()]);
  const stores = all.filter(({ store }) => !store.store.includes(DEMO_STORE));
  // Watched: active or paused, plus stores waiting for an email to read them by hand. Removed stores aren't listed.
  const watched = stores.filter(({ store: s }) => s.watching !== "ended" || s.needsManualRead);
  const notWatching = stores.filter(({ store: s }) => s.watching === "ended" && !s.needsManualRead);

  return (
    <main className="mx-auto w-full max-w-[1280px] flex-1 px-4 py-6 sm:px-8 sm:py-8">
      <h1 className="font-cond text-[32px] font-extrabold leading-tight tracking-tight sm:text-[36px]">My competitors</h1>
      <p className="mt-1 text-sm text-ink-2">We check each store every week until you remove it.</p>
      <div className="mt-5 max-w-2xl">
        <NewAnalysisForm initial={status} showQueue={false} label="Add a competitor" help="Takes about a minute. It appears in the list below while we read it." />
      </div>
      <CompetitorTable initial={status} watched={watched} notWatching={notWatching} contactEmail={CONTACT_EMAIL} />
    </main>
  );
}
