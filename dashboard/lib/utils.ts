export const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4111";

export function formatWeek(weekOf: string) {
  const [y, m, d] = weekOf.split("-").map(Number);
  if (!y) return weekOf;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,12}$/;

export function isValidDomain(raw: string): boolean {
  let d = raw.trim().toLowerCase();
  d = d.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/:\d+$/, "");
  if (!d || d.length > 253) return false;
  if (["localhost", "localhost.localdomain", "example.test", "injection-demo.test"].includes(d)) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(d)) return false;
  if (/^\[/.test(d)) return false;
  if (!DOMAIN_RE.test(d)) return false;
  const labels = d.split(".");
  if (labels.some(l => l.length === 0 || l.length > 63)) return false;
  const tld = labels[labels.length - 1];
  if (tld.length < 2 || tld.length > 12) return false;
  const namePart = labels.slice(0, -1).join(".");
  if (/^\d+$/.test(namePart.replace(/-/g, ""))) return false;
  return true;
}
