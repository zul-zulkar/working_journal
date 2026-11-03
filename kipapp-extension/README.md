# Jurnal → KipApp (ekstensi Chrome)

Bot untuk menginput otomatis kegiatan dari **Jurnal Kinerja** ke
**KipApp → Pelaksanaan Kinerja → Pelaksanaan** (`kipapp.bps.go.id/#/pelaksanaan-aksi`).

Panel muncul langsung di halaman KipApp (tombol **Jurnal → KipApp** di pojok
kanan bawah). Alurnya: pilih tahun & **periode SKP**, cek pemasangan Rencana Kinerja,
tinjau daftar kegiatan, lalu kirim.

## Kenapa ekstensi (bukan GUI desktop / web)

- KipApp memakai token sesi (`X-Auth`) yang hanya ada di tab KipApp yang sudah
  login. Ekstensi berjalan di tab itu dan memakai token yang sama, jadi tidak perlu
  menyimpan kata sandi SSO BPS di mana pun.
- Web Jurnal (Vercel) tidak bisa memanggil API KipApp langsung (CORS + tidak punya
  token). Server harus memegang kredensial KipApp, dan itu melanggar aturan
  arsitektur proyek.
- GUI desktop (Python/Selenium) perlu login ulang SSO dan instalasi tambahan, dan
  mudah rusak bila tampilan KipApp berubah.

## Pasang

1. Buka `chrome://extensions`, nyalakan **Developer mode** (kanan atas).
2. Klik **Load unpacked** dan pilih folder `kipapp-extension/` ini.
3. Halaman **Pengaturan** ekstensi terbuka lewat *Details → Extension options*
   (atau klik **Atur URL Jurnal** dari panel). Isi URL Jurnal Kinerja, misalnya
   `https://jurnal-kamu.vercel.app`, lalu klik **Simpan & uji koneksi** dan
   izinkan akses ke domain tersebut.
4. Pastikan sudah login di Jurnal Kinerja pada Chrome yang sama.
5. Buka/muat ulang (F5) tab KipApp **Pelaksanaan Kinerja → Pelaksanaan**.

Setelah mengubah file di folder ini, klik ikon ↻ ekstensi di `chrome://extensions`,
lalu muat ulang tab KipApp.

## Pemetaan data

| Jurnal Kinerja | KipApp (`POST /api/v1/kegiatan`) |
|---|---|
| Rencana Kinerja (kategori) | `rkid`. Dipasangkan otomatis dari kemiripan nama; pilihan manual diingat antar periode |
| `startDate` | `tanggal` |
| `endDate` (bila lebih dari 1 hari) | `tanggalselesai`, dipotong di akhir periode SKP |
| `startTime` / `endTime` (bila keduanya terisi) | `jammulai` / `jamselesai` |
| `title` | `kegiatan` (minimal 10 karakter, aturan KipApp) |
| `capaian` | `capaian` (wajib) |
| bukti | `datadukung`, lihat opsi di bawah |
| — | `progres` = 100, `iscapaianskp` sesuai centang "Masukkan ke capaian SKP" |

Yang diambil hanya kegiatan dengan tanggal mulai di dalam periode SKP terpilih.

**Data dukung** (pilih di panel):

- *Otomatis* (bawaan): kegiatan dengan tepat 1 bukti memakai link bukti itu.
  Kegiatan tanpa bukti atau dengan banyak bukti memakai **link laporan Jurnal**
  (`/share/<token>` untuk tanggal kegiatan, publik dan read-only).
- *Selalu link laporan Jurnal*, *Link bukti pertama saja*, *Satu link tetap*
  (misalnya `s.bps.go.id/...` per triwulan), atau *Kosongkan*.

## Pengaman

- **Tidak menggandakan kegiatan:** sebelum mengirim, daftar kegiatan KipApp untuk
  SKP itu dimuat ulang. Kegiatan dengan tanggal dan teks yang sama ditandai
  *sudah ada* dan dilewati.
- Kegiatan yang tidak lolos validasi (RK belum dipasangkan, kegiatan < 10
  karakter, capaian kosong, duplikat di Jurnal) masuk tab **Perlu perbaikan** dan
  tidak ikut terkirim. Perbaiki di Jurnal, lalu klik **Muat ulang**.
- **Simulasi** menampilkan JSON yang akan dikirim tanpa mengirim apa pun.
- Pengiriman berjalan satu per satu (jeda ±0,35 detik) dan bisa **Hentikan**
  kapan saja. Bila sesi KipApp habis (401), pengiriman berhenti.
- Token KipApp tidak pernah keluar dari tab KipApp (`bridge.js`). Bridge hanya
  mengizinkan endpoint `GET /tahun`, `GET /skp`, `GET /skp/rk`, `GET /kegiatan`,
  dan `POST /kegiatan`.
- Bot hanya **menambah** kegiatan. Mengirim kegiatan untuk dinilai, mengedit, atau
  menghapus tetap dilakukan manual di KipApp.

## Berkas

```
manifest.json   MV3: content script di kipapp.bps.go.id, izin host Jurnal opsional
bridge.js       MAIN world: tangkap X-Auth & pegawaiid, jalankan panggilan API yang diizinkan
core.js         logika murni: pemasangan RK, validasi, payload (bisa diuji dengan Node)
panel.js        UI panel (Shadow DOM) + alur kirim
background.js   ambil /api/data & buat link /api/share dari Jurnal (pakai cookie login Jurnal)
options.html/js pengaturan URL Jurnal + izin host
icons/          ikon ekstensi
```

## Kalau ada masalah

- **"Sesi KipApp belum terbaca"**: muat ulang tab KipApp (F5). Token dibaca saat
  KipApp memanggil API-nya sendiri ketika halaman dimuat.
- **"ID pegawai belum terbaca"**: buka menu *Pelaksanaan Kinerja → Pelaksanaan*,
  lalu klik **Coba lagi**.
- **"Belum masuk ke Jurnal Kinerja"**: klik **Masuk ke Jurnal**, login, biarkan tab
  Jurnal terbuka, lalu klik **Coba lagi**. Bila Chrome tidak mengirim cookie Jurnal
  dari ekstensi, data diambil lewat tab Jurnal yang terbuka itu.
- KipApp menolak satu kegiatan: pesan dari server tampil di baris kegiatan tersebut
  (tab **Baru**). Kegiatan lain tetap dikirim.
