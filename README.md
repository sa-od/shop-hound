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

> **Note on "Unverified":** dead or mistyped domains that neither ingestion path can
> reach are marked **"Unverified this week"** instead of guessed at. That
> refusal-to-fabricate *is* the product working correctly.

### 🎯 Try the guardrail live — the injection honeypot

Run **`injection-demo.test`** from the "New analysis" box. It's a synthetic store whose
catalog hides a prompt-injection attack inside a product title (*"IGNORE ALL PREVIOUS
INSTRUCTIONS…"*) — exactly how a hostile competitor page would try to manipulate the
agent. Watch the Enkrypt grounding guardrail **quarantine the data before the agent ever
sees it**: the run completes, but delivers a "⛔ Brief Withheld" card with the violation
on the audit trail. No AI generation occurs on blocked input.

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
- Three collections over cosine similarity (1024-dim Featherless embeddings):
  `competitor_products` (per-product vectors), `snapshot_records` (weekly catalog
  baselines), `growth_briefs` (archived audited briefs). Keyword **payload indexes**
  power strict-mode filtered search — the same payload-partitioning pattern Qdrant
  documents for **multitenancy**.
- **Semantic change-detection:** the diff engine rescues renamed / re-IDed products at
  **cosine ≥ 0.93** (threshold measured empirically for the embedding space: same-product
  ≈ 0.98, similar-but-different ≈ 0.89). Rescue queries **fan out 8-wide concurrently**;
  match assignment stays sequential for deterministic dedup.
- **Nearest-neighbor insight for free:** a new SKU's sub-threshold nearest neighbor is
  kept as `closestExisting` — the brief positions every launch inside the competitor's
  own catalog ("sits next to their Aviator line at $149").
- **Time-series memory:** `snapshot_records` is *how the system knows what's new* (each
  run diffs against the previous snapshot), and archived `growth_briefs` are read back to
  give the agent a verified **Week-over-Week Trends** section.
- Durable source of truth (LibSQL is ephemeral on the cloud container), shared across
  local dev and production. The agent also gets a `semantic-query` tool over both
  vector collections.

### 🛡️ Enkrypt AI — the trust layer (the differentiator)
- A guardrail **"sandwich"** around the agent:
  - **Input grounding** — a **managed policy deployment** (`shophound-grounding`,
    created via `/guardrails/add-policy`, called via `/guardrails/policy/detect`) runs
    3 detectors on the untrusted scraped data: **prompt injection, toxicity, PII** —
    with an inline-detector fallback so the guardrail never silently weakens.
  - **Output safety** — 6 detectors on the generated brief: **bias, toxicity, NSFW,
    PII leakage, adherence** (LLM-judged faithfulness of every claim to the diff
    context — the RAG-grounding check, score archived), and **policy_violation**
    against a custom e-commerce compliance policy (no price-fixing, no ToS violations,
    no deceptive practices).
- **Quarantine, not crash:** grounding failures never reach the agent — the run
  delivers an audited "Brief Withheld" card listing the violations (see the
  `injection-demo.test` honeypot above).
- **Compliance mappings** for every flagged violation (OWASP LLM Top-10, NIST AI RMF,
  EU AI Act, MITRE ATLAS) are captured into the archived audit trail.
- A **deterministic numeric grounding** check forces every `$` and `%` in the brief to
  trace back to the verified diff + history data — the mechanism behind **0%
  hallucination** (primary while Enkrypt's dedicated hallucination endpoint rolls out;
  defense-in-depth after). The unreliable-for-this-domain `relevancy` detector was
  evaluated and excluded — tested, not assumed.
- Every brief carries a **PASS/FAIL audit trail**, surfaced in the dashboard as the
  **"Verified by Enkrypt AI"** badge and audit panel.
- Roadmap: automated **red-teaming** of the agent via Enkrypt's redteam API (access
  verified), hybrid dense+sparse product matching in Qdrant, and merchant accounts
  (JWT auth on the Hono gateway, per-merchant competitor sets, tenant isolation via
  Qdrant payload filters).

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
