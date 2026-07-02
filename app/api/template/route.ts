import { NextResponse } from "next/server";
import { getDataReadOnly } from "@/lib/sheets";
import { buildTemplateWorkbook } from "@/lib/excel";
import { ConfigError } from "@/lib/google";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const XLSX_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// GET → a blank .xlsx template (instructions + example rows). Categories are
// pre-filled from the user's real rencana kinerja when available.
export async function GET() {
  try {
    let categories = [] as Awaited<ReturnType<typeof getDataReadOnly>>["categories"];
    try {
      categories = (await getDataReadOnly()).categories;
    } catch {
      // Fall back to built-in example categories if Sheets isn't reachable.
    }
    const buffer = await buildTemplateWorkbook(categories);
    return new NextResponse(buffer as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": XLSX_TYPE,
        "Content-Disposition": `attachment; filename="template-jurnal-kegiatan.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    if (err instanceof ConfigError) {
      return NextResponse.json({ error: err.message, code: "config" }, { status: 503 });
    }
    console.error("[/api/template]", err);
    return NextResponse.json({ error: "Gagal membuat template." }, { status: 500 });
  }
}
