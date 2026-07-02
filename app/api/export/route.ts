import { NextResponse } from "next/server";
import { getData } from "@/lib/sheets";
import { buildWorkbook } from "@/lib/excel";
import { ConfigError } from "@/lib/google";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const XLSX_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// GET → an .xlsx snapshot of all current activities + categories.
export async function GET() {
  try {
    const data = await getData();
    const buffer = await buildWorkbook(data);
    const stamp = new Date().toISOString().slice(0, 10);
    return new NextResponse(buffer as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": XLSX_TYPE,
        "Content-Disposition": `attachment; filename="jurnal-kegiatan-${stamp}.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    if (err instanceof ConfigError) {
      return NextResponse.json({ error: err.message, code: "config" }, { status: 503 });
    }
    console.error("[/api/export]", err);
    return NextResponse.json({ error: "Gagal membuat file Excel." }, { status: 500 });
  }
}
