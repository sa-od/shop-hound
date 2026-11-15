import type { CompetitorDiff, StructuredDiff } from './types';

/**
 * Changes: the "This week" feed's facts. PURE and deterministic.
 *
 * The trust rule: a fact line is built from the diff by a fixed template,
 * never written by the AI. Every figure in it is copied from the diff (prices,
 * percentages as stored, counts), with the store's currency. The only AI text
 * is an optional `suggestion`, labelled as such (Phase 2).
 *
 * One change per store per kind, aggregated ("Cut 4 prices, up to 30%");
 * a single product gets its own sentence ("Cut X from $35.00 to $30.00 (−14.3%)").
 */

/** 'sale' and 'sold_out' arrive in Phase 2 (compare-at prices, availability vs the previous read). */
export type ChangeKind = 'price_cut' | 'sale' | 'sold_out' | 'removed' | 'new' | 'price_rise' | 'renamed';

export interface ChangeProduct {
  title: string;
  url: string;
  oldPrice?: number;
  newPrice?: number;
  /** price_cut / price_rise: the change as stored in the diff (one decimal, negative = cut). */
  pct?: number;
  /** new: the competitor's closest existing product. */
  closest?: { title: string; price: number };
  /** renamed: the title before. */
  oldTitle?: string;
}

export interface Change {
  /** Stable: `${briefId}:${store}:${kind}`. */
  id: string;
  store: string;
  briefId: string;
  kind: ChangeKind;
  /** Template-built sentence, exact figures from the diff. Never AI-written. */
  fact: string;
  figures: {
    oldPrice?: number;
    newPrice?: number;
    /** Single product: its change %. */
    pct?: number;
    /** Products in this change. */
    count?: number;
    /** Several price moves: the largest move, as a positive %. */
    maxPct?: number;
    /** Catalogue size after the change (removed/new). */
    catalogCount?: number;
  };
  currency: string;
  products: ChangeProduct[];
  /** 1 = act on first. Positions after ranking all changes together. */
  rank: number;
  /** Date of the read this was found in, and of the read it was compared with (YYYY-MM-DD). */
  readOn: string;
  comparedWith: string | null;
  /** Phase 2: one AI sentence for the top changes, policy-checked. */
  suggestion?: { text: string; checked: boolean };
}

// Ranking order: cuts, then (Phase 2) sales and sold-outs, removals, launches, rises, renames.
const KIND_ORDER: Record<ChangeKind, number> = { price_cut: 0, sale: 1, sold_out: 2, removed: 3, new: 4, price_rise: 5, renamed: 6 };

// ── Formatting (exact; no rounding beyond what the diff stores) ─────────────

export function money(amount: number, currency = 'USD'): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, currencyDisplay: 'narrowSymbol', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

/** Signed percent with a true minus sign: −14.3%, +5%. The value as stored. */
export function signedPct(pct: number): string {
  return `${pct < 0 ? '−' : '+'}${trim(Math.abs(pct))}%`;
}

const trim = (n: number) => String(Math.round(n * 10) / 10);

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// ── Diff → changes ──────────────────────────────────────────────────────────

