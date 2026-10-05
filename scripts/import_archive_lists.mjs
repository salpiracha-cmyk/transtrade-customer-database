import fs from "node:fs/promises";
import fssync from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import JSZip from "jszip";
import { xml2js } from "xml-js";

const ROOT = path.resolve("..");
const EXTRACTED_DIR = process.env.ARCHIVE_IMPORT_DIR || path.join(ROOT, "work", "archive_review", "extracted_readable");
const INVENTORY_PATH = path.join(ROOT, "work", "archive_review", "list_inventory.csv");
const DB_PATH = path.resolve("data", "database.json");

const SOURCE_TYPE = "archive_buyer_list";
const SOURCE_TRUST = 75;
const IMPORT_ID = crypto.randomUUID();

const COLUMN_ALIASES = {
  company: ["company", "company name", "company name.", "company name:", "company name: (m/s.)", "customer", "buyer company name", "name of company in english", "importer", "importers name", "buyer name", "company name and details", "description"],
  person: ["person", "contact person", "contact person:", "attn", "attn person.", "buyer name", "focal person details", "manager / decision maker", "name", "buyer name", "attn"],
  role: ["role", "designation", "job title", "nature of business", "nature of activity", "trade"],
  country: ["country", "country/region", "home country/region", "city/country", "loacation / country", "location / country", "home country", "import to"],
  city: ["city", "home city", "location", "city/state", "city/country"],
  phone: ["phone", "phone as printed", "tel", "tel no", "tel no.", "telephone", "telephone #", "telephone contact", "office tel", "phone / office", "telephone contact", "telephone", "telephone #", "tel no.", "phone number", "phone #(+ = 261)", "phone #"],
  mobile: ["mobile", "mobile as printed", "mobile no.", "mobile no", "cell", "cell #", "cell #(+ = 261)", "mobile phone", "mobil", "mobile", "number"],
  email: ["email", "e-mail", "email address", "email address.", "e-mail address.", "email from card/note", "best email", "best email (updated)", "updated email", "e mail address", "e.mail", "e-mail id", "e mail", "e-mail", "e.mail", "e-mail address", "buyers e-mail address", "email address", "e-mail address.", "e-mail"],
  website: ["website", "official website", "web", "web address", "web page", "website", "web"],
  address: ["address", "postal address", "home street", "buyer address", "p.o.box", "p.o box", "postal address."],
  notes: ["notes", "remarks", "note.", "card/handwriting notes", "historical channel status", "remarks", "note"],
  priority: ["priority", "trade", "rice relevance / priority"],
  sourceId: ["contact id", "source id", "s.no", "s no", "s/no.", "sn#", "serial", "no."]
};

const inventory = await readInventory();
const db = JSON.parse(await fs.readFile(DB_PATH, "utf8"));
const existingIndex = buildExistingIndex(db.customers.filter((c) => !c.archivedAt));
const files = await listFiles(EXTRACTED_DIR);

const stats = {
  filesSeen: files.length,
  filesImported: 0,
  filesSkipped: 0,
  rowsParsed: 0,
  inserted: 0,
  merged: 0,
  skippedDuplicates: 0,
  skippedReferenceFiles: 0,
  skippedTemporaryFiles: 0,
  skippedPakistanIndia: 0,
  failed: []
};

