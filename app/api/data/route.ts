import { NextRequest, NextResponse } from "next/server";
import { getData, getDataReadOnly, revOf, saveData } from "@/lib/sheets";
import { ConfigError } from "@/lib/google";
import type { Activity, Category, Group, JournalData } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

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

// GET /api/data[?since=<rev>] — full data + its revision. Devices poll with
// `since`; when nothing changed the answer is a tiny { unchanged, rev }.
export async function GET(req: NextRequest) {
  try {
    const data = await getData();
    const rev = revOf(data);
    if (req.nextUrl.searchParams.get("since") === rev) {
      return NextResponse.json({ unchanged: true, rev }, { headers: NO_STORE });
    }
    return NextResponse.json({ ...data, rev }, { headers: NO_STORE });
  } catch (err) {
    return handleError(err);
  }
}

// Whole-document save (single-user app). Body: { activities, categories,
// groups, baseRev }. `baseRev` is the revision the client's edits are based on;
// if another device saved in between, nothing is written and the response is
// 409 with the current { data, rev } so the client can merge and retry.
export async function PUT(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<JournalData> & { baseRev?: unknown };
    if (!Array.isArray(body.activities) || !Array.isArray(body.categories)) {
      return NextResponse.json(
        { error: "Body harus berisi activities[] dan categories[]." },
        { status: 400 },
      );
    }
    const data: JournalData = {
      activities: body.activities as Activity[],
      categories: body.categories as Category[],
      // groups optional for backward compatibility with older clients.
      groups: Array.isArray(body.groups) ? (body.groups as Group[]) : [],
    };
    // Older clients send no baseRev — they keep last-write-wins behaviour.
    if (typeof body.baseRev === "string" && body.baseRev) {
      const current = await getDataReadOnly();
      const rev = revOf(current);
      if (rev !== body.baseRev) {
        return NextResponse.json(
          { error: "Data sudah diubah dari perangkat lain.", code: "conflict", data: current, rev },
          { status: 409, headers: NO_STORE },
        );
      }
    }
    await saveData(data);
    return NextResponse.json({ ok: true, rev: revOf(data) }, { headers: NO_STORE });
  } catch (err) {
    return handleError(err);
  }
}
