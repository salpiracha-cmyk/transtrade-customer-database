import fs from "node:fs/promises";
import fssync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, "..");
loadLocalEnv(path.join(rootDir, ".env"));

const liveUrl = (process.env.LIVE_SYNC_URL || "https://buyers.transtradeinternational.com").replace(/\/$/, "");
const user = process.env.LIVE_SYNC_USER || process.env.APP_USER || "tti";
const password = process.env.LIVE_SYNC_PASSWORD || process.env.APP_PASSWORD || "";
const dbPath = process.env.LIVE_SYNC_DB_PATH || path.join(rootDir, "data", "database.json");
const mode = process.env.LIVE_SYNC_MODE || "customers";
const dryRun = process.argv.includes("--dry-run");

if (!password) {
  console.error("Missing LIVE_SYNC_PASSWORD or APP_PASSWORD in .env");
  process.exit(1);
}

const db = JSON.parse(await fs.readFile(dbPath, "utf8"));
if (!Array.isArray(db.customers)) {
  console.error("Database file must include a customers array.");
  process.exit(1);
}

const active = db.customers.filter((customer) => !customer.archivedAt).length;
console.log(`Prepared ${db.customers.length} customer records (${active} active) for ${liveUrl}.`);
await import("./export-master-workbook.mjs");

if (dryRun) {
  console.log("Dry run only. No upload performed.");
  process.exit(0);
}

const boundary = `----tti-live-sync-${Date.now().toString(16)}`;
const fileBytes = await fs.readFile(dbPath);
const body = Buffer.concat([
  Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="mode"\r\n\r\n${mode}\r\n`),
  Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="database.json"\r\nContent-Type: application/json\r\n\r\n`),
  fileBytes,
  Buffer.from(`\r\n--${boundary}--\r\n`)
]);

const response = await fetch(`${liveUrl}/api/admin/restore-database`, {
  method: "POST",
  headers: {
    authorization: `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`,
    "content-type": `multipart/form-data; boundary=${boundary}`,
    "content-length": String(body.length)
  },
  body
});

const text = await response.text();
if (!response.ok) {
  console.error(`Live sync failed: HTTP ${response.status}`);
  console.error(text);
  process.exit(1);
}

console.log(`Live sync completed: ${text}`);

const summaryResponse = await fetch(`${liveUrl}/api/summary`, {
  headers: {
    authorization: `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`
  }
});
if (summaryResponse.ok) {
  const summary = await summaryResponse.json();
  console.log(`Live summary: ${summary.totals.active} active, ${summary.totals.countries} countries, ${summary.totals.emailReady} email-ready.`);
}

function loadLocalEnv(envPath) {
  if (!fssync.existsSync(envPath)) return;
  const lines = fssync.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}
