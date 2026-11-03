import "server-only";
import crypto from "crypto";
import type { sheets_v4 } from "googleapis";
import { requireEnv, sheetsClient } from "./google";
import { seedData } from "./seed";
import type { Activity, Category, Evidence, Group, JournalData, ShareLink } from "./types";

// ── Google Sheets data access ────────────────────────────────────────────────
// Four tabs in one spreadsheet:
//   Categories : id | name | color | groupId
//   Groups     : id | name | startDate | endDate
//   Activities : id | categoryId | startDate | endDate | startTime | endTime |
//                title | capaian | evidence(JSON)
//   Shares     : id | token | title | from | to | createdAt | revokedAt
//                (share links handed out — see "Share links" at the bottom;
//                not part of the journal document below)
// Evidence is serialised as JSON in a single cell (small — image binaries live
// in Vercel Blob / Drive; evidence only carries the url or legacy fileId).
//
// Multi-device sync: every read reports a revision (`revOf`, a hash of the
// rows) and saves are a single atomic batchUpdate, so a device polling for
// changes never observes a half-written sheet. /api/data uses the revision for
// cheap "nothing changed" polls and to refuse a save based on stale data (the
// client then merges and retries — see lib/merge.ts).

const CAT_TAB = "Categories";
const GRP_TAB = "Groups";
const ACT_TAB = "Activities";
const SHARE_TAB = "Shares";
const CAT_HEADER = ["id", "name", "color", "groupId"];
const GRP_HEADER = ["id", "name", "startDate", "endDate"];
const ACT_HEADER = [
  "id",
  "categoryId",
  "startDate",
  "endDate",
  "startTime",
  "endTime",
  "title",
  "capaian",
  "evidence",
];
const SHARE_HEADER = ["id", "token", "title", "from", "to", "createdAt", "revokedAt"];

function spreadsheetId(): string {
  return requireEnv("GOOGLE_SHEET_ID");
}

/** Creates missing tabs + header rows. Returns true if the tabs were just created. */
async function ensureStructure(): Promise<boolean> {
  const sheets = sheetsClient();
  const id = spreadsheetId();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: id });
  const existing = new Set(
    (meta.data.sheets || [])
      .map((s) => s.properties?.title)
      .filter(Boolean) as string[],
  );

  const toCreate = [CAT_TAB, GRP_TAB, ACT_TAB, SHARE_TAB].filter((t) => !existing.has(t));
  if (toCreate.length) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: id,
      requestBody: {
        requests: toCreate.map((title) => ({ addSheet: { properties: { title } } })),
      },
    });
  }

  // Write header rows (idempotent — always overwrite row 1).
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: id,
    requestBody: {
      valueInputOption: "RAW",
      data: [
        { range: `${CAT_TAB}!A1:D1`, values: [CAT_HEADER] },
        { range: `${GRP_TAB}!A1:D1`, values: [GRP_HEADER] },
        { range: `${ACT_TAB}!A1:I1`, values: [ACT_HEADER] },
        { range: `${SHARE_TAB}!A1:G1`, values: [SHARE_HEADER] },
      ],
    },
  });
  return toCreate.includes(CAT_TAB) && toCreate.includes(ACT_TAB);
}

// Structure is checked once per server instance rather than on every request:
// devices now poll /api/data, and re-writing the headers each time would burn
// the Sheets write quota for nothing.
let structureReady: Promise<boolean> | null = null;
/** Sample data is only seeded into a spreadsheet whose tabs we just created. */
let seedPending = false;

function ensureStructureOnce(): Promise<boolean> {
  if (!structureReady) {
    structureReady = ensureStructure().then(
      (fresh) => {
        if (fresh) seedPending = true;
        return fresh;
      },
      (err) => {
        structureReady = null;
        throw err;
      },
    );
  }
  return structureReady;
}

function parseEvidence(cell: string | undefined): Evidence[] {
  if (!cell) return [];
  try {
    const arr = JSON.parse(cell);
    return Array.isArray(arr) ? (arr as Evidence[]) : [];
  } catch {
    return [];
  }
}

