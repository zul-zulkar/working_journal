# Jurnal Kinerja — project brief

Aplikasi jurnaling kegiatan kerja sebagai bukti dukung laporan SKP. Single-user.

## Tech stack
Next.js 14+ (App Router), TypeScript, Tailwind CSS. Data via Google Sheets
(googleapis, service account). Gambar via Vercel Blob (CDN publik); Google Drive
hanya fallback legacy untuk data lama. Deploy: Vercel.

## Aturan arsitektur — jangan dilanggar
- Kredensial (service account, token Blob) CUMA di server (env var), tidak pernah ke client.
- Client fetch lewat API routes internal (/api/*) — tidak pernah panggil Google API langsung.
- /share/[token] harus bisa diakses publik tanpa login.

## Desain
Referensi visual ada di /prototype (hasil Claude Design). Pertahankan warna,
spacing, komponen yang sudah ada — jangan redesign dari nol kecuali diminta.

## Skema data
Lihat panduan-prompt-claude-code.md bagian "Skema data" di root project.