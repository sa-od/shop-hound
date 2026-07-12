"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, CheckCircle2 } from "lucide-react";
import type { Status } from "@/lib/api";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4111";

/**
 * Live status pill — polls /status so the header reflects reality without a
 * manual refresh. When a NEW brief lands (createdAt changes), it refreshes the
 * page so the card list updates, no matter where the run was triggered from.
 */
export function LiveStatusPill({ initial }: { initial: Status }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>(initial);
  const lastSeenRef = useRef<string | null>(initial.lastBrief?.createdAt ?? null);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(`${API}/status`, { cache: "no-store" });
        if (!res.ok) return;
        const s: Status = await res.json();
        if (cancelled) return;
        setStatus(s);
        const newest = s.lastBrief?.createdAt ?? null;
        if (newest && lastSeenRef.current && newest !== lastSeenRef.current) {
          lastSeenRef.current = newest;
          router.refresh(); // a new brief just landed — pull it into the list
        } else if (newest && !lastSeenRef.current) {
          lastSeenRef.current = newest;
        }
      } catch {
        /* transient — keep polling */
      }
    };
    const id = setInterval(tick, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [router]);

  if (status.running) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-500/30 bg-sky-500/10 px-3 py-1 text-xs text-sky-300">
        <Loader2 size={13} className="animate-spin" /> Run in progress
      </span>
    );
  }
  if (status.lastBrief) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1 text-xs text-zinc-300">
        <CheckCircle2 size={13} className="text-emerald-400" />
        Last run {status.lastBrief.weekOf}
      </span>
    );
  }
  return null;
}
