---
version: 1
slug: "dashboard-app"
primary_target: "dashboard/app"
related_targets: []
---

# Growth Briefs dashboard (whole app)

Mode: Operate. Confirmed via `shape` on 2026-11-13.

## Audience and job
Merchants, marketers and managers who analyse sets of up to 6 competitor stores and get a follow-up brief about weekly. Job: what did competitors change, and what should I do?

## Structure
Top bar: This week · Briefs, plus run status and New analysis (an inline panel: up to 6 domains → POST /api/run).
- **This week (home):** executive summary + 2–4 recommendations from the latest brief → sortable Movements table (one row per competitor: price changes with biggest drop %, new, removed, renamed, status; row opens that competitor) → compact trust badge ("Verified · 9 of 10 stores", opens audit) + run status.
- **Brief detail:** summary → recommendations → per-competitor sections with AI text next to product tables (price changes by % change, new products with "sits next to X" closest match, removed, renamed; rows link to the store). Audit trail collapsed at the end or in a side panel.
- **Briefs (archive):** compact rows: week, store count, totals, status.
- **Automatic tracking (2026-11-13, replaces the watchlist):** every store set analysed from the dashboard is tracked for 28 days after it was last run; running it again restarts the 28 days. A daily job (09:00 UTC) re-checks sets whose last brief is 7+ days old, so each set gets a new brief about weekly. The brief page says "Re-checked automatically every week until {date}. Next check on or after {date}" (approximate: a busy day can push it a day), or "Tracking ended {date}. Run again to resume". Never say "daily" about a brief. No watchlist-style page.

## Boundaries
- Remove the tech-stack footer and the injection-demo helper from the merchant UI.
- No separate cross-week trends view; trends stay inside the brief.
- Trust layer stays visible but secondary; never AI prose without its numbers; tables over decorative cards.

## States
First use (no briefs → New analysis form inline); baseline week (first_snapshot, not "0 changes"); run in progress (elapsed vs ~2 min estimate, longer for Firecrawl); partial failure (show unverifiedReasons); audit failed (brief shown with warning); quiet week ("No changes from N stores"); product tables 0 to hundreds of rows (top items first + "Show all N", sorted by size of change).

## Backend work needed
- Brief API returns the archived `diff` (product rows, removed SKUs, unverifiedReasons).
- Tracking lives in the backend (`lib/server/tracking.ts`: `trackingFor`, `listTrackedSets`; daily cron at `/api/cron/daily`). The UI only reads it.

## Decisions
- Run cap stays at 6 stores per run (`/api/run`).
- Single shared workspace, no login (assumed).
- Visual direction: open; to be chosen in new-work. Dark theme is not a binding commitment.

## Direction contract

Chosen 2026-11-13: Shelf-Edge Ticket (Impeccable's pick card). Code-led; reference sketch `.impeccable/mocks/decision/model-pick.html`.

THESIS: A competitor's price change is a shelf-edge price ticket, and a cut gets a yellow markdown sticker. The page refuses the category default of KPI cards on a grey SaaS shell and the old dark zinc look: the evidence is the ticket itself, not a summary tile.

OWN-WORLD: Supermarket shelf edge. Ground #F4F5F7 (shelf grey-white); white card stock (#FFFFFF) surfaces with a 1px #DADDE2 edge and a hard 1px bottom shadow like a ticket on a rail; carbon #111111 ink and the top bar; markdown yellow #FFD60A used only for price cuts and the numbered action markers; reduction red #E01E26 only for price-drop figures; grey shelf rail #D9DCE0 behind ticket rows. Barlow for UI and body text, Barlow Condensed 800 for prices, week titles and big numbers. Tabular figures throughout.

STORY: The merchant reads what changed (summary + price tickets), what to do (numbered actions), and who moved (Movements table), then opens a competitor or the full brief for product-level proof. Trust is a single quiet line that opens the audit.

FIRST VIEWPORT: Carbon top bar with the brand, This week / Briefs (yellow underline on the active tab) and run status + New analysis at the right (opens an inline panel under the bar: up to 6 domains). Main column: a white card with the week title in condensed type, the summary, and a grey shelf rail of up to 4 price tickets (biggest moves, yellow stickers on cuts, black sticker on rises). Below: the Movements table, one row per store in the brief (max 6). Right column (~420px): "What to do" card with yellow numbered markers, then the trust line and, on the brief page, the tracking line ("Re-checked automatically every week until {date}"). On mobile the right column drops below the summary card and the rail scrolls horizontally.

FORM: Shelf-edge ticket, rank 1 of my grounded list (presented as the pick; the roll had assigned rank 5, Mail-Order Catalog). seed:d44730ec561b0893. Signature interaction: price tickets are the unit everywhere (home rail, brief detail product lists); the yellow sticker appears only on real cuts, never as decoration. Motion: 150–200ms state transitions only; no entrance choreography.

CITED DEVIATIONS: reduction red ships as #D11B23, not #E01E26, because the drop figures include 12–13px text and #E01E26 sits at about 4.6:1 on white, while #D11B23 clears AA with margin. Below 640px the brand wordmark is dropped and the run status text moves into the button label ("Analysing 0:42"), so the two nav tabs and the action fit at 390px.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

FINISH STATUS: reviewed 2026-11-13 by impeccable-finish-reviewer (two fix rounds; all 8 material fixes resolved with evidence in .impeccable/review/; nothing material open). No shipping rasters.
