import Link from "next/link";
import { ExternalLink, ShieldAlert, ShieldCheck } from "lucide-react";
import type { BriefSummary } from "@/lib/api";
import { formatPct, formatPrice, type PriceTicket } from "@/lib/brief";

/** A price change as a shelf-edge ticket. The yellow sticker marks cuts only. */
export function Ticket({ t, showStore = true }: { t: PriceTicket; showStore?: boolean }) {
  const cut = t.changePct < 0;
  return (
    <a
      href={t.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group relative flex w-[188px] shrink-0 flex-col rounded-[4px] bg-stock px-3 pb-2.5 pt-3 shadow-ticket transition-transform duration-150 hover:-translate-y-0.5"
    >
      <span
        className={`absolute -right-1.5 -top-2 rotate-[4deg] rounded-[3px] px-2 py-1 font-cond text-base font-extrabold leading-none ${
          cut ? "bg-sticker text-ink" : "bg-ink text-white"
        }`}
      >
        {formatPct(t.changePct)}
      </span>
      <span className="line-clamp-2 min-h-[34px] pr-8 text-[13px] font-semibold leading-[1.3] group-hover:underline">{t.title}</span>
      {showStore && <span className="mt-0.5 truncate text-[11px] text-ink-3">{t.competitor}</span>}
      <span className="mt-2.5 text-xs text-ink-3">
        was <span className="line-through">{formatPrice(t.oldPrice)}</span>
      </span>
      <span className={`font-cond text-[38px] font-extrabold leading-none ${cut ? "text-cut" : "text-ink"}`}>
        {formatPrice(t.newPrice)}
      </span>
    </a>
  );
}

/** The grey shelf rail tickets hang on. */
export function Rail({ children }: { children: React.ReactNode }) {
  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-1 pt-3 sm:mx-0 sm:px-0">
      <div className="flex w-max gap-3 rounded-lg bg-rail p-3.5 pt-4 sm:w-fit sm:max-w-full sm:flex-wrap">
        {children}
      </div>
    </div>
  );
}

const STATUS: Record<string, { label: string; cls: string }> = {
  verified: { label: "Verified", cls: "bg-ok-soft text-ok" },
  first_snapshot: { label: "Baseline", cls: "bg-info-soft text-info" },
  unverified: { label: "Unverified", cls: "bg-warn-soft text-warn" },
};

export function StatusTag({ status }: { status: string }) {
  const s = STATUS[status] ?? { label: status, cls: "bg-shelf text-ink-2" };
  return <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold leading-none ${s.cls}`}>{s.label}</span>;
}

export function AuditTag({ passed }: { passed: boolean }) {
  return (
    <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold leading-none ${passed ? "bg-ok-soft text-ok" : "bg-warn-soft text-warn"}`}>
      {passed ? "Passed" : "Didn’t pass"}
    </span>
  );
}

/** One quiet line: the Enkrypt verdict, linking to the full audit. */
export function TrustLine({ brief }: { brief: BriefSummary }) {
  const checked = brief.competitors.filter((c) => c.status !== "unverified").length;
  const Icon = brief.greenLight ? ShieldCheck : ShieldAlert;
  return (
    <Link
      href={`/briefs/${brief.id}#audit`}
      className="inline-flex items-center gap-1.5 text-xs text-ink-2 hover:text-ink hover:underline"
    >
      <Icon size={14} className={checked === 0 ? "text-ink-3" : brief.greenLight ? "text-ok" : "text-warn"} />
      {checked === 0
        ? "No store data to verify"
        : `${brief.greenLight ? "Verified by Enkrypt AI" : "Did not pass the Enkrypt audit"} · ${checked} of ${brief.competitors.length} stores checked`}{" "}
      · Audit
    </Link>
  );
}

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-lg border border-edge bg-stock p-5 sm:p-6 ${className}`}>{children}</section>;
}

export function ProductLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="group inline-flex items-start gap-1 font-medium hover:underline">
      {children}
      <ExternalLink size={12} className="mt-1 shrink-0 text-ink-3 opacity-0 transition-opacity duration-150 group-hover:opacity-100" />
    </a>
  );
}

/** A product change as one row: name (+ detail line) left, figure right. Wraps instead of scrolling. */
export function ChangeRow({ title, href, detail, value, valueClass = "" }: { title: string; href?: string; detail?: React.ReactNode; value?: React.ReactNode; valueClass?: string }) {
  return (
    <li className="flex items-start justify-between gap-4 border-b border-[#eceef1] py-2.5 last:border-0">
      <div className="min-w-0 text-sm">
        {href ? <ProductLink href={href}>{title}</ProductLink> : <span className="font-medium">{title}</span>}
        {detail && <div className="mt-0.5 text-xs text-ink-3">{detail}</div>}
      </div>
      {value !== undefined && <div className={`shrink-0 text-right text-sm font-semibold ${valueClass}`}>{value}</div>}
    </li>
  );
}
