import "server-only";
import {
  put,
  BlobError,
  BlobAccessError,
  BlobStoreNotFoundError,
  BlobStoreSuspendedError,
  BlobServiceNotAvailable,
  BlobServiceRateLimited,
} from "@vercel/blob";
import { uploadImage as uploadToDrive } from "./drive";
import { ConfigError } from "./google";

// ── Evidence image storage ───────────────────────────────────────────────────
// Primary backend: Vercel Blob. Uploads get a public CDN URL stored directly in
// the evidence JSON — no proxy route, no Google OAuth dance. If Blob isn't
// configured at all, uploads fall back to the legacy Google Drive path
// (lib/drive.ts) and return a fileId served via /api/image/[id].
//
// Blob credentials — the SDK resolves them itself, we only decide "Blob or not":
//  • BLOB_STORE_ID (+ VERCEL_OIDC_TOKEN): what Vercel now adds when a store is
//    connected to a project. On Vercel the OIDC token is injected and rotated
//    automatically; locally `vercel env pull` fetches it and the SDK refreshes
//    it with the Vercel CLI login.
//  • BLOB_READ_WRITE_TOKEN: the older long-lived static token. Still honoured.
// Checking only BLOB_READ_WRITE_TOKEN made OIDC-connected projects silently fall
// through to Drive, so either variable counts as "Blob configured".

export type StoredImage = {
  name: string;
  /** Public CDN URL (Vercel Blob). */
  url?: string;
  /** Legacy Google Drive file id (fallback backend). */
  fileId?: string;
};

function hasEnv(name: string): boolean {
  const v = process.env[name];
  return !!(v && v.trim());
}

function blobConfigured(): boolean {
  return hasEnv("BLOB_STORE_ID") || hasEnv("BLOB_READ_WRITE_TOKEN");
}

export async function storeImage(
  buffer: Buffer,
  mimeType: string,
  name: string,
): Promise<StoredImage> {
  const safeName = name || "evidence.jpg";
  if (blobConfigured()) {
    const blob = await put(`evidence/${safeName}`, buffer, {
      access: "public",
      contentType: mimeType || "image/jpeg",
      // Random suffix keeps repeated names (clipboard.jpg) from colliding.
      addRandomSuffix: true,
    });
    return { url: blob.url, name: safeName };
  }
  return uploadToDrive(buffer, mimeType, safeName);
}

// ── Upload failure → actionable message ──────────────────────────────────────
// The upload route used to answer every failure with "Gagal mengunggah gambar.",
// which hid the usual cause: no Blob token, so the request fell through to the
// legacy Drive path whose OAuth refresh token had expired. The app is
// single-user and /api/upload sits behind the owner session, so naming env vars
// here is fine — values never appear.

export type UploadFailure = {
  message: string;
  status: number;
  /** "config": fixable by the owner (env/store setup); "upstream": try again. */
  code: "config" | "upstream" | "unknown";
};

/** Where to fix missing/bad Blob credentials, depending on where we run. */
function blobFixHint(): string {
  return process.env.VERCEL
    ? "Hubungkan Blob store ke project di dashboard Vercel (store → tab Projects → Connect), lalu Redeploy."
    : "Jalankan `vercel env pull` di folder proyek (lihat README), lalu restart npm run dev.";
}

function driveErrorKind(err: unknown): "expired" | "quota" | "folder" | null {
  if (!err || typeof err !== "object") return null;
  const e = err as { message?: unknown; response?: { data?: unknown } };
  const data = e.response?.data as { error?: unknown } | undefined;
  const msg = typeof e.message === "string" ? e.message : "";
  if (data?.error === "invalid_grant" || /invalid_grant/.test(msg)) return "expired";
  if (/storage quota/i.test(msg)) return "quota";
  if (/File not found/i.test(msg)) return "folder";
  return null;
}

export function explainUploadError(err: unknown): UploadFailure {
  if (blobConfigured()) {
    // BLOB_STORE_ID present but neither an OIDC token nor a static token could
    // be found — typical locally before `vercel env pull` / `vercel link`.
    if (err instanceof BlobError && /No blob credentials|No read-write token/i.test(err.message)) {
      return {
        status: 503,
        code: "config",
        message: `BLOB_STORE_ID sudah ada, tapi token login Vercel (OIDC) tidak ditemukan. ${blobFixHint()}`,
      };
    }
    if (err instanceof BlobAccessError) {
      return {
        status: 503,
        code: "config",
        message: `Vercel Blob menolak kredensial aplikasi — store mungkin sudah tidak terhubung ke project ini. ${blobFixHint()}`,
      };
    }
    if (err instanceof BlobStoreNotFoundError) {
      return {
        status: 503,
        code: "config",
        message: `Blob store tidak ditemukan (mungkin sudah dihapus). ${blobFixHint()}`,
      };
    }
    if (err instanceof BlobStoreSuspendedError) {
      return {
        status: 503,
        code: "config",
        message: "Blob store ditangguhkan oleh Vercel — cek kuota/penggunaan di dashboard Vercel.",
      };
    }
    if (err instanceof BlobServiceNotAvailable || err instanceof BlobServiceRateLimited) {
      return {
        status: 503,
        code: "upstream",
        message: "Layanan Vercel Blob sedang sibuk atau tidak tersedia. Coba lagi sebentar.",
      };
    }
    if (err instanceof BlobError) {
      // Messages come from Vercel and start with "Vercel Blob: …".
      return { status: 502, code: "upstream", message: `Upload ditolak — ${err.message}` };
    }
    return { status: 500, code: "unknown", message: "Gagal mengunggah gambar ke Vercel Blob. Coba lagi." };
  }

  // No Blob config at all → the request went to the legacy Google Drive fallback.
  const lead = "Penyimpanan gambar belum diatur (BLOB_STORE_ID kosong), dan";
  const config = (why: string): UploadFailure => ({
    status: 503,
    code: "config",
    message: `${lead} ${why} ${blobFixHint()}`,
  });
  if (err instanceof ConfigError) return config("Google Drive cadangan juga belum dikonfigurasi.");
  switch (driveErrorKind(err)) {
    case "expired":
      return config("token Google Drive cadangan sudah kedaluwarsa.");
    case "quota":
      return config("Google Drive cadangan menolak: service account tidak punya kuota.");
    case "folder":
      return config("Google Drive cadangan menolak: folder GOOGLE_DRIVE_FOLDER_ID tidak ditemukan/tidak dibagikan.");
  }
  return {
    status: 502,
    code: "upstream",
    message: `${lead} Google Drive cadangan gagal menerima berkas. ${blobFixHint()}`,
  };
}
