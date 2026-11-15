# 🐕 ShopHound — AI Competitive Intelligence for Shopify

**Competitive intelligence Shopify merchants can actually trust — verified, never hallucinated.**

ShopHound scrapes competitor catalogs every week, detects what *actually* changed —
price drops, new SKUs, title edits — and delivers a verified **Growth Brief** with a
hard guarantee: **0% hallucination**. If a claim can't be traced to real scraped data,
it never makes the brief.

🔗 **Live app:** https://shop-hound.vercel.app/
⚙️ **Backend API:** https://my-mastara-engine.server.mastra.cloud/briefs

Built for the **HiDevs × Mastra Hackathon 2026**. It now runs as a Next.js app on Vercel with MongoDB Atlas,
OpenAI and Firecrawl, behind in-house guardrails (see [How it works](#-how-it-works)); the original
Mastra / Qdrant backend is legacy.

---

## 🚀 How to use & test

Open the live dashboard → **https://shop-hound.vercel.app/**

1. Browse the **Weekly Growth Briefs** — each card shows the competitor(s), a
   ✓ **Verified** badge, and stat chips (price changes · new SKUs · title changes).
2. Click any brief to see the full report: rendered markdown, per-competitor status,
   and the **audit panel** (grounding + safety PASS/FAIL — the trust story).
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
agent. Watch the grounding guardrail **quarantine the data before the agent ever
sees it**: the run completes, but delivers a "⛔ Brief Withheld" card with the violation
on the audit trail. No AI generation occurs on blocked input.

### 🖥️ Run locally

```shell
npm run dev                       # Mastra backend + Studio at http://localhost:4111
cd dashboard && npm run dev       # Next.js dashboard at http://localhost:3000
```

The dashboard (`dashboard/`) is the app: it needs `MONGODB_URI`, `OPENAI_API_KEY`,
`FIRECRAWL_API_KEY` and, in production, `CRON_SECRET` (see `dashboard/.env.local`).
The Mastra backend on port 4111 is legacy. `COMPETITOR_STORES` optionally adds a set of
stores that is always tracked. `ENKRYPT_*` variables are no longer read.

### 🚢 Deploy the backend (legacy: Mastra Cloud)

> **Legacy.** The app no longer uses the Mastra Cloud backend: the dashboard on Vercel
> runs the whole pipeline and deploys from `main` on push. These steps are kept only for
> the old Mastra deployment.

**Pushing to GitHub does not deploy the backend.** Mastra Cloud is deployed
explicitly from the CLI; only the Vercel dashboard tracks git.

```shell
npm run build
npx mastra server deploy -y --skip-build --env-file .env.production --skip-preflight
```

Both flags are load-bearing:

- `--env-file` — the repo has two env files (`.env`, `.env.production`) and the
  deploy refuses to guess. **`.env.production` is the one that ships**, so it must
  carry `OPENAI_API_KEY`. It is gitignored and therefore easy to leave behind when
  `.env` is updated — that drift has already blocked one deploy.
- `--skip-preflight` — preflight rejects `file:./intel.db` and `file:./mastra.db`
  as host-local storage. That is by design: `intel.db` is a disposable mirror
  (its writes are `.catch()`-ed) and durable state lives in Qdrant precisely
  because cloud disks are ephemeral.

⚠️ **Every deploy resets `mastra.db`**, which holds workflow run history and agent
memory. Briefs and snapshots are unaffected — they live in Qdrant. Export anything
you need from `/api/workflows/:id/runs` first.

Server env vars can also be changed *without* a deploy (needs `mastra auth login`):

```shell
npx mastra server env list
npx mastra server env set OPENAI_API_KEY "$OPENAI_API_KEY"   # sourced, not pasted
```

Vercel hosts only the dashboard and the weekly cron, and never calls a model — it
needs no `OPENAI_API_KEY`.

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
- Three collections over cosine similarity (1024-dim embeddings):
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

### 🛡️ In-house guardrails — the trust layer (the differentiator)
`dashboard/lib/server/guardrails.ts` wraps the agent in a guardrail **"sandwich"**:
- **Input grounding** (before the agent): scraped store data is untrusted.
  - **Fixed injection rules** catch instruction overrides, role changes,
    system/role markers, prompt-disclosure requests, tool or URL directives, and
    instructions aimed at the reader.
  - **An email rule** catches personal data.
  - **One small structured model call** classifies the data as clean, an injection
    attempt, or abusive content.
  - **Fails closed:** if the model call errors, the input is treated as unverified and
    the agent never runs on it.
- **Output safety** (after the agent):
  - **Deterministic numeric and product grounding** (blocking): every `$` and `%` must
    trace to the verified diff and history, every number in a sentence naming a product
    must belong to that product, and every quoted product must exist. This is the
    mechanism behind **0% hallucination**.
  - **An email and phone-number rule** catches leaked personal data.
  - **One structured model call** judges the brief against the compliance policy: no
    price-fixing or coordination, no bypassing access controls, no ToS violations, no
    deceptive practices, no unsupported disparagement. Each violation is quoted and
    explained. Possibly biased framing is recorded as a non-blocking warning.
- **Quarantine, not crash:** grounding failures never reach the agent. The run
  delivers an audited "Brief Withheld" card listing the violations (see the
  `injection-demo.test` honeypot above).
- Every brief carries a **PASS/FAIL audit trail** (`enabled: false` when a check
  couldn't run, which is never green), shown in the dashboard as the **Verified**
  badge and audit panel.
- These checks replaced the Enkrypt AI vendor, whose hallucination detector never shipped
  and whose detectors added failures (503s, removed detectors, domains flagged as PII).

### 🤖 Supporting stack
- **OpenAI** — all inference via one endpoint: `gpt-4o-mini` for brief writing,
  `text-embedding-3-small` for vectors, pinned to **1024 dims** via the `dimensions`
  parameter so it matches the collections created under the previous provider
  (see `EMBEDDING_DIMENSIONS` in `src/mastra/lib/openai.ts` — changing it means
  recreating every collection and losing the diff baselines).
- **Next.js + Vercel** — the merchant dashboard, reading the Mastra API cross-origin.
- **Shopify `/products.json`** — zero-auth structured ingestion of catalog, pricing, and SKUs.

---

## 📊 Data flow

```
scrape (/products.json) → embed (OpenAI)      → upsert competitor_products
                                              → save snapshot_records
        ↓
diff current vs previous snapshot  ──►  structured change set
        ↓
grounding guardrail (input)  →  Agent writes brief  →  safety audit + numeric/product grounding (output)
        ↓
archive to growth_briefs (Qdrant)  ──►  dashboard reads /briefs
```