for (const filePath of files) {
  const archivePath = toArchivePath(filePath);
  const info = inventory.get(archivePath);
  if (path.basename(filePath).startsWith("~$")) {
    stats.skippedTemporaryFiles++;
    stats.filesSkipped++;
    continue;
  }
  if (info?.classification === "shipment/reference" || info?.classification === "card-derived list" || isReferenceFile(archivePath)) {
    stats.skippedReferenceFiles++;
    stats.filesSkipped++;
    continue;
  }
  try {
    const records = await parseImportFile(filePath, archivePath);
    stats.filesImported++;
    for (const rawRecord of records) {
      const record = normalizeCustomer({
        ...rawRecord,
        country: rawRecord.country || inferCountry(archivePath, rawRecord.sourceSheet),
        sourceType: SOURCE_TYPE,
        sourceTrust: SOURCE_TRUST,
        sourceFile: archivePath,
        notes: [rawRecord.notes, "Imported from buyer list working SRP archive."].filter(Boolean).join(" ")
      });
      stats.rowsParsed++;
      if (!record.company && !record.email && !record.mobile) continue;
      if (isExcludedCountry(record.country)) {
        stats.skippedPakistanIndia++;
        continue;
      }
      const existing = findExisting(record, existingIndex);
      if (existing) {
        const changed = mergeIntoExisting(existing, record);
        if (changed) {
          existing.updatedAt = now();
          stats.merged++;
        } else {
          stats.skippedDuplicates++;
        }
        continue;
      }
      record.id = crypto.randomUUID();
      record.importId = IMPORT_ID;
      record.createdAt = now();
      record.updatedAt = now();
      record.status = getCustomerStatus(record);
      db.customers.push(record);
      addToIndex(existingIndex, record);
      stats.inserted++;
    }
  } catch (error) {
    stats.failed.push({ file: archivePath, error: String(error.message || error) });
  }
}

db.imports.push({
  id: IMPORT_ID,
  filename: "buyer list working SRP.7z",
  savedPath: "/Users/salmanpiracha/Downloads/buyer list working SRP.7z",
  sourceType: SOURCE_TYPE,
  importMode: "bulk_archive_readable_spreadsheets",
  countryFallback: "",
  importedCount: stats.inserted,
  mergedCount: stats.merged,
  skippedDuplicates: stats.skippedDuplicates,
  createdAt: now()
});
db.events.push({
  id: crypto.randomUUID(),
  type: "bulk_archive_import",
  targetId: IMPORT_ID,
  detail: stats,
  createdAt: now()
});

await fs.writeFile(DB_PATH, `${JSON.stringify(db, null, 2)}\n`);
console.log(JSON.stringify(stats, null, 2));

async function readInventory() {
  const rows = csvRows(await fs.readFile(INVENTORY_PATH, "utf8"));
  const headers = rows.shift().map(normalizeText);
  const map = new Map();
  for (const row of rows) {
    const item = {};
    headers.forEach((header, index) => {
      item[header] = row[index] || "";
    });
    map.set(item.path, item);
  }
  return map;
}

async function listFiles(dir) {
  const output = [];
  for (const name of await fs.readdir(dir)) {
    const full = path.join(dir, name);
    const stat = await fs.stat(full);
    if (stat.isDirectory()) output.push(...await listFiles(full));
    else if (/\.(xlsx|csv)$/i.test(name)) output.push(full);
  }
  return output.sort();
}

function toArchivePath(filePath) {
  return path.relative(EXTRACTED_DIR, filePath).replaceAll(path.sep, "/");
}

async function parseImportFile(filePath, archivePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".csv") return parseCsv(await fs.readFile(filePath, "utf8"), archivePath);
  if (ext === ".xlsx") return parseXlsx(await fs.readFile(filePath), archivePath);
  return [];
}

function parseCsv(text, filename) {
  const rows = csvRows(text);
  if (!rows.length) return [];
  const headers = rows[0].map(normalizeText);
  return rows.slice(1).map((row) => mapRow(headers, row, filename, "CSV")).filter(usefulRecord);
}

async function parseXlsx(buffer, filename) {
  const zip = await JSZip.loadAsync(buffer);
  if (!zip.file("xl/workbook.xml")) return [];
  const workbook = xml2js(await zip.file("xl/workbook.xml").async("text"), { compact: true });
  const rels = xml2js(await zip.file("xl/_rels/workbook.xml.rels").async("text"), { compact: true });
  const sharedStrings = await readSharedStrings(zip);
  const workbookNode = child(workbook, "workbook");
  const sheetsNode = child(workbookNode, "sheets");
  const relsNode = child(rels, "Relationships");
  const sheets = asArray(child(sheetsNode, "sheet"));
  const relMap = new Map(asArray(child(relsNode, "Relationship")).map((rel) => [rel._attributes.Id, rel._attributes.Target]));
  const records = [];

  for (const sheet of sheets) {
    const sheetName = sheet._attributes.name;
    if (/^sheet\d+$/i.test(sheetName)) {
      // These old workbooks often include empty default tabs; the header scan below still handles useful ones.
    }
    const target = relMap.get(sheet._attributes["r:id"]);
    if (!target) continue;
    const sheetFile = zip.file(`xl/${target.replace(/^\/?xl\//, "")}`);
    if (!sheetFile) continue;
    const rows = parseSheetXml(await sheetFile.async("text"), sharedStrings);
    records.push(...sheetRowsToRecords(rows, filename, sheetName));
  }
  return records;
}

