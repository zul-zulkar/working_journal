import { NextRequest, NextResponse } from "next/server";
import { encodeShareToken } from "@/lib/shareToken";
import { ConfigError } from "@/lib/google";
import type { ShareConfig } from "@/lib/report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

// Mints a signed share token from a ShareConfig. Signing must happen here (not
// in the client bundle) since it needs the server-only SHARE_TOKEN_SECRET —
// an unsigned/client-built token could be edited by any recipient to widen the
// shared date range and see other activities.
export async function POST(req: NextRequest) {
  let body: Partial<ShareConfig>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body tidak valid." }, { status: 400 });
  }
  if (
    typeof body.from !== "string" ||
    typeof body.to !== "string" ||
    !ISO_RE.test(body.from) ||
    !ISO_RE.test(body.to) ||
    body.from > body.to
  ) {
    return NextResponse.json({ error: "Rentang tanggal tidak valid." }, { status: 400 });
  }
  const cfg: ShareConfig = {
    title: typeof body.title === "string" && body.title.trim() ? body.title.slice(0, 200) : "Laporan Kegiatan",
    from: body.from,
    to: body.to,
    stats: !!body.stats,
    timeline: !!body.timeline,
    grid: !!body.grid,
    report: !!body.report,
    hourly: !!body.hourly,
    table: !!body.table,
  };
  try {
    const token = encodeShareToken(cfg);
    return NextResponse.json({ token });
  } catch (err) {
    if (err instanceof ConfigError) {
      return NextResponse.json({ error: err.message, code: "config" }, { status: 503 });
    }
    console.error("[/api/share]", err);
    return NextResponse.json({ error: "Gagal membuat tautan." }, { status: 500 });
  }
}
