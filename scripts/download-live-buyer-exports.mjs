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
const date = new Date().toISOString().slice(0, 10);
const outputRoot = path.resolve(
  process.env.BUYER_APP_EXPORT_DIR ||
  process.env.SERVER_EXPORT_DIR ||
  path.join(rootDir, "outputs", "buyer list by APP")
);

if (!password) {
  console.error("Missing LIVE_SYNC_PASSWORD or APP_PASSWORD in .env");
  process.exit(1);
}

const auth = `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
const summary = await getJson("/api/summary");
const countries = Array.isArray(summary.countries) ? summary.countries.filter(Boolean) : [];

if (!countries.length) {
  console.error("Live app returned no countries. Check the live data before exporting.");
  process.exit(1);
}

await fs.mkdir(path.join(outputRoot, "master"), { recursive: true });
const masterFile = path.join(outputRoot, "master", `master-buyers-${date}.xlsx`);
await downloadFile("/api/export.xlsx?category=buyer", masterFile);

const written = [masterFile];
for (const country of countries) {
  const folder = sanitizeFolderName(country);
  const countryDir = path.join(outputRoot, folder);
  await fs.mkdir(countryDir, { recursive: true });
  const file = path.join(countryDir, `${folder}-buyers-${date}.xlsx`);
  await downloadFile(`/api/export.xlsx?category=buyer&country=${encodeURIComponent(country)}`, file);
  written.push(file);
}

await fs.writeFile(path.join(outputRoot, "README.txt"), [
  "Transtrade buyer list by APP",
  `Downloaded from live app: ${liveUrl}`,
  `Updated: ${new Date().toISOString()}`,
  `Live active records: ${summary.totals?.active ?? ""}`,
  `Live email-ready records: ${summary.totals?.emailReady ?? ""}`,
  `Countries exported: ${countries.length}`,
  "Miscellaneous contacts are excluded from these buyer export files."
].join("\n") + "\n");

console.log(JSON.stringify({
  liveUrl,
  outputRoot,
  masterFile,
  activeRecords: summary.totals?.active,
  emailReady: summary.totals?.emailReady,
  countryCount: countries.length,
  filesWritten: written.length
}, null, 2));

async function getJson(route) {
  const response = await fetch(`${liveUrl}${route}`, {
    headers: { authorization: auth }
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Live request failed: HTTP ${response.status} ${text}`);
  }
  return response.json();
}

async function downloadFile(route, filePath) {
  const response = await fetch(`${liveUrl}${route}`, {
    headers: { authorization: auth }
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Download failed for ${route}: HTTP ${response.status} ${text}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(filePath, bytes);
}

function sanitizeFolderName(value) {
  return String(value || "Unknown")
    .replace(/[<>:"/\\|?*]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "Unknown";
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
