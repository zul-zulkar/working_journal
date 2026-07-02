import "server-only";
import { put } from "@vercel/blob";
import { uploadImage as uploadToDrive } from "./drive";

// ── Evidence image storage ───────────────────────────────────────────────────
// Primary backend: Vercel Blob (BLOB_READ_WRITE_TOKEN). Uploads get a public
// CDN URL stored directly in the evidence JSON — no proxy route, no Google
// OAuth dance. If the token is absent, uploads fall back to the legacy Google
// Drive path (lib/drive.ts) and return a fileId served via /api/image/[id].

export type StoredImage = {
  name: string;
  /** Public CDN URL (Vercel Blob). */
  url?: string;
  /** Legacy Google Drive file id (fallback backend). */
  fileId?: string;
};

function blobConfigured(): boolean {
  const t = process.env.BLOB_READ_WRITE_TOKEN;
  return !!(t && t.trim());
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
