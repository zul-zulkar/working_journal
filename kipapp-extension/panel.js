// ── Jurnal → KipApp · panel (content script, isolated world) ─────────────────
// Panel samping di halaman KipApp: pilih periode SKP → pasangkan Rencana
// Kinerja → tinjau kegiatan dari Jurnal → kirim satu per satu ke
// POST /api/v1/kegiatan lewat bridge.js (yang memegang token sesi KipApp).
(() => {
  if (window.__jkPanel) return;
  window.__jkPanel = true;

  const JK = window.JKCore;
  const enc = encodeURIComponent;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ── jembatan ke bridge.js (MAIN world) & service worker ───────────────────
  let seq = 0;
  const pending = new Map();
  document.addEventListener("jk:res", (ev) => {
    let m;
    try {
      m = JSON.parse(ev.detail);
    } catch (_) {
      return;
    }
    const done = pending.get(m.id);
    if (done) {
      pending.delete(m.id);
      done(m);
    }
  });

  function bridge(op, extra) {
    return new Promise((resolve) => {
      const id = "jk" + ++seq + Math.random().toString(36).slice(2, 8);
      const t = setTimeout(() => {
        pending.delete(id);
        resolve({ ok: false, error: "Bridge tidak merespons — muat ulang halaman KipApp (F5)." });
      }, 30000);
      pending.set(id, (m) => {
        clearTimeout(t);
        resolve(m);
      });
      document.dispatchEvent(new CustomEvent("jk:req", { detail: JSON.stringify(Object.assign({ id, op }, extra)) }));
    });
  }

  async function api(method, path, body) {
    const r = await bridge("api", { method, path, body });
    if (!r.ok) {
      const e = new Error(r.error || "Gagal memanggil KipApp.");
      e.status = r.status;
      throw e;
    }
    return r.data;
  }

  function bg(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (res) => {
          const err = chrome.runtime.lastError;
          resolve(res || { ok: false, code: "ext", error: err ? err.message : "Ekstensi tidak merespons." });
        });
      } catch (e) {
        resolve({ ok: false, code: "ext", error: "Ekstensi diperbarui — muat ulang halaman KipApp (F5)." });
      }
    });
  }

  // ── state ──────────────────────────────────────────────────────────────────
  const S = {
    open: false,
    inited: false,
    busy: null, // teks status saat memuat
    kipError: null,
    needPelaksanaan: false,
    tahunList: [],
    tahunId: "",
    skpList: [],
    skpId: "",
    skp: null,
    rks: null,
    existing: null,
    jurnalUrl: "",
    jurnal: null,
    jurnalOrigin: "",
    jurnalErr: null,
    usedCats: [],
    catMap: {},
    rows: [],
    deselected: new Set(),
    results: new Map(),
    filter: "new",
    opts: { ddMode: "auto", ddFixed: "", capaianSkp: true },
    picks: {},
    confirm: false,
    sending: false,
    stopReq: false,
    progress: null, // { done, total, ok, fail }
    summary: null, // { ok, fail, stopped }
    preview: null, // payload[] untuk Simulasi
  };

  // ── data ───────────────────────────────────────────────────────────────────
  async function ensureInit() {
    if (S.inited) return;
    S.inited = true;
    const [loc, sync] = await Promise.all([
      chrome.storage.local.get(["jk_opts", "jk_picks"]),
      chrome.storage.sync.get("jurnalUrl"),
    ]);
    S.opts = Object.assign(S.opts, loc.jk_opts || {});
    S.picks = loc.jk_picks || {};
    S.jurnalUrl = sync.jurnalUrl || "";
    await loadTahun();
  }

  async function loadTahun() {
    S.busy = "Membaca sesi KipApp…";
    S.kipError = null;
    S.needPelaksanaan = false;
    render();
    try {
      const st = await bridge("status");
      if (!st.ok || !st.data || !st.data.hasToken) {
        throw new Error("Sesi KipApp belum terbaca. Muat ulang halaman ini (F5) dan pastikan sudah login.");
      }
      if (st.data.expired) throw new Error("Sesi KipApp sudah habis. Muat ulang halaman lalu login lagi.");
      const list = await api("GET", "/tahun?jenis=2");
      S.tahunList = (Array.isArray(list) ? list : []).slice().sort((a, b) => b.tahunawal - a.tahunawal);
      const yr = new Date().getFullYear();
      const t = S.tahunList.find((x) => x.tahunawal === yr) || S.tahunList[0];
      S.tahunId = t ? String(t.id) : "";
      if (S.tahunId) await loadSkp();
    } catch (e) {
      S.kipError = e.message;
    }
    S.busy = null;
    render();
  }

  function clearPeriod() {
    S.rks = null;
    S.existing = null;
    S.rows = [];
    S.usedCats = [];
    S.catMap = {};
    S.deselected = new Set();
    S.results = new Map();
    S.summary = null;
    S.confirm = false;
  }

  async function loadSkp() {
    S.skpList = [];
    S.skpId = "";
    S.skp = null;
    clearPeriod();
    const st = await bridge("status");
    const pid = st.data && st.data.pegawaiId;
    if (!pid) {
      S.needPelaksanaan = true;
      throw new Error("ID pegawai belum terbaca. Buka menu Pelaksanaan Kinerja → Pelaksanaan, lalu klik Coba lagi.");
    }
    const list = await api("GET", "/skp?periodeid=" + enc(S.tahunId) + "&pegawaiid=" + enc(pid) + "&jenis=2");
    S.skpList = (Array.isArray(list) ? list : [])
      .slice()
      .sort((a, b) => String(a.periodeawal).localeCompare(String(b.periodeawal)) || String(a.id).localeCompare(String(b.id)));
  }

  async function onTahun(id) {
    S.tahunId = id;
    S.busy = "Memuat periode SKP…";
    S.kipError = null;
    render();
    try {
      await loadSkp();
    } catch (e) {
      S.kipError = e.message;
    }
    S.busy = null;
    render();
  }

  async function loadJurnal() {
    S.jurnalErr = null;
    if (!S.jurnalUrl) {
      S.jurnal = null;
      S.jurnalErr = { code: "nourl", error: "URL Jurnal Kinerja belum diatur." };
      return;
    }
    const r = await bg({ type: "jurnal:data" });
    if (r.ok) {
      S.jurnal = r.data;
      S.jurnalOrigin = r.origin;
    } else {
      S.jurnal = null;
      S.jurnalErr = { code: r.code, error: r.error };
    }
  }

  async function onSkp(id) {
    S.skpId = id;
    S.skp = S.skpList.find((s) => String(s.id) === id) || null;
    clearPeriod();
    if (!S.skp) return render();
    S.busy = "Memuat rencana kinerja, kegiatan KipApp & data Jurnal…";
    S.kipError = null;
    render();
    const [rk, ex] = await Promise.allSettled([
      api("GET", "/skp/rk?skpid=" + enc(id) + "&direct=1"),
      api("GET", "/kegiatan?skpid=" + enc(id)),
      S.jurnal ? Promise.resolve() : loadJurnal(),
    ]);
    if (rk.status === "fulfilled" && ex.status === "fulfilled") {
      S.rks = Array.isArray(rk.value) ? rk.value : [];
      S.existing = Array.isArray(ex.value) ? ex.value : [];
    } else {
      S.kipError = (rk.reason || ex.reason).message;
    }
    S.busy = null;
    recompute();
    render();
  }

  async function reloadJurnal() {
    S.busy = "Memuat ulang data Jurnal…";
    render();
    await loadJurnal();
    S.busy = null;
    recompute();
    render();
  }

  function recompute() {
    if (!S.skp || !S.jurnal || !S.rks || !S.existing) {
      S.rows = [];
      S.usedCats = [];
      return;
    }
    const acts = S.jurnal.activities.filter((a) => JK.inPeriod(a, S.skp));
    const counts = new Map();
    acts.forEach((a) => counts.set(a.categoryId, (counts.get(a.categoryId) || 0) + 1));
    const cats = (S.jurnal.categories || []).filter((c) => counts.has(c.id));
    S.usedCats = cats.map((c) => Object.assign({}, c, { count: counts.get(c.id) }));
    S.catMap = JK.matchCategories(cats, S.rks, S.picks);
    S.rows = JK.buildRows({
      activities: acts,
      categories: S.jurnal.categories,
      skp: S.skp,
      catMap: S.catMap,
      existing: S.existing,
      opts: S.opts,
      jurnalOrigin: S.jurnalOrigin,
    });
  }

  function saveOpts() {
    chrome.storage.local.set({ jk_opts: S.opts });
  }

  function onPick(catId, value) {
    if (value === "") delete S.picks[catId];
    else if (value === JK.SKIP) S.picks[catId] = JK.SKIP;
    else {
      const rk = S.rks.find((r) => String(r.rkid) === value);
      if (rk) S.picks[catId] = JK.normalize(rk.rencanakinerja);
    }
    chrome.storage.local.set({ jk_picks: S.picks });
    recompute();
    render();
  }

  function selectedRows() {
    return S.rows.filter((r) => r.status === "new" && !S.deselected.has(r.id) && !(S.results.get(r.id) || {}).ok);
  }

  // ── kirim ──────────────────────────────────────────────────────────────────
  function shareTitle(from, to) {
    return "Bukti Dukung Kegiatan " + fmtLong(from) + (to && to !== from ? " – " + fmtLong(to) : "");
  }

  async function resolveDD(row, cache) {
    if (!row.dd.share) return row.dd.url || null;
    const { from, to } = row.dd.share;
    const key = from + "|" + to;
    if (!cache.has(key)) {
      const r = await bg({ type: "jurnal:share", from, to, title: shareTitle(from, to) });
      if (!r.ok) throw new Error(r.code === "revoked" ? r.error : "Gagal membuat link laporan Jurnal: " + r.error);
      cache.set(key, r.url);
    }
    return cache.get(key);
  }

  function previewDD(row) {
    if (row.dd.share) {
      const { from, to } = row.dd.share;
      return "(link laporan Jurnal " + from + (to !== from ? " s.d. " + to : "") + " — dibuat saat kirim)";
    }
    return row.dd.url || null;
  }

  function simulate() {
    S.preview = selectedRows().map((r) => JK.finalPayload(r, previewDD(r)));
    render();
  }

  async function send() {
    S.confirm = false;
    S.summary = null;
    S.busy = "Memeriksa ulang kegiatan yang sudah ada di KipApp…";
    render();
    try {
      // Muat ulang daftar KipApp sesaat sebelum kirim → tidak menggandakan
      // kegiatan yang baru saja diinput manual.
      S.existing = await api("GET", "/kegiatan?skpid=" + enc(S.skpId));
      recompute();
    } catch (e) {
      S.busy = null;
      S.kipError = e.message;
      return render();
    }
    S.busy = null;
    const rows = selectedRows();
    if (!rows.length) return render();

    S.sending = true;
    S.stopReq = false;
    S.progress = { done: 0, total: rows.length, ok: 0, fail: 0 };
    render();
    const shareCache = new Map();
    let fatal = false;
    for (const row of rows) {
      if (S.stopReq) break;
      try {
        const dd = await resolveDD(row, shareCache);
        await api("POST", "/kegiatan", JK.finalPayload(row, dd));
        S.results.set(row.id, { ok: true });
        S.progress.ok++;
      } catch (e) {
        S.results.set(row.id, { ok: false, error: e.message });
        S.progress.fail++;
        if (e.status === 401) fatal = true;
      }
      S.progress.done++;
      render();
      if (fatal) break;
      await sleep(350);
    }
    S.summary = { ok: S.progress.ok, fail: S.progress.fail, stopped: S.stopReq || fatal, total: rows.length };
    S.sending = false;
    S.progress = null;
    try {
      S.existing = await api("GET", "/kegiatan?skpid=" + enc(S.skpId));
    } catch (_) {}
    recompute();
    if (S.summary.fail === 0) S.filter = "exists";
    render();
    refreshKipAppTable();
  }

  // Segarkan tabel KipApp di belakang panel (jika periode sudah dipilih di sana).
  function refreshKipAppTable() {
    for (const b of document.querySelectorAll("button")) {
      if (b.textContent.trim() === "Refresh") {
        b.click();
        break;
      }
    }
  }

  // ── format ─────────────────────────────────────────────────────────────────
  function d(iso) {
    return new Date(iso + "T00:00:00");
  }
  function fmtShort(iso) {
    return d(iso).toLocaleDateString("id-ID", { weekday: "short", day: "numeric", month: "short" });
  }
  function fmtLong(iso) {
    return d(iso).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });
  }
  function skpLabel(s) {
    // keteranganperiodepenilaian = "I".."IV"; jenis 2 = triwulanan (seperti label KipApp).
    const k = s.keteranganperiodepenilaian;
    const ket = k ? " (" + (Number(s.jenisperiodepenilaian) === 2 ? "Triwulan " : "Periode ") + k + ")" : "";
    return s.deskperiodeawal + " – " + s.deskperiodeakhir + ket + " · " + s.statusskp + " · " + (s.jmlrk || 0) + " RK";
  }
  function ddLabel(row) {
    if (row.dd.share) return "laporan Jurnal";
    if (!row.dd.url) return "—";
    if (S.opts.ddMode === "fixed") return "link tetap";
    return "1 bukti";
  }

  // ── DOM ────────────────────────────────────────────────────────────────────
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v == null || v === false) continue;
        if (k === "class") el.className = v;
        else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
        else if (typeof v === "boolean") el[k] = v;
        else el.setAttribute(k, v);
      }
    }
    for (const c of kids.flat(Infinity)) {
      if (c == null || c === false) continue;
      el.append(c instanceof Node ? c : String(c));
    }
    return el;
  }

  function selectEl(options, value, onChange, attrs) {
    const sel = h(
      "select",
      Object.assign({ onchange: (e) => onChange(e.target.value) }, attrs || {}),
      options.map((o) => h("option", { value: o.value, disabled: !!o.disabled }, o.label)),
    );
    sel.value = value;
    return sel;
  }

  const host = document.createElement("div");
  host.id = "jk-kipapp-bot";
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = CSS();
  const mount = document.createElement("div");
  shadow.append(style, mount);
  (document.body || document.documentElement).appendChild(host);

  let bodyScroll = 0;

  function render() {
    const prev = shadow.querySelector(".body");
    if (prev) bodyScroll = prev.scrollTop;
    mount.replaceChildren(S.open ? drawer() : fab());
    const body = shadow.querySelector(".body");
    if (body) body.scrollTop = bodyScroll;
  }

  function fab() {
    return h(
      "button",
      { class: "fab", title: "Input otomatis dari Jurnal Kinerja", onclick: toggle },
      h("span", { class: "fab-dot" }, "J"),
      "Jurnal → KipApp",
    );
  }

  function drawer() {
    return h(
      "div",
      { class: "wrap" },
      h("div", { class: "scrim", onclick: () => !S.sending && toggle() }),
      h(
        "aside",
        { class: "drawer", role: "dialog", "aria-label": "Jurnal ke KipApp" },
        h(
          "header",
          { class: "head" },
          h("div", null, h("div", { class: "title" }, "Jurnal → KipApp"), h("div", { class: "sub" }, "Input otomatis Pelaksanaan Kinerja")),
          h("button", { class: "icon", title: "Tutup", "aria-label": "Tutup", disabled: S.sending, onclick: toggle }, "×"),
        ),
        h("div", { class: "body" }, periodCard(), S.skp ? jurnalCard() : null, mappingCard(), optionsCard(), rowsCard()),
        footer(),
        S.preview ? previewModal() : null,
      ),
    );
  }

  function card(step, title, ...kids) {
    return h("section", { class: "card" }, h("h3", null, h("span", { class: "step" }, step), title), ...kids);
  }

  function periodCard() {
    const tahunOpts = [{ value: "", label: "Pilih tahun", disabled: true }].concat(
      S.tahunList.map((t) => ({ value: String(t.id), label: String(t.tahunawal) })),
    );
    const skpOpts = [{ value: "", label: S.skpList.length ? "Pilih periode SKP" : "—", disabled: true }].concat(
      S.skpList.map((s) => ({ value: String(s.id), label: skpLabel(s) })),
    );
    const warn =
      S.skp && Number(S.skp.statusskpid) !== 1
        ? h("p", { class: "note warn" }, "Status SKP ini “" + S.skp.statusskp + "”. KipApp mungkin menolak kegiatan baru untuk SKP yang sudah dinilai.")
        : null;
    return card(
      "1",
      "Periode SKP",
      h(
        "div",
        { class: "grid2" },
        h("label", null, h("span", null, "Tahun"), selectEl(tahunOpts, S.tahunId, onTahun, { disabled: S.sending || !S.tahunList.length })),
        h("label", null, h("span", null, "Periode SKP"), selectEl(skpOpts, S.skpId, onSkp, { disabled: S.sending || !S.skpList.length })),
      ),
      S.skp ? h("p", { class: "muted" }, fmtLong(S.skp.periodeawal) + " s.d. " + fmtLong(S.skp.periodeakhir)) : null,
      warn,
      S.busy ? h("p", { class: "busy" }, h("span", { class: "spin" }), S.busy) : null,
      S.kipError
        ? h(
            "div",
            { class: "alert" },
            h("p", null, S.kipError),
            h(
              "div",
              { class: "row-actions" },
              S.needPelaksanaan
                ? h("button", { class: "btn sm", onclick: goPelaksanaan }, "Buka Pelaksanaan")
                : null,
              h("button", { class: "btn sm", onclick: loadTahun }, "Coba lagi"),
            ),
          )
        : null,
    );
  }

  async function goPelaksanaan() {
    location.hash = "#/pelaksanaan-aksi";
    S.busy = "Membuka halaman Pelaksanaan…";
    render();
    await sleep(2500);
    loadTahun();
  }

  function jurnalCard() {
    const e = S.jurnalErr;
    let content;
    if (e) {
      const actions = [];
      if (e.code === "nourl" || e.code === "perm") actions.push(h("button", { class: "btn sm primary", onclick: () => bg({ type: "openOptions" }) }, "Atur URL Jurnal"));
      if (e.code === "auth") actions.push(h("button", { class: "btn sm primary", onclick: () => bg({ type: "openJurnal" }) }, "Masuk ke Jurnal"));
      actions.push(h("button", { class: "btn sm", onclick: reloadJurnal }, "Coba lagi"));
      content = h(
        "div",
        { class: "alert" },
        h("p", null, e.error + (e.code === "auth" ? " Klik Masuk ke Jurnal, login (biarkan tab Jurnal tetap terbuka), lalu klik Coba lagi." : "")),
        h("div", { class: "row-actions" }, actions),
      );
    } else if (S.jurnal && S.skp) {
      const n = S.jurnal.activities.filter((a) => JK.inPeriod(a, S.skp)).length;
      content = h(
        "div",
        { class: "between" },
        h(
          "p",
          { class: "muted" },
          h("b", null, String(n)),
          " kegiatan Jurnal di periode ini · ",
          h("b", null, String((S.existing || []).length)),
          " kegiatan sudah ada di KipApp",
        ),
        h("button", { class: "btn sm ghost", onclick: reloadJurnal, disabled: S.sending }, "Muat ulang"),
      );
    } else return null;
    return card("2", "Sumber Jurnal", h("p", { class: "src" }, S.jurnalOrigin || S.jurnalUrl || "—"), content);
  }

  function mappingCard() {
    if (!S.rks || !S.usedCats.length) return null;
    const opts = [
      { value: "", label: "— Pilih rencana kinerja SKP —" },
      { value: JK.SKIP, label: "Lewati (jangan kirim)" },
    ].concat(S.rks.map((r) => ({ value: String(r.rkid), label: r.rencanakinerja })));
    return card(
      "3",
      "Pasangkan Rencana Kinerja",
      h("p", { class: "muted" }, "Rencana Kinerja di Jurnal → Rencana Kinerja SKP di KipApp. Dipasangkan otomatis dari kemiripan nama; pilihan manual diingat untuk periode berikutnya."),
      S.usedCats.map((c) => {
        const m = S.catMap[c.id] || { how: "none" };
        const badge =
          m.how === "manual"
            ? h("span", { class: "badge blue" }, "manual")
            : m.how === "auto"
            ? h("span", { class: "badge green" }, "otomatis " + Math.round(m.score * 100) + "%")
            : m.how === "skip"
            ? h("span", { class: "badge gray" }, "dilewati")
            : h("span", { class: "badge red" }, "belum");
        const value = m.how === "skip" ? JK.SKIP : m.rkid || "";
        return h(
          "div",
          { class: "map" },
          h(
            "div",
            { class: "map-src" },
            h("span", { class: "dot", style: "background:" + (/^#[0-9a-f]{3,8}$/i.test(c.color || "") ? c.color : "#8e8e93") }),
            h("span", { class: "map-name" }, c.name),
            h("span", { class: "count" }, c.count + " kegiatan"),
            badge,
          ),
          selectEl(opts, value, (v) => onPick(c.id, v), { disabled: S.sending, class: m.rkid || m.how === "skip" ? "" : "need" }),
        );
      }),
    );
  }

  function optionsCard() {
    if (!S.rks || !S.jurnal) return null;
    const ddOpts = [
      { value: "auto", label: "Otomatis: 1 bukti → link bukti; selainnya → link laporan Jurnal" },
      { value: "share", label: "Selalu link laporan Jurnal (per tanggal kegiatan)" },
      { value: "evidence", label: "Link bukti pertama saja (kosong bila tidak ada)" },
      { value: "fixed", label: "Satu link tetap untuk semua kegiatan" },
      { value: "none", label: "Kosongkan data dukung" },
    ];
    return card(
      "4",
      "Opsi",
      h(
        "label",
        { class: "stack" },
        h("span", null, "Data dukung"),
        selectEl(
          ddOpts,
          S.opts.ddMode,
          (v) => {
            S.opts.ddMode = v;
            saveOpts();
            recompute();
            render();
          },
          { disabled: S.sending },
        ),
      ),
      S.opts.ddMode === "fixed"
        ? h("input", {
            type: "url",
            class: "text",
            placeholder: "https://s.bps.go.id/…",
            value: S.opts.ddFixed,
            disabled: S.sending,
            oninput: (e) => {
              S.opts.ddFixed = e.target.value;
              saveOpts();
            },
            onchange: () => {
              recompute();
              render();
            },
          })
        : null,
      h(
        "label",
        { class: "check" },
        h("input", {
          type: "checkbox",
          checked: !!S.opts.capaianSkp,
          disabled: S.sending,
          onchange: (e) => {
            S.opts.capaianSkp = e.target.checked;
            saveOpts();
            recompute();
            render();
          },
        }),
        "Masukkan ke capaian SKP",
      ),
      h("p", { class: "muted" }, "Progres selalu 100. Kegiatan dengan tanggal mulai di dalam periode SKP saja yang diambil."),
    );
  }

  function rowsCard() {
    if (!S.rks || !S.jurnal) return null;
    const n = { new: 0, exists: 0, invalid: 0 };
    S.rows.forEach((r) => n[r.status]++);
    const tabs = [
      ["new", "Baru", n.new],
      ["invalid", "Perlu perbaikan", n.invalid],
      ["exists", "Sudah ada", n.exists],
      ["all", "Semua", S.rows.length],
    ];
    const list = S.rows.filter((r) => S.filter === "all" || r.status === S.filter);
    const selectable = list.filter((r) => r.status === "new" && !(S.results.get(r.id) || {}).ok);
    const allOn = selectable.length && selectable.every((r) => !S.deselected.has(r.id));
    return card(
      "5",
      "Kegiatan",
      h(
        "div",
        { class: "tabs", role: "tablist" },
        tabs.map(([k, label, count]) =>
          h(
            "button",
            {
              class: "tab" + (S.filter === k ? " on" : "") + (k === "invalid" && count ? " warn" : ""),
              role: "tab",
              "aria-selected": S.filter === k ? "true" : "false",
              onclick: () => {
                S.filter = k;
                bodyScroll = shadow.querySelector(".body").scrollTop;
                render();
              },
            },
            label,
            h("span", { class: "n" }, String(count)),
          ),
        ),
      ),
      selectable.length
        ? h(
            "label",
            { class: "check all" },
            h("input", {
              type: "checkbox",
              checked: !!allOn,
              disabled: S.sending,
              onchange: (e) => {
                selectable.forEach((r) => (e.target.checked ? S.deselected.delete(r.id) : S.deselected.add(r.id)));
                render();
              },
            }),
            "Pilih semua (" + selectable.length + ")",
          )
        : null,
      list.length ? h("ul", { class: "rows" }, list.map(rowEl)) : h("p", { class: "empty" }, emptyText()),
    );
  }

  function emptyText() {
    if (!S.rows.length) return "Tidak ada kegiatan Jurnal di periode ini.";
    if (S.filter === "new") return "Tidak ada kegiatan baru — semua sudah ada di KipApp atau perlu perbaikan.";
    if (S.filter === "invalid") return "Tidak ada yang perlu diperbaiki.";
    return "Kosong.";
  }

  function rowEl(r) {
    const a = r.act;
    const res = S.results.get(r.id);
    const rk = r.rkid && S.rks.find((x) => String(x.rkid) === String(r.rkid));
    let chip;
    if (res && res.ok) chip = h("span", { class: "badge green" }, "terkirim ✓");
    else if (res && !res.ok) chip = h("span", { class: "badge red" }, "gagal");
    else if (r.status === "exists") chip = h("span", { class: "badge gray" }, "sudah ada");
    else if (r.status === "invalid") chip = h("span", { class: "badge amber" }, "perlu perbaikan");
    else chip = h("span", { class: "badge blue" }, "baru");
    const canPick = r.status === "new" && !(res && res.ok);
    const time = r.payload.jammulai ? " · " + r.payload.jammulai + "–" + r.payload.jamselesai : "";
    const range = r.payload.tanggalselesai ? " s.d. " + fmtShort(r.payload.tanggalselesai) : "";
    return h(
      "li",
      { class: "r " + r.status + (canPick && S.deselected.has(r.id) ? " off" : "") },
      h("input", {
        type: "checkbox",
        "aria-label": "Pilih kegiatan",
        checked: canPick && !S.deselected.has(r.id),
        disabled: !canPick || S.sending,
        onchange: (e) => {
          e.target.checked ? S.deselected.delete(r.id) : S.deselected.add(r.id);
          render();
        },
      }),
      h(
        "div",
        { class: "r-main" },
        h("div", { class: "r-top" }, h("span", { class: "date" }, fmtShort(a.startDate) + range + time), chip),
        h("div", { class: "r-title" }, r.payload.kegiatan || "(tanpa judul)"),
        r.payload.capaian ? h("div", { class: "r-cap" }, r.payload.capaian) : null,
        h(
          "div",
          { class: "r-meta" },
          h("span", { title: rk ? rk.rencanakinerja : "" }, "RK: " + (rk ? rk.rencanakinerja : r.categoryName || "—")),
          h("span", null, "Data dukung: " + ddLabel(r)),
        ),
        r.issues.length ? h("div", { class: "issues" }, r.issues.join(" · ")) : null,
        r.notes.length ? h("div", { class: "notes" }, r.notes.join(" · ")) : null,
        res && !res.ok ? h("div", { class: "issues" }, res.error) : null,
      ),
    );
  }

  function footer() {
    if (!S.rks || !S.jurnal) return null;
    if (S.sending && S.progress) {
      const p = S.progress;
      return h(
        "footer",
        { class: "foot" },
        h(
          "div",
          { class: "prog" },
          h("div", { class: "prog-txt" }, "Mengirim " + p.done + "/" + p.total + " · " + p.ok + " berhasil" + (p.fail ? " · " + p.fail + " gagal" : "")),
          h("div", { class: "bar" }, h("i", { style: "width:" + Math.round((p.done / p.total) * 100) + "%" })),
        ),
        h("button", { class: "btn", disabled: S.stopReq, onclick: () => ((S.stopReq = true), render()) }, S.stopReq ? "Menghentikan…" : "Hentikan"),
      );
    }
    const sel = selectedRows();
    let summary = null;
    if (S.summary) {
      const { ok, fail, stopped } = S.summary;
      const text = fail
        ? ok + " terkirim, " + fail + " gagal — pesan galatnya ada di tiap kegiatan (tab Baru)."
        : ok + " kegiatan terkirim. Jangan lupa “Kirim” untuk dinilai di KipApp.";
      summary = h("p", { class: "sum " + (fail ? "bad" : "good") }, text + (stopped ? " Pengiriman dihentikan." : ""));
    }
    if (S.confirm) {
      return h(
        "footer",
        { class: "foot col" },
        h("p", { class: "confirm" }, "Kirim ", h("b", null, sel.length + " kegiatan"), " ke KipApp untuk SKP " + S.skp.deskperiodeawal + " – " + S.skp.deskperiodeakhir + "?"),
        h(
          "div",
          { class: "row-actions end" },
          h("button", { class: "btn", onclick: () => ((S.confirm = false), render()) }, "Batal"),
          h("button", { class: "btn primary", onclick: send }, "Ya, kirim"),
        ),
      );
    }
    return h(
      "footer",
      { class: "foot col" },
      summary,
      h(
        "div",
        { class: "row-actions end" },
        h("button", { class: "btn", disabled: !sel.length, onclick: simulate, title: "Lihat data yang akan dikirim tanpa mengirim" }, "Simulasi"),
        h(
          "button",
          { class: "btn primary", disabled: !sel.length || !!S.busy, onclick: () => ((S.confirm = true), render()) },
          sel.length ? "Kirim " + sel.length + " kegiatan" : "Tidak ada yang dipilih",
        ),
      ),
    );
  }

  function previewModal() {
    const json = JSON.stringify(S.preview, null, 2);
    return h(
      "div",
      { class: "modal" },
      h(
        "div",
        { class: "modal-box" },
        h(
          "div",
          { class: "between" },
          h("div", null, h("div", { class: "title" }, "Simulasi — belum dikirim"), h("div", { class: "sub" }, S.preview.length + " payload POST /api/v1/kegiatan")),
          h("button", { class: "icon", "aria-label": "Tutup", onclick: () => ((S.preview = null), render()) }, "×"),
        ),
        h("pre", null, json),
        h(
          "div",
          { class: "row-actions end" },
          h(
            "button",
            {
              class: "btn",
              onclick: (e) => {
                navigator.clipboard.writeText(json).then(() => (e.target.textContent = "Tersalin ✓"));
              },
            },
            "Salin JSON",
          ),
          h("button", { class: "btn primary", onclick: () => ((S.preview = null), render()) }, "Tutup"),
        ),
      ),
    );
  }

  function toggle() {
    if (S.sending) return;
    S.open = !S.open;
    render();
    if (S.open) ensureInit();
  }

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !S.open) return;
    if (S.preview) S.preview = null;
    else if (S.confirm) S.confirm = false;
    else if (!S.sending) S.open = false;
    render();
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === "toggle") toggle();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && changes.jurnalUrl) {
      S.jurnalUrl = changes.jurnalUrl.newValue || "";
      S.jurnal = null;
      S.jurnalOrigin = "";
      if (S.skp) reloadJurnal();
    }
  });

  render();

  // ── gaya (mengikuti token warna Jurnal Kinerja) ────────────────────────────
  function CSS() {
    return `
:host { all: initial; }
* { box-sizing: border-box; }
.wrap, .fab { font: 13px/1.45 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; color: #1d1d1f; }
button, select, input { font: inherit; color: inherit; }
.fab { position: fixed; right: 20px; bottom: 20px; z-index: 2147483000; display: flex; align-items: center; gap: 8px;
  padding: 9px 16px 9px 9px; border: 0; border-radius: 999px; background: #1d1d1f; color: #fff; font-weight: 600;
  box-shadow: 0 6px 24px rgba(0,0,0,.22); cursor: pointer; transition: transform .15s; }
.fab:hover { transform: translateY(-1px); }
.fab-dot { width: 24px; height: 24px; border-radius: 50%; background: #0a84ff; display: grid; place-items: center; font-size: 12px; }
.scrim { position: fixed; inset: 0; z-index: 2147483000; background: rgba(0,0,0,.18); }
.drawer { position: fixed; top: 0; right: 0; bottom: 0; z-index: 2147483001; width: min(580px, 100vw); background: #f5f5f7;
  display: flex; flex-direction: column; box-shadow: -10px 0 40px rgba(0,0,0,.18); }
.head { display: flex; align-items: center; justify-content: space-between; padding: 16px 18px; background: #fff; border-bottom: 1px solid rgba(0,0,0,.08); }
.title { font-size: 16px; font-weight: 700; letter-spacing: -.01em; }
.sub { font-size: 12px; color: #6e6e73; }
.icon { width: 32px; height: 32px; border: 0; border-radius: 50%; background: rgba(0,0,0,.05); font-size: 20px; line-height: 1; cursor: pointer; }
.icon:hover { background: rgba(0,0,0,.09); }
.body { flex: 1; overflow-y: auto; padding: 14px; display: flex; flex-direction: column; gap: 12px; }
.card { background: #fff; border-radius: 12px; padding: 14px; border: 1px solid rgba(0,0,0,.06); }
.card h3 { margin: 0 0 10px; font-size: 14px; font-weight: 650; display: flex; align-items: center; gap: 8px; }
.step { width: 20px; height: 20px; border-radius: 50%; background: #0a84ff; color: #fff; font-size: 11px; display: grid; place-items: center; }
.grid2 { display: grid; grid-template-columns: 110px 1fr; gap: 10px; }
label > span { display: block; font-size: 12px; color: #6e6e73; margin-bottom: 4px; }
label.stack { display: block; margin-bottom: 10px; }
select, input.text { width: 100%; padding: 8px 10px; border: 1px solid rgba(0,0,0,.14); border-radius: 8px; background: #fff; outline: none; }
select:focus, input.text:focus { border-color: #0a84ff; box-shadow: 0 0 0 3px rgba(10,132,255,.15); }
select.need { border-color: #ff3b30; }
input.text { margin-bottom: 10px; }
.check { display: flex; align-items: center; gap: 8px; cursor: pointer; margin: 4px 0; }
.check input, .r > input { width: 16px; height: 16px; accent-color: #0a84ff; margin: 0; flex: none; }
.muted { color: #6e6e73; margin: 8px 0 0; font-size: 12.5px; }
.src { margin: 0 0 4px; font-size: 12px; color: #0a84ff; word-break: break-all; }
.note { margin: 8px 0 0; font-size: 12.5px; padding: 8px 10px; border-radius: 8px; }
.warn { background: #fff4e5; color: #8a4b00; }
.busy { display: flex; align-items: center; gap: 8px; color: #6e6e73; margin: 10px 0 0; }
.spin { width: 14px; height: 14px; border-radius: 50%; border: 2px solid rgba(0,0,0,.1); border-top-color: #0a84ff; animation: s .8s linear infinite; }
@keyframes s { to { transform: rotate(360deg); } }
.alert { margin-top: 10px; padding: 10px 12px; border-radius: 8px; background: #fff0f0; color: #a1000b; }
.alert p { margin: 0 0 8px; }
.row-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.row-actions.end { justify-content: flex-end; }
.between { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.between .muted { margin: 0; }
.btn { padding: 8px 14px; border-radius: 8px; border: 1px solid rgba(0,0,0,.14); background: #fff; font-weight: 600; cursor: pointer; }
.btn:hover:not(:disabled) { background: #f2f2f7; }
.btn.primary { background: #0a84ff; border-color: #0a84ff; color: #fff; }
.btn.primary:hover:not(:disabled) { background: #0071e3; }
.btn.ghost { border-color: transparent; color: #0a84ff; }
.btn.sm { padding: 5px 10px; font-size: 12.5px; }
.btn:disabled { opacity: .45; cursor: default; }
.map { padding: 10px 0; border-top: 1px solid rgba(0,0,0,.06); }
.map-src { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; flex-wrap: wrap; }
.map-name { font-weight: 600; flex: 1 1 200px; min-width: 0; }
.dot { width: 9px; height: 9px; border-radius: 50%; flex: none; }
.count { font-size: 12px; color: #6e6e73; }
.badge { font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 999px; white-space: nowrap; }
.badge.green { background: #e3f6e8; color: #1b7a34; }
.badge.blue { background: #e5f1ff; color: #0060c7; }
.badge.red { background: #ffe9e8; color: #c4170c; }
.badge.amber { background: #fff1db; color: #9a5300; }
.badge.gray { background: #f0f0f2; color: #6e6e73; }
.tabs { display: flex; gap: 4px; background: #f2f2f7; padding: 3px; border-radius: 9px; margin-bottom: 10px; flex-wrap: wrap; }
.tab { flex: 1; border: 0; background: transparent; padding: 6px 8px; border-radius: 7px; cursor: pointer; font-weight: 600; font-size: 12.5px; color: #3a3a3c; white-space: nowrap; }
.tab.on { background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.12); color: #1d1d1f; }
.tab .n { margin-left: 6px; font-size: 11px; color: #6e6e73; }
.tab.warn .n { color: #c4170c; }
.check.all { margin-bottom: 6px; font-weight: 600; }
.rows { list-style: none; margin: 0; padding: 0; }
.r { display: flex; gap: 10px; padding: 10px 0; border-top: 1px solid rgba(0,0,0,.06); }
.r > input { margin-top: 2px; }
.r.off .r-main { opacity: .5; }
.r.exists .r-main { opacity: .7; }
.r-main { flex: 1; min-width: 0; }
.r-top { display: flex; justify-content: space-between; gap: 8px; align-items: center; }
.date { font-size: 12px; color: #6e6e73; font-variant-numeric: tabular-nums; }
.r-title { font-weight: 600; margin-top: 2px; }
.r-cap { color: #3a3a3c; margin-top: 2px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.r-meta { display: flex; flex-wrap: wrap; gap: 4px 12px; margin-top: 4px; font-size: 11.5px; color: #6e6e73; }
.r-meta span { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.issues { margin-top: 4px; font-size: 12px; color: #c4170c; }
.notes { margin-top: 4px; font-size: 12px; color: #9a5300; }
.empty { color: #6e6e73; text-align: center; padding: 18px 0 8px; margin: 0; }
.foot { display: flex; align-items: center; gap: 12px; padding: 12px 14px; background: #fff; border-top: 1px solid rgba(0,0,0,.08); }
.foot.col { flex-direction: column; align-items: stretch; gap: 8px; }
.prog { flex: 1; }
.prog-txt { font-size: 12.5px; margin-bottom: 6px; font-variant-numeric: tabular-nums; }
.bar { height: 6px; background: #f0f0f2; border-radius: 3px; overflow: hidden; }
.bar i { display: block; height: 100%; background: #0a84ff; transition: width .2s; }
.sum { margin: 0; font-size: 12.5px; padding: 8px 10px; border-radius: 8px; }
.sum.good { background: #e3f6e8; color: #1b7a34; }
.sum.bad { background: #fff0f0; color: #a1000b; }
.confirm { margin: 0; }
.modal { position: absolute; inset: 0; background: rgba(0,0,0,.3); display: grid; place-items: center; padding: 16px; }
.modal-box { background: #fff; border-radius: 12px; width: 100%; max-height: calc(100vh - 32px); display: flex; flex-direction: column; gap: 10px; padding: 14px; box-shadow: 0 10px 40px rgba(0,0,0,.25); }
.modal pre { margin: 0; flex: 1; min-height: 0; overflow: auto; background: #f5f5f7; border-radius: 8px; padding: 10px; font: 11.5px/1.5 ui-monospace, SFMono-Regular, Consolas, monospace; white-space: pre-wrap; word-break: break-word; }
@media (max-width: 560px) { .grid2 { grid-template-columns: 1fr; } }
`;
  }
})();
