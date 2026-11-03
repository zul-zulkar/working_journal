// ── Jurnal → KipApp · logika inti (tanpa DOM) ────────────────────────────────
// Dipakai panel.js (content script) dan bisa diuji di Node:
//   node -e "const c=require('./kipapp-extension/core.js'); ..."
//
// Tugasnya murni: memetakan Rencana Kinerja Jurnal ke Rencana Kinerja SKP di
// KipApp, lalu mengubah tiap kegiatan Jurnal dalam periode SKP menjadi payload
// POST /api/v1/kegiatan KipApp (lengkap dengan status: baru / sudah ada / perlu
// perbaikan).
(function (root) {
  "use strict";

  const SKIP = "__skip__";
  /** Skor minimal agar Rencana Kinerja dipasangkan otomatis. */
  const AUTO_MIN = 0.6;
  /** Aturan form KipApp (ModalAdd.vue): "Kegiatan minimal 10 karakter." */
  const MIN_KEGIATAN = 10;

  const STOP = new Set([
    "yang", "dan", "di", "ke", "dari", "pada", "untuk", "dengan", "dalam", "oleh",
    "atau", "sebagai", "serta", "terhadap", "secara", "the", "of", "and",
    // Awalan baku nama RK SKP — muncul di hampir semua RK, jadi tidak membedakan.
    "terwujudnya", "terlaksananya", "telaksananya", "tercapainya", "meningkatnya", "tersedianya",
  ]);

  function normalize(s) {
    return String(s || "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function tokens(s) {
    return normalize(s).split(" ").filter((w) => w && !STOP.has(w));
  }

  /** 0..1 — sama persis = 1; selain itu Dice koefisien kata (tanpa kata sambung). */
  function similarity(a, b) {
    const na = normalize(a);
    const nb = normalize(b);
    if (!na || !nb) return 0;
    if (na === nb) return 1;
    const A = new Set(tokens(a));
    const B = new Set(tokens(b));
    if (!A.size || !B.size) return 0;
    let inter = 0;
    A.forEach((t) => {
      if (B.has(t)) inter++;
    });
    const dice = (2 * inter) / (A.size + B.size);
    const contains = na.length > 12 && nb.length > 12 && (na.includes(nb) || nb.includes(na)) ? 0.9 : 0;
    return Math.max(dice, contains);
  }

  /**
   * Pasangkan tiap Rencana Kinerja Jurnal (category) ke RK KipApp.
   * `picks` = pilihan manual tersimpan: { [categoryId]: <nama RK ternormalisasi> | "__skip__" }.
   * Disimpan per nama (bukan rkid) karena rkid KipApp berganti tiap periode SKP,
   * sementara nama RK biasanya sama dari triwulan ke triwulan.
   * Hasil: { [categoryId]: { rkid: string|null, how: "manual"|"auto"|"skip"|"none", score } }
   */
  function matchCategories(categories, rks, picks) {
    const out = {};
    const byNorm = new Map(rks.map((r) => [normalize(r.rencanakinerja), r]));
    for (const c of categories) {
      const pick = picks && picks[c.id];
      if (pick === SKIP) {
        out[c.id] = { rkid: null, how: "skip", score: 0 };
        continue;
      }
      if (pick && byNorm.has(pick)) {
        out[c.id] = { rkid: String(byNorm.get(pick).rkid), how: "manual", score: 1 };
        continue;
      }
      let best = null;
      let bestScore = 0;
      for (const r of rks) {
        const s = similarity(c.name, r.rencanakinerja);
        if (s > bestScore) {
          best = r;
          bestScore = s;
        }
      }
      out[c.id] =
        best && bestScore >= AUTO_MIN
          ? { rkid: String(best.rkid), how: "auto", score: bestScore }
          : { rkid: null, how: "none", score: bestScore };
    }
    return out;
  }

  const TIME_RE = /^\d{2}:\d{2}$/;
  const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

  function existKey(tanggal, kegiatan) {
    return String(tanggal || "").slice(0, 10) + "|" + normalize(kegiatan);
  }

  function evidenceUrls(a, jurnalOrigin) {
    const urls = [];
    for (const e of a.evidence || []) {
      if (e && e.url) urls.push(e.url);
      else if (e && e.type === "image" && e.fileId && jurnalOrigin) urls.push(jurnalOrigin + "/api/image/" + e.fileId);
    }
    return urls;
  }

  /**
   * Data dukung untuk satu kegiatan. Mengembalikan
   *   { url }                 → link langsung
   *   { share: {from, to} }   → link laporan Jurnal (Bagikan) — dibuat saat kirim
   *   { url: null }           → kosong
   */
  function dataDukungFor(a, opts, jurnalOrigin) {
    const urls = evidenceUrls(a, jurnalOrigin);
    const range = { from: a.startDate, to: a.endDate && a.endDate > a.startDate ? a.endDate : a.startDate };
    switch (opts.ddMode) {
      case "none":
        return { url: null };
      case "fixed":
        return { url: (opts.ddFixed || "").trim() || null };
      case "evidence":
        return { url: urls[0] || null };
      case "share":
        return { share: range };
      case "auto":
      default:
        // Satu bukti → langsung ke bukti itu. Nol atau beberapa bukti → laporan
        // Jurnal untuk tanggal tsb (menampilkan semua gambar & link sekaligus).
        return urls.length === 1 ? { url: urls[0] } : { share: range };
    }
  }

  function sortActs(a, b) {
    return (
      a.startDate.localeCompare(b.startDate) ||
      (a.startTime || "99").localeCompare(b.startTime || "99") ||
      String(a.title).localeCompare(String(b.title))
    );
  }

  function inPeriod(a, skp) {
    return ISO_RE.test(a.startDate || "") && a.startDate >= skp.periodeawal && a.startDate <= skp.periodeakhir;
  }

  /**
   * Ubah kegiatan Jurnal dalam periode SKP menjadi baris siap kirim.
   * status: "new" (siap dikirim) | "exists" (sudah ada di KipApp) | "invalid" (perlu perbaikan)
   */
  function buildRows({ activities, categories, skp, catMap, existing, opts, jurnalOrigin }) {
    const catById = new Map((categories || []).map((c) => [c.id, c]));
    const exist = new Set((existing || []).map((k) => existKey(k.tanggal, k.kegiatan)));
    const seen = new Set();
    const rows = [];

    for (const a of (activities || []).filter((x) => inPeriod(x, skp)).sort(sortActs)) {
      const issues = [];
      const notes = [];
      const title = String(a.title || "").trim();
      const capaian = String(a.capaian || "").trim();
      const cat = catById.get(a.categoryId);
      const m = catMap[a.categoryId] || { rkid: null, how: "none" };

      if (!cat) issues.push("Belum punya Rencana Kinerja di Jurnal");
      else if (m.how === "skip") issues.push("Rencana Kinerja dilewati");
      else if (!m.rkid) issues.push("Rencana Kinerja belum dipasangkan");
      if (title.length < MIN_KEGIATAN) issues.push("Kegiatan minimal " + MIN_KEGIATAN + " karakter");
      if (!capaian) issues.push("Capaian kosong");

      let tanggalselesai = null;
      if (a.endDate && a.endDate > a.startDate) {
        tanggalselesai = a.endDate > skp.periodeakhir ? skp.periodeakhir : a.endDate;
        if (tanggalselesai !== a.endDate) notes.push("Tanggal selesai dipotong ke akhir periode SKP");
      }

      let jammulai = null;
      let jamselesai = null;
      if (TIME_RE.test(a.startTime || "") && TIME_RE.test(a.endTime || "")) {
        if (a.endTime > a.startTime) {
          jammulai = a.startTime;
          jamselesai = a.endTime;
        } else notes.push("Jam diabaikan (jam selesai ≤ jam mulai)");
      } else if (a.startTime || a.endTime) notes.push("Jam diabaikan (hanya satu jam yang terisi)");

      const key = existKey(a.startDate, title);
      const dup = seen.has(key);
      seen.add(key);
      if (dup) issues.push("Duplikat di Jurnal (tanggal & kegiatan sama)");

      const payload = {
        skpid: String(skp.id),
        rkid: m.rkid ? String(m.rkid) : null,
        kegiatan: title,
        tanggal: a.startDate,
        tanggalselesai,
        progres: 100,
        jammulai,
        jamselesai,
        capaian,
        iscapaianskp: opts.capaianSkp ? 1 : 0,
      };

      rows.push({
        id: a.id,
        act: a,
        categoryName: cat ? cat.name : "",
        rkid: m.rkid,
        payload,
        dd: dataDukungFor(a, opts, jurnalOrigin),
        status: exist.has(key) ? "exists" : issues.length ? "invalid" : "new",
        issues,
        notes,
      });
    }
    return rows;
  }

  /** Payload final untuk POST — data dukung kosong tidak dikirim (sama seperti form KipApp). */
  function finalPayload(row, ddUrl) {
    const p = Object.assign({}, row.payload);
    if (ddUrl) p.datadukung = ddUrl;
    return p;
  }

  const api = {
    SKIP,
    AUTO_MIN,
    MIN_KEGIATAN,
    normalize,
    similarity,
    matchCategories,
    buildRows,
    dataDukungFor,
    finalPayload,
    existKey,
    inPeriod,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.JKCore = api;
})(typeof self !== "undefined" ? self : this);