async function readRaw(): Promise<JournalData> {
  const sheets = sheetsClient();
  const id = spreadsheetId();
  let res;
  try {
    res = await sheets.spreadsheets.values.batchGet({
      spreadsheetId: id,
      ranges: [`${CAT_TAB}!A2:D`, `${GRP_TAB}!A2:D`, `${ACT_TAB}!A2:I`],
    });
  } catch (err) {
    // A tab may have been removed by hand — re-check the structure next time.
    structureReady = null;
    throw err;
  }
  const [catRows, grpRows, actRows] = res.data.valueRanges || [];

  const categories: Category[] = (catRows?.values || [])
    .filter((r) => r && r[0])
    .map((r) => ({
      id: String(r[0]),
      name: String(r[1] ?? ""),
      color: String(r[2] ?? "#8e8e93"),
      groupId: r[3] ? String(r[3]) : undefined,
    }));

  const groups: Group[] = (grpRows?.values || [])
    .filter((r) => r && r[0])
    .map((r) => ({
      id: String(r[0]),
      name: String(r[1] ?? ""),
      startDate: String(r[2] ?? ""),
      endDate: String(r[3] ?? r[2] ?? ""),
    }));

  const activities: Activity[] = (actRows?.values || [])
    .filter((r) => r && r[0])
    .map((r) => ({
      id: String(r[0]),
      categoryId: String(r[1] ?? ""),
      startDate: String(r[2] ?? ""),
      endDate: String(r[3] ?? r[2] ?? ""),
      startTime: String(r[4] ?? ""),
      endTime: String(r[5] ?? ""),
      title: String(r[6] ?? ""),
      capaian: String(r[7] ?? ""),
      evidence: parseEvidence(r[8] as string | undefined),
    }));

  return { activities, categories, groups };
}

/**
 * Read all journal data. Seeds sample data only into a brand-new spreadsheet
 * (tabs created by this instance) — never merely because the data reads empty,
 * which could otherwise happen to a device polling mid-way through a save.
 */
export async function getData(): Promise<JournalData> {
  await ensureStructureOnce();
  const data = await readRaw();
  if (seedPending) {
    seedPending = false;
    if (data.activities.length === 0 && data.categories.length === 0) {
      const seeded = seedData();
      await saveData(seeded);
      return seeded;
    }
  }
  return data;
}

/** Read-only variant used by the public share page and save checks — never seeds. */
export async function getDataReadOnly(): Promise<JournalData> {
  await ensureStructureOnce();
  return readRaw();
}

type Rows = { cat: string[][]; grp: string[][]; act: string[][] };

const cell = (v: unknown) => (v == null ? "" : String(v));

function toRows(data: JournalData): Rows {
  return {
    cat: data.categories.map((c) => [c.id, c.name, c.color, c.groupId || ""].map(cell)),
    grp: (data.groups || []).map((g) => [g.id, g.name, g.startDate, g.endDate].map(cell)),
    act: data.activities.map((a) =>
      [
        a.id,
        a.categoryId,
        a.startDate,
        a.endDate,
        a.startTime,
        a.endTime,
        a.title,
        a.capaian,
        JSON.stringify(a.evidence || []),
      ].map(cell),
    ),
  };
}

/** Sheets omits trailing empty cells on read; drop them so both sides hash alike. */
function trimRow(r: string[]): string[] {
  let n = r.length;
  while (n > 0 && r[n - 1] === "") n--;
  return r.slice(0, n);
}

/** Content revision: equal data (as stored in the sheet) => equal revision. */
export function revOf(data: JournalData): string {
  const rows = toRows(data);
  return crypto
    .createHash("sha256")
    .update(JSON.stringify([rows.cat.map(trimRow), rows.grp.map(trimRow), rows.act.map(trimRow)]))
    .digest("base64url")
    .slice(0, 24);
}

/**
 * Replace the full dataset (single-user app — whole-document save) in ONE
 * spreadsheets.batchUpdate, which Google applies atomically. Each tab's data
 * area (row 2 down) is rewritten with updateCells: cells past the new rows are
 * cleared by the same request, so readers never see an empty or partial sheet.
 */
export async function saveData(data: JournalData): Promise<void> {
  await ensureStructureOnce();
  const sheets = sheetsClient();
  const id = spreadsheetId();

  const meta = await sheets.spreadsheets.get({
    spreadsheetId: id,
    fields: "sheets.properties(sheetId,title,gridProperties(rowCount))",
  });
  const tabs = new Map(
    (meta.data.sheets || []).map((sh) => [
      sh.properties?.title || "",
      { sheetId: sh.properties?.sheetId ?? 0, rowCount: sh.properties?.gridProperties?.rowCount ?? 0 },
    ]),
  );

  const rows = toRows(data);
  const plan: [string, string[][], number][] = [
    [CAT_TAB, rows.cat, CAT_HEADER.length],
    [GRP_TAB, rows.grp, GRP_HEADER.length],
    [ACT_TAB, rows.act, ACT_HEADER.length],
  ];
  const requests: sheets_v4.Schema$Request[] = [];
  for (const [title, values, cols] of plan) {
    const tab = tabs.get(title);
    if (!tab) {
      structureReady = null;
      throw new Error(`Tab "${title}" tidak ditemukan di spreadsheet.`);
    }
    const needed = values.length + 1; // + header row
    if (needed > tab.rowCount) {
      requests.push({
        appendDimension: { sheetId: tab.sheetId, dimension: "ROWS", length: needed - tab.rowCount },
      });
    }
    requests.push({
      updateCells: {
        range: {
          sheetId: tab.sheetId,
          startRowIndex: 1,
          endRowIndex: Math.max(tab.rowCount, needed),
          startColumnIndex: 0,
          endColumnIndex: cols,
        },
        // RAW semantics: stringValue is stored verbatim (no formula/date parsing).
        rows: values.map((r) => ({
          values: r.map((v) => (v === "" ? {} : { userEnteredValue: { stringValue: v } })),
        })),
        fields: "userEnteredValue",
      },
    });
  }
  await sheets.spreadsheets.batchUpdate({ spreadsheetId: id, requestBody: { requests } });
}

