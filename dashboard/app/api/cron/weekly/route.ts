import { NextResponse } from "next/server";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4111";

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

  try {
    // Empty competitors → backend falls back to its COMPETITOR_STORES env var.
    // Short timeout: start-async kicks the run off server-side; we don't wait
    // for the multi-minute workflow to finish.
    await fetch(`${API}/api/workflows/competitiveIntelWorkflow/start-async`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inputData: { competitors: [] } }),
      signal: AbortSignal.timeout(15_000),
    }).catch(() => {}); // run continues server-side even if this times out
    return NextResponse.json({ ok: true, fired: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
