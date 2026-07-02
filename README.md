# Jurnal Kegiatan — Bukti Dukung SKP

Aplikasi jurnaling kegiatan kerja sebagai bukti dukung laporan SKP. Single-user.
Diimplementasikan dari prototipe Claude Design (`prototype/`) sesuai brief di
[CLAUDE.md](CLAUDE.md).

## Tech stack

- **Next.js 14** (App Router) + **TypeScript** + **Tailwind CSS**
- **Google Sheets** untuk data (activities + categories) — via `googleapis`, service account
- **Vercel Blob** untuk gambar bukti dukung (CDN publik; Google Drive tetap
  didukung sebagai fallback legacy)
- Deploy: **Vercel**

## Arsitektur (aturan yang dipertahankan)

- Semua kredensial (service account, token Blob) **hanya di server** (env var) —
  tidak pernah dikirim ke client.
- Client hanya memanggil API route internal (`/api/*`) — tidak pernah memanggil
  Google API langsung.
- `/share/[token]` dapat diakses publik tanpa login (laporan read-only, membaca
  data live dari Sheets; gambar dilayani langsung dari CDN Blob).

### Peta kode

```
app/
  page.tsx                  Aplikasi utama (client) → memanggil /api/*
  share/[token]/page.tsx    Laporan publik read-only (server component)
  api/
    data/route.ts           GET (baca semua) · PUT (simpan seluruh dokumen)
    upload/route.ts         POST multipart → simpan gambar (Blob / Drive fallback)
    image/[id]/route.ts     GET → proxy stream gambar Drive legacy (publik)
    export/route.ts         GET → unduh seluruh data sebagai Excel (.xlsx)
    template/route.ts       GET → unduh template Excel kosong (+ contoh & petunjuk)
    import/route.ts         POST → impor .xlsx, gabung ke data, simpan ke Sheets
components/
  JurnalApp.tsx             UI utama: list / grid / kalender, editor, kelola kategori, share
  ReportView.tsx            Render laporan (dipakai preview in-app & /share)
  ShareReport.tsx           Pembungkus tema untuk halaman /share publik
  Lightbox.tsx              Penampil gambar
lib/
  google.ts                 Auth service account + OAuth Drive (server-only, lazy)
  sheets.ts                 Baca/tulis Google Sheets (+ seed data awal)
  storage.ts                Simpan gambar: Vercel Blob, fallback Google Drive
  drive.ts                  Unggah & stream gambar Google Drive (legacy)
  excel.ts                  Ekspor/impor Excel (.xlsx) + template (server-only)
  report.ts                 buildReport() + codec token share
  enrich.ts / format.ts     View-model & util tanggal (aman di server + client)
```

### Skema data (Google Sheets)

Satu spreadsheet, dua tab (dibuat otomatis pada run pertama):

- **Categories** — `id | name | color`
- **Activities** — `id | categoryId | startDate | endDate | startTime | endTime | title | capaian | evidence`
  - `evidence` disimpan sebagai JSON di satu sel. Gambar baru menyimpan `url`
    (CDN Vercel Blob); gambar lama menyimpan `fileId` Drive dan tetap dirender
    lewat `/api/image/[fileId]`. Link menyimpan `url`.

Pada run pertama dengan sheet kosong, aplikasi mengisi contoh data (lihat `lib/seed.ts`).

## Setup

### 1. Google Cloud (untuk Sheets saja)

