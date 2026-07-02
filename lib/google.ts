import "server-only";
import { google } from "googleapis";

// ── Server-only Google auth ──────────────────────────────────────────────────
// The service-account credential NEVER leaves the server. It is read from env
// vars and used only inside API route handlers / server components.
//
// Provide credentials one of two ways:
//   1. GOOGLE_SERVICE_ACCOUNT_JSON  — the whole service-account JSON, or its
//      base64 encoding (handy for single-line env vars on Vercel).
//   2. GOOGLE_CLIENT_EMAIL + GOOGLE_PRIVATE_KEY  — the two fields separately.
//      (\n escape sequences in the private key are normalised to real newlines.)

const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive",
];

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

type Creds = { client_email: string; private_key: string };

function readCreds(): Creds {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (raw && raw.trim()) {
    let text = raw.trim();
    // Allow base64-encoded JSON to dodge newline/quoting issues in env files.
    if (!text.startsWith("{")) {
      try {
        text = Buffer.from(text, "base64").toString("utf8");
      } catch {
        /* fall through to JSON.parse which will throw a clear error */
      }
    }
    const parsed = JSON.parse(text);
    if (!parsed.client_email || !parsed.private_key) {
      throw new ConfigError(
        "GOOGLE_SERVICE_ACCOUNT_JSON is missing client_email/private_key.",
      );
    }
    return {
      client_email: parsed.client_email,
      private_key: String(parsed.private_key).replace(/\\n/g, "\n"),
    };
  }

  const client_email = process.env.GOOGLE_CLIENT_EMAIL;
  const private_key = process.env.GOOGLE_PRIVATE_KEY;
  if (client_email && private_key) {
    return { client_email, private_key: private_key.replace(/\\n/g, "\n") };
  }

  throw new ConfigError(
    "Google credentials are not configured. Set GOOGLE_SERVICE_ACCOUNT_JSON " +
      "(or GOOGLE_CLIENT_EMAIL + GOOGLE_PRIVATE_KEY) in your environment.",
  );
}

let authClient: InstanceType<typeof google.auth.JWT> | null = null;

function getAuth() {
  if (!authClient) {
    const { client_email, private_key } = readCreds();
    authClient = new google.auth.JWT({
      email: client_email,
      key: private_key,
      scopes: SCOPES,
    });
  }
  return authClient;
}

export function sheetsClient() {
  return google.sheets({ version: "v4", auth: getAuth() });
}

export function driveClient() {
  return google.drive({ version: "v3", auth: getAuth() });
}

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) {
    throw new ConfigError(`Missing required environment variable: ${name}`);
  }
  return v.trim();
}
