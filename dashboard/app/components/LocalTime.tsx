"use client";

import { useSyncExternalStore } from "react";

/**
 * Dates and times in the viewer's own time zone and locale. The server can't
 * know either (it runs in UTC), so the server render and the first client
 * render use a UTC, en-US form; once mounted, the browser’s own form replaces it.
 * No zone name is shown: every time is simply the viewer’s local time.
 */

type Format = "datetime" | "date" | "shortdate" | "time" | "calendar";

const OPTIONS: Record<Format, Intl.DateTimeFormatOptions> = {
  datetime: { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" },
  date: { month: "long", day: "numeric", year: "numeric" },
  shortdate: { month: "short", day: "numeric" },
  time: { hour: "numeric", minute: "2-digit" },
  // A calendar date with no time (YYYY-MM-DD, e.g. a snapshot date): never shifted by a zone.
  calendar: { month: "short", day: "numeric", timeZone: "UTC" },
};

const noop = () => () => {};
/** False during the server render and hydration, true after. */
export function useMounted() {
  return useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
}

export function formatTime(iso: string, format: Format, local: boolean): string {
  const d = new Date(format === "calendar" && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  const opts = local ? OPTIONS[format] : { ...OPTIONS[format], timeZone: "UTC" };
  return d.toLocaleString(local ? undefined : "en-US", opts);
}

export function LocalTime({ iso, format = "datetime" }: { iso: string; format?: Format }) {
  const local = useMounted();
  return (
    <time dateTime={iso} suppressHydrationWarning>
      {formatTime(iso, format, local)}
    </time>
  );
}

/** When a waiting store is tried again: "at 2:20 pm", "on 15 Nov, 2:20 pm", or "shortly" once due. */
export function RetryTime({ iso }: { iso?: string }) {
  const local = useMounted();
  if (!iso) return <>later</>;
  const d = new Date(iso);
  if (local && d.getTime() <= Date.now()) return <>shortly</>;
  const sameDay = local ? d.toDateString() === new Date().toDateString() : true;
  return (
    <time dateTime={iso} suppressHydrationWarning>
      {sameDay ? `at ${formatTime(iso, "time", local)}` : `on ${formatTime(iso, "shortdate", local)}, ${formatTime(iso, "time", local)}`}
    </time>
  );
}
