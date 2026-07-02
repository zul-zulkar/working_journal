# Jurnal Kegiatan — Bukti Dukung SKP

Aplikasi jurnaling kegiatan kerja sebagai bukti dukung laporan SKP. Single-user.
Diimplementasikan dari prototipe Claude Design (`prototype/`) sesuai brief di
[CLAUDE.md](CLAUDE.md).

## Tech stack

- **Next.js 14** (App Router) + **TypeScript** + **Tailwind CSS**
- **Google Sheets** untuk data (activities + categories) — via `googleapis`, service account
- **Google Drive** untuk gambar bukti dukung
- Deploy: **Vercel**

## Arsitektur (aturan yang dipertahankan)

- Kredensial service account **hanya di server** (env var) — tidak pernah dikirim ke client.
- Client hanya memanggil API route internal (`/api/*`) — tidak pernah memanggil Google API langsung.
- `/share/[token]` dapat diakses publik tanpa login (laporan read-only, membaca data live dari Sheets).

### Peta kode

```
app/
  page.tsx                  Aplikasi utama (client) → memanggil /api/*
  share/[token]/page.tsx    Laporan publik read-only (server component)
  api/
    data/route.ts           GET (baca semua) · PUT (simpan seluruh dokumen)
    upload/route.ts         POST multipart → unggah gambar ke Drive
    image/[id]/route.ts     GET → proxy stream gambar dari Drive (publik)
components/
  JurnalApp.tsx             UI utama: list / grid / kalender, editor, kelola kategori, share
  ReportView.tsx            Render laporan (dipakai preview in-app & /share)
  ShareReport.tsx           Pembungkus tema untuk halaman /share publik
  Lightbox.tsx              Penampil gambar
lib/
  google.ts                 Auth service account (server-only, lazy)
  sheets.ts                 Baca/tulis Google Sheets (+ seed data awal)
  drive.ts                  Unggah & stream gambar Google Drive
  report.ts                 buildReport() + codec token share
  enrich.ts / format.ts     View-model & util tanggal (aman di server + client)
```

### Skema data (Google Sheets)

Satu spreadsheet, dua tab (dibuat otomatis pada run pertama):

- **Categories** — `id | name | color`
- **Activities** — `id | categoryId | startDate | endDate | startTime | endTime | title | capaian | evidence`
  - `evidence` disimpan sebagai JSON di satu sel. Gambar hanya menyimpan `fileId`
    Drive (binernya ada di Drive), link menyimpan `url`.

Pada run pertama dengan sheet kosong, aplikasi mengisi contoh data (lihat `lib/seed.ts`).

## Setup

### 1. Google Cloud

1. Buat project di [Google Cloud Console](https://console.cloud.google.com/), aktifkan
   **Google Sheets API** dan **Google Drive API**.
2. Buat **Service Account**, lalu buat **key** JSON.
3. Buat **Spreadsheet** baru → **Share** ke email service account (Editor). Catat `SHEET_ID`.
4. Buat **folder Drive** untuk gambar → **Share** ke email service account (Editor). Catat `FOLDER_ID`.

### 2. Environment

```bash
cp .env.local.example .env.local
# isi GOOGLE_SHEET_ID, GOOGLE_DRIVE_FOLDER_ID, dan kredensial service account
```

### 3. Jalankan

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

Set environment variable yang sama di dashboard Vercel. Untuk
`GOOGLE_SERVICE_ACCOUNT_JSON`, gunakan bentuk **base64** agar aman dari masalah
newline: `base64 -w0 service-account.json`.

## Catatan

- Tema (terang/gelap), view aktif, dan urutan disimpan di `localStorage` (preferensi
  UI); data kegiatan & kategori disimpan di Google Sheets.
- Gambar dikompresi di sisi client (maks. 1280 px, JPEG) sebelum diunggah.
- Prototipe asli ada di `prototype/` sebagai referensi visual — jangan diubah.
