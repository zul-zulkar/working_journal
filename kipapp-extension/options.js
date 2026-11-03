// Pengaturan: URL Jurnal Kinerja + izin host untuk origin tersebut.
const $ = (id) => document.getElementById(id);

function show(kind, text) {
  const el = $("status");
  el.className = kind;
  el.textContent = text;
}

function parseOrigin(raw) {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "https:" && !/^(localhost|127\.0\.0\.1)$/.test(u.hostname)) return null;
    return u.origin;
  } catch (_) {
    return null;
  }
}

async function test() {
  show("info", "Menguji koneksi…");
  $("login").hidden = true;
  const r = await chrome.runtime.sendMessage({ type: "jurnal:data" });
  if (r && r.ok) {
    show("ok", "Terhubung · " + r.data.activities.length + " kegiatan, " + r.data.categories.length + " rencana kinerja.");
  } else if (r && r.code === "auth") {
    show("bad", "URL benar, tapi belum masuk ke Jurnal di Chrome ini. Klik “Masuk ke Jurnal”, login, lalu uji lagi.");
    $("login").hidden = false;
  } else {
    show("bad", (r && r.error) || "Gagal menghubungi Jurnal.");
  }
}

$("save").addEventListener("click", async () => {
  const origin = parseOrigin($("url").value);
  if (!origin) return show("bad", "URL tidak valid. Gunakan https://… (atau http://localhost untuk pengembangan).");
  // Harus di dalam handler klik — Chrome hanya mengizinkan permintaan izin dari gestur pengguna.
  const granted = await chrome.permissions.request({ origins: [origin + "/*"] });
  if (!granted) return show("bad", "Izin akses ke " + origin + " ditolak — ekstensi tidak bisa membaca data Jurnal.");
  await chrome.storage.sync.set({ jurnalUrl: origin });
  $("url").value = origin;
  await test();
});

$("login").addEventListener("click", () => chrome.runtime.sendMessage({ type: "openJurnal" }));

$("reset").addEventListener("click", async () => {
  await chrome.storage.local.remove("jk_picks");
  $("reset").textContent = "Pemetaan dihapus ✓";
});

chrome.storage.sync.get("jurnalUrl").then(({ jurnalUrl }) => {
  if (jurnalUrl) {
    $("url").value = jurnalUrl;
    test();
  }
});
