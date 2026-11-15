import { getLatestBrief } from "@/lib/server/briefs-store";
import { getStatus } from "@/lib/server/status";
import { CONTACT_EMAIL } from "@/lib/server/contact";
import type { Status } from "@/lib/api";
import { BriefOverview } from "./components/BriefOverview";
import { NewAnalysisForm } from "./components/NewAnalysisForm";
import { Card } from "./components/shelf";

export const dynamic = "force-dynamic";

export default async function ThisWeek() {
  const brief = await getLatestBrief();

  return (
    <main className="mx-auto w-full max-w-[1280px] flex-1 px-4 py-6 sm:px-8 sm:py-8">
      {brief ? <BriefOverview brief={brief} linkToFull contactEmail={CONTACT_EMAIL} /> : <FirstUse status={await getStatus()} />}
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
