import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, isHttps, sessionCookieOptions } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { ...sessionCookieOptions(isHttps(req)), maxAge: 0 });
  return res;
}
