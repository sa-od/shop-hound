import type { GuardrailVerdict } from './types';

/**
 * Enkrypt AI client — implements both halves of the "sandwich" (PRD §5.3):
 *  - grounding: scan untrusted scraped content BEFORE it reaches the agent
 *  - safety:    audit the generated brief (bias / policy / hallucination) AFTER
 *
 * If ENKRYPT_API_KEY is missing the pipeline still runs, but every verdict is
 * `greenLight: false, enkryptEnabled: false` — an unaudited brief can never be
 * mistaken for a verified one (PRD §11 audit-log requirement).
 */

const ENKRYPT_BASE_URL = process.env.ENKRYPT_BASE_URL ?? 'https://api.enkryptai.com';

// The compliance policy the output audit enforces (PRD §5.3 / §11).
const SAFETY_POLICY_TEXT = `Competitive intelligence briefs for e-commerce merchants must never:
1. Suggest price-fixing, price collusion, or coordinating prices with competitors.
2. Advise scraping content behind logins, bypassing paywalls, CAPTCHAs, or access controls.
3. Recommend violating any platform's Terms of Service (Shopify or otherwise).
4. Recommend deceptive practices: fake reviews, astroturfing, impersonating competitors or customers.
5. Contain defamatory or disparaging claims about competitors that are not supported by data.
Factual pricing observations and independent pricing decisions based on public data are allowed.`;

function apiKey(): string | undefined {
  return process.env.ENKRYPT_API_KEY;
}

// Enkrypt's detectors intermittently 5xx (observed: /guardrails/detect → 503
// with `"bias": null` in the body, then 200 on the next identical call).
// Retry fast server errors only — never timeouts, which would multiply the
// run's worst case against the 300s function limit. Exhausted retries still
// throw, and callers fail closed.
const SERVER_ERROR_RETRIES = 2;
// Endpoints that answer 503 by design until the vendor ships them — retrying is pointless.
const NOT_YET_RELEASED = ['/guardrails/hallucination'];

