"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/", label: "This week", short: "This week", match: (p: string) => p === "/" },
  // Store pages and per-run briefs sit under My competitors.
  {
    href: "/competitors",
    label: "My competitors",
    short: "Competitors",
    match: (p: string) => p.startsWith("/competitors") || p.startsWith("/stores") || p.startsWith("/briefs"),
  },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="flex h-full items-stretch">
      {ITEMS.map((item) => {
        const active = item.match(pathname);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`flex items-center border-b-[3px] px-2.5 pt-[3px] text-sm transition-colors duration-150 sm:px-3.5 ${
              active ? "border-sticker font-semibold text-white" : "border-transparent text-[#a8abb2] hover:text-white"
            }`}
          >
            <span className="sm:hidden">{item.short}</span>
            <span className="hidden sm:inline">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
