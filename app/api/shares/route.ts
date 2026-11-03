import { NextRequest, NextResponse } from "next/server";
import { getShares, registerShare, setShareRevoked } from "@/lib/sheets";
import { decodeShareToken } from "@/lib/shareToken";
import { ConfigError } from "@/lib/google";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

function handleError(err: unknown) {
  if (err instanceof ConfigError) {
    return NextResponse.json({ error: err.message, code: "config" }, { status: 503 });
  }
  console.error("[/api/shares]", err);
  return NextResponse.json({ error: "Gagal mengakses daftar tautan." }, { status: 500 });
}

async function readBody(req: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? body : null;
  } catch {
    return null;
  }
}

// GET /api/shares — share links the owner has handed out (Daftar Tautan).
export async function GET() {
  try {
    return NextResponse.json({ shares: await getShares() }, { headers: NO_STORE });
  } catch (err) {
    return handleError(err);
  }
}

// POST /api/shares { token } — record a link as it is copied / opened from the
// Bagikan panel. Title and range are taken from the verified token, never from
// the body, so only links this server signed can be listed.
export async function POST(req: NextRequest) {
  const body = await readBody(req);
  const token = typeof body?.token === "string" ? body.token : "";
  try {
    const cfg = token ? decodeShareToken(token) : null;
    if (!cfg) return NextResponse.json({ error: "Tautan tidak valid." }, { status: 400 });
    const share = await registerShare({ token, title: cfg.title, from: cfg.from, to: cfg.to });
    return NextResponse.json({ share }, { headers: NO_STORE });
  } catch (err) {
    return handleError(err);
  }
}

// PATCH /api/shares { id, revoked } — revoke a link (/share/[token] then refuses
// it) or re-activate it.
export async function PATCH(req: NextRequest) {
  const body = await readBody(req);
  if (typeof body?.id !== "string" || typeof body?.revoked !== "boolean") {
    return NextResponse.json({ error: "Body harus berisi id dan revoked." }, { status: 400 });
  }
  try {
    const share = await setShareRevoked(body.id, body.revoked);
    if (!share) return NextResponse.json({ error: "Tautan tidak ditemukan." }, { status: 404 });
    return NextResponse.json({ share }, { headers: NO_STORE });
  } catch (err) {
    return handleError(err);
  }
}