/** Changes in ONE store's verified diff (others have nothing compared). Unranked (rank 0). */
export function changesFromCompetitorDiff(d: CompetitorDiff, briefId: string): Change[] {
  if (d.status !== 'verified') return [];
  const currency = d.catalog?.currency || 'USD';
  const $ = (n: number) => money(n, currency);
  const catalogCount = d.catalog?.productCount ?? d.productCount;
  const base = (kind: ChangeKind) => ({
    id: `${briefId}:${d.competitor}:${kind}`,
    store: d.competitor,
    briefId,
    kind,
    currency,
    rank: 0,
    readOn: d.currentSnapshotDate,
    comparedWith: d.previousSnapshotDate,
  });
  const out: Change[] = [];

  const priceMove = (kind: 'price_cut' | 'price_rise', verb: string) => {
    // A drop to $0 isn't a cut: the product stopped being sold online (catalog.unpriced).
    const moves = d.priceChanges
      .filter(p => (kind === 'price_cut' ? p.newPrice < p.oldPrice && p.newPrice > 0 : p.newPrice > p.oldPrice))
      .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct) || a.title.localeCompare(b.title));
    if (moves.length === 0) return;
    const products = moves.map(p => ({ title: p.title, url: p.url, oldPrice: p.oldPrice, newPrice: p.newPrice, pct: p.changePct }));
    if (moves.length === 1) {
      const [m] = moves;
      out.push({
        ...base(kind),
        fact: `${verb} ${m.title} from ${$(m.oldPrice)} to ${$(m.newPrice)} (${signedPct(m.changePct)})`,
        figures: { oldPrice: m.oldPrice, newPrice: m.newPrice, pct: m.changePct, count: 1 },
        products,
      });
    } else {
      const maxPct = Math.abs(moves[0].changePct);
      out.push({
        ...base(kind),
        fact: `${verb} ${moves.length} prices, up to ${trim(maxPct)}%`,
        figures: { count: moves.length, maxPct },
        products,
      });
    }
  };
  priceMove('price_cut', 'Cut');
  priceMove('price_rise', 'Raised');

  if (d.removedSkus.length > 0) {
    // The priciest product leads: it's the one most worth knowing about.
    const removed = [...d.removedSkus].sort((a, b) => b.price - a.price || a.title.localeCompare(b.title));
    const [top] = removed;
    out.push({
      ...base('removed'),
      fact:
        removed.length === 1
          ? `Removed ${top.title} — ${$(top.price)}. Catalogue now ${catalogCount}.`
          : `Removed ${removed.length} products, including ${top.title} — ${$(top.price)}. Catalogue now ${catalogCount}.`,
      figures: { count: removed.length, catalogCount },
      products: removed.map(p => ({ title: p.title, url: p.url, oldPrice: p.price })),
    });
  }

  if (d.newSkus.length > 0) {
    const added = [...d.newSkus].sort((a, b) => b.price - a.price || a.title.localeCompare(b.title));
    const prices = added.map(p => p.price);
    const lo = Math.min(...prices);
    const hi = Math.max(...prices);
    const at = lo === hi ? `at ${$(lo)}` : `from ${$(lo)} to ${$(hi)}`;
    const [only] = added;
    const next = added.length === 1 && only.closestExisting ? `, next to ${only.closestExisting.title} at ${$(only.closestExisting.price)}` : '';
    out.push({
      ...base('new'),
      fact: added.length === 1 ? `Added ${only.title} ${at}${next}.` : `Added ${added.length} products ${at}.`,
      figures: { count: added.length, ...(added.length === 1 ? { newPrice: only.price } : {}), catalogCount },
      products: added.map(p => ({
        title: p.title,
        url: p.url,
        newPrice: p.price,
        ...(p.closestExisting ? { closest: { title: p.closestExisting.title, price: p.closestExisting.price } } : {}),
      })),
    });
  }

  if (d.titleChanges.length > 0) {
    const renamed = [...d.titleChanges].sort((a, b) => a.newTitle.localeCompare(b.newTitle));
    const [only] = renamed;
    out.push({
      ...base('renamed'),
      fact: renamed.length === 1 ? `Renamed ${only.oldTitle} to ${only.newTitle}.` : `Renamed ${plural(renamed.length, 'product', 'products')}.`,
      figures: { count: renamed.length },
      products: renamed.map(t => ({ title: t.newTitle, url: t.url, oldTitle: t.oldTitle })),
    });
  }
  return out;
}

/** The size that orders changes within a kind: % for price moves, count otherwise. */
function magnitude(c: Change): number {
  if (c.kind === 'price_cut' || c.kind === 'price_rise' || c.kind === 'sale') return c.figures.maxPct ?? Math.abs(c.figures.pct ?? 0);
  return c.figures.count ?? 0;
}

/** Deterministic order: kind, then size (largest first), then store, then id. */
export function compareChanges(a: Change, b: Change): number {
  return KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || magnitude(b) - magnitude(a) || a.store.localeCompare(b.store) || a.id.localeCompare(b.id);
}

/** Sort and number changes 1..n. Returns new objects. */
export function rankChanges(changes: Change[]): Change[] {
  return [...changes].sort(compareChanges).map((c, i) => ({ ...c, rank: i + 1 }));
}

/** Every change in a brief's diff, ranked within the brief. */
export function changesFromDiff(diff: Pick<StructuredDiff, 'diffs'>, briefId: string): Change[] {
  return rankChanges(diff.diffs.flatMap(d => changesFromCompetitorDiff(d, briefId)));
}

/** Per-kind counts of products changed — for a store row's "4 changes". */
export function changeTotals(changes: Change[]): { total: number; byKind: Partial<Record<ChangeKind, number>> } {
  const byKind: Partial<Record<ChangeKind, number>> = {};
  let total = 0;
  for (const c of changes) {
    const n = c.figures.count ?? c.products.length;
    byKind[c.kind] = (byKind[c.kind] ?? 0) + n;
    total += n;
  }
  return { total, byKind };
}
