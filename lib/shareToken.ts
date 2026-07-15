import "server-only";
import crypto from "crypto";
import { ConfigError } from "./google";
import type { ReportSection, ShareConfig } from "./report";

// ── Share token codec (server-only) ──────────────────────────────────────────
// The public /share/[token] route is stateless: the token encodes the report
// config (date range + which sections to show). Data itself is read fresh from
// Sheets so the link works across devices.
//
// The token is HMAC-signed with a server-only secret so a recipient cannot
// tamper with it (e.g. widen `from`/`to` in the base64 payload) to view
// activities outside the range the owner chose to share. Generating a token
// therefore only ever happens on the server (see /api/share) — never in the
// client bundle, which would require shipping the secret to the browser.

const ALL_SECTIONS: ReportSection[] = ["stats", "timeline", "grid", "report", "hourly", "table"];

function secret(): string {
  const s = process.env.SHARE_TOKEN_SECRET;
  if (!s || !s.trim()) {
    throw new ConfigError(
      "SHARE_TOKEN_SECRET belum diatur di server — tautan Bagikan tidak dapat dibuat/diverifikasi.",
    );
  }
  return s;
}

function sign(payload: string): string {
  return crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function encodeShareToken(cfg: ShareConfig): string {
  const secs = ALL_SECTIONS.filter((k) => cfg[k]);
  const payload = Buffer.from(
    JSON.stringify({ f: cfg.from, t: cfg.to, s: secs, ti: cfg.title }),
    "utf8",
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

// Throws ConfigError if SHARE_TOKEN_SECRET is unset (server misconfiguration —
// distinct from an invalid/tampered token, which returns null).
export function decodeShareToken(token: string): ShareConfig | null {
  const dot = token.lastIndexOf(".");
  if (dot < 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  // Signature must match exactly — this is what stops a recipient from editing
  // the (plainly base64, unencrypted) payload to widen the shared date range.
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const obj = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!obj || typeof obj.f !== "string" || typeof obj.t !== "string") return null;
    const secs: string[] = Array.isArray(obj.s) ? obj.s : ALL_SECTIONS;
    return {
      from: obj.f,
      to: obj.t,
      title: typeof obj.ti === "string" ? obj.ti : "Laporan Kegiatan",
      stats: secs.includes("stats"),
      timeline: secs.includes("timeline"),
      grid: secs.includes("grid"),
      report: secs.includes("report"),
      hourly: secs.includes("hourly"),
      table: secs.includes("table"),
    };
  } catch {
    return null;
  }
}
