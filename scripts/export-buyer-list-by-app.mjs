import fs from "node:fs/promises";
import fssync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, "..");
loadLocalEnv(path.join(rootDir, ".env"));

const dbPath = process.env.BUYER_APP_DB_PATH || path.join(rootDir, "data", "database.json");
const date = new Date().toISOString().slice(0, 10);
const db = JSON.parse(await fs.readFile(dbPath, "utf8"));
const outputRoot = path.resolve(
  process.env.BUYER_APP_EXPORT_DIR ||
  process.env.SERVER_EXPORT_DIR ||
  db.settings?.serverExportDir ||
  path.join(rootDir, "outputs", "buyer list by APP")
);
const active = (db.customers || []).filter((customer) => !customer.archivedAt);
const buyers = active.filter((customer) => !isMiscellaneousContact(customer));
const countries = [...new Set(buyers.map((customer) => normalizeCountryName(customer.country)).filter(Boolean))]
  .sort((a, b) => a.localeCompare(b));
const written = [];

await fs.mkdir(path.join(outputRoot, "master"), { recursive: true });
const masterFile = path.join(outputRoot, "master", `master-buyers-${date}.xlsx`);
await fs.writeFile(masterFile, await buildXlsx(buyers, "Master Buyers"));
written.push(masterFile);

for (const country of countries) {
  const folder = sanitizeFolderName(country);
  const countryDir = path.join(outputRoot, folder);
  await fs.mkdir(countryDir, { recursive: true });
  const rows = buyers.filter((customer) => normalizeCountryName(customer.country) === country);
  const file = path.join(countryDir, `${folder}-buyers-${date}.xlsx`);
  await fs.writeFile(file, await buildXlsx(rows, country));
  written.push(file);
}

await fs.writeFile(path.join(outputRoot, "README.txt"), [
  "Transtrade buyer list by APP",
  `Updated: ${new Date().toISOString()}`,
  `Active buyer/trader records exported: ${buyers.length}`,
  `Countries exported: ${countries.length}`,
  "Miscellaneous contacts are excluded from these folders."
].join("\n") + "\n");

console.log(JSON.stringify({
  outputRoot,
  masterFile,
  buyerRecords: buyers.length,
  countryCount: countries.length,
  filesWritten: written.length
}, null, 2));

function exportCustomerRow(c) {
  return [
    isTraderContact(c) ? "Traders" : "Potential Buyer",
    c.company || "",
    c.person || "",
    c.role || "",
    normalizeCountryName(c.country),
    c.city || "",
    c.phone || "",
    c.mobile || "",
    c.email || "",
    c.website || "",
    c.address || "",
    getCustomerStatus(c),
    getDataQuality(c),
    c.sourceType || "",
    c.sourceId || "",
    c.sourcePhoto || "",
    c.notes || ""
  ];
}