1. Buat project di [Google Cloud Console](https://console.cloud.google.com/),
   aktifkan **Google Sheets API**.
2. Buat **Service Account**, lalu buat **key** JSON.
3. Buat **Spreadsheet** baru → **Share** ke email service account (Editor).
   Catat `SHEET_ID`.

### 2. Vercel Blob (untuk gambar)

1. Buat project di [Vercel](https://vercel.com) (bisa sebelum deploy —
   `vercel link` dari folder project).
2. Di dashboard project → **Storage** → **Create Database** → **Blob** →
   hubungkan ke project.
3. Untuk dev lokal, salin `BLOB_READ_WRITE_TOKEN` dari halaman store tersebut
   (atau jalankan `vercel env pull .env.local`). Di Vercel sendiri token
   terpasang otomatis saat store terhubung.

### 3. Environment

```bash
cp .env.local.example .env.local
# isi GOOGLE_SHEET_ID, kredensial service account, dan BLOB_READ_WRITE_TOKEN
```

### 4. Jalankan

```bash
npm install
npm run dev        # http://localhost:3000
```

Perintah lain:

```bash
npm run build      # build produksi
npm run typecheck  # cek TypeScript
npm run lint       # ESLint
```

## Deploy ke Vercel

1. Push repo ke GitHub, lalu **Import** di Vercel (framework terdeteksi
   otomatis sebagai Next.js — tanpa konfigurasi tambahan).
2. Hubungkan **Blob store** ke project (Storage → Blob) —
   `BLOB_READ_WRITE_TOKEN` terpasang otomatis.
3. Set env var: `GOOGLE_SHEET_ID` dan `GOOGLE_SERVICE_ACCOUNT_JSON` (gunakan
   bentuk **base64** agar aman dari masalah newline: `base64 -w0 service-account.json`).
4. Deploy. Plan **Hobby** (gratis) cukup: aplikasi single-user, API route
   berjalan sebagai serverless function, gambar dilayani dari CDN Blob.

## Lampiran: fallback Google Drive (legacy)

Jika `BLOB_READ_WRITE_TOKEN` kosong, upload gambar jatuh ke Google Drive.
Service account **tidak punya kuota penyimpanan**, jadi jalur ini butuh OAuth
sebagai akun Google kamu sendiri:

1. Aktifkan **Google Drive API**, buat **OAuth Client ID** (tipe **Web
   application**), tambahkan `http://localhost:53682` sebagai redirect URI.
2. Isi `GOOGLE_DRIVE_FOLDER_ID`, `GOOGLE_OAUTH_CLIENT_ID`,
   `GOOGLE_OAUTH_CLIENT_SECRET` di `.env.local`, lalu jalankan
   `npm run get-drive-token` dan tempel refresh token yang tercetak.

Catatan: refresh token dari OAuth consent screen berstatus **Testing**
kedaluwarsa tiap 7 hari — publish ke Production bila ingin dipakai jangka
panjang. Gambar lama yang masih menyimpan `fileId` Drive tetap tampil lewat
proxy `/api/image/[fileId]` selama kredensial di atas tersedia.

## Ekspor / impor Excel

Dari sidebar (kiri bawah, atau menu hamburger di mobile):

- **Export Excel (.xlsx)** — unduh seluruh data (sheet `Kegiatan` + `Rencana
  Kinerja`). Bisa diedit di Excel/Google Sheets lalu diimpor kembali.
- **Unduh Template Excel** — file kosong berisi sheet `Petunjuk`, contoh baris,
  dan dropdown pemilihan rencana kinerja. Cocok untuk input massal.
- **Import Excel (.xlsx)** — impor bersifat **menggabungkan**: baris dengan `ID`
  yang cocok memperbarui kegiatan lama, baris tanpa `ID` ditambahkan sebagai
  kegiatan baru, dan kegiatan yang tidak ada di file **tidak dihapus**. Nama
  rencana kinerja baru otomatis dibuat.

Gambar bukti dukung dikelola langsung di aplikasi (tempel/upload), bukan lewat
Excel; kolom gambar pada file ekspor hanya untuk round-trip dan diisi otomatis.

## Catatan

- Tema (terang/gelap), view aktif, dan urutan disimpan di `localStorage` (preferensi
  UI); data kegiatan & kategori disimpan di Google Sheets.
- Gambar dikompresi di sisi client (maks. 1280 px, JPEG) sebelum diunggah;
  tempel langsung dari clipboard dengan Ctrl / ⌘ + V saat editor terbuka.
- Pemilihan rencana kinerja di editor menggunakan searchable select (ketik untuk
  mencari); tampilan gambar (lightbox) bisa ditutup dengan mengetuk area di luar
  gambar — praktis di mobile.
- Prototipe asli ada di `prototype/` sebagai referensi visual — jangan diubah.
