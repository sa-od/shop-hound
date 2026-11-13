import { getLatestBrief } from "@/lib/server/briefs-store";
import { BriefOverview } from "./components/BriefOverview";
import { NewAnalysisForm } from "./components/NewAnalysisForm";
import { Card } from "./components/shelf";

export const dynamic = "force-dynamic";

export default async function ThisWeek() {
  const brief = await getLatestBrief();

  return (
    <main className="mx-auto w-full max-w-[1280px] flex-1 px-4 py-6 sm:px-8 sm:py-8">
      {brief ? <BriefOverview brief={brief} linkToFull /> : <FirstUse />}
    </main>
  );
}

function FirstUse() {
  return (
    <Card className="mx-auto max-w-2xl">
      <h1 className="font-cond text-[32px] font-extrabold leading-tight tracking-tight">See what your competitors changed</h1>
      <p className="mt-2 max-w-[60ch] text-base leading-relaxed text-ink-2">
        Enter up to 6 competitor stores. The analysis reads their catalogs and writes a brief: what changed (prices, new and removed
        products, renames) and what to do about it. The first run saves each catalog as a baseline; after that the set is re-checked
        automatically every week for 28 days, each time with a new brief.
      </p>
      <div className="mt-6">
        <NewAnalysisForm autoFocus />
      </div>
    </Card>
  );
}