async function buildXlsx(customers, title) {
  const headers = ["List Section", "Company", "Person", "Role", "Country", "City", "Phone", "Mobile", "Email", "Website", "Address", "Status", "Data Quality", "Source Type", "Source ID", "Source Photo", "Notes"];
  const sorted = sortCustomerList(customers);
  const buyersOnly = sorted.filter((c) => !isTraderContact(c));
  const traders = sorted.filter(isTraderContact);
  const rows = [
    headers,
    ["Potential Buyers"],
    ...buyersOnly.map(exportCustomerRow),
    [],
    ["Traders"],
    ...traders.map(exportCustomerRow)
  ];
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`);
  zip.folder("_rels").file(".rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  zip.folder("xl").file("workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${escapeXml(title.slice(0, 31))}" sheetId="1" r:id="rId1"/></sheets></workbook>`);
  zip.folder("xl").folder("_rels").file("workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`);
  zip.folder("xl").folder("worksheets").file("sheet1.xml", buildSheetXml(rows));
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

function buildSheetXml(rows) {
  const body = rows.map((row, rIdx) => {
    const cells = row.map((value, cIdx) => {
      const ref = `${colName(cIdx + 1)}${rIdx + 1}`;
      return `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(value || "")}</t></is></c>`;
    }).join("");
    return `<row r="${rIdx + 1}">${cells}</row>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols>${Array.from({ length: 17 }, (_, i) => `<col min="${i + 1}" max="${i + 1}" width="${i === 1 ? 32 : i >= 14 ? 38 : 18}" customWidth="1"/>`).join("")}</cols><sheetData>${body}</sheetData><autoFilter ref="A1:Q${rows.length}"/></worksheet>`;
}

function getCustomerStatus(c) {
  if (!c.email && !c.mobile && !c.phone) return "incomplete";
  if (!c.email) return "missing_email";
  if (!c.mobile && !c.phone) return "missing_mobile";
  if ((c.sourceTrust || 0) < 60) return "needs_review";
  return "ready";
}

function getDataQuality(c) {
  if (!c.company || !normalizeCountryName(c.country)) return "research_needed";
  if (!c.email && !c.mobile && !c.phone) return "research_needed";
  if ((c.sourceTrust || 0) < 60) return "review";
  if (!c.email) return "phone_only";
  if (!c.mobile && !c.phone) return "email_only";
  return "clean";
}

function sortCustomerList(customers) {
  return [...customers].sort((a, b) =>
    normalizeCountryName(a.country).localeCompare(normalizeCountryName(b.country)) ||
    String(a.company || "").localeCompare(String(b.company || "")) ||
    String(a.person || "").localeCompare(String(b.person || ""))
  );
}

function isMiscellaneousContact(customer) {
  if (String(customer.manualCategory || "").toLowerCase() === "trader") return false;
  if (String(customer.manualCategory || "").toLowerCase() === "miscellaneous") return true;
  const text = [customer.company, customer.person, customer.role, customer.notes, customer.email, customer.website]
    .filter(Boolean).join(" ").toLowerCase();
  return /\b(sgs|inspection|inspector|inspections|inspecteur|inspect|survey|surveillance|cotecna|bureau veritas|control union|omic|embassy|consulate|chamber|ministry|minister|government|secretary|counsellor|ambassador|taxi|hotel|courier|cargo|logistics|freight|shipping|airline|security|bank|banking|exchange|finance|financial|insurance|credit|finance corporation|social security)\b/i.test(text);
}

function isTraderContact(customer) {
  if (String(customer.manualCategory || "").toLowerCase() === "trader") return true;
  if (String(customer.manualCategory || "").toLowerCase() === "miscellaneous") return false;
  const company = normalizeText(customer.company).toLowerCase();
  return /\b(olam|moi international|mewah|mehwa|louis dreyfus|dreyfus|ld commodities|ldc|east[ -]?bourne|global transit|etg|export trading group|cargill|adm|bunge|cofco|phoenix commodities|ameropa|agrocorp|wilmar|goldcrest commodities)\b/i.test(company);
}

function normalizeCountryName(value) {
  return normalizeText(value).replace(/Â/g, "").trim();
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function sanitizeFolderName(value) {
  return normalizeText(value).replace(/[<>:"/\\|?*\x00-\x1F]/g, " ").replace(/\s+/g, " ").slice(0, 80) || "Unknown";
}

function colName(index) {
  let name = "";
  while (index > 0) {
    const rem = (index - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    index = Math.floor((index - rem - 1) / 26);
  }
  return name;
}

function escapeXml(value) {
  return String(value ?? "").replace(/[<>&'"]/g, (ch) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", "\"": "&quot;" }[ch]));
}

function loadLocalEnv(envPath) {
  if (!fssync.existsSync(envPath)) return;
  for (const line of fssync.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const i = trimmed.indexOf("=");
    const key = trimmed.slice(0, i).trim();
    const value = trimmed.slice(i + 1).trim().replace(/^["']|["']$/g, "");
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}
