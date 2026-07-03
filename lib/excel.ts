import "server-only";
import ExcelJS from "exceljs";
import type { Activity, Category, Evidence, EvidenceImage, Group, JournalData } from "./types";
import { uid } from "./format";

// ── Excel (.xlsx) import/export ───────────────────────────────────────────────
// One workbook, three data sheets (plus a "Petunjuk" sheet in the template):
//   "Kegiatan"        : ID | Tanggal Mulai | Tanggal Selesai | Jam Mulai |
//                       Jam Selesai | Rencana Kinerja | Kegiatan | Capaian |
//                       Bukti Link | (Data gambar — jangan diubah)
//   "Rencana Kinerja" : Nama | Warna | Grup / Periode
//   "Grup Periode"    : Nama | Tanggal Mulai | Tanggal Selesai
//
// Categories are referenced by NAME in the activity rows, and groups by NAME in
// the category rows (human-friendly). The last activity column round-trips image
// evidence as JSON so export→edit→import is lossless for images too; humans just
// leave it alone.

const ACT_SHEET = "Kegiatan";
const CAT_SHEET = "Rencana Kinerja";
const GRP_SHEET = "Grup Periode";
const HELP_SHEET = "Petunjuk";

const DEFAULT_COLORS = [
  "#0A84FF", "#FF9F0A", "#34C759", "#BF5AF2", "#FF375F",
  "#30B0C7", "#5E5CE6", "#FFD60A", "#AC8E68", "#64D2FF",
];

const ACT_COLUMNS = [
  { header: "ID", key: "id", width: 20 },
  { header: "Tanggal Mulai", key: "startDate", width: 15 },
  { header: "Tanggal Selesai", key: "endDate", width: 15 },
  { header: "Jam Mulai", key: "startTime", width: 11 },
  { header: "Jam Selesai", key: "endTime", width: 11 },
  { header: "Rencana Kinerja", key: "category", width: 26 },
  { header: "Kegiatan", key: "title", width: 40 },
  { header: "Capaian", key: "capaian", width: 55 },
  { header: "Bukti Link", key: "links", width: 40 },
  { header: "(Data gambar — jangan diubah)", key: "imagesJson", width: 30 },
];

const CAT_COLUMNS = [
  { header: "Nama", key: "name", width: 30 },
  { header: "Warna", key: "color", width: 12 },
  { header: "Grup / Periode", key: "group", width: 24 },
];

const GRP_COLUMNS = [
  { header: "Nama", key: "name", width: 28 },
  { header: "Tanggal Mulai", key: "startDate", width: 15 },
  { header: "Tanggal Selesai", key: "endDate", width: 15 },
];

const HEADER_FILL = "FF0A84FF";

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

