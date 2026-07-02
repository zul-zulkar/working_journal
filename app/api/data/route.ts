import { NextRequest, NextResponse } from "next/server";
import { getData, saveData } from "@/lib/sheets";
import { ConfigError } from "@/lib/google";
import type { Activity, Category, JournalData } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function handleError(err: unknown) {
  if (err instanceof ConfigError) {
    return NextResponse.json({ error: err.message, code: "config" }, { status: 503 });
  }
  console.error("[/api/data]", err);
  return NextResponse.json(
    { error: "Gagal mengakses data. Coba lagi." },
    { status: 500 },
  );
}

export async function GET() {
  try {
    const data = await getData();
    return NextResponse.json(data);
  } catch (err) {
    return handleError(err);
  }
}

// Whole-document save (single-user app). Body: { activities, categories }.
export async function PUT(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<JournalData>;
    if (!Array.isArray(body.activities) || !Array.isArray(body.categories)) {
      return NextResponse.json(
        { error: "Body harus berisi activities[] dan categories[]." },
        { status: 400 },
      );
    }
    const data: JournalData = {
      activities: body.activities as Activity[],
      categories: body.categories as Category[],
    };
    await saveData(data);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleError(err);
  }
}
