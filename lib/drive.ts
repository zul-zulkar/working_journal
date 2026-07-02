import "server-only";
import { Readable } from "node:stream";
import { driveClient } from "./google";

// ── Google Drive access ──────────────────────────────────────────────────────
// Evidence images are stored in a Drive folder shared with the service account.
// Set GOOGLE_DRIVE_FOLDER_ID to that folder (recommended so files land in the
// user's Drive rather than the service account's own quota-limited storage).

function folderId(): string | undefined {
  const v = process.env.GOOGLE_DRIVE_FOLDER_ID;
  return v && v.trim() ? v.trim() : undefined;
}

export type UploadResult = { fileId: string; name: string };

export async function uploadImage(
  buffer: Buffer,
  mimeType: string,
  name: string,
): Promise<UploadResult> {
  const drive = driveClient();
  const parent = folderId();
  const res = await drive.files.create({
    requestBody: {
      name: name || "evidence.jpg",
      ...(parent ? { parents: [parent] } : {}),
    },
    media: {
      mimeType: mimeType || "image/jpeg",
      body: Readable.from(buffer),
    },
    fields: "id, name",
    // Support uploads into a Shared Drive folder if that's what was shared.
    supportsAllDrives: true,
  });
  const fileId = res.data.id;
  if (!fileId) throw new Error("Drive upload did not return a file id.");
  return { fileId, name: res.data.name || name };
}

export type DriveFile = {
  data: Buffer;
  mimeType: string;
};

export async function getImage(fileId: string): Promise<DriveFile> {
  const drive = driveClient();
  const meta = await drive.files.get({
    fileId,
    fields: "mimeType",
    supportsAllDrives: true,
  });
  const res = await drive.files.get(
    { fileId, alt: "media", supportsAllDrives: true },
    { responseType: "arraybuffer" },
  );
  return {
    data: Buffer.from(res.data as ArrayBuffer),
    mimeType: meta.data.mimeType || "application/octet-stream",
  };
}