// exceljs returns dates as UTC Date objects; format from UTC parts to avoid
// timezone shifting the day. Strings pass through untouched.
function cellToISODate(v: ExcelJS.CellValue): string {
  if (v == null) return "";
  if (v instanceof Date) {
    return `${v.getUTCFullYear()}-${pad2(v.getUTCMonth() + 1)}-${pad2(v.getUTCDate())}`;
  }
  const s = String(v).trim();
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${pad2(+m[2])}-${pad2(+m[3])}`;
  return s;
}

function cellToTime(v: ExcelJS.CellValue): string {
  if (v == null) return "";
  if (v instanceof Date) {
    return `${pad2(v.getUTCHours())}:${pad2(v.getUTCMinutes())}`;
  }
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2}):(\d{2})/);
  if (m) return `${pad2(+m[1])}:${m[2]}`;
  return s;
}

function cellToString(v: ExcelJS.CellValue): string {
  if (v == null) return "";
  if (typeof v === "object" && v !== null) {
    // Rich text / hyperlink cells.
    const anyV = v as { text?: string; hyperlink?: string; richText?: { text: string }[] };
    if (Array.isArray(anyV.richText)) return anyV.richText.map((r) => r.text).join("");
    if (typeof anyV.text === "string") return anyV.text;
    if (typeof anyV.hyperlink === "string") return anyV.hyperlink;
  }
  return String(v).trim();
}

function styleHeader(ws: ExcelJS.Worksheet) {
  const row = ws.getRow(1);
  row.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
  row.alignment = { vertical: "middle" };
  row.height = 22;
  ws.views = [{ state: "frozen", ySplit: 1 }];
}

function evidenceLinks(evidence: Evidence[]): string {
  return evidence
    .filter((e) => e.type === "link")
    .map((e) => e.url)
    .join("\n");
}

function evidenceImagesJson(evidence: Evidence[]): string {
  const imgs = evidence.filter((e): e is EvidenceImage => e.type === "image");
  return imgs.length ? JSON.stringify(imgs) : "";
}

// Add a dropdown on the "Rencana Kinerja" column so the template is easy to fill.
function addCategoryValidation(ws: ExcelJS.Worksheet, catCount: number) {
  const lastCatRow = Math.max(catCount + 1, 2);
  for (let r = 2; r <= 1000; r++) {
    ws.getCell(`F${r}`).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: [`'${CAT_SHEET}'!$A$2:$A$${lastCatRow}`],
      showErrorMessage: false,
    };
  }
}

// Add a group dropdown on the "Rencana Kinerja" sheet's Grup column (col C).
function addGroupValidation(ws: ExcelJS.Worksheet, groupCount: number) {
  const lastGrpRow = Math.max(groupCount + 1, 2);
  for (let r = 2; r <= 1000; r++) {
    ws.getCell(`C${r}`).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: [`'${GRP_SHEET}'!$A$2:$A$${lastGrpRow}`],
      showErrorMessage: false,
    };
  }
}

function fillCategorySheet(
  wb: ExcelJS.Workbook,
  categories: Category[],
  groups: Group[],
) {
  const ws = wb.addWorksheet(CAT_SHEET);
  ws.columns = CAT_COLUMNS;
  const groupName = (id?: string) =>
    (id && groups.find((g) => g.id === id)?.name) || "";
  categories.forEach((c) =>
    ws.addRow({ name: c.name, color: c.color, group: groupName(c.groupId) }),
  );
  styleHeader(ws);
  addGroupValidation(ws, groups.length);
}

function fillGroupSheet(wb: ExcelJS.Workbook, groups: Group[]) {
  const ws = wb.addWorksheet(GRP_SHEET);
  ws.columns = GRP_COLUMNS;
  groups.forEach((g) =>
    ws.addRow({ name: g.name, startDate: g.startDate, endDate: g.endDate }),
  );
  styleHeader(ws);
}

function fillActivitySheet(
  wb: ExcelJS.Workbook,
  data: JournalData,
): ExcelJS.Worksheet {
  const ws = wb.addWorksheet(ACT_SHEET);
  ws.columns = ACT_COLUMNS;
  const catName = (id: string) =>
    data.categories.find((c) => c.id === id)?.name || "";
  data.activities.forEach((a) => {
    const row = ws.addRow({
      id: a.id,
      startDate: a.startDate,
      endDate: a.endDate || a.startDate,
      startTime: a.startTime || "",
      endTime: a.endTime || "",
      category: catName(a.categoryId),
      title: a.title,
      capaian: a.capaian,
      links: evidenceLinks(a.evidence || []),
      imagesJson: evidenceImagesJson(a.evidence || []),
    });
    row.alignment = { vertical: "top", wrapText: true };
  });
  styleHeader(ws);
  addCategoryValidation(ws, data.categories.length);
  return ws;
}

/** Workbook mirroring the current data (used by /api/export). */
export async function buildWorkbook(data: JournalData): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Jurnal Kegiatan";
  wb.created = new Date();
  fillActivitySheet(wb, data);
  fillCategorySheet(wb, data.categories, data.groups);
  fillGroupSheet(wb, data.groups);
  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}

/** Blank template with example rows + an instructions sheet (used by /api/template). */
export async function buildTemplateWorkbook(
  categories: Category[],
  groups: Group[],
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Jurnal Kegiatan";
  wb.created = new Date();

  // Example period used when the user has no groups yet, so template categories
  // are already assigned to a valid periode.
  const grps: Group[] = groups.length
    ? groups
    : [
        {
          id: "g1",
          name: "SKP Tahun 2026",
          startDate: "2026-01-01",
          endDate: "2026-12-31",
        },
      ];

  const cats: Category[] = categories.length
    ? categories
    : [
        { id: "1", name: "Penyusunan Laporan", color: DEFAULT_COLORS[0], groupId: grps[0].id },
        { id: "2", name: "Rapat & Koordinasi", color: DEFAULT_COLORS[3], groupId: grps[0].id },
        { id: "3", name: "Pelayanan Administrasi", color: DEFAULT_COLORS[2], groupId: grps[0].id },
      ];

  // Instructions sheet first (so it opens on it).
  const help = wb.addWorksheet(HELP_SHEET);
  help.columns = [{ width: 100 }];
  const lines = [
    "PETUNJUK PENGISIAN — Template Jurnal Kegiatan",
    "",
    "1. Isi data kegiatan di sheet \"Kegiatan\" (satu baris = satu kegiatan).",
    "2. Kolom wajib: Tanggal Mulai, Rencana Kinerja, Kegiatan.",
    "3. Format tanggal: YYYY-MM-DD (contoh 2026-07-02). Format jam: HH:mm (contoh 09:30).",
    "4. Tanggal Selesai & jam boleh dikosongkan (dianggap sama dengan tanggal mulai / tanpa jam).",
    "5. Rencana Kinerja: pilih dari dropdown. Nama baru otomatis dibuat sebagai rencana kinerja baru saat impor.",
    "6. Daftar rencana kinerja ada di sheet \"Rencana Kinerja\". Kolom \"Grup / Periode\" mengaitkan tiap rencana kinerja ke satu periode (pilih dari dropdown).",
    "7. Daftar periode ada di sheet \"Grup Periode\" (Nama, Tanggal Mulai, Tanggal Selesai). Antar-periode sebaiknya TIDAK tumpang tindih tanggalnya. Periode baru pada sheet ini otomatis dibuat saat impor.",
    "8. Kolom ID: KOSONGKAN untuk kegiatan baru. Baris hasil ekspor punya ID — biarkan agar impor memperbarui data yang sama (bukan menduplikat).",
    "9. Bukti Link: satu URL per baris (tekan Alt+Enter di dalam sel untuk baris baru).",
    "10. Kolom \"(Data gambar — jangan diubah)\": diisi otomatis saat ekspor. Jangan diedit manual.",
    "",
    "CATATAN IMPOR: impor bersifat menggabungkan — baris dengan ID cocok memperbarui data lama, baris tanpa ID ditambahkan. Impor tidak pernah menghapus kegiatan yang tidak ada di file.",
    "Di aplikasi, rencana kinerja hanya bisa dipilih untuk kegiatan yang tanggalnya berada dalam rentang periode grupnya.",
    "Gambar bukti dukung diunggah langsung di aplikasi (tempel/Upload), tidak lewat Excel.",
  ];
  lines.forEach((t, i) => {
    const row = help.addRow([t]);
    if (i === 0) row.font = { bold: true, size: 13 };
  });

  // Groups + categories sheets.
  fillGroupSheet(wb, grps);
  fillCategorySheet(wb, cats, grps);

  // Activities sheet with two example rows.
  const ws = wb.addWorksheet(ACT_SHEET);
  ws.columns = ACT_COLUMNS;
  ws.addRow({
    id: "",
    startDate: "2026-07-02",
    endDate: "",
    startTime: "09:00",
    endTime: "11:30",
    category: cats[0].name,
    title: "Contoh: Menyusun laporan kinerja triwulan",
    capaian: "Contoh capaian — jelaskan hasil/keluaran pekerjaan.",
    links: "https://contoh.com/dokumen",
    imagesJson: "",
  }).alignment = { vertical: "top", wrapText: true };
  ws.addRow({
    id: "",
    startDate: "2026-07-03",
    endDate: "2026-07-04",
    startTime: "",
    endTime: "",
    category: cats[1] ? cats[1].name : cats[0].name,
    title: "Contoh: Rapat koordinasi program",
    capaian: "",
    links: "",
    imagesJson: "",
  }).alignment = { vertical: "top", wrapText: true };
  styleHeader(ws);
  addCategoryValidation(ws, cats.length);

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}

// ── Parse an uploaded workbook and MERGE into existing data ───────────────────
// Merge rules (never destructive):
//   - Groups: keep all existing; add new named periods from the "Grup Periode"
//     sheet; refresh dates of matching ones. Overlap is not enforced here (the
//     in-app editor guards that); an exported→imported file is trusted.
//   - Categories: keep all existing; add any new names found (by case-insensitive
//     name). Group assignment from the sheet's "Grup / Periode" column is applied
//     when it resolves to a known period.
//   - Activities: upsert by ID. Rows with an ID matching an existing activity
//     replace it; rows without an ID (or a new ID) are added. Existing activities
//     absent from the file are kept.

function normName(s: string): string {
  return s.trim().toLowerCase();
}

export function parseWorkbookMerge(
  wb: ExcelJS.Workbook,
  current: JournalData,
): JournalData {
  // Groups: start from current, index by normalized name.
  const groups: Group[] = (current.groups || []).map((g) => ({ ...g }));
  const groupByName = new Map<string, Group>();
  groups.forEach((g) => groupByName.set(normName(g.name), g));

  const grpSheet = wb.getWorksheet(GRP_SHEET);
  if (grpSheet) {
    grpSheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const name = cellToString(row.getCell(1).value);
      if (!name) return;
      const startDate = cellToISODate(row.getCell(2).value);
      const endDateRaw = cellToISODate(row.getCell(3).value) || startDate;
      const endDate = endDateRaw < startDate ? startDate : endDateRaw;
      const key = normName(name);
      const existing = groupByName.get(key);
      if (existing) {
        if (startDate) {
          existing.startDate = startDate;
          existing.endDate = endDate;
        }
      } else if (startDate) {
        const g: Group = { id: uid(), name: name.trim(), startDate, endDate };
        groups.push(g);
        groupByName.set(key, g);
      }
      // A named period with no start date and no match is skipped — a group
      // without a range can't participate in date filtering.
    });
  }
  const resolveGroupId = (name: string): string | undefined =>
    groupByName.get(normName(name))?.id;

  // Categories: start from current, index by normalized name.
  const categories: Category[] = current.categories.map((c) => ({ ...c }));
  const catByName = new Map<string, Category>();
  categories.forEach((c) => catByName.set(normName(c.name), c));
  let colorCursor = categories.length;
  const ensureCategory = (name: string): string => {
    const key = normName(name);
    const existing = catByName.get(key);
    if (existing) return existing.id;
    const cat: Category = {
      id: uid(),
      name: name.trim(),
      color: DEFAULT_COLORS[colorCursor++ % DEFAULT_COLORS.length],
    };
    categories.push(cat);
    catByName.set(key, cat);
    return cat.id;
  };

  // Pull explicit categories from the "Rencana Kinerja" sheet (names, colors,
  // and their group/periode assignment).
  const catSheet = wb.getWorksheet(CAT_SHEET);
  if (catSheet) {
    catSheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const name = cellToString(row.getCell(1).value);
      if (!name) return;
      const color = cellToString(row.getCell(2).value);
      const groupName = cellToString(row.getCell(3).value);
      const key = normName(name);
      let cat = catByName.get(key);
      if (!cat) {
        cat = {
          id: uid(),
          name: name.trim(),
          color: /^#?[0-9a-fA-F]{6}$/.test(color)
            ? color.startsWith("#") ? color : `#${color}`
            : DEFAULT_COLORS[colorCursor++ % DEFAULT_COLORS.length],
        };
        categories.push(cat);
        catByName.set(key, cat);
      }
      // Apply group assignment when the column resolves to a known period.
      // Blank/unknown group names leave the existing assignment untouched.
      if (groupName) {
        const gid = resolveGroupId(groupName);
        if (gid) cat.groupId = gid;
      }
    });
  }

  // Activities: upsert by ID into a copy of current.
  const activities: Activity[] = current.activities.map((a) => ({ ...a }));
  const actById = new Map<string, number>();
  activities.forEach((a, i) => actById.set(a.id, i));

  const actSheet = wb.getWorksheet(ACT_SHEET);
  if (!actSheet) {
    throw new Error(`Sheet "${ACT_SHEET}" tidak ditemukan di file.`);
  }

  let imported = 0;
  actSheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const startDate = cellToISODate(row.getCell(2).value);
    const title = cellToString(row.getCell(7).value);
    // Skip blank/example-guard rows: require at least a title and a start date.
    if (!title || !startDate) return;

    const id = cellToString(row.getCell(1).value) || uid();
    const endDate = cellToISODate(row.getCell(3).value) || startDate;
    const startTime = cellToTime(row.getCell(4).value);
    const endTime = cellToTime(row.getCell(5).value);
    const categoryName = cellToString(row.getCell(6).value);
    const capaian = cellToString(row.getCell(8).value);
    const linksRaw = cellToString(row.getCell(9).value);
    const imagesRaw = cellToString(row.getCell(10).value);

    const evidence: Evidence[] = [];
    if (imagesRaw) {
      try {
        const arr = JSON.parse(imagesRaw);
        if (Array.isArray(arr)) {
          arr.forEach((x) => {
            if (x && x.type === "image" && (x.url || x.fileId)) {
              evidence.push({
                id: typeof x.id === "string" ? x.id : uid(),
                type: "image",
                name: typeof x.name === "string" ? x.name : "Gambar",
                url: typeof x.url === "string" ? x.url : undefined,
                fileId: typeof x.fileId === "string" ? x.fileId : undefined,
              });
            }
          });
        }
      } catch {
        /* ignore malformed image JSON */
      }
    }
    linksRaw
      .split(/\r?\n/)
      .map((u) => u.trim())
      .filter(Boolean)
      .forEach((url) => evidence.push({ id: uid(), type: "link", name: url, url }));

    const activity: Activity = {
      id,
      categoryId: categoryName ? ensureCategory(categoryName) : "",
      startDate,
      endDate: endDate < startDate ? startDate : endDate,
      startTime,
      endTime,
      title: title.trim(),
      capaian: capaian.trim(),
      evidence,
    };

    const idx = actById.get(id);
    if (idx != null) activities[idx] = activity;
    else {
      actById.set(id, activities.length);
      activities.push(activity);
    }
    imported++;
  });

  if (imported === 0) {
    throw new Error("Tidak ada baris kegiatan yang valid di file.");
  }

  return { activities, categories, groups };
}

/** Load an uploaded .xlsx buffer into an ExcelJS workbook. */
export async function loadWorkbook(buffer: Buffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  // Cast bridges the generic Buffer<ArrayBufferLike> (newer @types/node) and the
  // non-generic Buffer that exceljs's bundled types expect.
  await wb.xlsx.load(buffer as unknown as Parameters<typeof wb.xlsx.load>[0]);
  return wb;
}
