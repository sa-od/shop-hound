---
version: 1
slug: "dashboard-app"
primary_target: "dashboard/app"
related_targets: []
---

# Growth Briefs dashboard (whole app)

Mode: Operate. Confirmed via `shape` on 2026-11-13.

## Audience and job
Merchants, marketers and managers watching up to 5 competitor stores, checking weekly. Job: what did competitors change, and what should I do?

## Structure
Top bar: This week · Briefs · Watchlist.
- **This week (home):** executive summary + 2–4 recommendations from the latest brief → sortable Movements table (one row per competitor: price changes with biggest drop %, new, removed, renamed, status; row opens that competitor) → compact trust badge ("Verified · 9 of 10 stores", opens audit) + run status.
- **Brief detail:** summary → recommendations → per-competitor sections with AI text next to product tables (price changes by % change, new products with "sits next to X" closest match, removed, renamed; rows link to the store). Audit trail collapsed at the end or in a side panel.
- **Briefs (archive):** compact rows: week, store count, totals, status.
- **Watchlist:** add a store (domain validation; Shopify = fast, other platforms = slower, best-effort via Firecrawl), remove, last scraped, last status, Run now. Holds at most 5 stores (show "3 of 5"; add is disabled when full). Every run, manual or weekly, covers the whole list.

## Boundaries
- Remove the tech-stack footer and the injection-demo helper from the merchant UI.
- No separate cross-week trends view; trends stay inside the brief.
- Trust layer stays visible but secondary; never AI prose without its numbers; tables over decorative cards.

## States
First use (empty watchlist → add stores); baseline week (first_snapshot, not "0 changes"); run in progress (elapsed vs ~2 min estimate, longer for Firecrawl); partial failure (show unverifiedReasons); audit failed (brief shown with warning); quiet week ("No changes from N stores"); product tables 0 to hundreds of rows (top items first + "Show all N", sorted by size of change).

## Backend work needed
- Brief API returns the archived `diff` (product rows, removed SKUs, unverifiedReasons).
- Watchlist collection + add/list/remove routes; cron reads the watchlist instead of `COMPETITOR_STORES`.

## Decisions
- Run cap stays at 6 stores per run (unchanged in `/api/run`). Watchlist max is 5, so a run always covers the full watchlist; no store selection needed.
- Single shared workspace, no login (assumed).
- Visual direction: open; to be chosen in new-work. Dark theme is not a binding commitment.
