"use client";

import React, { CSSProperties } from "react";
import type { Activity, Category, Evidence } from "@/lib/types";
import { ActivityItem, buildGroups, enrichActivity } from "@/lib/enrich";
import {
  PALETTE,
  catById,
  fmt,
  fmtLong,
  parseD,
  readableOn,
  toISO,
  todayISO,
  uid,
} from "@/lib/format";
import {
  ShareConfig,
  actsInRange,
  buildReport,
  encodeShareToken,
} from "@/lib/report";
import Lightbox, { LightboxState } from "./Lightbox";
import ReportView from "./ReportView";

const WEEK_START: "sunday" | "monday" = "sunday";
const MAX_CAL_LANES = 3;
const DEFAULT_VIEW: View = "list";
const PREFS_KEY = "jkk:prefs:v1";

type View = "list" | "grid" | "calendar";
type Sort = "date-desc" | "date-asc" | "title";

type FormState = {
  categoryId: string;
  startDate: string;
  endDate: string;
  isRange: boolean;
  hasTime: boolean;
  startTime: string;
  endTime: string;
  title: string;
  capaian: string;
  evidence: Evidence[];
  linkDraft: string;
};

type State = {
  loaded: boolean;
  error: string | null;
  theme: "light" | "dark";
  view: View;
  search: string;
  filterCat: string;
  sort: Sort;
  activities: Activity[];
  categories: Category[];
  calYear: number;
  calMonth: number;
  width: number;
  sidebarOpen: boolean;
  editorOpen: boolean;
  editingId: string | null;
  form: FormState | null;
  catMgrOpen: boolean;
  catForm: { name: string; color: string };
  lightbox: LightboxState | null;
  dayView: string | null;
  shareOpen: boolean;
  shareView: boolean;
  shareCfg: ShareConfig | null;
  toast: string | null;
};

export default class JurnalApp extends React.Component<{}, State> {
  private mounted = false;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private onResize = () => {
    if (this.mounted) this.setState({ width: window.innerWidth });
  };
  private onDocPaste = (e: ClipboardEvent) => {
    if (this.state.editorOpen) this.pasteImages(e);
  };

  constructor(props: {}) {
    super(props);
    const today = new Date();
    this.state = {
      loaded: false,
      error: null,
      theme: "light",
      view: DEFAULT_VIEW,
      search: "",
      filterCat: "all",
      sort: "date-desc",
      activities: [],
      categories: [],
      calYear: today.getFullYear(),
      calMonth: today.getMonth(),
      width: typeof window !== "undefined" ? window.innerWidth : 1200,
      sidebarOpen: false,
      editorOpen: false,
      editingId: null,
      form: null,
      catMgrOpen: false,
      catForm: { name: "", color: PALETTE[0] },
      lightbox: null,
      dayView: null,
      shareOpen: false,
      shareView: false,
      shareCfg: null,
      toast: null,
    };
  }

  componentDidMount() {
    this.mounted = true;
    window.addEventListener("resize", this.onResize);
    document.addEventListener("paste", this.onDocPaste);
    this.load();
  }
  componentWillUnmount() {
    this.mounted = false;
    window.removeEventListener("resize", this.onResize);
    document.removeEventListener("paste", this.onDocPaste);
  }