async function readSharedStrings(zip) {
  const file = zip.file("xl/sharedStrings.xml");
  if (!file) return [];
  const parsed = xml2js(await file.async("text"), { compact: true });
  const sst = child(parsed, "sst");
  return asArray(child(sst, "si")).map((si) => {
    const directText = child(si, "t");
    if (directText) return xmlText(directText);
    return asArray(child(si, "r")).map((r) => xmlText(child(r, "t"))).join("");
  });
}

function parseSheetXml(xml, sharedStrings) {
  const parsed = xml2js(xml, { compact: true });
  const worksheet = child(parsed, "worksheet");
  const sheetData = child(worksheet, "sheetData");
  return asArray(child(sheetData, "row")).map((row) => {
    const values = [];
    for (const cell of asArray(child(row, "c"))) {
      const ref = cell._attributes?.r || "";
      const col = colIndex(ref.replace(/\d+/g, "")) - 1;
      const type = cell._attributes?.t;
      let value = "";
      if (type === "s") value = sharedStrings[Number(xmlText(child(cell, "v")))] || "";
      else if (type === "inlineStr") value = xmlText(child(child(cell, "is"), "t"));
      else value = xmlText(child(cell, "v"));
      values[col] = value;
    }
    return values;
  });
}

function sheetRowsToRecords(rows, filename, sheetName) {
  const records = [];
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const headers = (rows[i] || []).map(normalizeText);
    if (scoreHeaders(headers) < 2) continue;
    for (const row of rows.slice(i + 1)) {
      const record = mapRow(headers, row || [], filename, sheetName);
      if (usefulRecord(record)) records.push(record);
    }
    break;
  }
  return records;
}

function scoreHeaders(headers) {
  const labels = Object.values(COLUMN_ALIASES).flat();
  return headers.filter((header) => labels.includes(String(header || "").toLowerCase().trim())).length;
}

function mapRow(headers, row, filename, sheetName) {
  const record = { sourceFile: filename, sourceSheet: sheetName, sourceType: SOURCE_TYPE };
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    const idx = headers.findIndex((header) => aliases.includes(String(header || "").toLowerCase().trim()));
    if (idx >= 0) record[field] = row[idx] || "";
  }
  return record;
}

function usefulRecord(record) {
  const company = normalizeText(record.company);
  const hasContact = normalizeText(record.email) || normalizeText(record.mobile) || normalizeText(record.phone) || normalizeText(record.person) || normalizeText(record.website) || normalizeText(record.address);
  return Boolean((company && hasContact) || normalizeText(record.email) || normalizeText(record.mobile));
}

function normalizeCustomer(record) {
  const customer = {};
  for (const key of ["company", "person", "role", "country", "city", "phone", "mobile", "email", "website", "address", "notes", "priority", "sourceType", "sourceId", "sourcePhoto", "sourceFile", "sourceSheet"]) {
    customer[key] = normalizeText(record[key]);
  }
  customer.sourceTrust = Number(record.sourceTrust || SOURCE_TRUST);
  customer.status = getCustomerStatus(customer);
  return customer;
}

function mergeIntoExisting(existing, incoming) {
  let changed = false;
  for (const field of ["company", "person", "role", "country", "city", "phone", "mobile", "email", "website", "address", "priority", "sourceId"]) {
    if (!existing[field] && incoming[field]) {
      existing[field] = incoming[field];
      changed = true;
    }
  }
  if ((existing.sourceTrust || 0) < incoming.sourceTrust && incoming.email && !existing.email) {
    existing.email = incoming.email;
    changed = true;
  }
  if (incoming.notes || incoming.sourceFile) {
    const note = `Archive source: ${incoming.sourceFile}${incoming.sourceSheet ? ` / ${incoming.sourceSheet}` : ""}`;
    if (!String(existing.notes || "").includes(note)) {
      existing.notes = [existing.notes, incoming.notes, note].filter(Boolean).join(" | ");
      changed = true;
    }
  }
  existing.sourceTrust = Math.max(Number(existing.sourceTrust || 0), incoming.sourceTrust);
  existing.status = getCustomerStatus(existing);
  return changed;
}

