import { Mail } from "lucide-react";
import { manualReadHref } from "@/lib/brief";

/**
 * "Email us to start tracking" for a store we can't read automatically. Uses the
 * server's ready-made mailto when there is one; otherwise builds one from the
 * configured address. Nothing when neither is known.
 */
export function ManualReadLink({
  mailto,
  email,
  store,
  className = "",
}: {
  mailto?: string | null;
  email?: string | null;
  store: string;
  className?: string;
}) {
  const href = mailto || (email ? manualReadHref(email, store) : null);
  if (!href) return null;
  return (
    <a href={href} className={`inline-flex items-center gap-1.5 font-semibold text-ink underline underline-offset-2 hover:no-underline ${className}`}>
      <Mail size={14} className="shrink-0" />
      Email us to start tracking
    </a>
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
