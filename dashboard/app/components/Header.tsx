import Link from "next/link";
import { Radar } from "lucide-react";
import type { Status } from "@/lib/api";
import { LiveStatusPill } from "./LiveStatusPill";

export function Header({ status }: { status: Status }) {
  return (
    <header className="sticky top-0 z-10 border-b border-zinc-800/80 bg-zinc-950/70 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-4">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-lg border border-emerald-500/30 bg-emerald-500/10">
            <Radar size={18} className="text-emerald-400" />
          </span>
          <span className="font-semibold tracking-tight text-zinc-100">
            Growth Briefs
            <span className="ml-2 hidden text-xs font-normal text-zinc-500 sm:inline">Competitive Intelligence</span>
          </span>
        </Link>
        <LiveStatusPill initial={status} />
      </div>
    </header>
  );
}
