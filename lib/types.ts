// Domain model — mirrors the data shape used by the Claude Design prototype.
// Activities + Categories live in Google Sheets; evidence images live in Vercel
// Blob (public CDN url) or, for legacy entries, Google Drive (fileId — the
// binary never sits in the sheet).

export type EvidenceImage = {
  id: string;
  type: "image";
  name: string;
  /** Public CDN URL (Vercel Blob) — set on new uploads. */
  url?: string;
  /** Legacy Google Drive file id, rendered via /api/image/[fileId]. */
  fileId?: string;
};

export type EvidenceLink = {
  id: string;
  type: "link";
  name: string;
  url: string;
};

export type Evidence = EvidenceImage | EvidenceLink;

export type Category = {
  id: string;
  name: string;
  color: string;
};

export type Activity = {
  id: string;
  categoryId: string;
  /** ISO date yyyy-mm-dd */
  startDate: string;
  /** ISO date yyyy-mm-dd (equals startDate for single-day activities) */
  endDate: string;
  /** HH:mm or "" */
  startTime: string;
  /** HH:mm or "" */
  endTime: string;
  title: string;
  capaian: string;
  evidence: Evidence[];
};

export type JournalData = {
  activities: Activity[];
  categories: Category[];
};
