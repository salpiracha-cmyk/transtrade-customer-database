import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, "..");
const dbPath = process.env.BUYER_APP_DB_PATH || path.join(rootDir, "data", "database.json");
const dryRun = process.argv.includes("--dry-run");
const db = JSON.parse(await fs.readFile(dbPath, "utf8"));
const customers = db.customers || [];
const contexts = new Map();
const changes = [];

for (let index = 0; index < customers.length; index++) {
  const customer = customers[index];
  if (customer.archivedAt) continue;
  if (isRowContextUnsafeSource(customer)) continue;
  const key = sourceKey(customer);
  const company = normalizeText(customer.company);
  if (company) {
    contexts.set(key, contextFrom(customer, index));
    continue;
  }
  const context = contexts.get(key);
  if (!context || !isContinuationCustomer(customer, context, index)) continue;
  const filled = [];
  for (const field of ["company", "country", "city", "address", "website"]) {
    if (!normalizeText(customer[field]) && normalizeText(context[field])) {
      if (!dryRun) customer[field] = context[field];
      filled.push(field);
    }
  }
  if (filled.length) {
    const note = `Company details inherited from nearby workbook row for ${context.company}.`;
    if (!dryRun) {
      customer.notes = appendNote(customer.notes, note);
      customer.updatedAt = new Date().toISOString();
    }
    changes.push({
      id: customer.id,
      sourceFile: customer.sourceFile || "",
      sourceSheet: customer.sourceSheet || "",
      company: context.company,
      person: customer.person || "",
      email: customer.email || "",
      mobile: customer.mobile || "",
      phone: customer.phone || "",
      filled: filled.join("; ")
    });
  }
}

if (!dryRun && changes.length) {
  db.events ||= [];
  db.events.push({
    id: cryptoRandomId(),
    type: "workbook_row_context_applied",
    subjectId: "database",
    details: { changed: changes.length },
    createdAt: new Date().toISOString()
  });
  await fs.writeFile(dbPath, `${JSON.stringify(db, null, 2)}\n`);
}

console.log(JSON.stringify({
  dryRun,
  changed: changes.length,
  sample: changes.slice(0, 20)
}, null, 2));

function sourceKey(customer) {
  return [customer.importId || "", customer.sourceType || "", customer.sourceFile || "", customer.sourceSheet || ""].join("|");
}

function contextFrom(customer, index) {
  return {
    index,
    company: normalizeText(customer.company),
    country: normalizeText(customer.country),
    city: normalizeText(customer.city),
    address: normalizeText(customer.address),
    website: normalizeText(customer.website),
    sourceFile: normalizeText(customer.sourceFile),
    sourceSheet: normalizeText(customer.sourceSheet)
  };
}

function isContinuationCustomer(customer, context, index) {
  if (isRowContextUnsafeSource(customer)) return false;
  if (normalizeText(customer.company)) return false;
  if (index - context.index < 1 || index - context.index > 8) return false;
  if (!normalizeText(customer.email) && !normalizeText(customer.mobile) && !normalizeText(customer.phone) && !normalizeText(customer.person)) return false;
  const person = normalizeText(customer.person);
  if (person && isValidEmail(person)) return false;
  if (looksLikeSystemContact(person) || looksLikeSystemContact(customer.email)) return false;
  if (normalizeText(customer.mobile) || normalizeText(customer.phone)) return true;
  if (person && !looksLikeCompanyName(person)) return true;
  return emailMatchesCompanyContext(customer.email, context);
}

function isRowContextUnsafeSource(customer) {
  const sourceType = normalizeText(customer.sourceType);
  const sourceFile = normalizeText(customer.sourceFile);
  return sourceType === "card_master"
    || sourceFile === "TTI_Sales_Master.xlsx"
    || sourceFile.endsWith("ALL TRANSTRADE1 CONTACTS.csv");
}

function looksLikeCompanyName(value) {
  return /\b(ltd|limited|llc|company|co\.|trading|trade|imports?|exports?|group|international|foods?)\b/i.test(String(value || ""));
}

function looksLikeSystemContact(value) {
  return /\b(noreply|no-reply|hostmaster|postmaster|webmaster|alerts?|booking|accounts department|google alerts)\b/i.test(String(value || ""));
}

function emailMatchesCompanyContext(email, context) {
  const firstEmail = splitFirst(email).toLowerCase();
  if (!isValidEmail(firstEmail)) return false;
  const domain = firstEmail.split("@")[1] || "";
  const companySlug = slug(context.company);
  const websiteSlug = slug(String(context.website || "").replace(/^https?:\/\//i, "").split("/")[0]);
  const domainSlug = slug(domain.replace(/\.[a-z]{2,}(\.[a-z]{2})?$/i, ""));
  return Boolean(domainSlug && (companySlug.includes(domainSlug) || domainSlug.includes(companySlug) || (websiteSlug && websiteSlug.includes(domainSlug))));
}

function splitFirst(value) {
  return String(value || "").split(/[;,]/)[0].trim();
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(value || ""));
}

function appendNote(existing, note) {
  const text = normalizeText(existing);
  return text.includes(note) ? text : [text, note].filter(Boolean).join(" ");
}

function normalizeText(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function slug(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function cryptoRandomId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
