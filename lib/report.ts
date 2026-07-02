import type { JournalData } from "./types";
import { catById, fmt, fmtDay, imageUrl, parseD, rangeLabel, toISO, todayISO } from "./format";
import { ActivityItem, DayGroup, buildGroups, enrichActivity } from "./enrich";

export type ReportSection = "stats" | "timeline" | "grid" | "report";

export type ShareConfig = {
  title: string;
  from: string;
  to: string;
  stats: boolean;
  timeline: boolean;
  grid: boolean;
  report: boolean;
};

export type CatStat = {
  name: string;
  color: string;
  count: number;
  pct: number;
  barStyle: string;
};

export type GRow = {
  title: string;
  dateLabel: string;
  color: string;
  barStyle: string;
  images: string[];
};

export type Tick = { left: number; label: string };

export type ReportModel = {
  title: string;
  rangeLabel: string;
  from: string;
  to: string;
  showStats: boolean;
  showTimeline: boolean;
  showGrid: boolean;
  showReport: boolean;
  total: number;
  catCount: number;
  rangeDays: number;
  catStats: CatStat[];
  items: ActivityItem[];
  gRows: GRow[];
  ticks: Tick[];
  groups: DayGroup[];
  empty: boolean;
  generated: string;
};

const ALL_SECTIONS: ReportSection[] = ["stats", "timeline", "grid", "report"];

export function actsInRange(data: JournalData, cfg: Pick<ShareConfig, "from" | "to">) {
  return data.activities.filter(
    (a) => (a.endDate || a.startDate) >= cfg.from && a.startDate <= cfg.to,
  );
}

export function buildReport(data: JournalData, cfg: ShareConfig): ReportModel {
  const { categories } = data;
  const acts = actsInRange(data, cfg).slice();
  acts.sort((a, b) => (a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : 0));
  const items = acts.map((a) => enrichActivity(a, categories));
  const total = acts.length;

  const catMap: Record<
    string,
    { name: string; color: string; count: number }
  > = {};
  acts.forEach((a) => {
    const c = catById(categories, a.categoryId);
    const k = c ? c.id : "none";
    catMap[k] = catMap[k] || {
      name: c ? c.name : "Tanpa Kategori",
      color: c ? c.color : "#8e8e93",
      count: 0,
    };
    catMap[k].count++;
  });
  const catStats: CatStat[] = Object.keys(catMap)
    .map((k) => catMap[k])
    .sort((a, b) => b.count - a.count)
    .map((s) => ({
      name: s.name,
      color: s.color,
      count: s.count,
      pct: total ? Math.round((s.count / total) * 100) : 0,
      barStyle: `width:${total ? (s.count / total) * 100 : 0}%;background:${s.color};`,
    }));

  const dayMs = 86400000;
  const fromD = parseD(cfg.from);
  const toD = parseD(cfg.to);
  const rangeDays = Math.max(
    1,
    Math.round((toD.getTime() - fromD.getTime()) / dayMs) + 1,
  );

  const gRows: GRow[] = acts.map((a) => {
    const s = parseD(a.startDate);
    const e = parseD(a.endDate || a.startDate);
    const cs = s < fromD ? fromD : s;
    const ce = e > toD ? toD : e;
    const left = ((cs.getTime() - fromD.getTime()) / dayMs / rangeDays) * 100;
    const width = (((ce.getTime() - cs.getTime()) / dayMs + 1) / rangeDays) * 100;
    const c = catById(categories, a.categoryId);
    const color = c ? c.color : "#8e8e93";
    const imgs = (a.evidence || [])
      .filter((x) => x.type === "image")
      .map((x) => imageUrl(x));
    return {
      title: a.title,
      dateLabel: rangeLabel(a.startDate, a.endDate),
      color,
      barStyle: `left:${left.toFixed(3)}%;width:${Math.max(width, 1.2).toFixed(
        3,
      )}%;background:${color};`,
      images: imgs,
    };
  });

  const tcount = Math.min(rangeDays, 8);
  const ticks: Tick[] = [];
  const denom = Math.max(tcount - 1, 1);
  for (let i = 0; i < tcount; i++) {
    const dd = new Date(fromD);
    dd.setDate(dd.getDate() + Math.round((i * (rangeDays - 1)) / denom));
    ticks.push({ left: (i / denom) * 100, label: fmtDay(toISO(dd)) });
  }

  const groups = buildGroups(acts, categories, true);

  return {
    title: cfg.title || "Laporan Kegiatan",
    rangeLabel: rangeLabel(cfg.from, cfg.to),
    from: cfg.from,
    to: cfg.to,
    showStats: cfg.stats,
    showTimeline: cfg.timeline,
    showGrid: cfg.grid,
    showReport: cfg.report,
    total,
    catCount: catStats.length,
    rangeDays,
    catStats,
    items,
    gRows,
    ticks,
    groups,
    empty: total === 0,
    generated: fmt(todayISO(), { day: "numeric", month: "long", year: "numeric" }),
  };
}

// ── Share token codec ────────────────────────────────────────────────────────
// The public /share/[token] route is stateless: the token encodes the report
// config. Data itself is read fresh from Sheets so the link works across devices.

function b64urlEncode(s: string): string {
  const b64 =
    typeof Buffer !== "undefined"
      ? Buffer.from(s, "utf8").toString("base64")
      : btoa(unescape(encodeURIComponent(s)));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): string {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  if (typeof Buffer !== "undefined") return Buffer.from(b64, "base64").toString("utf8");
  return decodeURIComponent(escape(atob(b64)));
}

export function encodeShareToken(cfg: ShareConfig): string {
  const secs = ALL_SECTIONS.filter((k) => cfg[k]);
  return b64urlEncode(
    JSON.stringify({ f: cfg.from, t: cfg.to, s: secs, ti: cfg.title }),
  );
}

export function decodeShareToken(token: string): ShareConfig | null {
  try {
    const obj = JSON.parse(b64urlDecode(token));
    if (!obj || typeof obj.f !== "string" || typeof obj.t !== "string") return null;
    const secs: string[] = Array.isArray(obj.s) ? obj.s : ALL_SECTIONS;
    return {
      from: obj.f,
      to: obj.t,
      title: typeof obj.ti === "string" ? obj.ti : "Laporan Kegiatan",
      stats: secs.includes("stats"),
      timeline: secs.includes("timeline"),
      grid: secs.includes("grid"),
      report: secs.includes("report"),
    };
  } catch {
    return null;
  }
}