// ── Share links ──────────────────────────────────────────────────────────────
// Rows are appended when the owner hands a link out and afterwards only their
// revokedAt cell changes — saveData() never touches this tab, so a journal save
// from another device can't drop a revocation. Tokens are deterministic (same
// title + range => same token), so every operation matches by token and covers
// duplicate rows a race between two devices may have appended.

async function readShareRows(): Promise<string[][]> {
  await ensureStructureOnce();
  try {
    const res = await sheetsClient().spreadsheets.values.get({
      spreadsheetId: spreadsheetId(),
      range: `${SHARE_TAB}!A2:G`,
    });
    // Blank rows in between come back as [] — row i lives at sheet row i + 2.
    return ((res.data.values || []) as unknown[][]).map((r) => (r || []).map(cell));
  } catch (err) {
    structureReady = null;
    throw err;
  }
}

function toShare(r: string[]): ShareLink {
  return {
    id: r[0],
    token: r[1] ?? "",
    title: r[2] ?? "",
    from: r[3] ?? "",
    to: r[4] ?? "",
    createdAt: r[5] ?? "",
    revokedAt: r[6] ?? "",
  };
}

function rowsWithToken(rows: string[][], token: string): number[] {
  const out: number[] = [];
  rows.forEach((r, i) => {
    if (r[0] && r[1] === token) out.push(i);
  });
  return out;
}

async function writeRevokedAt(rowIdx: number[], value: string): Promise<void> {
  if (!rowIdx.length) return;
  await sheetsClient().spreadsheets.values.batchUpdate({
    spreadsheetId: spreadsheetId(),
    requestBody: {
      valueInputOption: "RAW",
      data: rowIdx.map((i) => ({ range: `${SHARE_TAB}!G${i + 2}`, values: [[value]] })),
    },
  });
}

/** Recorded share links, one per token, newest first. */
export async function getShares(): Promise<ShareLink[]> {
  const rows = await readShareRows();
  const byToken = new Map<string, ShareLink>();
  for (const r of rows) {
    if (!r[0] || !r[1]) continue;
    const prev = byToken.get(r[1]);
    if (!prev) byToken.set(r[1], toShare(r));
    else if (!prev.revokedAt && r[6]) prev.revokedAt = r[6];
  }
  return Array.from(byToken.values()).sort((a, b) =>
    a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0,
  );
}

/**
 * Records a link the owner just handed out. Already recorded => returned as is,
 * re-activated if it had been revoked (sharing it again means it should work).
 */
export async function registerShare(
  input: Pick<ShareLink, "token" | "title" | "from" | "to">,
): Promise<ShareLink> {
  const rows = await readShareRows();
  const hits = rowsWithToken(rows, input.token);
  if (hits.length) {
    if (hits.some((i) => rows[i][6])) await writeRevokedAt(hits, "");
    return { ...toShare(rows[hits[0]]), revokedAt: "" };
  }
  const link: ShareLink = {
    id: crypto.randomBytes(9).toString("base64url"),
    ...input,
    createdAt: new Date().toISOString(),
    revokedAt: "",
  };
  await sheetsClient().spreadsheets.values.append({
    spreadsheetId: spreadsheetId(),
    range: `${SHARE_TAB}!A:G`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [[link.id, link.token, link.title, link.from, link.to, link.createdAt, ""]],
    },
  });
  return link;
}

/** Revokes (or re-activates) a recorded link. null if the id is unknown. */
export async function setShareRevoked(id: string, revoked: boolean): Promise<ShareLink | null> {
  const rows = await readShareRows();
  const row = rows.find((r) => r[0] === id);
  if (!row || !row[1]) return null;
  const revokedAt = revoked ? new Date().toISOString() : "";
  await writeRevokedAt(rowsWithToken(rows, row[1]), revokedAt);
  return { ...toShare(row), revokedAt };
}

/** Whether /share/[token] must refuse this token. Unrecorded tokens stay valid. */
export async function isShareRevoked(token: string): Promise<boolean> {
  const rows = await readShareRows();
  return rows.some((r) => r[0] && r[1] === token && !!r[6]);
}