function buildExistingIndex(customers) {
  const index = new Map();
  for (const customer of customers) addToIndex(index, customer);
  return index;
}

function addToIndex(index, customer) {
  for (const key of recordKeys(customer)) {
    if (!index.has(key)) index.set(key, customer);
  }
}

function findExisting(record, index) {
  for (const key of recordKeys(record)) {
    const found = index.get(key);
    if (found) return found;
  }
  return null;
}

function recordKeys(record) {
  const keys = [];
  for (const email of splitMulti(record.email)) keys.push(`email:${email.toLowerCase()}`);
  const phoneDigits = digits(record.mobile || record.phone);
  if (phoneDigits.length >= 7) keys.push(`phone:${phoneDigits}`);
  if (record.website) keys.push(`web:${slug(record.website)}`);
  const companySlug = slug(record.company);
  const countrySlug = slug(record.country);
  if (companySlug.length > 4 && countrySlug) keys.push(`company:${companySlug}:${countrySlug}`);
  return keys.filter(Boolean);
}

function splitMulti(value) {
  return String(value || "").split(/[;,]/).map((item) => item.trim()).filter(Boolean);
}

function inferCountry(filePath, sheetName) {
  const source = `${filePath} ${sheetName}`.toLowerCase();
  const countries = ["Afghanistan", "Angola", "Bahrain", "Bangladesh", "Belgium", "Benin", "Canada", "China", "Denmark", "Dubai", "Egypt", "France", "Germany", "Indonesia", "Iraq", "Kenya", "Madagascar", "Malaysia", "Mauritius", "Morocco", "Mozambique", "Oman", "Russia", "Singapore", "Somalia", "Sri Lanka", "Sudan", "Tanzania", "Togo", "Uganda", "United Arab Emirates", "Vietnam", "Yemen", "Zimbabwe"];
  for (const country of countries) {
    if (source.includes(country.toLowerCase())) return country === "Dubai" ? "United Arab Emirates" : country;
  }
  if (source.includes("uae") || source.includes("u.a.e")) return "United Arab Emirates";
  if (source.includes("mauratius")) return "Mauritius";
  return "";
}

function isExcludedCountry(country) {
  const value = slug(country);
  return value === "india" || value === "pakistan";
}

function isReferenceFile(filePath) {
  const value = filePath.toLowerCase();
  return value.includes("export data mapco") || value.includes("shipment data") || value.includes("10 exp ");
}

function getCustomerStatus(c) {
  if (c.archivedAt) return "archived";
  if (!c.email && !c.mobile) return "incomplete";
  if (!c.email) return "missing_email";
  if (!c.mobile) return "missing_mobile";
  if ((c.sourceTrust || 0) < 60) return "needs_review";
  return "ready";
}

function csvRows(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === "\"" && quoted && next === "\"") {
      cell += "\"";
      i++;
    } else if (ch === "\"") {
      quoted = !quoted;
    } else if (ch === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((ch === "\n" || ch === "\r") && !quoted) {
      if (ch === "\r" && next === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => normalizeText(c)));
}

function normalizeText(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function now() {
  return new Date().toISOString();
}

function digits(value) {
  return String(value || "").replace(/\D/g, "");
}

function slug(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function child(node, localName) {
  if (!node) return undefined;
  const direct = node[localName];
  if (direct) return direct;
  const key = Object.keys(node).find((name) => name === localName || name.endsWith(`:${localName}`));
  return key ? node[key] : undefined;
}

function xmlText(node) {
  if (!node) return "";
  if (typeof node._text === "string") return node._text;
  if (typeof node === "string") return node;
  return "";
}

function colIndex(col) {
  let index = 0;
  for (const ch of col) index = index * 26 + ch.charCodeAt(0) - 64;
  return index;
}
