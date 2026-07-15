import type { Activity, Category } from "./types";
import {
  catById,
  fmtLong,
  imageUrl,
  rangeLabel,
  timeLabel,
} from "./format";

// Pure view-model for a single activity (no event handlers — the client attaches
// interactivity). Shared between the app list/grid/day views and the report.
export type ActivityItem = {
  id: string;
  title: string;
  capaian: string;
  catName: string;
  catColor: string;
  dateLabel: string;
  startDate: string;
  endDate: string;
  isRange: boolean;
  rangeBadge: string;
  timeLabel: string;
  cover: string | null;
  hasCover: boolean;
  noCover: boolean;
  imgCount: number;
  imgCountMore: boolean;
  imgCountLabel: string;
  /** All evidence image urls (proxied), in order — used for the lightbox. */
  images: string[];
  links: { url: string; name: string }[];
  linkCount: number;
  evCount: number;
  coverNote: string;
};

export function enrichActivity(
  a: Activity,
  categories: Category[],
): ActivityItem {
  const c = catById(categories, a.categoryId);
  const ev = a.evidence || [];
  const images = ev.filter((e) => e.type === "image");
  const links = ev.filter((e) => e.type === "link");
  const imgUrls = images.map((x) => imageUrl(x));
  const isRange = !!(a.endDate && a.endDate !== a.startDate);

  return {
    id: a.id,
    title: a.title,
    capaian: a.capaian,
    catName: c ? c.name : "Tanpa Kategori",
    catColor: c ? c.color : "#8e8e93",
    dateLabel: rangeLabel(a.startDate, a.endDate),
    startDate: a.startDate,
    endDate: a.endDate || a.startDate,
    isRange,
    rangeBadge: isRange ? rangeLabel(a.startDate, a.endDate) : "",
    timeLabel: timeLabel(a),
    cover: imgUrls[0] || null,
    hasCover: imgUrls.length > 0,
    noCover: imgUrls.length === 0,
    imgCount: imgUrls.length,
    imgCountMore: imgUrls.length > 1,
    imgCountLabel: imgUrls.length + " foto",
    images: imgUrls,
    links: links.map((l) => ({ url: l.url, name: l.name || l.url })),
    linkCount: links.length,
    evCount: ev.length,
    coverNote: links.length ? "tautan bukti" : "tanpa bukti",
  };
}

export type DayGroup = {
  key: string;
  label: string;
  countLabel: string;
  items: ActivityItem[];
};

export function buildGroups(
  arr: Activity[],
  categories: Category[],
  asc: boolean,
): DayGroup[] {
  const map: Record<string, Activity[]> = {};
  arr.forEach((a) => {
    (map[a.startDate] = map[a.startDate] || []).push(a);
  });
  const keys = Object.keys(map).sort((a, b) =>
    asc ? (a < b ? -1 : 1) : a > b ? -1 : 1,
  );
  return keys.map((k) => ({
    key: k,
    label: fmtLong(k),
    countLabel: map[k].length + " kegiatan",
    items: map[k].map((a) => enrichActivity(a, categories)),
  }));
}

export type HourBucket = { hour: number; label: string; count: number; pct: number };

/**
 * Bucket activities by the hour of their start time (00–23). Activities
 * without a recorded time are counted separately (noTimeCount) rather than
 * silently dropped or bucketed into an arbitrary hour. Shared by the share
 * report and the app's own "Per Jam" view so both stay in sync.
 */
export function buildHourlyBuckets(acts: Pick<Activity, "startTime">[]): {
  hourly: HourBucket[];
  hourlyMax: number;
  noTimeCount: number;
} {
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
  return { hourly, hourlyMax, noTimeCount };
}
