import { NextRequest, NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  createSessionToken,
  isAuthConfigured,
  isHttps,
  passwordMatches,
  sessionCookieOptions,
} from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FAIL_DELAY_MS = 700;

export async function POST(req: NextRequest) {
  if (!isAuthConfigured()) {
    return NextResponse.json(
      { error: "APP_PASSWORD belum diatur di server.", code: "config" },
      { status: 503 },
    );
  }
  let password = "";
  try {
    const body = await req.json();
    if (body && typeof body.password === "string") password = body.password.slice(0, 512);
  } catch {
    /* treated as an empty (wrong) password */
  }
  if (!(await passwordMatches(password))) {
    // Serverless instances don't share memory, so a fixed delay is the cheap
    // brake on guessing; good enough for a single-owner app.
    await new Promise((r) => setTimeout(r, FAIL_DELAY_MS));
    return NextResponse.json({ error: "Kata sandi salah." }, { status: 401 });
  }
  const token = await createSessionToken();
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token!, sessionCookieOptions(isHttps(req)));
  return res;
}
