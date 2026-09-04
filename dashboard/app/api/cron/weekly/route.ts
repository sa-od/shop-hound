import { NextResponse } from "next/server";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4111";

// The Mastra Cloud container scales to zero when idle; waking it can take
// longer than the Hobby default function window, which is how the first
// version of this route silently missed cold Mondays. Give the function a
// full minute and wake the backend before firing the run.
export const maxDuration = 60;

/**
 * Weekly analysis trigger, invoked by Vercel Cron (see dashboard/vercel.json).
 * Exists because the Mastra Cloud container's own cron only fires while the
 * container is awake — this external trigger both wakes it and starts the run.
 */
export async function GET(req: Request) {
  // Vercel sends `Authorization: Bearer <CRON_SECRET>` with cron invocations.
  // Reject anything else so strangers can't trigger (paid) analysis runs.
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Phase 1 — wake the backend: poll /status until it answers (cold start can
  // take tens of seconds after weeks of inactivity).
  let awake = false;
  const wakeDeadline = Date.now() + 35_000;
  while (Date.now() < wakeDeadline) {
    try {
      const res = await fetch(`${API}/status`, {
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) {
        awake = true;
        break;
      }
    } catch {
      /* still waking — retry */
    }
    await new Promise((r) => setTimeout(r, 2_000));
  }
  if (!awake) {
    // Report honestly so Vercel's cron log shows a real failure — the first
    // version swallowed errors and logged missed Mondays as successes.
    return NextResponse.json(
      { ok: false, error: "backend did not wake within 35s" },
      { status: 502 },
    );
  }

  // Phase 2 — start the run. Empty competitors → backend falls back to its
  // COMPETITOR_STORES env var. start-async returns once the run is accepted;
  // the multi-minute workflow continues server-side.
  try {
    const res = await fetch(`${API}/api/workflows/competitiveIntelWorkflow/start-async`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inputData: { competitors: [] } }),
      signal: AbortSignal.timeout(15_000),
    });
    return NextResponse.json({
      ok: true,
      backendStatus: res.status,
      fired: new Date().toISOString(),
    });
  } catch (e) {
    // A timeout here can still mean the run started (gateway held the request
    // while the workflow spun up) — but surface it so the cron log is truthful.
    return NextResponse.json(
      { ok: false, error: `start-async did not confirm: ${String(e).slice(0, 150)}` },
      { status: 502 },
    );
  }
}
