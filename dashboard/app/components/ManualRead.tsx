import { ExternalLink, Mail } from "lucide-react";
import { manualReadHref } from "@/lib/brief";

/**
 * "Email us to start tracking" for a store we can't read automatically. Uses the
 * server's ready-made mailto when there is one; otherwise builds one from the
 * configured address. Nothing when neither is known. `gmail`: the same email
 * as a Gmail web-compose link, offered beside it when the server sends one.
 */
export function ManualReadLink({
  mailto,
  gmail,
  email,
  store,
  className = "",
}: {
  mailto?: string | null;
  gmail?: string | null;
  email?: string | null;
  store: string;
  className?: string;
}) {
  const href = mailto || (email ? manualReadHref(email, store) : null);
  if (!href) return null;
  return (
    <span className={`inline-flex flex-wrap items-center gap-x-4 gap-y-1.5 ${className}`}>
      <a href={href} className="inline-flex items-center gap-1.5 font-semibold text-ink underline underline-offset-2 hover:no-underline">
        <Mail size={14} className="shrink-0" />
        Email us to start tracking
      </a>
      {gmail && (
        <a
          href={gmail}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-ink-2 underline decoration-ink-3/50 underline-offset-2 hover:text-ink hover:decoration-ink"
        >
          Open in Gmail
          <ExternalLink size={12} className="shrink-0" aria-hidden />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      )}
    </span>
  );
}

/** "Built on: Shopify (custom storefront)". */
export function PlatformTag({ name, className = "" }: { name?: string | null; className?: string }) {
  if (!name) return null;
  return (
    <span className={`inline-block rounded-full bg-shelf px-2.5 py-1 text-[11px] font-semibold leading-none text-ink-2 ${className}`}>
      Built on: {name}
    </span>
  );
}
