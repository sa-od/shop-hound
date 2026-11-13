import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { Agent, fetch as undiciFetch, type RequestInit, type Response } from 'undici';
import { isIP } from 'node:net';
import { isPrivateAddress } from './store-url';

/**
 * fetch() for user-supplied hosts. The scraper requests addresses that users
 * typed, so a host resolving to a private/internal address (or redirecting to
 * one) could make this server probe its own network or the cloud metadata
 * endpoint. The check runs inside the connection's DNS lookup — on the very
 * address being connected to — so a record that changes between a pre-check
 * and the fetch (DNS rebinding), or a redirect to an internal host, is caught.
 */

class PrivateAddressError extends Error {
  code = 'EPRIVATEADDR';
  constructor(host: string, address: string) {
    super(`${host} resolves to a private address (${address}) — refusing to connect`);
  }
}

const agent = new Agent({
  connect: {
    lookup(hostname, options, callback) {
      dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
        if (err) return callback(err, '', 0);
        const list = addresses as LookupAddress[];
        const bad = list.find(a => isPrivateAddress(a.address));
        if (bad) return callback(new PrivateAddressError(hostname, bad.address), '', 0);
        if ((options as { all?: boolean }).all) return (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, list);
        callback(null, list[0].address, list[0].family);
      });
    },
  },
  // Stores answer in well under this; anything slower is treated as down.
  connectTimeout: 10_000,
});

const MAX_REDIRECTS = 5;

/**
 * Refuse a URL before connecting: only http(s), and never an IP literal in a
 * private range — a literal skips DNS, so the lookup check above can't see it
 * (e.g. a store redirecting to http://169.254.169.254/).
 */
export function assertPublicUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw Object.assign(new Error(`refusing to fetch ${url.protocol} URL`), { code: 'EPRIVATEADDR' });
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) && isPrivateAddress(host)) throw new PrivateAddressError(host, host);
  return url;
}

/** fetch() that checks every hop: redirects are followed here, one by one. */
export async function safeFetch(url: string, init: RequestInit = {}): Promise<Response> {
  let current = assertPublicUrl(url);
  for (let hop = 0; ; hop++) {
    const res = await undiciFetch(current, { ...init, dispatcher: agent, redirect: 'manual' });
    const location = res.headers.get('location');
    if (res.status < 300 || res.status >= 400 || !location) return res;
    if (hop >= MAX_REDIRECTS) throw Object.assign(new Error('too many redirects'), { code: 'ETOOMANYREDIRECTS' });
    await res.body?.cancel().catch(() => {});
    current = assertPublicUrl(new URL(location, current).toString());
  }
}

/**
 * A short, human reason for a failed store fetch — this text is shown on the
 * brief ("Unverified: connection refused"), so it must read well.
 */
export function describeFetchError(err: unknown): string {
  const e = err as { name?: string; code?: string; message?: string; cause?: { code?: string; message?: string } };
  const code = e?.cause?.code ?? e?.code;
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError' || code === 'UND_ERR_CONNECT_TIMEOUT') return 'timed out';
  switch (code) {
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return 'no website found at this address';
    case 'ECONNREFUSED':
      return 'connection refused';
    case 'ECONNRESET':
    case 'UND_ERR_SOCKET':
      return 'connection dropped';
    case 'EPRIVATEADDR':
      return 'points to a private network address';
    case 'ETOOMANYREDIRECTS':
      return 'too many redirects';
    case 'CERT_HAS_EXPIRED':
    case 'ERR_TLS_CERT_ALTNAME_INVALID':
    case 'DEPTH_ZERO_SELF_SIGNED_CERT':
    case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
      return 'invalid HTTPS certificate';
  }
  return (e?.cause?.message ?? e?.message ?? String(err)).slice(0, 160);
}
