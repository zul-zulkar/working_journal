// ── Jurnal → KipApp · bridge (MAIN world, document_start) ────────────────────
// Berjalan di konteks JavaScript KipApp sendiri supaya bisa melihat token sesi
// yang dipasang aplikasi di setiap panggilan API (header X-Auth). Token tidak
// pernah keluar dari halaman ini: panel (isolated world) hanya meminta bridge
// menjalankan panggilan API yang ada di daftar izin, lalu menerima hasil JSON.
(() => {
  if (window.__jkBridge) return;
  window.__jkBridge = true;

  let token = null;
  let pegawaiId = null;

  function notePegawai(url) {
    try {
      const id = new URL(url, location.href).searchParams.get("pegawaiid");
      if (id) pegawaiId = id;
    } catch (_) {}
  }

  // KipApp memakai axios (XHR). Tangkap header X-Auth & pegawaiid dari URL.
  const XHR = XMLHttpRequest.prototype;
  const origOpen = XHR.open;
  const origSetHeader = XHR.setRequestHeader;
  XHR.open = function (method, url) {
    notePegawai(url);
    return origOpen.apply(this, arguments);
  };
  XHR.setRequestHeader = function (name, value) {
    if (value && String(name).toLowerCase() === "x-auth") token = value;
    return origSetHeader.apply(this, arguments);
  };
  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    try {
      notePegawai(typeof input === "string" ? input : input && input.url);
      const h = new Headers((init && init.headers) || (input instanceof Request ? input.headers : undefined));
      const t = h.get("x-auth");
      if (t) token = t;
    } catch (_) {}
    return origFetch.apply(this, arguments);
  };

  // Cadangan: halaman Pelaksanaan menyimpan pegawai terpilih di komponen Vue-nya.
  function pegawaiFromVue() {
    try {
      let el = null;
      for (const e of document.querySelectorAll("body *")) {
        if (e.__vue__) {
          el = e;
          break;
        }
      }
      if (!el) return null;
      const stack = [el.__vue__.$root];
      while (stack.length) {
        const v = stack.pop();
        if (v.pegawai && v.pegawai.key) return String(v.pegawai.key);
        stack.push(...(v.$children || []));
      }
    } catch (_) {}
    return null;
  }

  function tokenExp() {
    try {
      const p = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      return typeof p.exp === "number" ? p.exp : null;
    } catch (_) {
      return null;
    }
  }

  // Hanya endpoint ini yang boleh dipanggil panel.
  const ALLOWED = [
    ["GET", /^\/tahun\?/],
    ["GET", /^\/skp\?/],
    ["GET", /^\/skp\/rk\?/],
    ["GET", /^\/kegiatan\?/],
    ["POST", /^\/kegiatan$/],
  ];

  document.addEventListener("jk:req", async (ev) => {
    let req;
    try {
      req = JSON.parse(ev.detail);
    } catch (_) {
      return;
    }
    const reply = (res) =>
      document.dispatchEvent(new CustomEvent("jk:res", { detail: JSON.stringify(Object.assign({ id: req.id }, res)) }));

    if (req.op === "status") {
      const exp = token ? tokenExp() : null;
      reply({
        ok: true,
        data: {
          hasToken: !!token,
          expired: !!(exp && exp * 1000 < Date.now()),
          pegawaiId: pegawaiId || pegawaiFromVue(),
        },
      });
      return;
    }
    if (req.op !== "api") return;

    const method = String(req.method || "GET").toUpperCase();
    const path = String(req.path || "");
    if (!ALLOWED.some(([m, re]) => m === method && re.test(path))) {
      reply({ ok: false, status: 0, error: "Endpoint tidak diizinkan: " + method + " " + path });
      return;
    }
    if (!token) {
      reply({ ok: false, status: 401, error: "Sesi KipApp belum terbaca — muat ulang halaman KipApp (F5)." });
      return;
    }
    try {
      const headers = { "X-Auth": token, Accept: "application/json" };
      if (method === "POST") headers["Content-Type"] = "application/json";
      const r = await origFetch(location.origin + "/api/v1" + path, {
        method,
        headers,
        body: method === "POST" ? JSON.stringify(req.body || {}) : undefined,
      });
      const text = await r.text();
      let data = text;
      try {
        data = JSON.parse(text);
      } catch (_) {}
      const msg = data && typeof data === "object" ? data.error || data.message : null;
      reply({
        ok: r.ok,
        status: r.status,
        data,
        error: r.ok ? null : r.status === 401 ? "Sesi KipApp habis — muat ulang halaman KipApp lalu login lagi." : msg || "HTTP " + r.status,
      });
    } catch (e) {
      reply({ ok: false, status: 0, error: String((e && e.message) || e) });
    }
  });
})();