  // ---------- persistence ----------
  readPrefs(): Partial<Pick<State, "theme" | "view" | "sort">> {
    try {
      return JSON.parse(localStorage.getItem(PREFS_KEY) || "{}") || {};
    } catch {
      return {};
    }
  }
  savePrefs() {
    try {
      const { theme, view, sort } = this.state;
      localStorage.setItem(PREFS_KEY, JSON.stringify({ theme, view, sort }));
    } catch {
      /* ignore */
    }
  }
  async load() {
    const prefs = this.readPrefs();
    try {
      const res = await fetch("/api/data");
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Gagal memuat data dari server.");
      }
      const data = await res.json();
      this.setState({
        loaded: true,
        error: null,
        activities: Array.isArray(data.activities) ? data.activities : [],
        categories: Array.isArray(data.categories) ? data.categories : [],
        theme: prefs.theme || "light",
        view: prefs.view || DEFAULT_VIEW,
        sort: prefs.sort || "date-desc",
      });
    } catch (err) {
      this.setState({
        loaded: true,
        error: (err as Error).message || "Gagal memuat data.",
        theme: prefs.theme || "light",
      });
    }
  }
  /** Persist activities + categories to Google Sheets (whole-document save). */
  syncData(next?: { activities?: Activity[]; categories?: Category[] }) {
    const activities = next?.activities || this.state.activities;
    const categories = next?.categories || this.state.categories;
    fetch("/api/data", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ activities, categories }),
    })
      .then(async (r) => {
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          throw new Error(j.error || "Gagal menyimpan.");
        }
      })
      .catch((err) => this.flash(err.message || "Gagal menyimpan ke server"));
  }
  /** setState for domain data, then persist to the server. */
  commitData(patch: Partial<State>, cb?: () => void) {
    this.setState(patch as State, () => {
      this.syncData();
      if (cb) cb();
    });
  }
  flash(msg: string) {
    this.setState({ toast: msg });
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      if (this.mounted) this.setState({ toast: null });
    }, 2200);
  }

  // ---------- filtering ----------
  getFiltered(): Activity[] {
    const { activities, search, filterCat, sort } = this.state;
    let arr = activities.slice();
    if (filterCat !== "all") arr = arr.filter((a) => a.categoryId === filterCat);
    const q = (search || "").trim().toLowerCase();
    if (q)
      arr = arr.filter((a) => {
        const c = catById(this.state.categories, a.categoryId);
        return (
          (a.title || "").toLowerCase().includes(q) ||
          (a.capaian || "").toLowerCase().includes(q) ||
          ((c && c.name) || "").toLowerCase().includes(q)
        );
      });
    arr.sort((a, b) => {
      if (sort === "date-asc")
        return a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : 0;
      if (sort === "title") return (a.title || "").localeCompare(b.title || "");
      return a.startDate > b.startDate ? -1 : a.startDate < b.startDate ? 1 : 0;
    });
    return arr;
  }
  buildDay(iso: string) {
    const acts = this.state.activities.filter(
      (a) => a.startDate <= iso && (a.endDate || a.startDate) >= iso,
    );
    acts.sort((a, b) => {
      const at = a.startTime || "~";
      const bt = b.startTime || "~";
      return at < bt ? -1 : at > bt ? 1 : 0;
    });
    return {
      iso,
      label: fmtLong(iso),
      count: acts.length,
      countLabel: acts.length + " kegiatan",
      empty: acts.length === 0,
      items: acts.map((a) => enrichActivity(a, this.state.categories)),
    };
  }

  // ---------- calendar ----------
  buildCalendar() {
    const { calYear, calMonth, filterCat, activities } = this.state;
    const weekStartMon = WEEK_START !== "sunday";
    const maxLanes = MAX_CAL_LANES;
    const first = new Date(calYear, calMonth, 1);
    const offset = weekStartMon ? (first.getDay() + 6) % 7 : first.getDay();
    const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
    const rows = Math.ceil((offset + daysInMonth) / 7);
    const gridStart = new Date(calYear, calMonth, 1 - offset);
    const today = todayISO();
    const acts = activities
      .filter((a) => filterCat === "all" || a.categoryId === filterCat)
      .map((a) => ({
        a,
        s: parseD(a.startDate),
        e: parseD(a.endDate || a.startDate),
      }));

    const weeks = [];
    for (let w = 0; w < rows; w++) {
      const weekStart = new Date(gridStart);
      weekStart.setDate(gridStart.getDate() + w * 7);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 6);

      const days = [];
      for (let d = 0; d < 7; d++) {
        const dd = new Date(weekStart);
        dd.setDate(weekStart.getDate() + d);
        const iso = toISO(dd);
        const inMonth = dd.getMonth() === calMonth;
        const isToday = iso === today;
        const numStyle: CSSProperties = isToday
          ? {
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              minWidth: 24,
              height: 24,
              padding: "0 5px",
              borderRadius: 12,
              background: "var(--accent)",
              color: "#fff",
              fontWeight: 680,
              fontSize: 13,
            }
          : {
              display: "inline-block",
              padding: "2px 5px",
              fontSize: 13,
              fontWeight: inMonth ? 560 : 400,
              color: inMonth ? "var(--text)" : "var(--text-3)",
            };
        const cellStyle: CSSProperties = {
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "flex-start",
          padding: 6,
          minHeight: "inherit",
          borderRight: "1px solid var(--sep)",
          borderTop: "1px solid var(--sep)",
          background: isToday ? "var(--accent-soft)" : "transparent",
          cursor: "pointer",
          textAlign: "left",
          font: "inherit",
          color: "inherit",
        };
        days.push({ iso, num: dd.getDate(), numStyle, cellStyle });
      }

      type Seg = {
        a: Activity;
        startCol: number;
        endCol: number;
        span: number;
        isStart: boolean;
        isEnd: boolean;
        lane: number;
      };
      const segs: Seg[] = [];
      acts.forEach((o) => {
        if (o.e < weekStart || o.s > weekEnd) return;
        const segStart = o.s < weekStart ? weekStart : o.s;
        const segEnd = o.e > weekEnd ? weekEnd : o.e;
        const startCol = Math.round((segStart.getTime() - weekStart.getTime()) / 86400000);
        const endCol = Math.round((segEnd.getTime() - weekStart.getTime()) / 86400000);
        segs.push({
          a: o.a,
          startCol,
          endCol,
          span: endCol - startCol + 1,
          isStart: o.s >= weekStart,
          isEnd: o.e <= weekEnd,
          lane: 0,
        });
      });
      segs.sort((x, y) => x.startCol - y.startCol || y.span - x.span);
      const lanes: { startCol: number; endCol: number }[][] = [];
      segs.forEach((seg) => {
        let lane = 0;
        while (true) {
          const occ = lanes[lane] || (lanes[lane] = []);
          const clash = occ.some(
            (o) => !(seg.startCol > o.endCol || seg.endCol < o.startCol),
          );
          if (!clash) {
            occ.push({ startCol: seg.startCol, endCol: seg.endCol });
            seg.lane = lane;
            break;
          }
          lane++;
        }
      });
      const gap = 4;
      const bars: { title: string; css: CSSProperties; showLabel: boolean; actId: string }[] = [];
      const overflow: Record<number, number> = {};
      let usedLanes = 0;
      segs.forEach((seg) => {
        if (seg.lane >= maxLanes) {
          for (let c = seg.startCol; c <= seg.endCol; c++)
            overflow[c] = (overflow[c] || 0) + 1;
          return;
        }
        usedLanes = Math.max(usedLanes, seg.lane + 1);
        const c = catById(this.state.categories, seg.a.categoryId);
        const color = c ? c.color : "#8e8e93";
        const tc = readableOn(color);
        const leftPct = ((seg.startCol / 7) * 100).toFixed(4);
        const widthCalc = `calc(${((seg.span / 7) * 100).toFixed(4)}% - ${gap}px)`;
        const rl = seg.isStart ? "6px" : "2px";
        const rr = seg.isEnd ? "6px" : "2px";
        const css: CSSProperties = {
          position: "absolute",
          left: `calc(${leftPct}% + 2px)`,
          width: widthCalc,
          top: seg.lane * 24,
          height: 20,
          display: "flex",
          alignItems: "center",
          padding: "0 7px",
          fontSize: 11,
          fontWeight: 600,
          lineHeight: "20px",
          color: tc,
          background: color,
          borderRadius: `${rl} ${rr} ${rr} ${rl}`,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          cursor: "pointer",
          boxShadow: "0 1px 1.5px rgba(0,0,0,.14)",
          pointerEvents: "auto",
        };
        bars.push({
          title: seg.a.title,
          css,
          showLabel: seg.isStart || seg.startCol === 0,
          actId: seg.a.id,
        });
      });
      const overflowCells = Object.keys(overflow).map((c) => ({
        n: overflow[Number(c)],
        style: {
          position: "absolute" as const,
          left: `${((Number(c) / 7) * 100).toFixed(4)}%`,
          width: `${(100 / 7).toFixed(4)}%`,
          top: Math.min(usedLanes, maxLanes) * 24,
          pointerEvents: "none" as const,
        },
      }));
      const laneCount = Math.max(Math.min(usedLanes, maxLanes), 1);
      const minH = Math.max(96, 34 + laneCount * 24 + (overflowCells.length ? 16 : 0) + 6);
      weeks.push({ days, bars, overflowCells, minH: minH + "px" });
    }
    return {
      weeks,
      weekdays: weekStartMon
        ? ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"]
        : ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"],
      label: fmt(toISO(first), { month: "long", year: "numeric" }),
    };
  }

  // ---------- editor ----------
  blankForm(iso?: string): FormState {
    const cid = this.state.categories[0] ? this.state.categories[0].id : "";
    const d = iso || todayISO();
    return {
      categoryId: cid,
      startDate: d,
      endDate: d,
      isRange: false,
      hasTime: false,
      startTime: "",
      endTime: "",
      title: "",
      capaian: "",
      evidence: [],
      linkDraft: "",
    };
  }
  openNew() {
    this.setState({ editorOpen: true, editingId: null, form: this.blankForm(), sidebarOpen: false });
  }
  openNewOn(iso: string) {
    this.setState({ editorOpen: true, editingId: null, form: this.blankForm(iso) });
  }
  openDay(iso: string) {
    this.setState({ dayView: iso, sidebarOpen: false });
    try {
      window.scrollTo(0, 0);
    } catch {
      /* ignore */
    }
  }
  closeDay() {
    this.setState({ dayView: null });
  }
  openEdit(id: string) {
    const a = this.state.activities.find((x) => x.id === id);
    if (!a) return;
    this.setState({
      editorOpen: true,
      editingId: id,
      form: {
        categoryId: a.categoryId,
        startDate: a.startDate,
        endDate: a.endDate || a.startDate,
        isRange: !!(a.endDate && a.endDate !== a.startDate),
        hasTime: !!(a.startTime || a.endTime),
        startTime: a.startTime || "",
        endTime: a.endTime || "",
        title: a.title || "",
        capaian: a.capaian || "",
        evidence: (a.evidence || []).slice(),
        linkDraft: "",
      },
    });
  }
  closeEditor() {
    this.setState({ editorOpen: false, editingId: null, form: null });
  }
  setForm(patch: Partial<FormState> | ((f: FormState) => Partial<FormState>)) {
    this.setState((s) => {
      if (!s.form) return null;
      const delta = typeof patch === "function" ? patch(s.form) : patch;
      return { form: { ...s.form, ...delta } } as State;
    });
  }
  saveForm() {
    const f = this.state.form;
    if (!f) return;
    if (!f.title || !f.title.trim()) {
      this.flash("Nama kegiatan wajib diisi");
      return;
    }
    let endDate = f.isRange ? f.endDate || f.startDate : f.startDate;
    if (endDate < f.startDate) endDate = f.startDate;
    const act: Activity = {
      id: this.state.editingId || uid(),
      categoryId: f.categoryId || (this.state.categories[0] && this.state.categories[0].id) || "",
      startDate: f.startDate,
      endDate,
      startTime: f.hasTime ? f.startTime : "",
      endTime: f.hasTime ? f.endTime : "",
      title: f.title.trim(),
      capaian: (f.capaian || "").trim(),
      evidence: f.evidence || [],
    };
    const acts = this.state.activities.slice();
    const idx = acts.findIndex((a) => a.id === act.id);
    const editing = idx >= 0;
    if (editing) acts[idx] = act;
    else acts.unshift(act);
    this.commitData({ activities: acts, editorOpen: false, editingId: null, form: null }, () =>
      this.flash(editing ? "Kegiatan diperbarui" : "Kegiatan ditambahkan"),
    );
  }
  deleteCurrent() {
    const id = this.state.editingId;
    if (!id) return;
    if (!window.confirm("Hapus kegiatan ini?")) return;
    const acts = this.state.activities.filter((a) => a.id !== id);
    this.commitData({ activities: acts, editorOpen: false, editingId: null, form: null }, () =>
      this.flash("Kegiatan dihapus"),
    );
  }
  addLink() {
    const f = this.state.form;
    if (!f) return;
    const url = (f.linkDraft || "").trim();
    if (!url) return;
    let name = url;
    try {
      name = new URL(/^https?:/.test(url) ? url : "https://" + url).hostname.replace("www.", "");
    } catch {
      /* keep url as name */
    }
    this.setForm((ff) => ({
      evidence: [...ff.evidence, { id: uid(), type: "link", name, url }],
      linkDraft: "",
    }));
  }
  compress(file: File): Promise<Blob> {
    return new Promise((resolve) => {
      const rd = new FileReader();
      rd.onload = () => {
        const img = new Image();
        img.onload = () => {
          const max = 1280;
          let w = img.width;
          let h = img.height;
          if (w > max || h > max) {
            const r = Math.min(max / w, max / h);
            w = Math.round(w * r);
            h = Math.round(h * r);
          }
          const cv = document.createElement("canvas");
          cv.width = w;
          cv.height = h;
          const ctx = cv.getContext("2d");
          if (!ctx) return resolve(file);
          ctx.drawImage(img, 0, 0, w, h);
          cv.toBlob((blob) => resolve(blob || file), "image/jpeg", 0.72);
        };
        img.onerror = () => resolve(file);
        img.src = rd.result as string;
      };
      rd.onerror = () => resolve(file);
      rd.readAsDataURL(file);
    });
  }
  async uploadEvidence(items: { blob: Blob; name: string }[]) {
    const fd = new FormData();
    items.forEach((it) => fd.append("file", it.blob, it.name));
    const res = await fetch("/api/upload", { method: "POST", body: fd });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error || "Gagal mengunggah gambar.");
    }
    const data = (await res.json()) as { files: { fileId: string; name: string }[] };
    return data.files.map((f) => ({
      id: uid(),
      type: "image" as const,
      name: f.name,
      fileId: f.fileId,
    }));
  }
  addImages(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!files.length) return;
    this.flash("Mengunggah gambar…");
    Promise.all(files.map((f) => this.compress(f).then((blob) => ({ blob, name: f.name }))))
      .then((items) => this.uploadEvidence(items))
      .then((imgs) => {
        this.setForm((ff) => ({ evidence: [...ff.evidence, ...imgs] }));
        this.flash(imgs.length + " gambar ditambahkan");
      })
      .catch((err) => this.flash(err.message || "Gagal mengunggah gambar"));
  }
  pasteImages(e: ClipboardEvent) {
    const items = (e.clipboardData && e.clipboardData.items) || [];
    const files: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.kind === "file" && /^image\//.test(it.type)) {
        const f = it.getAsFile();
        if (f) files.push(f);
      }
    }
    if (!files.length) return;
    e.preventDefault();
    this.flash("Mengunggah gambar…");
    Promise.all(
      files.map((f) => this.compress(f).then((blob) => ({ blob, name: f.name || "clipboard.jpg" }))),
    )
      .then((its) => this.uploadEvidence(its))
      .then((imgs) => {
        this.setForm((ff) => ({ evidence: [...ff.evidence, ...imgs] }));
        this.flash(imgs.length + " gambar dari clipboard ditambahkan");
      })
      .catch((err) => this.flash(err.message || "Gagal mengunggah gambar"));
  }
  removeEvidence(eid: string) {
    this.setForm((ff) => ({ evidence: ff.evidence.filter((x) => x.id !== eid) }));
  }

  // ---------- categories ----------
  openCatMgr() {
    this.setState({ catMgrOpen: true, sidebarOpen: false, catForm: { name: "", color: PALETTE[0] } });
  }
  closeCatMgr() {
    this.setState({ catMgrOpen: false });
  }
  renameCat(id: string, name: string) {
    const cats = this.state.categories.map((c) => (c.id === id ? { ...c, name } : c));
    this.commitData({ categories: cats });
  }
  cycleColor(id: string) {
    const cats = this.state.categories.map((c) => {
      if (c.id !== id) return c;
      const i = PALETTE.indexOf(c.color);
      return { ...c, color: PALETTE[(i + 1) % PALETTE.length] };
    });
    this.commitData({ categories: cats });
  }
  deleteCat(id: string) {
    const used = this.state.activities.filter((a) => a.categoryId === id).length;
    const msg = used
      ? "Hapus rencana kinerja ini? " + used + ' kegiatan akan menjadi "Tanpa Kategori".'
      : "Hapus rencana kinerja ini?";
    if (!window.confirm(msg)) return;
    const cats = this.state.categories.filter((c) => c.id !== id);
    const patch: Partial<State> = { categories: cats };
    if (this.state.filterCat === id) patch.filterCat = "all";
    this.commitData(patch);
  }
  addCat() {
    const cf = this.state.catForm;
    const name = (cf.name || "").trim();
    if (!name) {
      this.flash("Nama rencana kinerja wajib diisi");
      return;
    }
    const cat: Category = { id: uid(), name, color: cf.color };
    this.commitData({
      categories: [...this.state.categories, cat],
      catForm: { name: "", color: PALETTE[(PALETTE.indexOf(cf.color) + 1) % PALETTE.length] },
    });
  }

  // ---------- lightbox ----------
  openLightbox(images: string[], index: number, title: string) {
    if (!images || !images.length) return;
    this.setState({ lightbox: { images: images.slice(), index: index || 0, title: title || "" } });
  }
  lbClose() {
    this.setState({ lightbox: null });
  }

  // ---------- export / import ----------
  download(name: string, content: BlobPart, type: string) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }
  exportCsv() {
    const esc = (v: unknown) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const head = [
      "Rencana Kinerja",
      "Tanggal Mulai",
      "Tanggal Selesai",
      "Jam Mulai",
      "Jam Selesai",
      "Kegiatan",
      "Capaian",
      "Bukti Dukung",
    ];
    const rows = this.getFiltered().map((a) => {
      const c = catById(this.state.categories, a.categoryId);
      const ev = (a.evidence || [])
        .map((e) => (e.type === "link" ? e.url : "[gambar] " + (e.name || "")))
        .join(" | ");
      return [c ? c.name : "", a.startDate, a.endDate, a.startTime, a.endTime, a.title, a.capaian, ev]
        .map(esc)
        .join(",");
    });
    const csv = [head.join(","), ...rows].join("\r\n");
    // Prepend a UTF-8 BOM so Excel opens the file with correct encoding.
    this.download("jurnal-kegiatan.csv", "﻿" + csv, "text/csv;charset=utf-8");
    this.flash("Spreadsheet (CSV) diunduh");
  }
  exportJson() {
    const { activities, categories } = this.state;
    this.download(
      "jurnal-kegiatan.json",
      JSON.stringify({ activities, categories, exportedAt: new Date().toISOString() }, null, 2),
      "application/json",
    );
    this.flash("Data (JSON) diunduh");
  }
  importJson(e: React.ChangeEvent<HTMLInputElement>) {
    const file = (e.target.files || [])[0];
    e.target.value = "";
    if (!file) return;
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const d = JSON.parse(rd.result as string);
        if (Array.isArray(d.activities) && Array.isArray(d.categories)) {
          this.commitData({ activities: d.activities, categories: d.categories, sidebarOpen: false }, () =>
            this.flash("Data berhasil diimpor"),
          );
        } else this.flash("Format file tidak dikenali");
      } catch {
        this.flash("Gagal membaca file");
      }
    };
    rd.readAsText(file);
  }

  // ---------- share ----------
  minMax() {
    const ds: string[] = [];
    this.state.activities.forEach((a) => {
      ds.push(a.startDate);
      ds.push(a.endDate || a.startDate);
    });
    ds.sort();
    return { min: ds[0] || todayISO(), max: ds[ds.length - 1] || todayISO() };
  }
  openShare() {
    const t = new Date();
    const from = toISO(new Date(t.getFullYear(), t.getMonth(), 1));
    const to = todayISO();
    this.setState({
      shareOpen: true,
      sidebarOpen: false,
      shareCfg: {
        title: "Laporan Kegiatan Kerja",
        from,
        to,
        stats: true,
        timeline: true,
        grid: true,
        report: true,
      },
    });
  }
  closeShare() {
    this.setState({ shareOpen: false });
  }
  setCfg(patch: Partial<ShareConfig>) {
    this.setState((s) => (s.shareCfg ? ({ shareCfg: { ...s.shareCfg, ...patch } } as State) : null));
  }
  shQuick(kind: "week" | "month" | "30" | "all") {
    const t = new Date();
    let from = "";
    let to = todayISO();
    if (kind === "week") {
      const d = new Date();
      const off = (d.getDay() + 6) % 7;
      const mon = new Date(d);
      mon.setDate(d.getDate() - off);
      from = toISO(mon);
      to = toISO(new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 6));
    } else if (kind === "month") {
      from = toISO(new Date(t.getFullYear(), t.getMonth(), 1));
      to = toISO(new Date(t.getFullYear(), t.getMonth() + 1, 0));
    } else if (kind === "30") {
      const d = new Date();
      d.setDate(d.getDate() - 29);
      from = toISO(d);
    } else {
      const mm = this.minMax();
      from = mm.min;
      to = mm.max;
    }
    this.setCfg({ from, to });
  }
  shareUrl(cfg: ShareConfig) {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    return `${origin}/share/${encodeShareToken(cfg)}`;
  }
  shCopy() {
    if (!this.state.shareCfg) return;
    const url = this.shareUrl(this.state.shareCfg);
    const done = () => this.flash("Tautan disalin");
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done, () => this.flash("Salin manual dari kotak tautan"));
    } else this.flash("Salin manual dari kotak tautan");
  }
  openReport() {
    this.setState({ shareView: true, shareOpen: false });
    if (typeof window !== "undefined") window.scrollTo(0, 0);
  }
  exitReport() {
    this.setState({ shareView: false });
  }

  // ---------- theme / view ----------
  toggleTheme() {
    this.setState({ theme: this.state.theme === "dark" ? "light" : "dark" }, () => this.savePrefs());
  }
  setView(v: View) {
    this.setState({ view: v }, () => this.savePrefs());
  }
  setSort(v: Sort) {
    this.setState({ sort: v }, () => this.savePrefs());
  }
  setFilter(id: string) {
    this.setState({ filterCat: id, sidebarOpen: false });
  }

  // ---------- style helpers ----------
  navStyle(active: boolean): CSSProperties {
    return {
      border: "none",
      background: active ? "var(--surface)" : "transparent",
      color: active ? "var(--text)" : "var(--text-2)",
      borderRadius: 8,
      padding: "7px 14px",
      fontSize: 13.5,
      fontWeight: active ? 640 : 500,
      cursor: "pointer",
      boxShadow: active ? "0 1px 3px rgba(0,0,0,.14)" : "none",
      transition: "all .15s ease",
    };
  }
  sideStyle(active: boolean): CSSProperties {
    return {
      display: "flex",
      alignItems: "center",
      gap: 10,
      width: "100%",
      border: "none",
      background: active ? "var(--fill)" : "transparent",
      color: "var(--text)",
      borderRadius: 10,
      padding: "9px 10px",
      fontSize: 14,
      fontWeight: active ? 600 : 500,
      cursor: "pointer",
    };
  }
  swTrack(on: boolean): CSSProperties {
    return {
      position: "relative",
      width: 44,
      height: 26,
      borderRadius: 16,
      transition: "background .2s",
      background: on ? "var(--accent)" : "var(--fill-2)",
      display: "inline-block",
      flex: "none",
    };
  }
  swKnob(on: boolean): CSSProperties {
    return {
      position: "absolute",
      top: 2,
      left: 2,
      width: 22,
      height: 22,
      borderRadius: "50%",
      background: "#fff",
      boxShadow: "0 1px 3px rgba(0,0,0,.3)",
      transition: "transform .2s",
      transform: on ? "translateX(18px)" : "none",
    };
  }
  Switch(on: boolean) {
    return (
      <span style={this.swTrack(on)}>
        <span style={this.swKnob(on)} />
      </span>
    );
  }

  // ===================================================================
  // RENDER
  // ===================================================================
  render() {
    const s = this.state;
    if (!s.loaded) {
      return (
        <div data-theme={s.theme} style={rootStyle}>
          <div style={{ position: "fixed", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--bg)" }}>
            <div style={{ width: 34, height: 34, borderRadius: "50%", border: "3px solid var(--fill-2)", borderTopColor: "var(--accent)", animation: "jkk-spin .8s linear infinite" }} />
          </div>
        </div>
      );
    }

    if (s.error) {
      return (
        <div data-theme={s.theme} style={rootStyle}>
          {this.renderError()}
        </div>
      );
    }

    if (s.shareView && s.shareCfg) {
      return (
        <div data-theme={s.theme} style={rootStyle}>
          <ReportView
            report={buildReport({ activities: s.activities, categories: s.categories }, s.shareCfg)}
            onToggleTheme={() => this.toggleTheme()}
            onBack={() => this.exitReport()}
          />
          {s.toast && this.renderToast()}
        </div>
      );
    }

    return (
      <div data-theme={s.theme} style={rootStyle}>
        {this.renderApp()}
        {s.editorOpen && this.renderEditor()}
        {s.catMgrOpen && this.renderCatMgr()}
        {s.shareOpen && this.renderShare()}
        {s.dayView && this.renderDay()}
        {s.lightbox && <Lightbox state={s.lightbox} onClose={() => this.lbClose()} />}
        {s.toast && this.renderToast()}
      </div>
    );
  }

  renderError() {
    return (
      <div style={{ maxWidth: 520, margin: "0 auto", padding: "80px 24px", textAlign: "center" }}>
        <div style={{ fontSize: 44, opacity: 0.5, marginBottom: 8 }}>⚠︎</div>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Tidak dapat memuat data</div>
        <p style={{ color: "var(--text-2)", fontSize: 14, lineHeight: 1.6 }}>{this.state.error}</p>
        <p style={{ color: "var(--text-3)", fontSize: 12.5, lineHeight: 1.6, marginTop: 14 }}>
          Pastikan variabel lingkungan Google Sheets/Drive sudah dikonfigurasi (lihat README), lalu muat ulang.
        </p>
        <button
          onClick={() => this.setState({ loaded: false, error: null }, () => this.load())}
          style={{ marginTop: 18, border: "none", background: "var(--accent)", color: "#fff", borderRadius: 11, padding: "11px 20px", fontSize: 15, fontWeight: 600, cursor: "pointer" }}
        >
          Coba Lagi
        </button>
      </div>
    );
  }

  renderToast() {
    return (
      <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", zIndex: 100, background: "rgba(30,30,32,.94)", color: "#fff", padding: "12px 20px", borderRadius: 13, fontSize: 14, fontWeight: 560, boxShadow: "0 12px 40px rgba(0,0,0,.35)", animation: "jkk-pop .25s ease", backdropFilter: "blur(20px)" }}>
        {this.state.toast}
      </div>
    );
  }

  // ---------- sidebar (shared markup for desktop + mobile sheet) ----------
  renderNav(isSheet: boolean) {
    const s = this.state;
    return (
      <>
        <button
          onClick={() => this.setFilter("all")}
          style={this.sideStyle(s.filterCat === "all")}
        >
          <span style={{ width: 11, height: 11, borderRadius: "50%", background: "linear-gradient(135deg,var(--accent),#5E5CE6)", flex: "none" }} />
          <span style={{ flex: 1, textAlign: "left" }}>Semua Kegiatan</span>
          <span style={{ color: "var(--text-3)", fontSize: 13, fontVariantNumeric: "tabular-nums" }}>{s.activities.length}</span>
        </button>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 8px 6px" }}>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: ".05em" }}>Rencana Kinerja</span>
          {!isSheet && (
            <button onClick={() => this.openCatMgr()} title="Kelola" style={{ border: "none", background: "transparent", color: "var(--accent)", fontSize: 19, lineHeight: 1, cursor: "pointer", padding: "0 4px" }}>＋</button>
          )}
        </div>
        {s.categories.map((c) => {
          const count = s.activities.filter((a) => a.categoryId === c.id).length;
          return (
            <button key={c.id} onClick={() => this.setFilter(c.id)} style={this.sideStyle(s.filterCat === c.id)}>
              <span style={{ width: 11, height: 11, borderRadius: 3, flex: "none", background: c.color }} />
              <span style={{ flex: 1, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
              <span style={{ color: "var(--text-3)", fontSize: 13, fontVariantNumeric: "tabular-nums" }}>{count}</span>
            </button>
          );
        })}
      </>
    );
  }

  renderApp() {
    const s = this.state;
    const isMobile = s.width < 860;
    const showSidebar = !isMobile;
    const filtered = this.getFiltered();
    const hasResults = filtered.length > 0;

    return (
      <>
        <div style={{ display: "flex", minHeight: "100dvh" }}>
          {/* SIDEBAR desktop */}
          {showSidebar && (
            <aside style={{ width: 266, flex: "none", borderRight: "1px solid var(--sep)", background: "var(--surface)", display: "flex", flexDirection: "column", height: "100dvh", position: "sticky", top: 0 }}>
              <div style={{ padding: "20px 18px 8px", display: "flex", alignItems: "center", gap: 10 }}>
                <div style={logoBox}>J</div>
                <div>
                  <div style={{ fontWeight: 720, fontSize: 16, letterSpacing: "-.02em", lineHeight: 1.1 }}>Jurnal Kegiatan</div>
                  <div style={{ fontSize: 11.5, color: "var(--text-3)" }}>Bukti Dukung SKP</div>
                </div>
              </div>
              <div style={{ padding: "8px 10px", overflow: "auto", flex: 1 }}>{this.renderNav(false)}</div>
              <div style={{ padding: 10, borderTop: "1px solid var(--sep)", display: "flex", flexDirection: "column", gap: 1 }}>
                <button onClick={() => this.openCatMgr()} style={sideFootBtn}>Kelola Rencana Kinerja</button>
                <button onClick={() => this.exportCsv()} style={sideFootBtn}>Export Spreadsheet (CSV)</button>
                <button onClick={() => this.exportJson()} style={sideFootBtn}>Export Data (JSON)</button>
                <label style={{ ...sideFootBtn, display: "block" }}>
                  Import Data (JSON)
                  <input type="file" accept="application/json,.json" onChange={(e) => this.importJson(e)} style={{ display: "none" }} />
                </label>
                <button onClick={() => this.toggleTheme()} style={sideFootBtn}>{s.theme === "dark" ? "Mode Terang" : "Mode Gelap"}</button>
              </div>
            </aside>
          )}

          {/* MAIN */}
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
            {isMobile && (
              <div style={{ position: "sticky", top: 0, zIndex: 25, display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", background: "var(--surface)", borderBottom: "1px solid var(--sep)", backdropFilter: "saturate(180%) blur(20px)" }}>
                <button onClick={() => this.setState({ sidebarOpen: true })} style={hamburgerBtn}>
                  <span style={hamLine} />
                  <span style={hamLine} />
                  <span style={hamLine} />
                </button>
                <div style={{ flex: 1, fontWeight: 720, fontSize: 17, letterSpacing: "-.02em" }}>Jurnal Kegiatan</div>
                <button onClick={() => this.openShare()} style={{ border: "none", background: "var(--fill)", color: "var(--text)", height: 38, padding: "0 13px", borderRadius: 10, fontSize: 13.5, fontWeight: 600, cursor: "pointer" }}>Bagikan</button>
                <button onClick={() => this.toggleTheme()} style={{ border: "none", background: "var(--fill)", color: "var(--text)", width: 38, height: 38, borderRadius: 10, fontSize: 15, cursor: "pointer" }}>◐</button>
              </div>
            )}

            {/* toolbar */}
            <header className="jkk-noprint" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "12px clamp(14px,3vw,26px)", background: "var(--surface)", borderBottom: "1px solid var(--sep)", position: "sticky", top: 0, zIndex: 15, backdropFilter: "saturate(180%) blur(20px)" }}>
              <div style={{ display: "flex", background: "var(--fill)", borderRadius: 10, padding: 2, flex: "none" }}>
                {(["list", "grid", "calendar"] as View[]).map((v) => (
                  <button key={v} onClick={() => this.setView(v)} style={this.navStyle(s.view === v)}>
                    {v === "list" ? "List" : v === "grid" ? "Grid" : "Kalender"}
                  </button>
                ))}
              </div>
              <div style={{ position: "relative", flex: 1, minWidth: 150, maxWidth: 360 }}>
                <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-3)", fontSize: 15, pointerEvents: "none" }}>⌕</span>
                <input
                  value={s.search}
                  onChange={(e) => this.setState({ search: e.target.value })}
                  placeholder="Cari kegiatan…"
                  style={{ width: "100%", padding: "9px 12px 9px 34px", borderRadius: 10, border: "1px solid var(--sep-2)", background: "var(--bg)", color: "var(--text)", fontSize: 14, outline: "none" }}
                />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginLeft: "auto", flex: "none" }}>
                {showSidebar && (
                  <>
                    <select value={s.sort} onChange={(e) => this.setSort(e.target.value as Sort)} style={{ border: "1px solid var(--sep-2)", background: "var(--bg)", color: "var(--text)", borderRadius: 10, padding: "9px 10px", fontSize: 13.5, cursor: "pointer", outline: "none" }}>
                      <option value="date-desc">Terbaru</option>
                      <option value="date-asc">Terlama</option>
                      <option value="title">Judul A–Z</option>
                    </select>
                    <button onClick={() => this.openShare()} style={{ border: "none", background: "var(--fill)", color: "var(--text)", borderRadius: 10, padding: "9px 15px", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>Bagikan</button>
                  </>
                )}
                <button onClick={() => this.openNew()} style={{ border: "none", background: "var(--accent)", color: "#fff", borderRadius: 10, padding: "9px 16px", fontSize: 14, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>＋ Kegiatan</button>
              </div>
            </header>

            <main style={{ padding: "clamp(14px,2.5vw,26px)", flex: 1 }}>
              {s.view === "list" && this.renderList(filtered, hasResults)}
              {s.view === "grid" && this.renderGrid(filtered, hasResults)}
              {s.view === "calendar" && this.renderCalendar()}
            </main>
          </div>
        </div>

        {/* mobile sidebar sheet */}
        {isMobile && s.sidebarOpen && (
          <div onClick={() => this.setState({ sidebarOpen: false })} style={{ position: "fixed", inset: 0, zIndex: 40, background: "var(--scrim)", animation: "jkk-fade .2s ease" }}>
            <aside onClick={(e) => e.stopPropagation()} style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: "82%", maxWidth: 300, background: "var(--surface)", display: "flex", flexDirection: "column", animation: "jkk-slide .28s cubic-bezier(.32,.72,0,1)", boxShadow: "var(--shadow-lg)" }}>
              <div style={{ padding: "20px 18px 8px", display: "flex", alignItems: "center", gap: 10 }}>
                <div style={logoBox}>J</div>
                <div style={{ fontWeight: 720, fontSize: 16, letterSpacing: "-.02em", flex: 1 }}>Jurnal Kegiatan</div>
                <button onClick={() => this.setState({ sidebarOpen: false })} style={{ border: "none", background: "var(--fill)", color: "var(--text)", width: 32, height: 32, borderRadius: "50%", fontSize: 15, cursor: "pointer" }}>✕</button>
              </div>
              <div style={{ padding: "8px 10px", overflow: "auto", flex: 1 }}>{this.renderNav(true)}</div>
              <div style={{ padding: 10, borderTop: "1px solid var(--sep)", display: "flex", flexDirection: "column", gap: 1 }}>
                <button onClick={() => this.openCatMgr()} style={{ ...sideFootBtn, fontSize: 14, padding: "11px 10px" }}>Kelola Rencana Kinerja</button>
                <button onClick={() => this.exportCsv()} style={{ ...sideFootBtn, fontSize: 14, padding: "11px 10px" }}>Export Spreadsheet (CSV)</button>
                <button onClick={() => this.exportJson()} style={{ ...sideFootBtn, fontSize: 14, padding: "11px 10px" }}>Export Data (JSON)</button>
                <label style={{ ...sideFootBtn, fontSize: 14, padding: "11px 10px", display: "block" }}>
                  Import Data (JSON)
                  <input type="file" accept="application/json,.json" onChange={(e) => this.importJson(e)} style={{ display: "none" }} />
                </label>
              </div>
            </aside>
          </div>
        )}
      </>
    );
  }

  // ---------- LIST ----------
  renderList(filtered: Activity[], hasResults: boolean) {
    if (!hasResults) return this.renderEmpty();
    const groups = buildGroups(filtered, this.state.categories, this.state.sort === "date-asc");
    return (
      <div style={{ maxWidth: 880, margin: "0 auto", display: "flex", flexDirection: "column", gap: 26 }}>
        {groups.map((g) => (
          <section key={g.key}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 9, padding: "2px 2px 12px" }}>
              <h2 style={{ fontSize: 15, fontWeight: 700, margin: 0, textTransform: "capitalize", letterSpacing: "-.01em" }}>{g.label}</h2>
              <span style={{ color: "var(--text-3)", fontSize: 13 }}>{g.countLabel}</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
              {g.items.map((it) => this.renderListCard(it))}
            </div>
          </section>
        ))}
      </div>
    );
  }
  renderListCard(it: ActivityItem) {
    return (
      <article
        key={it.id}
        className="jkk-card"
        onClick={() => this.openEdit(it.id)}
        style={{ background: "var(--surface)", border: "1px solid var(--sep)", borderRadius: 15, padding: "15px 17px", boxShadow: "var(--shadow)", cursor: "pointer", display: "flex", gap: 15 }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 7, flexWrap: "wrap" }}>
            <span style={catPill}>
              <span style={{ width: 8, height: 8, borderRadius: 3, background: it.catColor }} />
              {it.catName}
            </span>
            {it.rangeBadge && <span style={rangeBadge}>{it.rangeBadge}</span>}
            {it.timeLabel && <span style={{ fontSize: 12.5, color: "var(--text-3)" }}>{it.timeLabel}</span>}
          </div>
          <h3 style={{ margin: "0 0 4px", fontSize: 16.5, fontWeight: 660, letterSpacing: "-.015em", lineHeight: 1.25 }}>{it.title}</h3>
          <p style={clampN(2)}>{it.capaian}</p>
          {it.evCount > 0 && (
            <div style={{ display: "flex", gap: 8, marginTop: 11, flexWrap: "wrap", alignItems: "center" }}>
              {it.images.map((url, i) => (
                <button key={i} onClick={(e) => { e.stopPropagation(); this.openLightbox(it.images, i, it.title); }} style={{ ...thumb(44), backgroundImage: `url('${url}')` }} />
              ))}
              {it.links.map((lk, i) => (
                <a key={i} href={lk.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} style={linkChip}>↗ {lk.name}</a>
              ))}
            </div>
          )}
        </div>
        {it.hasCover && (
          <button onClick={(e) => { e.stopPropagation(); this.openLightbox(it.images, 0, it.title); }} style={{ ...coverBtn(88), backgroundImage: `url('${it.cover}')` }} />
        )}
      </article>
    );
  }

  // ---------- GRID ----------
  renderGrid(filtered: Activity[], hasResults: boolean) {
    if (!hasResults) return this.renderEmpty();
    const items = filtered.map((a) => enrichActivity(a, this.state.categories));
    return (
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(258px,1fr))", gap: 16 }}>
        {items.map((it) => (
          <article key={it.id} className="jkk-card-grid" onClick={() => this.openEdit(it.id)} style={{ background: "var(--surface)", border: "1px solid var(--sep)", borderRadius: 16, overflow: "hidden", boxShadow: "var(--shadow)", cursor: "pointer", display: "flex", flexDirection: "column" }}>
            {it.hasCover ? (
              <button onClick={(e) => { e.stopPropagation(); this.openLightbox(it.images, 0, it.title); }} style={{ height: 152, border: "none", backgroundColor: "var(--fill)", backgroundSize: "cover", backgroundPosition: "center", cursor: "zoom-in", position: "relative", padding: 0, backgroundImage: `url('${it.cover}')` }}>
                {it.imgCountMore && <span style={countBadge}>{it.imgCountLabel}</span>}
              </button>
            ) : (
              <div style={hatchBox(92)}><span style={monoNote}>{it.coverNote}</span></div>
            )}
            <div style={{ padding: "14px 15px", display: "flex", flexDirection: "column", gap: 7, flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 600, color: "var(--text-2)" }}>
                  <span style={{ width: 8, height: 8, borderRadius: 3, background: it.catColor }} />{it.catName}
                </span>
                {it.rangeBadge && <span style={{ fontSize: 11, fontWeight: 600, color: "var(--accent)", background: "var(--accent-soft)", padding: "2px 8px", borderRadius: 16 }}>{it.rangeBadge}</span>}
              </div>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 640, letterSpacing: "-.01em", lineHeight: 1.25 }}>{it.title}</h3>
              <p style={clampN(3, 13.5)}>{it.capaian}</p>
              <div style={{ marginTop: "auto", paddingTop: 5, display: "flex", alignItems: "center", gap: 7, color: "var(--text-3)", fontSize: 12 }}>
                {it.dateLabel}
                {it.timeLabel && <span>· {it.timeLabel}</span>}
              </div>
            </div>
          </article>
        ))}
      </div>
    );
  }

  // ---------- CALENDAR ----------
  renderCalendar() {
    const cal = this.buildCalendar();
    return (
      <div style={{ maxWidth: 1060, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <h2 style={{ fontSize: 22, fontWeight: 720, margin: 0, letterSpacing: "-.025em", textTransform: "capitalize" }}>{cal.label}</h2>
          <div style={{ flex: 1 }} />
          <button onClick={() => { const t = new Date(); this.setState({ calYear: t.getFullYear(), calMonth: t.getMonth() }); }} style={calNavBtn}>Hari Ini</button>
          <button onClick={() => this.setState((st) => { const d = new Date(st.calYear, st.calMonth - 1, 1); return { calYear: d.getFullYear(), calMonth: d.getMonth() }; })} style={calArrow}>‹</button>
          <button onClick={() => this.setState((st) => { const d = new Date(st.calYear, st.calMonth + 1, 1); return { calYear: d.getFullYear(), calMonth: d.getMonth() }; })} style={calArrow}>›</button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", background: "var(--surface)", border: "1px solid var(--sep)", borderBottom: "none", borderRadius: "14px 14px 0 0", overflow: "hidden" }}>
          {cal.weekdays.map((wd) => (
            <div key={wd} style={{ padding: "9px 8px", fontSize: 12, fontWeight: 680, color: "var(--text-3)", borderBottom: "1px solid var(--sep)" }}>{wd}</div>
          ))}
        </div>
        <div style={{ border: "1px solid var(--sep)", borderTop: "none", borderRadius: "0 0 14px 14px", overflow: "hidden", background: "var(--surface)" }}>
          {cal.weeks.map((wk, wi) => (
            <div key={wi} style={{ position: "relative" }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", minHeight: wk.minH }}>
                {wk.days.map((d) => (
                  <button key={d.iso} onClick={() => this.openDay(d.iso)} style={d.cellStyle}>
                    <span style={d.numStyle}>{d.num}</span>
                  </button>
                ))}
              </div>
              <div style={{ position: "absolute", left: 0, right: 0, top: 30, bottom: 4, pointerEvents: "none" }}>
                <div style={{ position: "relative", height: "100%", margin: "0 3px" }}>
                  {wk.bars.map((bar, bi) => (
                    <div key={bi} onClick={() => this.openEdit(bar.actId)} title={bar.title} style={bar.css}>
                      {bar.showLabel ? bar.title : ""}
                    </div>
                  ))}
                  {wk.overflowCells.map((ov, oi) => (
                    <div key={oi} style={ov.style}>
                      <span style={{ fontSize: 10.5, color: "var(--text-3)", fontWeight: 600, paddingLeft: 6 }}>+{ov.n}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
        <p style={{ margin: "13px 2px", color: "var(--text-3)", fontSize: 12.5 }}>Klik tanggal untuk menambah kegiatan · klik bar untuk membuka.</p>
      </div>
    );
  }

  renderEmpty() {
    return (
      <div style={{ maxWidth: 420, margin: "70px auto", textAlign: "center", color: "var(--text-3)" }}>
        <div style={{ fontSize: 44, marginBottom: 6, opacity: 0.5 }}>◔</div>
        <div style={{ fontSize: 17, fontWeight: 640, color: "var(--text-2)" }}>Belum ada kegiatan</div>
        <div style={{ fontSize: 14, margin: "6px 0 18px" }}>Mulai catat kegiatan kerja sebagai bukti dukung laporan.</div>
        <button onClick={() => this.openNew()} style={{ border: "none", background: "var(--accent)", color: "#fff", borderRadius: 11, padding: "11px 20px", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>＋ Tambah Kegiatan</button>
      </div>
    );
  }

  // ---------- DAY DETAIL ----------
  renderDay() {
    const day = this.buildDay(this.state.dayView!);
    return (
      <div style={{ position: "fixed", inset: 0, zIndex: 45, background: "var(--bg)", overflow: "auto", animation: "jkk-fade .25s ease" }}>
        <div style={{ position: "sticky", top: 0, zIndex: 5, display: "flex", alignItems: "center", gap: 12, padding: "12px clamp(14px,4vw,26px)", background: "var(--surface)", borderBottom: "1px solid var(--sep)", backdropFilter: "saturate(180%) blur(20px)" }}>
          <button onClick={() => this.closeDay()} style={backBtn}>‹ Kalender</button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 720, letterSpacing: "-.02em", textTransform: "capitalize", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{day.label}</div>
            <div style={{ fontSize: 12.5, color: "var(--text-3)" }}>{day.countLabel}</div>
          </div>
          <button onClick={() => this.openNewOn(day.iso)} style={{ border: "none", background: "var(--accent)", color: "#fff", borderRadius: 10, padding: "9px 15px", fontSize: 14, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>＋ Tambah</button>
        </div>
        <div style={{ maxWidth: 820, margin: "0 auto", padding: "clamp(16px,3vw,26px)" }}>
          {day.empty && (
            <div style={{ textAlign: "center", padding: "70px 20px", color: "var(--text-3)" }}>
              <div style={{ fontSize: 40, opacity: 0.5, marginBottom: 6 }}>◔</div>
              <div style={{ fontSize: 16, fontWeight: 640, color: "var(--text-2)" }}>Tidak ada kegiatan pada tanggal ini</div>
              <button onClick={() => this.openNewOn(day.iso)} style={{ border: "none", background: "var(--accent)", color: "#fff", borderRadius: 11, padding: "11px 20px", fontSize: 15, fontWeight: 600, cursor: "pointer", marginTop: 16 }}>＋ Tambah Kegiatan</button>
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
            {day.items.map((it) => this.renderListCard(it))}
          </div>
        </div>
      </div>
    );
  }

  // ---------- EDITOR MODAL ----------
  renderEditor() {
    const s = this.state;
    const f = s.form;
    if (!f) return null;
    const isMobile = s.width < 860;
    return (
      <div onClick={() => this.closeEditor()} style={overlay(isMobile)}>
        <div onClick={(e) => e.stopPropagation()} style={modalCard(isMobile)}>
          <header style={modalHeader}>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, letterSpacing: "-.02em", flex: 1 }}>{s.editingId ? "Ubah Kegiatan" : "Kegiatan Baru"}</h2>
            <button onClick={() => this.closeEditor()} style={closeBtn}>✕</button>
          </header>
          <div style={{ padding: 20, overflow: "auto", flex: 1 }}>
            {/* Rencana Kinerja */}
            <div style={{ marginBottom: 17 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "0 0 8px" }}>
                <label style={fieldLabel}>Rencana Kinerja</label>
                <button onClick={() => this.openCatMgr()} style={{ border: "none", background: "transparent", color: "var(--accent)", fontSize: 12.5, fontWeight: 600, cursor: "pointer", padding: 0 }}>Kelola</button>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, maxHeight: 150, overflow: "auto", padding: 1 }}>
                {s.categories.map((c) => {
                  const active = f.categoryId === c.id;
                  return (
                    <button key={c.id} onClick={() => this.setForm({ categoryId: c.id })} style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "8px 13px", borderRadius: 11, cursor: "pointer", fontSize: 14, whiteSpace: "nowrap", transition: "all .12s ease", ...(active ? { background: "var(--accent-soft)", border: "1.5px solid var(--accent)", color: "var(--accent)", fontWeight: 640 } : { background: "var(--bg)", border: "1px solid var(--sep-2)", color: "var(--text)", fontWeight: 500 }) }}>
                      <span style={{ width: 9, height: 9, borderRadius: 3, flex: "none", background: c.color }} />
                      {c.name}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Tanggal */}
            <div style={{ marginBottom: 17 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 7 }}>
                <label style={fieldLabel}>Tanggal</label>
                <button onClick={() => this.setForm((ff) => ({ isRange: !ff.isRange, endDate: ff.startDate }))} style={toggleRow}>
                  Rentang tanggal{this.Switch(f.isRange)}
                </button>
              </div>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <input type="date" value={f.startDate} onChange={(e) => this.setForm((ff) => ({ startDate: e.target.value, endDate: !ff.isRange || ff.endDate < e.target.value ? e.target.value : ff.endDate }))} style={dateInput} />
                {f.isRange && (
                  <>
                    <span style={{ color: "var(--text-3)" }}>→</span>
                    <input type="date" value={f.endDate} onChange={(e) => this.setForm({ endDate: e.target.value })} style={dateInput} />
                  </>
                )}
              </div>
            </div>

            {/* Jam */}
            <div style={{ marginBottom: 17 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 7 }}>
                <label style={fieldLabel}>Jam <span style={{ color: "var(--text-3)", fontWeight: 400 }}>(opsional)</span></label>
                <button onClick={() => this.setForm((ff) => ({ hasTime: !ff.hasTime }))} style={toggleRow}>
                  Tambah jam{this.Switch(f.hasTime)}
                </button>
              </div>
              {f.hasTime && (
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <input type="time" value={f.startTime} onChange={(e) => this.setForm({ startTime: e.target.value })} style={dateInput} />
                  <span style={{ color: "var(--text-3)" }}>→</span>
                  <input type="time" value={f.endTime} onChange={(e) => this.setForm({ endTime: e.target.value })} style={dateInput} />
                </div>
              )}
            </div>

            {/* Kegiatan */}
            <div style={{ marginBottom: 17 }}>
              <label style={{ ...fieldLabel, display: "block", margin: "0 0 7px" }}>Kegiatan</label>
              <input value={f.title} onChange={(e) => this.setForm({ title: e.target.value })} placeholder="Nama kegiatan" style={textInput} />
            </div>

            {/* Capaian */}
            <div style={{ marginBottom: 17 }}>
              <label style={{ ...fieldLabel, display: "block", margin: "0 0 7px" }}>Capaian</label>
              <textarea value={f.capaian} onChange={(e) => this.setForm({ capaian: e.target.value })} rows={4} placeholder="Jelaskan capaian / hasil pekerjaan…" style={{ ...textInput, lineHeight: 1.5 }} />
            </div>

            {/* Bukti Dukung */}
            <div>
              <label style={{ ...fieldLabel, display: "block", margin: "0 0 7px" }}>Bukti Dukung</label>
              <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                <input value={f.linkDraft} onChange={(e) => this.setForm({ linkDraft: e.target.value })} placeholder="Tempel link (Drive, dsb.)" style={{ ...textInput, fontSize: 14, padding: "10px 12px", borderRadius: 10 }} />
                <button onClick={() => this.addLink()} style={{ border: "none", background: "var(--fill-2)", color: "var(--text)", borderRadius: 10, padding: "0 15px", fontSize: 14, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>Tambah</button>
              </div>
              <label style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3, padding: 14, border: "1.5px dashed var(--sep-2)", borderRadius: 12, cursor: "pointer", color: "var(--text-2)", fontSize: 14, fontWeight: 500, marginBottom: 10, textAlign: "center" }}>
                <span>＋ Unggah gambar (bisa lebih dari satu)</span>
                <span style={{ fontSize: 11.5, color: "var(--text-3)", fontWeight: 400 }}>atau tempel gambar dari clipboard (Ctrl / ⌘ + V)</span>
                <input type="file" accept="image/*" multiple onChange={(e) => this.addImages(e)} style={{ display: "none" }} />
              </label>
              {f.evidence.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {f.evidence.map((ev) => (
                    <div key={ev.id} style={{ display: "flex", alignItems: "center", gap: 11, padding: "8px 10px", border: "1px solid var(--sep)", borderRadius: 11, background: "var(--surface-2)" }}>
                      {ev.type === "image" ? (
                        <span style={{ width: 42, height: 42, borderRadius: 8, flex: "none", backgroundColor: "var(--fill)", backgroundSize: "cover", backgroundPosition: "center", backgroundImage: `url('/api/image/${encodeURIComponent(ev.fileId)}')` }} />
                      ) : (
                        <span style={{ width: 42, height: 42, borderRadius: 8, background: "var(--accent-soft)", color: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none", fontSize: 17 }}>↗</span>
                      )}
                      <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-2)" }}>
                        {ev.type === "link" ? ev.name || ev.url : ev.name || "Gambar"}
                      </span>
                      <button onClick={() => this.removeEvidence(ev.id)} style={{ border: "none", background: "var(--fill)", color: "var(--text-2)", width: 28, height: 28, borderRadius: "50%", fontSize: 13, cursor: "pointer", flex: "none" }}>✕</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <footer style={modalFooter}>
            {s.editingId && (
              <button onClick={() => this.deleteCurrent()} style={{ border: "none", background: "transparent", color: "#FF3B30", fontSize: 14, fontWeight: 600, cursor: "pointer", padding: "9px 4px" }}>Hapus</button>
            )}
            <div style={{ flex: 1 }} />
            <button onClick={() => this.closeEditor()} style={secondaryBtn}>Batal</button>
            <button onClick={() => this.saveForm()} style={primaryBtn}>Simpan</button>
          </footer>
        </div>
      </div>
    );
  }

  // ---------- KELOLA RENCANA KINERJA ----------
  renderCatMgr() {
    const s = this.state;
    const isMobile = s.width < 860;
    return (
      <div onClick={() => this.closeCatMgr()} style={overlay(isMobile)}>
        <div onClick={(e) => e.stopPropagation()} style={modalCard(isMobile)}>
          <header style={modalHeader}>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, letterSpacing: "-.02em", flex: 1 }}>Rencana Kinerja</h2>
            <button onClick={() => this.closeCatMgr()} style={closeBtn}>✕</button>
          </header>
          <div style={{ padding: "16px 20px", overflow: "auto", flex: 1 }}>
            <p style={{ margin: "0 0 14px", fontSize: 13, color: "var(--text-3)" }}>Kelompokkan kegiatan berdasarkan rencana kinerja. Ketuk kotak warna untuk mengganti warna.</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
              {s.categories.map((c) => {
                const count = s.activities.filter((a) => a.categoryId === c.id).length;
                return (
                  <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 11, padding: "8px 10px", border: "1px solid var(--sep)", borderRadius: 12, background: "var(--surface-2)" }}>
                    <button onClick={() => this.cycleColor(c.id)} title="Ganti warna" style={{ width: 24, height: 24, borderRadius: 7, border: "none", cursor: "pointer", flex: "none", background: c.color }} />
                    <input value={c.name} onChange={(e) => this.renameCat(c.id, e.target.value)} style={{ flex: 1, minWidth: 0, border: "none", background: "transparent", color: "var(--text)", fontSize: 14.5, fontWeight: 560, outline: "none" }} />
                    <span style={{ fontSize: 12, color: "var(--text-3)", flex: "none" }}>{count} keg.</span>
                    <button onClick={() => this.deleteCat(c.id)} style={{ border: "none", background: "var(--fill)", color: "var(--text-2)", width: 28, height: 28, borderRadius: "50%", fontSize: 13, cursor: "pointer", flex: "none" }}>✕</button>
                  </div>
                );
              })}
            </div>
            <div style={{ borderTop: "1px solid var(--sep)", paddingTop: 16 }}>
              <label style={{ ...fieldLabel, display: "block", margin: "0 0 9px" }}>Tambah rencana kinerja baru</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginBottom: 11 }}>
                {PALETTE.map((col) => {
                  const sel = s.catForm.color === col;
                  return (
                    <button key={col} onClick={() => this.setState({ catForm: { ...this.state.catForm, color: col } })} style={{ width: 28, height: 28, borderRadius: 8, cursor: "pointer", background: col, border: `2px solid ${sel ? "var(--text)" : "transparent"}`, boxShadow: sel ? "inset 0 0 0 2px var(--surface)" : "none" }} />
                  );
                })}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <input value={s.catForm.name} onChange={(e) => this.setState({ catForm: { ...this.state.catForm, name: e.target.value } })} placeholder="Nama rencana kinerja" style={textInput} />
                <button onClick={() => this.addCat()} style={{ border: "none", background: "var(--accent)", color: "#fff", borderRadius: 11, padding: "0 18px", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>Tambah</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ---------- SHARE CONFIG ----------
  renderShare() {
    const s = this.state;
    const cfg = s.shareCfg;
    if (!cfg) return null;
    const isMobile = s.width < 860;
    const n = actsInRange({ activities: s.activities, categories: s.categories }, cfg).length;
    const url = this.shareUrl(cfg);
    return (
      <div onClick={() => this.closeShare()} style={overlay(isMobile)}>
        <div onClick={(e) => e.stopPropagation()} style={modalCard(isMobile)}>
          <header style={modalHeader}>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, letterSpacing: "-.02em", flex: 1 }}>Bagikan Laporan</h2>
            <button onClick={() => this.closeShare()} style={closeBtn}>✕</button>
          </header>
          <div style={{ padding: 20, overflow: "auto", flex: 1 }}>
            <p style={{ margin: "0 0 18px", fontSize: 13.5, color: "var(--text-2)", lineHeight: 1.5 }}>Buat laporan read-only berisi kegiatan pada rentang tanggal tertentu — siap ditampilkan pada aplikasi SKP dan dilihat atasan.</p>
            <div style={{ marginBottom: 16 }}>
              <label style={{ ...fieldLabel, display: "block", margin: "0 0 7px" }}>Judul Laporan</label>
              <input value={cfg.title} onChange={(e) => this.setCfg({ title: e.target.value })} style={textInput} />
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ ...fieldLabel, display: "block", margin: "0 0 7px" }}>Rentang Tanggal</label>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <input type="date" value={cfg.from} onChange={(e) => this.setCfg({ from: e.target.value })} style={dateInput} />
                <span style={{ color: "var(--text-3)" }}>→</span>
                <input type="date" value={cfg.to} onChange={(e) => this.setCfg({ to: e.target.value })} style={dateInput} />
              </div>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginBottom: 20 }}>
              <button onClick={() => this.shQuick("week")} style={quickBtn}>Minggu ini</button>
              <button onClick={() => this.shQuick("month")} style={quickBtn}>Bulan ini</button>
              <button onClick={() => this.shQuick("30")} style={quickBtn}>30 hari</button>
              <button onClick={() => this.shQuick("all")} style={quickBtn}>Semua</button>
            </div>
            <label style={{ ...fieldLabel, display: "block", margin: "0 0 9px" }}>Bagian yang Ditampilkan</label>
            <div style={{ display: "flex", flexDirection: "column", gap: 2, marginBottom: 18 }}>
              {([
                ["stats", "Ringkasan statistik"],
                ["timeline", "Lini masa / timeline"],
                ["grid", "Kartu grid + bukti"],
                ["report", "Rincian per tanggal"],
              ] as [keyof ShareConfig, string][]).map(([key, label]) => (
                <button key={key} onClick={() => this.setCfg({ [key]: !cfg[key] } as Partial<ShareConfig>)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", border: "none", background: "transparent", color: "var(--text)", fontSize: 14.5, padding: "9px 2px", cursor: "pointer" }}>
                  {label}
                  {this.Switch(!!cfg[key])}
                </button>
              ))}
            </div>
            <div style={{ background: "var(--surface-2)", border: "1px solid var(--sep)", borderRadius: 12, padding: "13px 15px", marginBottom: 14 }}>
              <div style={{ fontSize: 13, color: "var(--text-2)", marginBottom: 8 }}>
                <b style={{ color: "var(--text)" }}>{n} kegiatan</b> akan disertakan.
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <input value={url} readOnly style={{ flex: 1, minWidth: 0, padding: "9px 11px", borderRadius: 9, border: "1px solid var(--sep-2)", background: "var(--bg)", color: "var(--text-2)", fontSize: 12, outline: "none", fontFamily: "ui-monospace,monospace" }} />
                <button onClick={() => this.shCopy()} style={{ border: "none", background: "var(--fill-2)", color: "var(--text)", borderRadius: 9, padding: "0 15px", fontSize: 13.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>Salin</button>
              </div>
            </div>
            <p style={{ margin: 0, fontSize: 11.5, color: "var(--text-3)", lineHeight: 1.5 }}>Catatan: tautan membuka laporan read-only dari data yang tersimpan di Spreadsheet, sehingga dapat dibuka lintas perangkat tanpa perlu login.</p>
          </div>
          <footer style={modalFooter}>
            <div style={{ flex: 1 }} />
            <button onClick={() => this.closeShare()} style={secondaryBtn}>Batal</button>
            <button onClick={() => this.openReport()} style={primaryBtn}>Buka Laporan</button>
          </footer>
        </div>
      </div>
    );
  }
}

// ===================================================================
// Shared style constants
// ===================================================================
const rootStyle: CSSProperties = {
  background: "var(--bg)",
  color: "var(--text)",
  minHeight: "100dvh",
  WebkitFontSmoothing: "antialiased",
  textRendering: "optimizeLegibility",
};
const logoBox: CSSProperties = {
  width: 30,
  height: 30,
  borderRadius: 8,
  background: "var(--accent)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "#fff",
  fontWeight: 760,
  fontSize: 16,
};
const sideFootBtn: CSSProperties = {
  textAlign: "left",
  border: "none",
  background: "transparent",
  color: "var(--text-2)",
  fontSize: 13.5,
  padding: "9px 10px",
  borderRadius: 9,
  cursor: "pointer",
};
const hamburgerBtn: CSSProperties = {
  border: "none",
  background: "var(--fill)",
  color: "var(--text)",
  width: 38,
  height: 38,
  borderRadius: 10,
  cursor: "pointer",
  display: "flex",
  flexDirection: "column",
  gap: 3.5,
  alignItems: "center",
  justifyContent: "center",
};
const hamLine: CSSProperties = { width: 15, height: 1.8, background: "currentColor", borderRadius: 2 };
const catPill: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  fontSize: 12,
  fontWeight: 600,
  color: "var(--text-2)",
  background: "var(--fill)",
  padding: "3px 10px",
  borderRadius: 20,
};
const rangeBadge: CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: "var(--accent)",
  background: "var(--accent-soft)",
  padding: "3px 10px",
  borderRadius: 20,
};
const linkChip: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  fontSize: 12.5,
  color: "var(--accent)",
  textDecoration: "none",
  background: "var(--fill)",
  padding: "6px 11px",
  borderRadius: 9,
  maxWidth: 220,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};
const countBadge: CSSProperties = {
  position: "absolute",
  right: 8,
  bottom: 8,
  background: "rgba(0,0,0,.62)",
  color: "#fff",
  fontSize: 11,
  fontWeight: 600,
  padding: "2px 9px",
  borderRadius: 20,
};
const monoNote: CSSProperties = {
  fontFamily: "ui-monospace,SFMono-Regular,monospace",
  fontSize: 11,
  color: "var(--text-3)",
};
const backBtn: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  border: "none",
  background: "var(--fill)",
  color: "var(--text)",
  borderRadius: 9,
  padding: "8px 13px",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
};
const calNavBtn: CSSProperties = {
  border: "1px solid var(--sep-2)",
  background: "var(--surface)",
  color: "var(--text)",
  borderRadius: 9,
  padding: "7px 13px",
  fontSize: 13.5,
  fontWeight: 600,
  cursor: "pointer",
};
const calArrow: CSSProperties = {
  border: "1px solid var(--sep-2)",
  background: "var(--surface)",
  color: "var(--text)",
  borderRadius: 9,
  width: 36,
  height: 34,
  fontSize: 18,
  cursor: "pointer",
  lineHeight: 1,
};
const fieldLabel: CSSProperties = { fontSize: 13, fontWeight: 640, color: "var(--text-2)" };
const textInput: CSSProperties = {
  width: "100%",
  flex: 1,
  padding: "11px 13px",
  borderRadius: 11,
  border: "1px solid var(--sep-2)",
  background: "var(--bg)",
  color: "var(--text)",
  fontSize: 15,
  outline: "none",
};
const dateInput: CSSProperties = {
  flex: 1,
  padding: "11px 13px",
  borderRadius: 11,
  border: "1px solid var(--sep-2)",
  background: "var(--bg)",
  color: "var(--text)",
  fontSize: 15,
  outline: "none",
};
const toggleRow: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  border: "none",
  background: "transparent",
  color: "var(--text-2)",
  fontSize: 13,
  cursor: "pointer",
  padding: 0,
};
const modalHeader: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: "17px 20px",
  borderBottom: "1px solid var(--sep)",
  flex: "none",
};
const modalFooter: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "14px 20px",
  borderTop: "1px solid var(--sep)",
  flex: "none",
};
const closeBtn: CSSProperties = {
  border: "none",
  background: "var(--fill)",
  color: "var(--text)",
  width: 32,
  height: 32,
  borderRadius: "50%",
  fontSize: 15,
  cursor: "pointer",
};
const primaryBtn: CSSProperties = {
  border: "none",
  background: "var(--accent)",
  color: "#fff",
  borderRadius: 10,
  padding: "10px 20px",
  fontSize: 15,
  fontWeight: 600,
  cursor: "pointer",
};
const secondaryBtn: CSSProperties = {
  border: "none",
  background: "var(--fill)",
  color: "var(--text)",
  borderRadius: 10,
  padding: "10px 18px",
  fontSize: 15,
  fontWeight: 600,
  cursor: "pointer",
};
const quickBtn: CSSProperties = {
  border: "1px solid var(--sep-2)",
  background: "var(--surface)",
  color: "var(--text-2)",
  borderRadius: 20,
  padding: "6px 13px",
  fontSize: 12.5,
  fontWeight: 560,
  cursor: "pointer",
};

function overlay(isMobile: boolean): CSSProperties {
  return {
    position: "fixed",
    inset: 0,
    zIndex: 60,
    display: "flex",
    justifyContent: "center",
    background: "var(--scrim)",
    backdropFilter: "blur(2px)",
    animation: "jkk-fade .2s ease",
    alignItems: isMobile ? "flex-end" : "center",
    padding: isMobile ? 0 : 24,
  };
}
function modalCard(isMobile: boolean): CSSProperties {
  return {
    background: "var(--surface)",
    boxShadow: "var(--shadow-lg)",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    ...(isMobile
      ? {
          width: "100%",
          maxWidth: 640,
          borderRadius: "22px 22px 0 0",
          maxHeight: "94dvh",
          animation: "jkk-sheet .3s cubic-bezier(.32,.72,0,1)",
        }
      : {
          width: 600,
          maxWidth: "calc(100vw - 32px)",
          borderRadius: 20,
          maxHeight: "88dvh",
          animation: "jkk-pop .22s ease",
        }),
  };
}
function clampN(lines: number, fontSize = 14): CSSProperties {
  return {
    margin: 0,
    color: "var(--text-2)",
    fontSize,
    lineHeight: 1.5,
    display: "-webkit-box",
    WebkitLineClamp: lines,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  };
}
function thumb(size: number): CSSProperties {
  return {
    width: size,
    height: size,
    borderRadius: 9,
    border: "1px solid var(--sep)",
    backgroundSize: "cover",
    backgroundPosition: "center",
    cursor: "zoom-in",
    padding: 0,
  };
}
function coverBtn(size: number): CSSProperties {
  return {
    width: size,
    height: size,
    flex: "none",
    borderRadius: 12,
    border: "1px solid var(--sep)",
    backgroundSize: "cover",
    backgroundPosition: "center",
    cursor: "zoom-in",
    padding: 0,
  };
}
function hatchBox(height: number): CSSProperties {
  return {
    height,
    background: "repeating-linear-gradient(135deg,var(--fill),var(--fill) 9px,transparent 9px,transparent 18px)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderBottom: "1px solid var(--sep)",
  };
}
