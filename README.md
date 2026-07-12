# 🐕 ShopHound — AI Competitive Intelligence for Shopify

**Competitive intelligence Shopify merchants can actually trust — verified, never hallucinated.**

ShopHound scrapes competitor catalogs every week, detects what *actually* changed —
price drops, new SKUs, title edits — and delivers a verified **Growth Brief** with a
hard guarantee: **0% hallucination**. If a claim can't be traced to real scraped data,
it never makes the brief.

🔗 **Live app:** https://shop-hound.vercel.app/
⚙️ **Backend API:** https://my-mastara-engine.server.mastra.cloud/briefs

Built for the **HiDevs × Mastra Hackathon 2026** on **Mastra · Qdrant · Enkrypt AI** (+ Featherless · Next.js · Vercel).

---

## 🚀 How to use & test

Open the live dashboard → **https://shop-hound.vercel.app/**

1. Browse the **Weekly Growth Briefs** — each card shows the competitor(s), a
   ✓ **Verified by Enkrypt AI** badge, and stat chips (price changes · new SKUs · title changes).
2. Click any brief to see the full report: rendered markdown, per-competitor status,
   and the **Enkrypt AI audit panel** (grounding + safety PASS/FAIL — the trust story).
3. Hit **➕ New analysis**, type one or more competitor domains, and **Run**. The workflow
   scrapes → embeds → diffs → audits → archives, and the new brief appears when it's done
   (~1–2 min; the UI fires it async and polls for the result).

### ✅ Verified Shopify stores to test with

Any store with a public `/products.json` works. These are confirmed live and small
(fast runs), so they're great for a demo:

| Store | ~Products | Niche |
|---|---|---|
| `pipsnacks.com` | 39 | Snacks |
| `greatjonesgoods.com` | 68 | Cookware |
| `jenis.com` | 95 | Ice cream |
| `getquip.com` | 106 | Oral care |
| `deathwishcoffee.com` | 128 | Coffee |
| `liquiddeath.com` | 210 | Beverages |
| `magicspoon.com` | 272 | Cereal |
| `goodr.com` | 374 | **Eyewear** |
| `voyageeyewear.com` | ~1,000 | **Eyewear** (has a diff baseline) |

**Best demo combo:** `goodr.com, magicspoon.com, deathwishcoffee.com` — ~800 products
total, all Verified, done in ~1 minute.

> **Note on "Unverified":** stores that aren't Shopify, have `/products.json` disabled,
> or are mistyped (e.g. `jeins.com`) can't be scraped — ShopHound marks them
> **"Unverified this week"** instead of guessing. That refusal-to-fabricate *is* the
> product working correctly.

### 🖥️ Run locally

```shell
npm run dev                       # Mastra backend + Studio at http://localhost:4111
cd dashboard && npm run dev       # Next.js dashboard at http://localhost:3000
```

Requires env vars: `FEATHERLESS_API_KEY`, `QDRANT_URL`, `QDRANT_API_KEY`,
`ENKRYPT_API_KEY` (see `.env` for the full list). Set `COMPETITOR_STORES` to control the
weekly auto-run's default competitor set.

---

## 🧠 How it works

A 7-step Mastra workflow runs the pipeline:
**scrape → embed → diff → ground → generate → safety-audit → persist.**

### ⚡ Mastra — the backbone
- **Workflow** (`createStep` / `createWorkflow`): the typed, chained 7-step pipeline,
  scheduled weekly via Mastra's built-in **cron** (Monday 09:00 UTC).
- **Agent** with **Mastra Memory**: the reasoning agent that writes each Growth Brief,
  with persistent threads for long-term context.
- **Tools**: `scrape-live` (real-time catalog validation) and `semantic-query`
  (search over long-term memory in Qdrant).
- **Server**: `registerApiRoute()` adds custom **Hono** routes (`/briefs`, `/briefs/:id`,
  `/status`) to the same deployment — the read API the dashboard consumes.
- Deployed on **Mastra Cloud**.

### 🔷 Qdrant — the durable brain
- Three collections over cosine similarity: `competitor_products` (per-product vectors),
  `snapshot_records` (weekly catalog baselines), `growth_briefs` (archived audited briefs).
- **Semantic change-detection:** the diff engine rescues renamed / re-IDed products at
  **cosine ≥ 0.93**, so real changes aren't lost as noise.
- **Time-series baseline:** `snapshot_records` is *how the system knows what's new* — each
  run diffs the current catalog against the previous snapshot.
- Durable source of truth (LibSQL is ephemeral on the cloud container), shared across
  local dev and production.

### 🛡️ Enkrypt AI — the trust layer (the differentiator)
- A guardrail **"sandwich"**: **input grounding** (prompt-injection + toxicity on source
  data) and **output safety** (bias / policy / NSFW on the generated brief).
- A **deterministic numeric grounding** check forces every `$` and `%` in the brief to
  trace back to the verified diff data — the mechanism behind **0% hallucination**.
- Every brief carries a **PASS/FAIL audit trail**, surfaced in the dashboard as the
  **"Verified by Enkrypt AI"** badge and audit panel.

### 🤖 Supporting stack
- **Featherless AI** — all inference via one OpenAI-compatible endpoint: `Qwen2.5-72B`
  for brief writing, `Qwen3-Embedding-0.6B` (1024-dim) for vectors.
- **Next.js + Vercel** — the merchant dashboard, reading the Mastra API cross-origin.
- **Shopify `/products.json`** — zero-auth structured ingestion of catalog, pricing, and SKUs.

---

## 📊 Data flow

```
scrape (/products.json) → embed (Featherless) → upsert competitor_products
                                              → save snapshot_records
        ↓
diff current vs previous snapshot  ──►  structured change set
        ↓
Enkrypt grounding (input)  →  Agent writes brief  →  Enkrypt safety + numeric check (output)
        ↓
archive to growth_briefs (Qdrant)  ──►  dashboard reads /briefs
```
