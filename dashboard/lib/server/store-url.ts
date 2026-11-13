import { promises as dns } from 'node:dns';
import { isIP } from 'node:net';
import { INJECTION_DEMO_DOMAIN } from './scraper';

/**
 * Turn whatever a user typed into ONE canonical store domain, or a clear,
 * user-facing rejection. This module is the source of truth: the UI only
 * trims, and shows `error` as-is.
 *
 *   goodr.com · GOODR.COM · https://www.goodr.com/collections/x?y#z → goodr.com
 *   shop.goodr.com → shop.goodr.com   (only "www." is dropped)
 *   bücher.de → xn--bcher-kva.de      (IDN → punycode)
 */

export type StoreUrlErrorCode = 'multiple' | 'invalid_url' | 'not_found' | 'private_address';

export type ParsedStore = { ok: true; domain: string } | { ok: false; code: StoreUrlErrorCode; error: string };

// TLDs that can never be a public store (RFC 2606 / 6761 / common internal).
const RESERVED_TLDS = new Set(['localhost', 'local', 'invalid', 'test', 'example', 'internal', 'lan', 'home', 'corp', 'intranet', 'localdomain', 'arpa', 'onion']);

const LABEL_RE = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
const TLD_RE = /^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;

const fail = (code: StoreUrlErrorCode, error: string): ParsedStore => ({ ok: false, code, error });
const NOT_A_STORE = (input: string) => fail('invalid_url', `“${input}” doesn't look like a store website — try something like goodr.com`);

/** Syntax only (no network). */
export function parseStoreInput(raw: unknown): ParsedStore {
  if (typeof raw !== 'string') return fail('invalid_url', 'Enter a store website, like goodr.com');
  const input = raw.trim();
  if (!input) return fail('invalid_url', 'Enter a store website, like goodr.com');
  if (input.length > 2048) return fail('invalid_url', 'That address is too long');

  // More than one store: separators, or whitespace between two tokens.
  if (/[,;|]/.test(input) || /\S\s+\S/.test(input)) {
    return fail('multiple', 'Add one store at a time');
  }

  // The guardrail honeypot is a deliberate exception (.test TLD).
  if (input.toLowerCase() === INJECTION_DEMO_DOMAIN) return { ok: true, domain: INJECTION_DEMO_DOMAIN };

  // Scheme: only http(s). "goodr.com:443" is host:port, not a scheme.
  let withScheme: string;
  if (/^https?:\/\//i.test(input)) {
    withScheme = input;
  } else if (/^[a-z][a-z0-9+.-]*:(?!\d)/i.test(input) || input.startsWith('//')) {
    return fail('invalid_url', "Enter a store's web address, like goodr.com");
  } else {
    withScheme = `https://${input}`;
  }

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return NOT_A_STORE(input);
  }
  if (url.username || url.password) return fail('invalid_url', "Enter a store's web address, like goodr.com");

  // Hostname: lowercase (URL does it), IDN → punycode (URL does it),
  // trailing dot and a leading "www." removed.
  let host = url.hostname.replace(/\.$/, '');
  if (host.startsWith('[') || isIP(host)) return NOT_A_STORE(input);
  if (host.startsWith('www.')) host = host.slice(4);

  const labels = host.split('.');
  if (host.length > 253 || labels.length < 2 || !labels.every(l => LABEL_RE.test(l))) return NOT_A_STORE(input);
  const tld = labels[labels.length - 1];
  if (!TLD_RE.test(tld) || RESERVED_TLDS.has(tld)) return NOT_A_STORE(input);

  return { ok: true, domain: host };
}

// ── Address safety ────────────────────────────────────────────────────────────

/**
 * True for addresses a public store can never live on: loopback, private
 * ranges, link-local (incl. the cloud metadata endpoint 169.254.169.254),
 * CGNAT, multicast, unspecified, and their IPv6 equivalents.
 */
export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 || // this-net, private, loopback, multicast/reserved
      (a === 169 && b === 254) || // link-local / metadata
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) || // CGNAT
      (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) // special-purpose / benchmarking
    );
  }
  if (v === 6) {
    const s = ip.toLowerCase();
    if (s === '::' || s === '::1') return true;
    // IPv4-mapped/-translated, dotted (::ffff:127.0.0.1) or hex (::ffff:7f00:1,
    // which is how URL() writes it) — judge the embedded IPv4 address.
    const dotted = s.match(/^::(?:ffff:(?:0:)?)?(\d+\.\d+\.\d+\.\d+)$/);
    if (dotted) return isPrivateAddress(dotted[1]);
    const hex = s.match(/^::(?:ffff:(?:0:)?)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hex) {
      const [hi, lo] = [Number.parseInt(hex[1], 16), Number.parseInt(hex[2], 16)];
      return isPrivateAddress(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
    if (/^64:ff9b::/.test(s)) return false; // NAT64 of a public address — allowed
    return /^(fc|fd)/.test(s) || /^fe[89ab]/.test(s) || s.startsWith('ff'); // ULA, link-local, multicast
  }
  return true; // not an IP at all → never connect
}

const LOOKUP_TIMEOUT_MS = 3_000;

async function lookupAll(host: string): Promise<string[] | null> {
  try {
    const res = await Promise.race([
      dns.lookup(host, { all: true, verbatim: true }),
      new Promise<never>((_, reject) => setTimeout(() => reject(Object.assign(new Error('timeout'), { code: 'ETIMEOUT' })), LOOKUP_TIMEOUT_MS)),
    ]);
    return res.map(r => r.address);
  } catch {
    return null; // NXDOMAIN, no records, or timed out — treat as "no website"
  }
}

/**
 * Parse + check the store exists on the public internet: the domain (or its
 * www. form — some stores only answer there) must resolve, and only to public
 * addresses. Runs before anything is queued, so a typo costs nothing.
 */
export async function resolveStoreInput(raw: unknown): Promise<ParsedStore> {
  const parsed = parseStoreInput(raw);
  if (!parsed.ok || parsed.domain === INJECTION_DEMO_DOMAIN) return parsed;
  const { domain } = parsed;

  const [apex, www] = await Promise.all([lookupAll(domain), lookupAll(`www.${domain}`)]);
  const addresses = [...(apex ?? []), ...(www ?? [])];
  if (addresses.length === 0) {
    return fail('not_found', `We couldn't find a website at ${domain}`);
  }
  if (addresses.some(isPrivateAddress)) {
    return fail('private_address', `${domain} points to a private network address — only public store websites can be analysed`);
  }
  return parsed;
}