async function enkryptPost<T>(path: string, body: unknown, extraHeaders?: Record<string, string>): Promise<T> {
  const retries = NOT_YET_RELEASED.includes(path) ? 0 : SERVER_ERROR_RETRIES;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${ENKRYPT_BASE_URL}${path}`, {
      method: 'POST',
      headers: { apikey: apiKey()!, 'Content-Type': 'application/json', ...extraHeaders },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    if (res.ok) return (await res.json()) as T;
    const text = await res.text();
    // 429 = per-second rate limit ("Second Rate limit exceeded"): waiting a
    // moment is exactly the fix.
    if ((res.status >= 500 || res.status === 429) && attempt < retries) {
      console.warn(`[enkrypt] ${path} → ${res.status}, retrying (${attempt + 1}/${retries})`);
      await new Promise(r => setTimeout(r, 1_200 * (attempt + 1)));
      continue;
    }
    throw new Error(`Enkrypt ${path} failed: ${res.status} ${text}`);
  }
}

// Managed guardrails policy on the Enkrypt platform (created via
// /guardrails/add-policy): the grounding detector set lives as a named,
// centrally-editable deployment instead of inline per-call config. The
// output-side audit stays inline (its policy_violation text is call-specific).
const GROUNDING_POLICY = 'shophound-grounding';

interface DetectResponse {
  summary: Record<string, unknown>;
  details: Record<string, unknown>;
  result_message?: string | null;
}

interface HallucinationResponse {
  summary: { is_hallucination: number };
  details: Record<string, unknown>;
}

function disabledVerdict(checkpoint: 'grounding' | 'safety'): GuardrailVerdict {
  return {
    checkpoint,
    greenLight: false,
    enkryptEnabled: false,
    violations: ['ENKRYPT_API_KEY not set — brief is UNAUDITED, no green light possible'],
  };
}

// PII entities per checkpoint. person_name is excluded everywhere (products are
// routinely named after people — "Erika", "Wayfarer"). phone_number is excluded
// on INPUT: numeric Shopify product IDs (e.g. 9798669205721) false-match as
// phone numbers and quarantined legitimate runs for weeks. The generated brief
// is prose without raw IDs, so the output audit keeps the phone check.
const INPUT_PII_ENTITIES = ['email'];
const OUTPUT_PII_ENTITIES = ['email', 'phone_number'];

/** Pull compliance-framework tags (OWASP LLM Top-10, NIST AI RMF, EU AI Act…) for flagged detectors. */
function complianceTags(details: Record<string, unknown>, flagged: string[]): Record<string, unknown> {
  const tags: Record<string, unknown> = {};
  for (const name of flagged) {
    const mapping = (details as any)?.[name]?.compliance_mapping;
    if (mapping && Object.keys(mapping).length > 0) tags[name] = mapping;
  }
  return tags;
}

/**
 * GROUNDING checkpoint (input side).
 * Scans the scraped/diff payload that is about to reach the reasoning agent:
 * scraped web content is untrusted input, so we check for prompt injection,
 * toxic content, and PII smuggled inside product data.
 */
export async function groundingCheck(diffText: string): Promise<GuardrailVerdict> {
  if (!apiKey()) return disabledVerdict('grounding');

  const text = diffText.slice(0, 30_000);
  // Prefer the managed policy deployment; fall back to inline detector config
  // so the guardrail never silently weakens if the policy is renamed/deleted.
  // If Enkrypt itself is unreachable/incompatible (their API has drifted
  // before), FAIL CLOSED with a persisted verdict instead of killing the run.
  let res: DetectResponse;
  try {
    res = await enkryptPost<DetectResponse>(
      '/guardrails/policy/detect',
      { text },
      { 'x-enkrypt-policy': GROUNDING_POLICY },
    ).catch(err => {
      console.warn(`[enkrypt] policy "${GROUNDING_POLICY}" unavailable, using inline detectors:`, String(err).slice(0, 150));
      return enkryptPost<DetectResponse>('/guardrails/detect', {
        text,
        detectors: {
          injection_attack: { enabled: true },
          toxicity: { enabled: true },
          pii: { enabled: true, entities: INPUT_PII_ENTITIES },
        },
      });
    });
  } catch (err) {
    return {
      checkpoint: 'grounding',
      greenLight: false,
      enkryptEnabled: true,
      violations: [`grounding guardrail unavailable — input treated as unverified: ${String(err).slice(0, 200)}`],
      detail: { enkryptError: true },
    };
  }

  const violations: string[] = [];
  const flagged: string[] = [];
  const s = res.summary as { injection_attack?: number; toxicity?: unknown[]; pii?: number };
  if (s.injection_attack) {
    violations.push('prompt injection detected in scraped payload');
    flagged.push('injection_attack');
  }
  if (Array.isArray(s.toxicity) && s.toxicity.length > 0) {
    violations.push(`toxic content in scraped payload: ${s.toxicity.join(', ')}`);
    flagged.push('toxicity');
  }
  if (s.pii) {
    const entities = Object.keys((res.details as any)?.pii?.entities ?? {});
    violations.push(`PII detected in scraped payload (${entities.join(', ') || 'unspecified'})`);
    flagged.push('pii');
  }

  return {
    checkpoint: 'grounding',
    greenLight: violations.length === 0,
    enkryptEnabled: true,
    violations,
    detail: { summary: res.summary, compliance: complianceTags(res.details, flagged) },
  };
}

/**
 * Deterministic numeric grounding: every dollar amount and percentage in the
 * brief must literally exist in the structured diff. Used as the primary
 * hallucination check while Enkrypt's /guardrails/hallucination endpoint is
 * rolling out (currently 503 "coming soon"), and as defense-in-depth after.
 */
export function verifyNumericGrounding(brief: string, diffContext: string): string[] {
  // All numeric tokens appearing anywhere in the diff JSON (incl. inside strings)
  const allowed = new Set<number>();
  for (const m of diffContext.matchAll(/-?\d+(?:\.\d+)?/g)) {
    allowed.add(Math.abs(Number.parseFloat(m[0])));
  }
  // Section counts are legitimate derived numbers ("3 new SKUs")
  try {
    const diff = JSON.parse(diffContext);
    for (const d of diff.diffs ?? []) {
      for (const key of ['newSkus', 'removedSkus', 'priceChanges', 'titleChanges']) {
        allowed.add((d[key] ?? []).length);
      }
    }
    allowed.add((diff.unverified ?? []).length);
  } catch {
    // context not JSON — string token matching above still applies
  }

  const violations: string[] = [];
  // Only currency amounts and percentages — the fabrication risk the PRD targets
  for (const m of brief.matchAll(/\$\s?(\d[\d,]*(?:\.\d+)?)|(-?\d+(?:\.\d+)?)\s?%/g)) {
    const raw = (m[1] ?? m[2]).replace(/,/g, '');
    const value = Math.abs(Number.parseFloat(raw));
    if (!allowed.has(value)) {
      violations.push(`ungrounded number in brief: "${m[0].trim()}" does not appear in the verified diff`);
    }
  }
  return violations;
}

/** Normalized form for comparing a brief's prose against diff titles. */
function norm(s: string): string {
  return s.toLowerCase().replace(/[\u2018\u2019\u201c\u201d]/g, "'").replace(/\s+/g, ' ').replace(/[.,;:!?\u2026]+$/, '').trim();
}

/** A number in the brief may be a rounded form of the diff's value. */
function near(value: number, allowed: Set<number>): boolean {
  for (const a of allowed) {
    if (a === value) return true;
    if (Math.abs(a - value) <= 0.5) return true;
    if (a !== 0 && Math.abs(a - value) / Math.abs(a) <= 0.01) return true;
  }
  return false;
}

interface ProductFacts { title: string; numbers: Set<number> }

/** Every product the diff actually mentions, with the numbers that belong to it. */
function productFacts(diffContext: string): ProductFacts[] {
  let diff: any;
  try { diff = JSON.parse(diffContext); } catch { return []; }
  const facts: ProductFacts[] = [];
  for (const d of diff.diffs ?? []) {
    for (const key of ['newSkus', 'removedSkus', 'priceChanges', 'titleChanges']) {
      for (const item of d[key] ?? []) {
        const numbers = new Set<number>();
        for (const v of [item.price, item.oldPrice, item.newPrice, item.closestExisting?.price]) {
          if (typeof v === 'number') numbers.add(Math.abs(v));
        }
        if (typeof item.changePct === 'number') {
          numbers.add(Math.abs(item.changePct));
          numbers.add(Math.abs(Math.round(item.changePct)));
        }
        for (const t of [item.title, item.oldTitle, item.newTitle]) {
          if (typeof t === 'string' && t.trim()) facts.push({ title: t, numbers });
        }
        // A new SKU's closest existing product is a product the brief may name
        // in its own sentence ("…sits next to their {title} at ${price}"), so
        // it is a fact in its own right, carrying its own price.
        const closest = item.closestExisting;
        if (closest && typeof closest.title === 'string' && closest.title.trim() && typeof closest.price === 'number') {
          facts.push({ title: closest.title, numbers: new Set([Math.abs(closest.price)]) });
        }
      }
    }
    // A store's catalogue summary names its cheapest and priciest products.
    for (const item of [...(d.catalog?.cheapest ?? []), ...(d.catalog?.priciest ?? [])]) {
      if (typeof item?.title === 'string' && item.title.trim() && typeof item.price === 'number') {
        facts.push({ title: item.title, numbers: new Set([Math.abs(item.price)]) });
      }
    }
  }
  return facts;
}

const MONEY_OR_PCT = /\$\s?(\d[\d,]*(?:\.\d+)?)|(-?\d+(?:\.\d+)?)\s?%/g;

/**
 * PRODUCT grounding — the half `verifyNumericGrounding` cannot see.
 *
 * That check asks only "does this number appear somewhere in the diff?", so a
 * real price pinned to the wrong product, or to a product that does not exist,
 * passes clean. Both were reproduced against live audit context before this
 * was written. Two rules close it:
 *
 *  1. ATTRIBUTION — within a sentence that names known products, every dollar
 *     amount and percentage must belong to one of those products.
 *  2. EXISTENCE — a quoted product-looking string must correspond to a product
 *     in the diff.
 *
 * Rule 2 deliberately reads only straight-quoted spans. Briefs vary in style:
 * one model run quotes titles, another uses **bold** for section labels like
 * "Price Changes" — treating bold as a title reference would fail legitimate
 * briefs. Rule 1 carries the weight, and is style-independent because it
 * matches known titles anywhere in the prose.
 */
export function verifyProductGrounding(brief: string, diffContext: string): string[] {
  const facts = productFacts(diffContext);
  if (facts.length === 0) return [];
  const violations: string[] = [];
  const normBrief = norm(brief);

  // 1 — attribution, per sentence
  for (const sentence of brief.split(/(?<=[.!?])\s+|\n+/)) {
    const nSentence = norm(sentence);
    if (!nSentence) continue;
    const mentioned = facts.filter(f => nSentence.includes(norm(f.title)));
    if (mentioned.length === 0) continue; // no product named — global numeric check covers it
    const allowed = new Set<number>();
    for (const m of mentioned) for (const n of m.numbers) allowed.add(n);
    for (const m of sentence.matchAll(MONEY_OR_PCT)) {
      const value = Math.abs(Number.parseFloat((m[1] ?? m[2]).replace(/,/g, '')));
      if (!near(value, allowed)) {
        violations.push(
          `misattributed number in brief: "${m[0].trim()}" is not a value of ${mentioned.map(x => `"${x.title}"`).join(' / ')}`,
        );
      }
    }
  }

  // 2 — existence of quoted product references
  for (const m of brief.matchAll(/"([^"\n]{8,120})"/g)) {
    const quoted = norm(m[1]);
    if (!quoted.includes(' ')) continue; // single tokens are rarely product titles
    const known = facts.some(f => {
      const t = norm(f.title);
      return t.includes(quoted) || quoted.includes(t);
    });
    if (!known && !norm(diffContext).includes(quoted)) {
      violations.push(`ungrounded product in brief: "${m[1]}" does not appear in the verified diff`);
    }
  }

  return violations;
}

const BIAS_CHUNK_CHARS = 900;

/** Split markdown at headings / blank lines into chunks of at most ~BIAS_CHUNK_CHARS. */
export function chunkForDetection(text: string, max = BIAS_CHUNK_CHARS): string[] {
  const chunks: string[] = [];
  let cur = '';
  for (const para of text.split(/\n(?=#)|\n\s*\n/)) {
    if (!para.trim()) continue;
    if (cur && cur.length + para.length + 1 > max) {
      chunks.push(cur);
      cur = '';
    }
    // A single oversized paragraph is split hard rather than sent whole.
    for (let i = 0; i < para.length; i += max) {
      const piece = para.slice(i, i + max);
      if (cur && cur.length + piece.length + 1 > max) {
        chunks.push(cur);
        cur = piece;
      } else {
        cur = cur ? `${cur}\n${piece}` : piece;
      }
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

/**
 * Run the bias detector chunk by chunk; returns the chunks it flagged. Throws
 * if a chunk can't be checked. Sequential on purpose: Enkrypt enforces a
 * per-second rate limit, and the main detect call runs alongside this.
 */
async function detectBiasByChunk(text: string): Promise<string[]> {
  const chunks = chunkForDetection(text);
  const flagged: string[] = [];
  for (const [i, chunk] of chunks.entries()) {
    const res = await enkryptPost<DetectResponse>('/guardrails/detect', {
      text: chunk,
      detectors: { bias: { enabled: true } },
    });
    const bias = (res.summary as { bias?: number | null }).bias;
    if (bias === null || bias === undefined) {
      throw new Error(`bias detector returned no verdict for chunk ${i + 1}/${chunks.length}`);
    }
    if (bias) flagged.push(chunk);
  }
  return flagged;
}

// The instruction the reasoning agent answers — the hallucination endpoint
// judges the brief against it.
const BRIEF_INSTRUCTION =
  'Write a weekly competitive intelligence growth brief strictly grounded in the provided structured diff data.';

/**
 * SAFETY checkpoint (output side) — three layers:
 *  1. Grounding audit — Enkrypt /guardrails/hallucination when available,
 *     deterministic numeric verification always. PRD metric: 0% hallucination.
 *  2. Content detectors — bias, toxicity, nsfw, PII leakage, and policy
 *     violations (price-fixing, ToS) against the custom compliance policy.
 */
/**
 * Enkrypt's PII detector tags bare domain names as emails — reproduced:
 * "Verified: goodr.com (vs 2026-11-06)" → email "goodr.com", while
 * "Competitors: goodr.com, magicspoon.com." → no PII. Competitor domains are
 * in every brief, so the false positive would fail audits at random.
 *
 * So the text sent to Enkrypt replaces each competitor domain with a neutral
 * name — but never when it follows "@", so a real address (sales@goodr.com)
 * reaches the detector intact and is still caught. The deterministic
 * grounding checks keep reading the original brief.
 */
export function maskCompetitorDomains(text: string, diffContext: string): string {
  let competitors: string[] = [];
  try {
    competitors = (JSON.parse(diffContext).diffs ?? []).map((d: { competitor: string }) => d.competitor);
  } catch {
    return text;
  }
  // Longest first so "shop.example.com" is masked before "example.com".
  competitors.sort((a, b) => b.length - a.length);
  let masked = text;
  competitors.forEach(domain => {
    const escaped = domain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    masked = masked.replace(new RegExp(`(?<![@\\w.-])${escaped}(?![\\w-])`, 'gi'), `Competitor ${String.fromCharCode(65 + competitors.indexOf(domain))}`);
  });
  return masked;
}

export async function safetyAudit(brief: string, diffContext: string): Promise<GuardrailVerdict> {
  if (!apiKey()) return disabledVerdict('safety');
  const enkryptText = maskCompetitorDomains(brief, diffContext).slice(0, 30_000);

  const hallucinationPromise: Promise<HallucinationResponse | null> = enkryptPost<HallucinationResponse>(
    '/guardrails/hallucination',
    {
      request_text: BRIEF_INSTRUCTION,
      response_text: brief.slice(0, 30_000),
      context: diffContext.slice(0, 30_000),
    },
  ).catch(err => {
    console.warn('[enkrypt] hallucination endpoint unavailable, using deterministic grounding:', String(err).slice(0, 200));
    return null;
  });

  // NOTE on detector history (Enkrypt's detect API has drifted between
  // releases): `relevancy` was evaluated and excluded (false-flags on-topic
  // briefs); `adherence` worked in July 2026 but was later REMOVED upstream
  // ("Unknown detector(s): adherence") and crashed the pipeline for weeks —
  // deterministic numeric grounding remains the always-on grounding audit.
  //
  // `bias` runs separately, per chunk: on a whole brief it 503s with
  // `"bias": null` for certain passages (reproduced on a 2.5k-char brief:
  // first 500 chars → 200, 1000 → 503, 1500 → 200, 2000 → 503), while every
  // paragraph-sized chunk of the same text answers 200. Chunking keeps the
  // check's full coverage; a chunk that still fails throws → fail closed.
  let hallucination: HallucinationResponse | null;
  let detect: DetectResponse;
  let biasedChunks: string[];
  try {
    [hallucination, detect, biasedChunks] = await Promise.all([
      hallucinationPromise,
      enkryptPost<DetectResponse>('/guardrails/detect', {
        text: enkryptText,
        detectors: {
          toxicity: { enabled: true },
          nsfw: { enabled: true },
          pii: { enabled: true, entities: OUTPUT_PII_ENTITIES },
          policy_violation: {
            enabled: true,
            policy_text: SAFETY_POLICY_TEXT,
            need_explanation: true,
          },
        },
      }),
      detectBiasByChunk(enkryptText),
    ]);
  } catch (err) {
    // FAIL CLOSED, don't kill the run: the brief persists as not-green with an
    // explicit unaudited flag (plus whatever the deterministic check finds).
    return {
      checkpoint: 'safety',
      greenLight: false,
      enkryptEnabled: true,
      violations: [
        `safety audit unavailable — brief is UNAUDITED, no green light: ${String(err).slice(0, 200)}`,
        ...verifyNumericGrounding(brief, diffContext),
        ...verifyProductGrounding(brief, diffContext),
      ],
      detail: { enkryptError: true, groundingMethod: 'deterministic-numeric only (Enkrypt detect failed)' },
    };
  }

  const violations: string[] = [];
  const flagged: string[] = [];

  if (hallucination && hallucination.summary.is_hallucination >= 0.5) {
    violations.push(
      `hallucination detected (score ${hallucination.summary.is_hallucination}): brief contains claims not grounded in the diff`,
    );
  }
  // Deterministic numeric grounding — always runs (primary check while the
  // Enkrypt endpoint rolls out, defense-in-depth once it's live)
  violations.push(...verifyNumericGrounding(brief, diffContext));
  // Attribution + product existence — see verifyProductGrounding.
  violations.push(...verifyProductGrounding(brief, diffContext));

  const s = detect.summary as {
    policy_violation?: number;
    toxicity?: unknown[];
    nsfw?: number;
    pii?: number;
  };
  const d = detect.details as any;
  // Bias is a WARNING, not a blocker: the detector false-flags neutral advice
  // reproducibly (e.g. "Consider exploring themes similar to {competitor}'s
  // new product launches…" → bias=1 on every call). It is recorded and shown
  // on the audit panel, but does not withhold the green light. Injection,
  // policy, toxicity, nsfw, PII and grounding remain blocking.
  const warnings = biasedChunks.map(chunk => {
    const excerpt = chunk.replace(/\s+/g, ' ').trim();
    return `possible biased framing (non-blocking): "${excerpt.length > 160 ? `${excerpt.slice(0, 160)}…` : excerpt}"`;
  });
  if (biasedChunks.length > 0) flagged.push('bias');
  if (s.policy_violation) {
    violations.push(`policy violation${d?.policy_violation?.explanation ? `: ${d.policy_violation.explanation}` : ''}`);
    flagged.push('policy_violation');
  }
  if (Array.isArray(s.toxicity) && s.toxicity.length > 0) {
    violations.push('toxic content in brief');
    flagged.push('toxicity');
  }
  if (s.nsfw) {
    violations.push('nsfw content in brief');
    flagged.push('nsfw');
  }
  if (s.pii) {
    const entities = Object.keys(d?.pii?.entities ?? {});
    violations.push(`PII leaked into brief (${entities.join(', ') || 'unspecified'})`);
    flagged.push('pii');
  }

  return {
    checkpoint: 'safety',
    greenLight: violations.length === 0,
    enkryptEnabled: true,
    violations,
    warnings,
    detail: {
      groundingMethod: hallucination
        ? 'enkrypt-hallucination + deterministic numeric/product grounding'
        : 'deterministic numeric + product grounding (Enkrypt hallucination detection not yet released by vendor)',
      hallucinationScore: hallucination?.summary.is_hallucination ?? null,
      detectSummary: detect.summary,
      compliance: complianceTags(detect.details, flagged),
    },
  };
}
