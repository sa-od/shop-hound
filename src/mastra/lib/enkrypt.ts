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

async function enkryptPost<T>(path: string, body: unknown, extraHeaders?: Record<string, string>): Promise<T> {
  const res = await fetch(`${ENKRYPT_BASE_URL}${path}`, {
    method: 'POST',
    headers: { apikey: apiKey()!, 'Content-Type': 'application/json', ...extraHeaders },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Enkrypt ${path} failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as T;
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
export async function safetyAudit(brief: string, diffContext: string): Promise<GuardrailVerdict> {
  if (!apiKey()) return disabledVerdict('safety');

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
  let hallucination: HallucinationResponse | null;
  let detect: DetectResponse;
  try {
    [hallucination, detect] = await Promise.all([
      hallucinationPromise,
      enkryptPost<DetectResponse>('/guardrails/detect', {
        text: brief.slice(0, 30_000),
        detectors: {
          bias: { enabled: true },
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

  const s = detect.summary as {
    bias?: number;
    policy_violation?: number;
    toxicity?: unknown[];
    nsfw?: number;
    pii?: number;
  };
  const d = detect.details as any;
  if (s.bias) {
    violations.push(`biased framing detected${d?.bias?.biased_text ? `: "${d.bias.biased_text}"` : ''}`);
    flagged.push('bias');
  }
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
    detail: {
      groundingMethod: hallucination
        ? 'enkrypt-hallucination + deterministic-numeric'
        : 'deterministic-numeric grounding (Enkrypt hallucination endpoint unavailable)',
      hallucinationScore: hallucination?.summary.is_hallucination ?? null,
      detectSummary: detect.summary,
      compliance: complianceTags(detect.details, flagged),
    },
  };
}
