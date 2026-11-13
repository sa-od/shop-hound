# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Shopify merchants, marketers, and growth/e-commerce managers who watch a set of competitor stores. Their job is to find out what competitors changed (prices, new products, renamed products) and decide how to respond. This is a real working tool for them, not a demo or showcase.

## Product Purpose

Shop Hound (shown in the UI as "Growth Briefs") scrapes competitor storefronts, compares each catalog with the previous snapshot, and has an AI analyst write a weekly Growth Brief: an executive summary, the movements per competitor with exact numbers, and 2–4 strategic recommendations. Success means a merchant opens a brief and quickly understands **what changed and what to do about it**.

## Positioning

Every brief is built from a deterministic catalog diff and checked by Enkrypt AI before delivery: a grounding check (claims match the verified data) and a safety check (bias, policy, prompt-injection). Competitors whose scrape failed are marked unverified, never invented. This trust layer sets the product apart, but it supports the content rather than being the main point.

## Operating Context

- Rhythm: a merchant adds competitor stores one at a time; each add joins a queue and is analysed in order, so they never wait before adding the next. Each store then gets a new brief about weekly for 28 days (see Capabilities). One brief per store per run, labelled by its snapshot date.
- Analysing one store takes about a minute; non-Shopify stores fall back to Firecrawl extraction, which is slower (several minutes) and best-effort.
- Week-over-week trends show up in the brief when archived history exists.

## Capabilities and Constraints

- Next.js 16 App Router + Tailwind v4 app in `dashboard/`; data comes from MongoDB through `dashboard/lib/server/*`.
- Per competitor data: status (`verified`, `first_snapshot`/baseline, `unverified`), source (`shopify` | `firecrawl`), product count, new SKUs, price changes, title changes. Each brief also stores the full diff with product-level detail (title, URL, old/new price, change %, closest existing product), which the brief page shows.
- The brief body is generated Markdown with fixed sections: Executive Summary, Competitor Movements, Strategic Recommendations, an optional Week-over-Week Trends, and an appended Data Confidence section.
- Limits: one store per analysis (`POST /api/run { store }`); at most 10 stores waiting in the queue.
- Automatic tracking: every store analysed from the dashboard is re-checked about weekly for 28 days after it was last run (running it again restarts the 28 days). A daily job re-checks the stores whose last brief is 7+ days old; a busy day can push one to the next day, so the next check is "on or after" a date. A store that could never be read is not tracked. There is no watchlist.
- Compliance: recommendations must never suggest coordinating or fixing prices with competitors.

## Evidence on Hand

Real data only: briefs, diffs, and audit verdicts stored by the pipeline. There are no testimonials, customer logos, or benchmarks; do not invent any.

## Product Principles

1. What changed and what to do comes first; everything else supports it.
2. Show trust, don't make it the headline: the verification status is always visible, and the full audit is one step away.
3. Never present unverified data as fact; failures and gaps are stated plainly with their reason.
4. Use exact numbers from the diff; no vague claims.
