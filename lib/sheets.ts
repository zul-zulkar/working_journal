import "server-only";
import { requireEnv, sheetsClient } from "./google";
import { seedData } from "./seed";
import type { Activity, Category, Evidence, JournalData } from "./types";

// ── Google Sheets data access ────────────────────────────────────────────────
// Two tabs in one spreadsheet:
//   Categories : id | name | color
//   Activities : id | categoryId | startDate | endDate | startTime | endTime |
//                title | capaian | evidence(JSON)
// Evidence is serialised as JSON in a single cell (small — image binaries live in
// Drive, evidence only carries the fileId).

const CAT_TAB = "Categories";
const ACT_TAB = "Activities";
const CAT_HEADER = ["id", "name", "color"];
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

async function ensureStructure(): Promise<void> {
  const sheets = sheetsClient();
  const id = spreadsheetId();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: id });
  const existing = new Set(
    (meta.data.sheets || [])
      .map((s) => s.properties?.title)
      .filter(Boolean) as string[],
  );

  const toCreate = [CAT_TAB, ACT_TAB].filter((t) => !existing.has(t));
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
        { range: `${CAT_TAB}!A1:C1`, values: [CAT_HEADER] },
        { range: `${ACT_TAB}!A1:I1`, values: [ACT_HEADER] },
      ],
    },
  });
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
  const res = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: id,
    ranges: [`${CAT_TAB}!A2:C`, `${ACT_TAB}!A2:I`],
  });
  const [catRows, actRows] = res.data.valueRanges || [];

  const categories: Category[] = (catRows?.values || [])
    .filter((r) => r && r[0])
    .map((r) => ({
      id: String(r[0]),
      name: String(r[1] ?? ""),
      color: String(r[2] ?? "#8e8e93"),
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

  return { activities, categories };
}

/** Read all journal data. Seeds the sheet with sample data on first run. */
export async function getData(): Promise<JournalData> {
  await ensureStructure();
  const data = await readRaw();
  if (data.activities.length === 0 && data.categories.length === 0) {
    const seeded = seedData();
    await saveData(seeded);
    return seeded;
  }
  return data;
}

/** Read-only variant used by the public share page — never seeds/writes. */
export async function getDataReadOnly(): Promise<JournalData> {
  await ensureStructure();
  return readRaw();
}

/** Replace the full dataset (single-user app — whole-document save). */
export async function saveData(data: JournalData): Promise<void> {
  await ensureStructure();
  const sheets = sheetsClient();
  const id = spreadsheetId();

  // Clear existing data rows (keep headers).
  await sheets.spreadsheets.values.batchClear({
    spreadsheetId: id,
    requestBody: { ranges: [`${CAT_TAB}!A2:C`, `${ACT_TAB}!A2:I`] },
  });

  const catValues = data.categories.map((c) => [c.id, c.name, c.color]);
  const actValues = data.activities.map((a) => [
    a.id,
    a.categoryId,
    a.startDate,
    a.endDate,
    a.startTime,
    a.endTime,
    a.title,
    a.capaian,
    JSON.stringify(a.evidence || []),
  ]);

  const updates: { range: string; values: unknown[][] }[] = [];
  if (catValues.length) {
    updates.push({ range: `${CAT_TAB}!A2`, values: catValues });
  }
  if (actValues.length) {
    updates.push({ range: `${ACT_TAB}!A2`, values: actValues });
  }
  if (updates.length) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: id,
      requestBody: { valueInputOption: "RAW", data: updates },
    });
  }
}
