import Link from "next/link";
import type { Status } from "@/lib/api";
import { Nav } from "./Nav";
import { RunControl } from "./RunControl";

export function TopBar({ status }: { status: Status }) {
  return (
    <header className="sticky top-0 z-20 bg-ink text-white">
      <div className="mx-auto flex h-14 max-w-[1280px] items-center gap-6 px-4 sm:gap-10 sm:px-8">
        <Link href="/" className="hidden font-cond text-[22px] font-extrabold leading-none tracking-tight sm:block">
          Growth Briefs
        </Link>
        <Nav />
        <RunControl initial={status} />
      </div>
    </header>
  );
}
