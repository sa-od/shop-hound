// Pure helpers that turn a stored brief (markdown + diff) into what the UI shows.
// Client-safe: types only from the server modules.
import type { BriefDetail, CompetitorSummary } from './api';
import type { CompetitorDiff } from './server/types';

export interface BriefSections {
  summary: string;
  recommendations: string[];
  /** The analyst's text per store (from "Competitor Movements"), keyed by domain. */
  byStore: Map<string, string>;
  /** Everything else (trends, data confidence), as markdown. */
  rest: string;
}

/** Top-level list items; wrapped lines and nested items stay with their item. */
function listItems(body: string): string[] {
  const items: string[] = [];
  for (const line of body.split('\n')) {
    const top = line.match(/^(?:[-*+]|\d+[.)])\s+(.*)$/); // unindented bullet or number
    if (top) items.push(top[1].trim());
    else if (line.trim() && items.length) items[items.length - 1] += ` ${line.trim().replace(/^(?:[-*+]|\d+[.)])\s+/, '')}`;
    else if (line.trim() && !items.length) items.push(line.trim()); // prose without bullets
  }
  return items.filter(Boolean);
}

/** Split "### store.com" subsections of the movements section. */
function storeSections(body: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of body.split(/^#{3,4}\s+/m).slice(1)) {
    const nl = part.indexOf('\n');
    const name = (nl === -1 ? part : part.slice(0, nl)).replace(/[*`]/g, '').trim().toLowerCase();
    const text = nl === -1 ? '' : part.slice(nl + 1).trim();
    if (name && text) out.set(name, text);
  }
  return out;
}

/** Split the generated markdown on its `##`-level headings (any of #, ##, ###). */
export function splitBrief(markdown: string): BriefSections {
  const sections = markdown.split(/^#{1,2}\s+/m);
  let summary = '';
  let recommendations: string[] = [];
  let byStore = new Map<string, string>();
  const rest: string[] = [];
  let found = false;
  for (const part of sections.slice(1)) {
    const nl = part.indexOf('\n');
    const heading = (nl === -1 ? part : part.slice(0, nl)).trim();
    const h = heading.toLowerCase();
    const body = nl === -1 ? '' : part.slice(nl + 1).trim();
    // Briefs where nothing was read saved before the "## Summary" form used "# Nothing to report this time".
    if (/summary|nothing to report/.test(h)) {
      summary = body;
      found = true;
    } else if (/recommendation|what to do|next steps|actions/.test(h)) {
      recommendations = listItems(body);
      found = true;
    } else if (/movement/.test(h)) {
      byStore = storeSections(body);
      found = true;
      if (byStore.size === 0) rest.push(`## ${heading}\n\n${body}`); // unstructured: keep it readable
    } else if (/growth brief/.test(h) && !body) {
      // a document title with no body of its own
    } else rest.push(`## ${heading}\n\n${body}`);
  }
  // Blocked or legacy briefs without the expected sections are shown whole.
  if (!found) return { summary: '', recommendations: [], byStore: new Map(), rest: markdown };
  return { summary, recommendations, byStore, rest: rest.join('\n\n') };
}

export interface PriceTicket {
  competitor: string;
  title: string;
  url: string;
  oldPrice: number;
  newPrice: number;
  changePct: number;
}

/** Every price change in the brief, biggest move first. */
export function priceTickets(brief: BriefDetail): PriceTicket[] {
  const tickets: PriceTicket[] = [];
  for (const d of brief.diff?.diffs ?? []) {
    for (const p of d.priceChanges) {
      tickets.push({ competitor: d.competitor, title: p.title, url: p.url, oldPrice: p.oldPrice, newPrice: p.newPrice, changePct: p.changePct });
    }
  }
  return tickets.sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));
}

export function diffFor(brief: BriefDetail, competitor: string): CompetitorDiff | undefined {
  return brief.diff?.diffs.find(d => d.competitor === competitor);
}

/**
 * The store's catalog as read on this check, summarised from the snapshot
 * (backend: optional `catalog` on each read store's diff). Absent on briefs
 * saved before it existed; the UI then keeps its plainer wording.
 */
export interface CatalogSummary {
  productCount: number;
  currency: string;
  price: { min: number; median: number; max: number };
  priceBands: { label: string; count: number }[];
  inStock: number;
  soldOut: number;
  /** Whole percent, as the brief cites it. */
  inStockPct?: number;
  productTypes: { name: string; count: number }[];
  vendors: { name: string; count: number }[];
  avgVariants: number;
  cheapest: { title: string; price: number; url: string }[];
  priciest: { title: string; price: number; url: string }[];
}

/** The last successful read of a store that couldn't be read this time. */
export interface LastKnown {
  snapshotDate: string;
  productCount: number;
}

type WithExtras = { catalog?: CatalogSummary; lastKnown?: LastKnown };

export interface MovementRow extends CompetitorSummary {
  catalog?: CatalogSummary;
  lastKnown?: LastKnown;
  removed: number;
  /** Largest absolute price move, signed (−24 = a 24% cut). */
  biggest: number | null;
  total: number;
}

/** One row per competitor, busiest first; baseline and unverified stores last. */
export function movementRows(brief: BriefDetail): MovementRow[] {
  const rank = (s: string) => (s === 'verified' ? 0 : s === 'first_snapshot' ? 1 : 2);
  return brief.competitors
    .map(c => {
      const d = diffFor(brief, c.competitor);
      const biggest = d && d.priceChanges.length
        ? d.priceChanges.reduce((m, p) => (Math.abs(p.changePct) > Math.abs(m) ? p.changePct : m), 0)
        : null;
      const removed = d?.removedSkus.length ?? 0;
      // Read from the diff entry or the competitor summary, whichever the backend fills.
      const extra = { ...(c as WithExtras), ...(d as WithExtras | undefined) };
      return {
        ...c,
        catalog: extra.catalog,
        lastKnown: extra.lastKnown,
        removed,
        biggest,
        total: c.priceChanges + c.newSkus + c.titleChanges + removed,
      };
    })
    .sort((a, b) => rank(a.status) - rank(b.status) || b.total - a.total);
}

export function slug(domain: string) {
  return `store-${domain.replace(/[^a-z0-9]+/gi, '-')}`;
}

const money = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Prices come without a currency in the diff, so none is invented. */
export const formatPrice = (n: number) => money.format(n);

export function formatPct(n: number) {
  const r = Math.round(n);
  return `${r > 0 ? '+' : r < 0 ? '−' : ''}${Math.abs(r)}%`;
}

/** A price in the catalog's own currency; plain figures when the code isn't one Intl knows. */
export function formatMoney(n: number, currency?: string) {
  if (currency && /^[A-Z]{3}$/.test(currency)) {
    try {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(n);
    } catch {
      /* fall through */
    }
  }
  return formatPrice(n);
}

/** "429 products · $12.00–$98.00, median $35.00" */
export function catalogLine(c: CatalogSummary) {
  const m = (n: number) => formatMoney(n, c.currency);
  return `${c.productCount.toLocaleString()} products · ${m(c.price.min)}–${m(c.price.max)}, median ${m(c.price.median)}`;
}

export function shortDay(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/** "Last read Nov 6: 140 products" */
export function lastKnownLine(l: LastKnown) {
  return `Last read ${shortDay(l.snapshotDate)}: ${l.productCount.toLocaleString()} products`;
}
