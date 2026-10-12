import fs from "fs";
import path from "path";

const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const dbPath = path.join(rootDir, "data", "database.json");
const outputDir = path.join(rootDir, "outputs", "point-1-to-3-review-2026-10-12");
const conflictPath = path.join(rootDir, "outputs", "full-source-recheck-2026-10-12", "conflict_review.csv");

await fs.promises.mkdir(outputDir, { recursive: true });

const db = JSON.parse(await fs.promises.readFile(dbPath, "utf8"));
const backupPath = path.join(rootDir, "data", `database.backup-before-obvious-misc-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
await fs.promises.writeFile(backupPath, JSON.stringify(db, null, 2));

const miscRules = [
  ["inspection", /\b(sgs|inspection|inspector|inspections|inspecteur|inspect|survey|surveillance|cotecna|bureau veritas|control union|omic)\b/i],
  ["government_chamber", /\b(embassy|consulate|chamber|ministry|minister|government|secretary|counsellor|ambassador|commerce department|trade office)\b/i],
  ["travel_hotel_taxi", /\b(taxi|hotel|guest house|travel agency|travels|tourism|translator|translation|interpreter)\b/i],
  ["logistics_cargo", /\b(courier|cargo|logistics|freight|shipping|airline|clearing|forwarding|transport)\b/i],
  ["bank_finance", /\b(bank|banking|exchange|finance|financial|insurance|credit|finance corporation|social security)\b/i],
  ["service_support", /\b(security services|printing press|media|newspaper|university|hospital|clinic|doctor)\b/i]
];

const miscCounts = new Map();
const changed = [];
for (const customer of db.customers || []) {
  if (customer.archivedAt) continue;
  const manual = String(customer.manualCategory || "").toLowerCase();
  if (manual === "trader" || manual === "miscellaneous") continue;
  const text = [
    customer.company,
    customer.person,
    customer.role,
    customer.notes,
    customer.email,
    customer.website,
    customer.address
  ].filter(Boolean).join(" ");
  const match = miscRules.find(([, pattern]) => pattern.test(text));
  if (!match) continue;
  const [reason] = match;
  customer.manualCategory = "miscellaneous";
  customer.updatedAt = new Date().toISOString();
  miscCounts.set(reason, (miscCounts.get(reason) || 0) + 1);
  changed.push({
    id: customer.id,
    company: customer.company || "",
    person: customer.person || "",
    country: customer.country || "",
    reason,
    sourceType: customer.sourceType || ""
  });
}

if (changed.length) {
  db.events ||= [];
  db.events.push({
    id: crypto.randomUUID(),
    type: "obvious_miscellaneous_classification",
    customerId: "",
    at: new Date().toISOString(),
    detail: { count: changed.length, reasons: Object.fromEntries(miscCounts) }
  });
  await fs.promises.writeFile(dbPath, JSON.stringify(db, null, 2));
}

const conflictRows = parseCsv(await fs.promises.readFile(conflictPath, "utf8"));
const byCountry = new Map();
const byType = new Map();
const byCountryType = new Map();

for (const row of conflictRows) {
  const country = cleanCountry(row.app_country || row.source_country || "Unknown");
  const types = String(row.conflict_fields || "unknown")
    .split(/[;,|]/)
    .map((v) => v.trim())
    .filter(Boolean);
  addCount(byCountry, country, 1);
  for (const type of types.length ? types : ["unknown"]) {
    addCount(byType, type, 1);
    addCount(byCountryType, `${country}||${type}`, 1);
  }
}

const countryRows = [...byCountry.entries()]
  .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  .map(([country, count]) => ({ country, conflict_rows: count }));

const typeRows = [...byType.entries()]
  .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  .map(([conflict_type, count]) => ({ conflict_type, conflict_rows: count }));

const countryTypeRows = [...byCountryType.entries()]
  .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  .map(([key, count]) => {
    const [country, conflict_type] = key.split("||");
    return { country, conflict_type, conflict_rows: count };
  });

await writeCsv(path.join(outputDir, "conflict_summary_by_country.csv"), countryRows);
await writeCsv(path.join(outputDir, "conflict_summary_by_type.csv"), typeRows);
await writeCsv(path.join(outputDir, "conflict_summary_by_country_and_type.csv"), countryTypeRows);
await writeCsv(path.join(outputDir, "obvious_miscellaneous_moves.csv"), changed);
await fs.promises.writeFile(path.join(outputDir, "summary.json"), JSON.stringify({
  backupPath,
  obviousMiscellaneousMoved: changed.length,
  obviousMiscellaneousByReason: Object.fromEntries(miscCounts),
  conflictRows: conflictRows.length,
  conflictCountries: countryRows.length,
  conflictTypes: typeRows.length
}, null, 2));

console.log(JSON.stringify({
  backupPath,
  outputDir,
  obviousMiscellaneousMoved: changed.length,
  obviousMiscellaneousByReason: Object.fromEntries(miscCounts),
  conflictRows: conflictRows.length,
  conflictCountries: countryRows.length,
  conflictTypes: typeRows.length
}, null, 2));

function addCount(map, key, count) {
  map.set(key, (map.get(key) || 0) + count);
}

function cleanCountry(value) {
  return String(value || "").trim() || "Unknown";
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === "\"" && text[i + 1] === "\"") {
        field += "\"";
        i += 1;
      } else if (ch === "\"") {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === "\"") {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch !== "\r") {
      field += ch;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [headers, ...data] = rows;
  return data.filter((items) => items.length && items.some(Boolean)).map((items) => {
    const record = {};
    headers.forEach((header, index) => {
      record[header] = items[index] || "";
    });
    return record;
  });
}

async function writeCsv(filePath, rows) {
  const headers = rows.length ? Object.keys(rows[0]) : ["empty"];
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((header) => csvCell(row[header])).join(","));
  }
  await fs.promises.writeFile(filePath, `${lines.join("\n")}\n`);
}

function csvCell(value) {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, "\"\"")}"`;
  return text;
}
