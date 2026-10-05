import { NextResponse, type NextRequest } from "next/server";
import {
  SESSION_COOKIE,
  createSessionToken,
  isHttps,
  sessionCookieOptions,
  shouldRenew,
  verifySessionToken,
} from "@/lib/session";

// Everything requires the owner session except these. /share/[token] stays
// public so anyone holding a link sees exactly the date range it was minted for
// (the token is HMAC-signed — editing it yields "Tautan tidak valid"), and
// /api/image serves the legacy Drive evidence images those reports embed.
const PUBLIC_EXACT = new Set(["/login", "/demo", "/favicon.ico", "/robots.txt"]);
const PUBLIC_PREFIX = ["/share/", "/api/auth/", "/api/image/"];

function isPublic(pathname: string): boolean {
  return PUBLIC_EXACT.has(pathname) || PUBLIC_PREFIX.some((p) => pathname.startsWith(p));
}

export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

  const left = await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (left !== null) {
    const res = NextResponse.next();
    // Sliding session: an app used at least every two weeks never logs out.
    if (shouldRenew(left)) {
      const token = await createSessionToken();
      if (token) res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(isHttps(req)));
    }
    return res;
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "Sesi berakhir. Silakan masuk lagi.", code: "auth" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  const next = pathname + search;
  if (next !== "/") url.searchParams.set("next", next);
  return NextResponse.redirect(url);
}

export const config = {
  // Skip Next internals (static chunks, HMR, dev overlay) — the public share page
  // needs its JS chunks without a session too.
  matcher: ["/((?!_next/|__nextjs).*)"],
};
