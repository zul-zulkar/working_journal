import "server-only";
import crypto from "crypto";
import type { sheets_v4 } from "googleapis";
import { requireEnv, sheetsClient } from "./google";
import { seedData } from "./seed";
import type { Activity, Category, Evidence, Group, JournalData } from "./types";

// ── Google Sheets data access ────────────────────────────────────────────────
// Three tabs in one spreadsheet:
//   Categories : id | name | color | groupId
//   Groups     : id | name | startDate | endDate
//   Activities : id | categoryId | startDate | endDate | startTime | endTime |
//                title | capaian | evidence(JSON)
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

  const toCreate = [CAT_TAB, GRP_TAB, ACT_TAB].filter((t) => !existing.has(t));
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
