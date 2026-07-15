import type { JournalData } from "./types";
import { catById, fmt, fmtDay, imageUrl, parseD, rangeLabel, toISO, todayISO } from "./format";
import { ActivityItem, DayGroup, buildGroups, enrichActivity } from "./enrich";

export type ReportSection = "stats" | "timeline" | "grid" | "report" | "hourly" | "table";

export type ShareConfig = {
  title: string;
  from: string;
  to: string;
  stats: boolean;
  timeline: boolean;
  grid: boolean;
  report: boolean;
  hourly: boolean;
  table: boolean;
};

export type HourBucket = { hour: number; label: string; count: number; pct: number };

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
  showHourly: boolean;
  showTable: boolean;
  total: number;
  catCount: number;
  rangeDays: number;
  catStats: CatStat[];
  items: ActivityItem[];
  gRows: GRow[];
  ticks: Tick[];
  groups: DayGroup[];
  hourly: HourBucket[];
  hourlyMax: number;
  noTimeCount: number;
  empty: boolean;
  generated: string;
};

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

  // ── Per-jam: bucket activities by the hour of their start time. Activities
  // without a recorded time are counted separately (noTimeCount) rather than
  // silently dropped or bucketed into an arbitrary hour.
  const hourCounts = new Array(24).fill(0) as number[];
  let noTimeCount = 0;
  acts.forEach((a) => {
    const h = a.startTime ? parseInt(a.startTime.slice(0, 2), 10) : NaN;
    if (Number.isFinite(h) && h >= 0 && h <= 23) hourCounts[h]++;
    else noTimeCount++;
  });
  const hourlyMax = Math.max(1, ...hourCounts);
  const hourly: HourBucket[] = hourCounts.map((count, hour) => ({
    hour,
    label: String(hour).padStart(2, "0") + ":00",
    count,
    pct: Math.round((count / hourlyMax) * 100),
  }));

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
    showHourly: cfg.hourly,
    showTable: cfg.table,
    total,
    catCount: catStats.length,
    rangeDays,
    catStats,
    items,
    gRows,
    ticks,
    groups,
    hourly,
    hourlyMax,
    noTimeCount,
    empty: total === 0,
    generated: fmt(todayISO(), { day: "numeric", month: "long", year: "numeric" }),
  };
}
