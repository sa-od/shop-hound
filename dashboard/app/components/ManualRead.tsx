import { Mail } from "lucide-react";
import { manualReadHref } from "@/lib/brief";

/** "Request the analysis by email" for a store we can't read automatically. Nothing when no address is configured. */
export function ManualReadLink({ email, store, className = "" }: { email?: string | null; store: string; className?: string }) {
  if (!email) return null;
  return (
    <a
      href={manualReadHref(email, store)}
      className={`inline-flex items-center gap-1.5 font-semibold text-ink underline underline-offset-2 hover:no-underline ${className}`}
    >
      <Mail size={14} className="shrink-0" />
      Request the analysis by email
    </a>
  );
}
