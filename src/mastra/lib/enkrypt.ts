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
 * SAFETY checkpoint (output side) — two Enkrypt calls:
 *  1. /guardrails/hallucination — every claim in the brief must be grounded in
 *     the structured diff (context). PRD success metric: 0% hallucination.
 *  2. /guardrails/detect — bias framing + policy violations (price-fixing, ToS).
 */
export async function safetyAudit(brief: string, diffContext: string): Promise<GuardrailVerdict> {
  if (!apiKey()) return disabledVerdict('safety');

  const [hallucination, detect] = await Promise.all([
    enkryptPost<HallucinationResponse>('/guardrails/hallucination', {
      request_text:
        'Write a weekly competitive intelligence growth brief strictly grounded in the provided structured diff data.',
      response_text: brief.slice(0, 30_000),
      context: diffContext.slice(0, 30_000),
    }),
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

  if (hallucination.summary.is_hallucination >= 0.5) {
    violations.push(
      `hallucination detected (score ${hallucination.summary.is_hallucination}): brief contains claims not grounded in the diff`,
    );
  }

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
      hallucinationScore: hallucination.summary.is_hallucination,
      detectSummary: detect.summary,
    },
  };
}
