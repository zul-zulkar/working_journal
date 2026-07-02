import type { Activity, Category } from "./types";

// Framework-agnostic helpers ported from the prototype. Safe on server + client.

export const PALETTE = [
  "#0A84FF",
  "#FF9F0A",
  "#34C759",
  "#BF5AF2",
  "#FF375F",
  "#30B0C7",
  "#5E5CE6",
  "#FFD60A",
  "#AC8E68",
  "#64D2FF",
];

export function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export function parseD(iso: string): Date {
  const p = (iso || "").split("-").map(Number);
  return new Date(p[0] || 2000, (p[1] || 1) - 1, p[2] || 1);
}

export function toISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}

export function todayISO(): string {
  return toISO(new Date());
}

export function fmt(iso: string, opts: Intl.DateTimeFormatOptions): string {
  try {
    return new Intl.DateTimeFormat("id-ID", opts).format(parseD(iso));
  } catch {
    return iso;
  }
}

export function fmtLong(iso: string): string {
  return fmt(iso, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

export function fmtMed(iso: string): string {
  return fmt(iso, { day: "numeric", month: "short", year: "numeric" });
}

export function fmtDay(iso: string): string {
  return fmt(iso, { day: "numeric", month: "short" });
}

export function rangeLabel(s: string, e?: string): string {
  if (!e || s === e) return fmtMed(s);
  const ds = parseD(s);
  const de = parseD(e);
  if (ds.getFullYear() === de.getFullYear() && ds.getMonth() === de.getMonth()) {
    const mo = fmt(s, { month: "short" });
    return `${ds.getDate()}–${de.getDate()} ${mo} ${de.getFullYear()}`;
  }
  if (ds.getFullYear() === de.getFullYear()) return `${fmtDay(s)} – ${fmtMed(e)}`;
  return `${fmtMed(s)} – ${fmtMed(e)}`;
}

export function timeLabel(a: Pick<Activity, "startTime" | "endTime">): string {
  if (a.startTime && a.endTime) return `${a.startTime}–${a.endTime}`;
  if (a.startTime) return `mulai ${a.startTime}`;
  return "";
}

export function daysSpan(a: Pick<Activity, "startDate" | "endDate">): number {
  const s = parseD(a.startDate);
  const e = parseD(a.endDate || a.startDate);
  return Math.round((e.getTime() - s.getTime()) / 86400000) + 1;
}

export function catById(
  categories: Category[],
  id: string,
): Category | undefined {
  return categories.find((c) => c.id === id);
}

/** Pick black/white text for legibility on a hex background. */
export function readableOn(hex: string): string {
  try {
    const h = hex.replace("#", "");
    const r = parseInt(h.slice(0, 2), 16) / 255;
    const g = parseInt(h.slice(2, 4), 16) / 255;
    const b = parseInt(h.slice(4, 6), 16) / 255;
    const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return L > 0.62 ? "#1d1d1f" : "#ffffff";
  } catch {
    return "#fff";
  }
}

/** Evidence image url served through the internal proxy. */
export function imageUrl(fileId: string): string {
  return `/api/image/${encodeURIComponent(fileId)}`;
}
