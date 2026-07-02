import { NextRequest, NextResponse } from "next/server";
import { getData, saveData } from "@/lib/sheets";
import { loadWorkbook, parseWorkbookMerge } from "@/lib/excel";
import { ConfigError } from "@/lib/google";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB — plenty for a spreadsheet of rows.

// POST multipart/form-data (field `file`) with an .xlsx. Parses it, MERGES into
// the current data (upsert activities by id, add new categories by name — never
// deletes), saves to Sheets, and returns the merged { activities, categories }.
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Tidak ada berkas." }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "Berkas melebihi 8 MB." }, { status: 413 });
    }
    const name = (file.name || "").toLowerCase();
    if (!name.endsWith(".xlsx")) {
      return NextResponse.json(
        { error: "Format harus .xlsx (Excel). Gunakan template yang disediakan." },
        { status: 415 },
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const wb = await loadWorkbook(buffer);
    const current = await getData();
    const merged = parseWorkbookMerge(wb, current);
    await saveData(merged);

    return NextResponse.json({
      ok: true,
      data: merged,
      counts: {
        activities: merged.activities.length,
        categories: merged.categories.length,
      },
    });
  } catch (err) {
    if (err instanceof ConfigError) {
      return NextResponse.json({ error: err.message, code: "config" }, { status: 503 });
    }
    const msg = err instanceof Error ? err.message : "Gagal mengimpor file.";
    console.error("[/api/import]", err);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
