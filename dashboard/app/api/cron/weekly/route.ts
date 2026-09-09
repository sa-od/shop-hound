import { NextResponse } from "next/server";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4111";

// The Mastra Cloud container scales to zero when idle; waking it can take
// longer than the Hobby default function window, which is how the first
// version of this route silently missed cold Mondays. Give the function a
// full minute and wake the backend before firing the run.
export const maxDuration = 60;

const WAKE_BUDGET_MS = 35_000;
const START_BUDGET_MS = 15_000;

/** Pull a readable line out of whatever the workflow put in `error`. */
function errText(err: unknown): string {
  if (!err) return "no detail";
  if (typeof err === "string") return err.slice(0, 300);
  if (typeof err === "object" && "message" in err) {
    return String((err as { message: unknown }).message).slice(0, 300);
  }
  return JSON.stringify(err).slice(0, 300);
}

/** Node rejects an `AbortSignal.timeout` fetch as TimeoutError (older: AbortError). */
function isTimeout(e: unknown): boolean {
  const name = (e as { name?: string })?.name;
  return name === "TimeoutError" || name === "AbortError";
}

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
  const wakeDeadline = Date.now() + WAKE_BUDGET_MS;
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
      { ok: false, stage: "wake", error: `backend did not wake within ${WAKE_BUDGET_MS / 1000}s` },
      { status: 502 },
    );
  }

  // Phase 2 — start the run. Empty competitors → backend falls back to its
  // COMPETITOR_STORES env var.
  //
  // `start-async` is "async" only in the sense that it does not stream: the
  // handler awaits the entire workflow before responding. So the two outcomes
  // are the opposite of what they look like, and both must be read carefully:
  //
  //   • A response arrives inside our window → the workflow already finished.
  //     For a run that normally takes 60-90s that means it died early, and the
  //     body says so with { status: "failed", error } under an HTTP *200*.
  //   • Our own timeout fires → the run is still executing server-side. That
  //     is the healthy path, not an error.
  //
  // The previous version had this inverted — it trusted HTTP 200 without ever
  // reading the body and returned 502 on the timeout — which is why four
  // consecutive dead Mondays (a lapsed embeddings-provider subscription,
  // failing in ~1s) were logged by Vercel Cron as successes.
  const fired = new Date().toISOString();
  try {
    const res = await fetch(`${API}/api/workflows/competitiveIntelWorkflow/start-async`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inputData: { competitors: [] } }),
      signal: AbortSignal.timeout(START_BUDGET_MS),
    });

    const body = (await res.json().catch(() => null)) as
      | { status?: string; error?: unknown }
      | null;

    if (!res.ok) {
      return NextResponse.json(
        {
          ok: false,
          stage: "start",
          error: `backend rejected the run (HTTP ${res.status})`,
          detail: errText(body ?? (await res.text().catch(() => null))),
          fired,
        },
        { status: 502 },
      );
    }

    // HTTP 200 but the workflow itself reported a non-success terminal state.
    if (body?.status && body.status !== "success") {
      return NextResponse.json(
        {
          ok: false,
          stage: "workflow",
          error: `workflow ${body.status}`,
          detail: errText(body.error),
          fired,
        },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true, status: body?.status ?? "success", fired });
  } catch (e) {
    if (isTimeout(e)) {
      // Expected for a healthy run: it outlived our window and continues
      // server-side. Check /briefs (or the backend's run history) for the
      // outcome — we genuinely cannot know it yet from here.
      return NextResponse.json({ ok: true, status: "running", fired });
    }
    return NextResponse.json(
      { ok: false, stage: "start", error: `could not reach backend: ${errText(e)}`, fired },
      { status: 502 },
    );
  }
}
