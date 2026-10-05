// ── Owner session (single password) ──────────────────────────────────────────
// Edge-safe: only Web Crypto + TextEncoder, so middleware.ts (Edge runtime) and
// the Node route handlers share one implementation.
//
// The whole app sits behind APP_PASSWORD (server env var — never in the repo or
// the client bundle). Logging in sets an httpOnly cookie holding
// `v1.<expiry>.<HMAC>`; nothing secret is stored in it, the signature just proves
// the server issued it. Changing APP_PASSWORD invalidates every session.
//
// Public on purpose (see middleware.ts): /login, /demo, /share/[token] (signed
// per date range — lib/shareToken.ts) and the /api/image proxy those pages use.

export const SESSION_COOKIE = "jkk_session";
/** 30 days, renewed on use once less than half remains (sliding session). */
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30;
const RENEW_BELOW = SESSION_MAX_AGE / 2;

const enc = new TextEncoder();

export function isAuthConfigured(): boolean {
  return !!(process.env.APP_PASSWORD && process.env.APP_PASSWORD.length);
}

function keyMaterial(): string | null {
  const pw = process.env.APP_PASSWORD;
  if (!pw) return null;
  // Mixing in the share secret means a captured cookie can't be used to
  // brute-force the password offline (when SHARE_TOKEN_SECRET is set).
  return `${pw}\u0000${process.env.SHARE_TOKEN_SECRET || ""}`;
}

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Constant-time compare for equal-length ASCII strings. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function sign(data: string): Promise<string | null> {
  const km = keyMaterial();
  if (!km) return null;
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(km),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return b64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data))));
}

async function sha256(s: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s))));
}

/** Null when APP_PASSWORD is not configured. */
export async function createSessionToken(): Promise<string | null> {
  const exp = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE;
  const payload = `v1.${exp}`;
  const sig = await sign(payload);
  return sig ? `${payload}.${sig}` : null;
}

/** Seconds of validity left, or null if missing / tampered / expired. */
export async function verifySessionToken(token: string | null | undefined): Promise<number | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1" || !/^\d+$/.test(parts[1])) return null;
  const left = Number(parts[1]) - Math.floor(Date.now() / 1000);
  if (left <= 0) return null;
  const expected = await sign(`v1.${parts[1]}`);
  if (!expected || !safeEqual(expected, parts[2])) return null;
  return left;
}

export function shouldRenew(secondsLeft: number): boolean {
  return secondsLeft < RENEW_BELOW;
}

/** Compares digests so neither the length nor the content leaks via timing. */
export async function passwordMatches(input: string): Promise<boolean> {
  const pw = process.env.APP_PASSWORD;
  if (!pw) return false;
  const [a, b] = await Promise.all([sha256(input), sha256(pw)]);
  return safeEqual(a, b);
}

export function sessionCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    // Plain http only on a LAN dev server (e.g. testing from a phone).
    secure,
    path: "/",
    maxAge: SESSION_MAX_AGE,
  };
}

/** Is this request on https (directly or behind Vercel's proxy)? */
export function isHttps(req: { headers: Headers; nextUrl: URL }): boolean {
  const fwd = req.headers.get("x-forwarded-proto");
  return (fwd ? fwd.split(",")[0].trim() : req.nextUrl.protocol.replace(":", "")) === "https";
}

/** Where to go after login — same-origin paths only (no open redirect). */
export function safeNextPath(raw: unknown): string {
  if (typeof raw !== "string" || !raw.startsWith("/")) return "/";
  if (raw.startsWith("//") || raw.startsWith("/\\")) return "/";
  if (raw.startsWith("/login") || raw.startsWith("/api/")) return "/";
  return raw;
}
