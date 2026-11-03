// ── Jurnal → KipApp · service worker ─────────────────────────────────────────
// Mengambil data dari aplikasi Jurnal Kinerja (lintas-origin, dengan cookie
// login Jurnal yang sudah ada di Chrome) atas permintaan panel di KipApp.
// Content script tidak bisa fetch lintas-origin di MV3, jadi lewat sini.

const KIPAPP_URL = "https://kipapp.bps.go.id/#/pelaksanaan-aksi";

async function jurnalOrigin() {
  const { jurnalUrl } = await chrome.storage.sync.get("jurnalUrl");
  if (!jurnalUrl) return null;
  try {
    return new URL(jurnalUrl).origin;
  } catch (_) {
    return null;
  }
}

function fail(code, error) {
  return { ok: false, code, error };
}

// Cadangan bila cookie Jurnal tidak ikut terkirim dari service worker: jalankan
// fetch di dalam tab Jurnal yang sedang terbuka (same-origin, cookie pasti ikut).
async function fetchViaTab(origin, path, init) {
  const tabs = await chrome.tabs.query({ url: origin + "/*" });
  if (!tabs.length) return null;
  const [res] = await chrome.scripting.executeScript({
    target: { tabId: tabs[0].id },
    func: async (p, i) => {
      const r = await fetch(p, Object.assign({ cache: "no-store" }, i));
      return { status: r.status, text: await r.text() };
    },
    args: [path, init || {}],
  });
  return res && res.result;
}

async function jurnalFetch(path, init) {
  const origin = await jurnalOrigin();
  if (!origin) return fail("nourl", "URL Jurnal Kinerja belum diatur.");
  if (!(await chrome.permissions.contains({ origins: [origin + "/*"] }))) {
    return fail("perm", "Izin akses ke " + origin + " belum diberikan.");
  }
  let status;
  let text;
  try {
    const r = await fetch(origin + path, Object.assign({ credentials: "include", cache: "no-store" }, init));
    status = r.status;
    text = await r.text();
  } catch (e) {
    return fail("network", "Tidak bisa menghubungi " + origin + " (" + ((e && e.message) || e) + ").");
  }
  if (status === 401) {
    try {
      const viaTab = await fetchViaTab(origin, path, init);
      if (viaTab) ({ status, text } = viaTab);
    } catch (_) {}
  }
  let data = null;
  try {
    data = JSON.parse(text);
  } catch (_) {}
  if (status === 401) return fail("auth", "Belum masuk ke Jurnal Kinerja.");
  if (status < 200 || status >= 300) return fail("http", (data && data.error) || "Jurnal menjawab HTTP " + status + ".");
  if (!data) return fail("http", "Jawaban Jurnal bukan JSON — periksa URL Jurnal.");
  return { ok: true, data, origin };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    switch (msg && msg.type) {
      case "jurnal:data": {
        const r = await jurnalFetch("/api/data");
        if (r.ok && !Array.isArray(r.data.activities)) return fail("http", "Format data Jurnal tidak dikenal.");
        return r.ok
          ? { ok: true, origin: r.origin, data: { activities: r.data.activities, categories: r.data.categories || [], groups: r.data.groups || [] } }
          : r;
      }
      case "jurnal:share": {
        const body = {
          title: String(msg.title || "Bukti Dukung Kegiatan").slice(0, 200),
          from: msg.from,
          to: msg.to,
          stats: false,
          timeline: true,
          grid: true,
          report: true,
          hourly: false,
          table: true,
        };
        const r = await jurnalFetch("/api/share", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        return r.ok && r.data.token ? { ok: true, url: r.origin + "/share/" + r.data.token } : r.ok ? fail("http", "Token Bagikan kosong.") : r;
      }
      case "openOptions":
        await chrome.runtime.openOptionsPage();
        return { ok: true };
      case "openJurnal": {
        const origin = await jurnalOrigin();
        if (origin) await chrome.tabs.create({ url: origin + "/login" });
        return { ok: !!origin };
      }
      default:
        return fail("unknown", "Pesan tidak dikenal.");
    }
  })().then(sendResponse, (e) => sendResponse(fail("error", String((e && e.message) || e))));
  return true;
});

// Klik ikon ekstensi: di KipApp → buka/tutup panel; di tempat lain → buka KipApp.
chrome.action.onClicked.addListener(async (tab) => {
  if (tab.url && tab.url.startsWith("https://kipapp.bps.go.id/")) {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: "toggle" });
      return;
    } catch (_) {
      // Tab dibuka sebelum ekstensi dipasang → content script belum ada.
      await chrome.tabs.reload(tab.id);
      return;
    }
  }
  await chrome.tabs.create({ url: KIPAPP_URL });
});
