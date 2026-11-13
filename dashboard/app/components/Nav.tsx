"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/", label: "This week", match: (p: string) => p === "/" },
  { href: "/briefs", label: "Briefs", match: (p: string) => p.startsWith("/briefs") },
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
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
