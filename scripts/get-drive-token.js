// One-time helper: obtain a GOOGLE_OAUTH_REFRESH_TOKEN for Drive uploads.
//
// Why: service accounts have zero Drive storage quota, so uploading evidence
// images fails on a personal Google account. This script runs an OAuth consent
// flow as *your own* Google account instead, so uploads count against your
// normal Drive quota. Run it once, then paste the printed refresh token into
// .env.local (and your Vercel project's env vars).
//
// Prerequisites:
//   1. In Google Cloud Console (same project as your service account), create
//      an OAuth Client ID of type "Web application".
//   2. Add http://localhost:53682 as an Authorized redirect URI.
//   3. Put the client id/secret in .env.local as GOOGLE_OAUTH_CLIENT_ID /
//      GOOGLE_OAUTH_CLIENT_SECRET.
//
// Usage:
//   node scripts/get-drive-token.js

const fs = require("fs");
const path = require("path");
const http = require("http");
const { google } = require("googleapis");

const PORT = 53682;
const REDIRECT_URI = `http://localhost:${PORT}`;

function loadEnvLocal() {
  const envPath = path.join(__dirname, "..", ".env.local");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvLocal();

const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error(
    "Missing GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET.\n" +
      "Set them in .env.local first (see scripts/get-drive-token.js header for setup steps).",
  );
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: "offline",
  prompt: "consent",
  scope: ["https://www.googleapis.com/auth/drive"],
});

console.log("\n1. Open this URL, sign in with the Google account that owns your Drive folder,");
console.log("   and approve access:\n");
console.log(authUrl + "\n");
console.log(`2. Waiting for the redirect on ${REDIRECT_URI} ...\n`);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT_URI);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error) {
    res.end("Authorization failed: " + error + ". You can close this tab.");
    console.error("Authorization failed:", error);
    server.close();
    process.exit(1);
    return;
  }
  if (!code) {
    res.end("No code received. You can close this tab.");
    return;
  }

  res.end("Authorized. You can close this tab and return to the terminal.");
  server.close();

  try {
    const { tokens } = await oauth2Client.getToken(code);
    if (!tokens.refresh_token) {
      console.error(
        "\nNo refresh_token returned. If you've authorized this app before, revoke access at " +
          "https://myaccount.google.com/permissions and re-run this script so Google issues a fresh one.",
      );
      process.exit(1);
    }
    console.log("\nSuccess. Add this to .env.local (and your Vercel project env vars):\n");
    console.log(`GOOGLE_OAUTH_REFRESH_TOKEN=${tokens.refresh_token}\n`);
  } catch (err) {
    console.error("\nFailed to exchange code for tokens:", err.message || err);
    process.exit(1);
  }
});

server.listen(PORT);
