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

async function enkryptPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${ENKRYPT_BASE_URL}${path}`, {
    method: 'POST',
    headers: { apikey: apiKey()!, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Enkrypt ${path} failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as T;
}

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

/**
 * GROUNDING checkpoint (input side).
 * Scans the scraped/diff payload that is about to reach the reasoning agent:
 * scraped web content is untrusted input, so we check for prompt injection and
 * toxic content smuggled inside product data.
 */
export async function groundingCheck(diffText: string): Promise<GuardrailVerdict> {
  if (!apiKey()) return disabledVerdict('grounding');

  const res = await enkryptPost<DetectResponse>('/guardrails/detect', {
    text: diffText.slice(0, 30_000),
    detectors: {
      injection_attack: { enabled: true },
      toxicity: { enabled: true },
    },
  });

  const violations: string[] = [];
  const s = res.summary as { injection_attack?: number; toxicity?: unknown[] };
  if (s.injection_attack) violations.push('prompt injection detected in scraped payload');
  if (Array.isArray(s.toxicity) && s.toxicity.length > 0) {
    violations.push(`toxic content in scraped payload: ${s.toxicity.join(', ')}`);
  }

  return {
    checkpoint: 'grounding',
    greenLight: violations.length === 0,
    enkryptEnabled: true,
    violations,
    detail: { summary: res.summary },
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

/**
 * SAFETY checkpoint (output side) — two checks:
 *  1. Grounding audit — Enkrypt /guardrails/hallucination when available,
 *     deterministic numeric verification as fallback. PRD metric: 0% hallucination.
 *  2. Enkrypt /guardrails/detect — bias framing + policy violations (price-fixing, ToS).
 */
export async function safetyAudit(brief: string, diffContext: string): Promise<GuardrailVerdict> {
  if (!apiKey()) return disabledVerdict('safety');

  const hallucinationPromise: Promise<HallucinationResponse | null> = enkryptPost<HallucinationResponse>(
    '/guardrails/hallucination',
    {
      request_text:
        'Write a weekly competitive intelligence growth brief strictly grounded in the provided structured diff data.',
      response_text: brief.slice(0, 30_000),
      context: diffContext.slice(0, 30_000),
    },
  ).catch(err => {
    console.warn('[enkrypt] hallucination endpoint unavailable, using deterministic grounding:', String(err).slice(0, 200));
    return null;
  });

  const [hallucination, detect] = await Promise.all([
    hallucinationPromise,
    enkryptPost<DetectResponse>('/guardrails/detect', {
      text: brief.slice(0, 30_000),
      detectors: {
        bias: { enabled: true },
        toxicity: { enabled: true },
        nsfw: { enabled: true },
        policy_violation: {
          enabled: true,
          policy_text: SAFETY_POLICY_TEXT,
          need_explanation: true,
        },
      },
    }),
  ]);

  const violations: string[] = [];

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
  };
  if (s.bias) {
    const biasDetail = (detect.details as any)?.bias;
    violations.push(`biased framing detected${biasDetail?.biased_text ? `: "${biasDetail.biased_text}"` : ''}`);
  }
  if (s.policy_violation) {
    const pv = (detect.details as any)?.policy_violation;
    violations.push(`policy violation${pv?.explanation ? `: ${pv.explanation}` : ''}`);
  }
  if (Array.isArray(s.toxicity) && s.toxicity.length > 0) violations.push('toxic content in brief');
  if (s.nsfw) violations.push('nsfw content in brief');

  return {
    checkpoint: 'safety',
    greenLight: violations.length === 0,
    enkryptEnabled: true,
    violations,
    detail: {
      groundingMethod: hallucination
        ? 'enkrypt-hallucination + deterministic-numeric'
        : 'deterministic-numeric (Enkrypt hallucination endpoint not yet available)',
      hallucinationScore: hallucination?.summary.is_hallucination ?? null,
      detectSummary: detect.summary,
    },
  };
}
