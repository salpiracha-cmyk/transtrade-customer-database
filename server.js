import http from "node:http";
import fs from "node:fs/promises";
import fssync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import JSZip from "jszip";
import { xml2js } from "xml-js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
loadLocalEnv(path.join(__dirname, ".env"));
const PORT = Number(process.env.PORT || 3000);
const DB_PATH = path.join(__dirname, "data", "database.json");
const PUBLIC_DIR = path.join(__dirname, "public");
const IMPORT_DIR = path.join(__dirname, "imports");
const CARD_DIR = path.join(__dirname, "uploads", "cards");
const OCR_SCRIPT = path.join(__dirname, "scripts", "ocr_vision.swift");
const HOST = process.env.HOST || "0.0.0.0";
const OLLAMA_URL = (process.env.OLLAMA_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
const OLLAMA_VISION_MODEL = process.env.OLLAMA_VISION_MODEL || "moondream";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const RESEND_FROM_NAME = process.env.RESEND_FROM_NAME || "Transtrade International";
const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL || "business@outreach.transtradeinternational.com";
const RESEND_DOMAIN = process.env.RESEND_DOMAIN || "outreach.transtradeinternational.com";
const OUTREACH_SEND_ENABLED = process.env.OUTREACH_SEND_ENABLED === "true";
const OUTREACH_SEND_GAP_MS = Number(process.env.OUTREACH_SEND_GAP_MS || 300000);
const APP_USER = process.env.APP_USER || "tti";
const APP_PASSWORD = process.env.APP_PASSWORD || "";
const execFileAsync = promisify(execFile);
let outreachProcessing = false;

const SOURCE_TRUST = {
  "clean_excel": 100,
  "manual": 90,
  "verified_country_workbook": 85,
  "archive_buyer_list": 75,
  "card_master": 60,
  "card_ocr": 45,
  "internet_research": 35,
  "ai_suggestion": 20
};

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

const COLUMN_ALIASES = {
  company: ["company", "company name", "company name.", "customer", "buyer company name", "name of company in english", "importer", "buyer name"],
  person: ["person", "contact person", "contact person:", "attn", "attn person.", "buyer name", "focal person details", "manager / decision maker"],
  role: ["role", "designation", "job title", "nature of business"],
  country: ["country", "country/region", "home country/region", "city/country", "loacation / country"],
  city: ["city", "home city", "location", "city/state"],
  phone: ["phone", "phone as printed", "tel", "tel no", "tel no.", "telephone", "telephone #", "telephone contact", "office tel", "phone / office"],
  mobile: ["mobile", "mobile as printed", "mobile no.", "mobile no", "cell", "cell #", "cell #(+ = 261)", "mobile phone", "mobil"],
  email: ["email", "e-mail", "email address", "email address.", "e-mail address.", "email from card/note", "best email", "best email (updated)", "updated email", "e mail address", "e.mail"],
  website: ["website", "official website", "official website", "web", "web address", "web page"],
  address: ["address", "postal address", "home street", "buyer address"],
  notes: ["notes", "remarks", "note.", "card/handwriting notes", "historical channel status"],
  priority: ["priority", "trade", "rice relevance / priority"],
  sourceId: ["contact id", "source id"],
  sourcePhoto: ["photo", "source photo", "source image"]
};

startServer().catch((error) => {
  console.error("Failed to start Transtrade Customer Database", error);
  process.exit(1);
});

async function startServer() {
  await ensureDirs();
  await ensureDb();

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (isPublicUnsubscribeRoute(url)) {
        await handlePublicUnsubscribe(req, res, url);
        return;
      }
      if (APP_PASSWORD && !isAuthorized(req)) {
        requestAuth(res);
        return;
      }
      if (url.pathname.startsWith("/api/")) {
        await handleApi(req, res, url);
        return;
      }
      await serveStatic(req, res, url);
    } catch (error) {
      console.error(error);
      sendJson(res, 500, { error: "Server error", detail: String(error.message || error) });
    }
  });

  server.listen(PORT, HOST, () => {
    console.log(`Transtrade Customer Database running at http://${HOST}:${PORT}`);
  });
  setInterval(() => {
    processOutreachQueue().catch((error) => console.error("Outreach queue error", error));
  }, 15000).unref();
  processOutreachQueue().catch((error) => console.error("Outreach queue error", error));
}

function isPublicUnsubscribeRoute(url) {
  return url.pathname === "/unsubscribe" || url.pathname === "/api/unsubscribe";
}

function isAuthorized(req) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Basic ")) return false;
  const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  const separator = decoded.indexOf(":");
  if (separator === -1) return false;
  const user = decoded.slice(0, separator);
  const password = decoded.slice(separator + 1);
  return user === APP_USER && password === APP_PASSWORD;
}

function requestAuth(res) {
  res.writeHead(401, {
    "www-authenticate": 'Basic realm="Transtrade Customer Database"',
    "content-type": "text/plain; charset=utf-8"
  });
  res.end("Login required");
}

async function ensureDirs() {
  await fs.mkdir(path.dirname(DB_PATH), { recursive: true });
  await fs.mkdir(IMPORT_DIR, { recursive: true });
  await fs.mkdir(CARD_DIR, { recursive: true });
}

async function ensureDb() {
  if (!fssync.existsSync(DB_PATH)) {
    await writeDb({ customers: [], imports: [], events: [], suppressions: [], campaigns: [] });
  }
}

async function readDb() {
  return JSON.parse(await fs.readFile(DB_PATH, "utf8"));
}

async function writeDb(db) {
  await fs.writeFile(DB_PATH, `${JSON.stringify(db, null, 2)}\n`);
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/summary") {
    const db = await readDb();
    sendJson(res, 200, buildSummary(db));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/customers") {
    const db = await readDb();
    const country = url.searchParams.get("country");
    const status = url.searchParams.get("status");
    const contact = url.searchParams.get("contact");
    const quality = url.searchParams.get("quality");
    const sourceType = url.searchParams.get("sourceType");
    const category = url.searchParams.get("category");
    const query = (url.searchParams.get("q") || "").toLowerCase();
    const includeArchived = url.searchParams.get("archived") === "1";
    let customers = db.customers;
    if (!includeArchived) customers = customers.filter((c) => !c.archivedAt);
    if (country) customers = customers.filter((c) => normalizeCountryName(c.country) === normalizeCountryName(country));
    if (status) customers = customers.filter((c) => getCustomerStatus(c) === status);
    if (contact) customers = customers.filter((c) => contactMatches(c, contact));
    if (quality) customers = customers.filter((c) => getDataQuality(c) === quality);
    if (sourceType) customers = customers.filter((c) => c.sourceType === sourceType);
    if (category) customers = customers.filter((c) => categoryMatches(c, category));
    if (query) {
      customers = customers.filter((c) => [c.company, c.person, c.email, c.mobile, c.phone, c.country, c.city, c.role].some((v) => String(v || "").toLowerCase().includes(query)));
    }
    customers = sortCustomerList(customers).map(withCustomerCategory);
    sendJson(res, 200, { customers: customers.slice(0, 1000), total: customers.length });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/customers") {
    const body = await readJson(req);
    const db = await readDb();
    const customer = normalizeCustomer({
      ...body,
      sourceType: body.sourceType || "manual",
      sourceTrust: SOURCE_TRUST[body.sourceType || "manual"] || 70
    });
    customer.id = crypto.randomUUID();
    customer.createdAt = now();
    customer.updatedAt = now();
    db.customers.push(customer);
    db.events.push(event("customer_created", customer.id, { sourceType: customer.sourceType }));
    await writeDb(db);
    sendJson(res, 201, { customer });
    return;
  }

  const customerMatch = url.pathname.match(/^\/api\/customers\/([^/]+)$/);
  if (customerMatch && req.method === "PATCH") {
    const id = customerMatch[1];
    const body = await readJson(req);
    const db = await readDb();
    const customer = db.customers.find((c) => c.id === id);
    if (!customer) return sendJson(res, 404, { error: "Customer not found" });
    Object.assign(customer, normalizeCustomer({ ...customer, ...body }), { updatedAt: now() });
    db.events.push(event("customer_updated", id, { fields: Object.keys(body) }));
    await writeDb(db);
    sendJson(res, 200, { customer });
    return;
  }

  if (customerMatch && req.method === "DELETE") {
    const id = customerMatch[1];
    const db = await readDb();
    const customer = db.customers.find((c) => c.id === id);
    if (!customer) return sendJson(res, 404, { error: "Customer not found" });
    customer.archivedAt = now();
    customer.updatedAt = now();
    db.events.push(event("customer_archived", id, {}));
    await writeDb(db);
    sendJson(res, 200, { customer });
    return;
  }

  if (customerMatch && req.method === "POST" && url.searchParams.get("restore") === "1") {
    const id = customerMatch[1];
    const db = await readDb();
    const customer = db.customers.find((c) => c.id === id);
    if (!customer) return sendJson(res, 404, { error: "Customer not found" });
    delete customer.archivedAt;
    customer.updatedAt = now();
    db.events.push(event("customer_restored", id, {}));
    await writeDb(db);
    sendJson(res, 200, { customer });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/duplicates") {
    const db = await readDb();
    const type = url.searchParams.get("type") || "all";
    const limit = Number(url.searchParams.get("limit") || 250);
    const groups = findDuplicates(db.customers.filter((c) => !c.archivedAt), { type, limit, ignored: db.ignoredDuplicates || [] });
    sendJson(res, 200, { groups, total: groups.length, type });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/company-contacts") {
    const db = await readDb();
    const q = (url.searchParams.get("q") || "").toLowerCase();
    const limit = Number(url.searchParams.get("limit") || 200);
    const groups = findCompanyContactGroups(db.customers.filter((c) => !c.archivedAt), { q, limit });
    sendJson(res, 200, { groups, total: groups.length });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/ai/status") {
    sendJson(res, 200, await getAiStatus());
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/outreach/status") {
    const db = await readDb();
    sendJson(res, 200, buildOutreachStatus(db));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/outreach/preview") {
    const db = await readDb();
    const country = url.searchParams.get("country") || "";
    const recipients = getOutreachRecipients(db, { country });
    sendJson(res, 200, {
      country,
      total: recipients.length,
      recipients: recipients.slice(0, 50).map((item) => ({
        customerId: item.customer.id,
        company: item.customer.company || "",
        person: item.customer.person || "",
        country: item.customer.country || "",
        email: item.email
      }))
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/outreach/draft") {
    const body = await readJson(req);
    const country = normalizeCountryName(body.country || "");
    const draft = await draftOutreachEmail({ country, purpose: body.purpose || "" });
    sendJson(res, 200, draft);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/outreach/test") {
    const body = await readJson(req);
    const db = await readDb();
    const country = normalizeCountryName(body.country || "");
    const testEmail = normalizeEmail(body.testEmail || "");
    if (!testEmail) return sendJson(res, 400, { error: "Test email is required" });
    const recipients = getOutreachRecipients(db, { country });
    if (!recipients.length) return sendJson(res, 400, { error: "No eligible buyer emails for this country" });
    const sample = recipients[0];
    const sent = await sendOutreachEmail({
      to: testEmail,
      cc: splitEmails(body.cc || ""),
      subject: normalizeText(body.subject || ""),
      body: normalizeMultilineText(body.body || ""),
      customer: sample.customer,
      campaignId: "test",
      itemId: crypto.randomUUID(),
      testMode: true
    });
    db.events.push(event("outreach_test_sent", testEmail, { country, subject: body.subject || "", providerId: sent.id || "" }));
    await writeDb(db);
    sendJson(res, 200, { sent: true, to: testEmail, providerId: sent.id || "" });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/outreach/campaigns") {
    const body = await readJson(req);
    const db = await readDb();
    const country = normalizeCountryName(body.country || "");
    const subject = normalizeText(body.subject || "");
    const emailBody = normalizeMultilineText(body.body || "");
    if (!country) return sendJson(res, 400, { error: "Country is required" });
    if (!subject || !emailBody) return sendJson(res, 400, { error: "Subject and email body are required" });
    if (body.confirmed !== true) return sendJson(res, 400, { error: "Confirm the campaign after sending a test email" });
    if (!RESEND_API_KEY) return sendJson(res, 400, { error: "Resend API key is not configured" });
    const recipients = getOutreachRecipients(db, { country });
    if (!recipients.length) return sendJson(res, 400, { error: "No eligible buyer emails for this country" });
    const campaignId = crypto.randomUUID();
    const startAt = Date.now();
    const cc = splitEmails(body.cc || "");
    const items = recipients.map((recipient, index) => ({
      id: crypto.randomUUID(),
      customerId: recipient.customer.id,
      to: recipient.email,
      cc,
      status: "queued",
      scheduledAt: new Date(startAt + index * OUTREACH_SEND_GAP_MS).toISOString(),
      attempts: 0
    }));
    const campaign = {
      id: campaignId,
      country,
      subject,
      body: emailBody,
      cc,
      status: "queued",
      sendGapMinutes: OUTREACH_SEND_GAP_MS / 60000,
      total: items.length,
      sent: 0,
      failed: 0,
      skipped: 0,
      createdAt: now(),
      updatedAt: now(),
      items
    };
    db.campaigns ||= [];
    db.campaigns.push(campaign);
    db.events.push(event("outreach_campaign_created", campaignId, { country, total: items.length, gapMs: OUTREACH_SEND_GAP_MS }));
    await writeDb(db);
    processOutreachQueue().catch((error) => console.error("Outreach queue error", error));
    sendJson(res, 201, { campaign: campaignSummary(campaign) });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/outreach/campaigns") {
    const db = await readDb();
    const campaigns = (db.campaigns || []).slice(-10).reverse().map(campaignSummary);
    sendJson(res, 200, { campaigns });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/admin/restore-database") {
    const contentType = req.headers["content-type"] || "";
    if (!contentType.includes("multipart/form-data")) return sendJson(res, 400, { error: "Use multipart/form-data" });
    const upload = await readMultipart(req, contentType);
    const file = upload.files.file;
    if (!file) return sendJson(res, 400, { error: "Missing file field" });
    const restored = JSON.parse(file.data.toString("utf8"));
    if (!Array.isArray(restored.customers)) return sendJson(res, 400, { error: "Database file must include a customers array" });
    const restoreMode = upload.fields.mode || url.searchParams.get("mode") || "full";
    const current = await readDb();
    const nextDb = restoreMode === "customers"
      ? {
          ...current,
          customers: restored.customers || [],
          imports: restored.imports || [],
          ignoredDuplicates: restored.ignoredDuplicates || current.ignoredDuplicates || []
        }
      : {
          customers: restored.customers || [],
          imports: restored.imports || [],
          events: restored.events || [],
          suppressions: restored.suppressions || [],
          campaigns: restored.campaigns || [],
          ignoredDuplicates: restored.ignoredDuplicates || []
        };
    nextDb.events ||= [];
    nextDb.suppressions ||= [];
    nextDb.campaigns ||= [];
    nextDb.ignoredDuplicates ||= [];
    const backupName = `database.backup-before-live-restore-${Date.now()}.json`;
    const backupPath = path.join(path.dirname(DB_PATH), backupName);
    if (fssync.existsSync(DB_PATH)) await fs.copyFile(DB_PATH, backupPath);
    nextDb.events.push(event("database_restored", "admin", {
      filename: file.filename,
      customers: nextDb.customers.length,
      backup: backupName,
      mode: restoreMode
    }));
    await writeDb(nextDb);
    sendJson(res, 200, {
      restored: true,
      mode: restoreMode,
      customers: nextDb.customers.length,
      suppressions: nextDb.suppressions.length,
      campaigns: nextDb.campaigns.length,
      backup: backupName
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/cards/extract") {
    const body = await readJson(req);
    const filename = path.basename(String(body.path || body.filename || ""));
    if (!filename) return sendJson(res, 400, { error: "Missing card photo path" });
    const savedPath = path.join(CARD_DIR, filename);
    if (!savedPath.startsWith(CARD_DIR) || !fssync.existsSync(savedPath)) {
      return sendJson(res, 404, { error: "Card photo not found" });
    }
    const ai = await runBestCardAi(savedPath, "", 120000);
    sendJson(res, 200, {
      path: `uploads/cards/${filename}`,
      filename,
      ocrStatus: "skipped",
      ocrText: "",
      ...ai,
      extracted: mergeExtractedFields({}, ai.aiExtracted)
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/duplicates/keep-separate") {
    const body = await readJson(req);
    const ids = [...new Set(body.ids || [])].filter(Boolean).sort();
    if (ids.length < 2) return sendJson(res, 400, { error: "Need at least two ids to keep separate" });
    const db = await readDb();
    db.ignoredDuplicates ||= [];
    const signature = duplicateSignature(ids);
    if (!db.ignoredDuplicates.some((item) => item.signature === signature)) {
      db.ignoredDuplicates.push({
        id: crypto.randomUUID(),
        signature,
        ids,
        reason: normalizeText(body.reason || "Valid separate contacts"),
        createdAt: now()
      });
    }
    db.events.push(event("duplicates_kept_separate", signature, { ids, reason: body.reason || "" }));
    await writeDb(db);
    sendJson(res, 200, { signature, ids });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/duplicates/merge") {
    const body = await readJson(req);
    const db = await readDb();
    const result = mergeCustomers(db, body.ids || [], body.primaryId || "");
    if (!result) return sendJson(res, 400, { error: "Need at least two active customer ids to merge" });
    db.events.push(event("customers_merged", result.primary.id, {
      mergedIds: result.mergedIds,
      primaryId: result.primary.id
    }));
    await writeDb(db);
    sendJson(res, 200, result);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/import") {
    const contentType = req.headers["content-type"] || "";
    if (!contentType.includes("multipart/form-data")) return sendJson(res, 400, { error: "Use multipart/form-data" });
    const upload = await readMultipart(req, contentType);
    const file = upload.files.file;
    if (!file) return sendJson(res, 400, { error: "Missing file field" });
    const sourceType = upload.fields.sourceType || "clean_excel";
    const countryFallback = upload.fields.country || "";
    const importMode = upload.fields.importMode || "generic";
    const savedName = `${Date.now()}-${sanitizeFileName(file.filename)}`;
    const savedPath = path.join(IMPORT_DIR, savedName);
    await fs.writeFile(savedPath, file.data);

    const records = (await parseImportFile(savedPath, file.filename, { sourceType, countryFallback, importMode }))
      .filter((record) => !isTemporarilyExcludedRecord(record, importMode));
    const db = await readDb();
    const importId = crypto.randomUUID();
    const customers = records.map((record) => ({
      ...normalizeCustomer(record),
      id: crypto.randomUUID(),
      importId,
      sourceType,
      sourceTrust: SOURCE_TRUST[sourceType] || 50,
      createdAt: now(),
      updatedAt: now()
    }));
    db.customers.push(...customers);
    db.imports.push({
      id: importId,
      filename: file.filename,
      savedPath,
      sourceType,
      importMode,
      countryFallback,
      importedCount: customers.length,
      createdAt: now()
    });
    db.events.push(event("import_created", importId, { filename: file.filename, importedCount: customers.length, sourceType }));
    await writeDb(db);
    sendJson(res, 201, { importId, importedCount: customers.length, duplicates: findDuplicates(db.customers.filter((c) => !c.archivedAt)).length });
    return;
  }

  if (req.method === "POST" && (url.pathname === "/api/cards" || url.pathname === "/api/cards/ocr")) {
    const contentType = req.headers["content-type"] || "";
    if (!contentType.includes("multipart/form-data")) return sendJson(res, 400, { error: "Use multipart/form-data" });
    const upload = await readMultipart(req, contentType);
    const file = upload.files.file;
    if (!file) return sendJson(res, 400, { error: "Missing file field" });
    const savedName = `${Date.now()}-${sanitizeFileName(file.filename)}`;
    const savedPath = path.join(CARD_DIR, savedName);
    await fs.writeFile(savedPath, file.data);
    if (url.pathname === "/api/cards/ocr") {
      const quick = url.searchParams.get("quick") === "1";
      if (quick) {
        sendJson(res, 201, {
          path: `uploads/cards/${savedName}`,
          filename: file.filename,
          ocrStatus: "skipped",
          aiStatus: "skipped",
          extracted: {
            notes: "Card photo saved. Fill the details from the preview."
          },
          message: "Card saved for manual review."
        });
        return;
      }
      const ocr = await runCardOcr(savedPath);
      const ai = await runCardAi(savedPath, ocr.ocrText);
      sendJson(res, 201, {
        path: `uploads/cards/${savedName}`,
        filename: file.filename,
        ...ocr,
        ...ai,
        extracted: mergeExtractedFields(ocr.extracted, ai.aiExtracted)
      });
      return;
    }
    sendJson(res, 201, { path: `uploads/cards/${savedName}`, filename: file.filename });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/export.xlsx") {
    const db = await readDb();
    const customers = filterCustomers(db.customers, url);
    const label = exportLabel(url);
    const buffer = await buildXlsx(customers, label);
    res.writeHead(200, {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${sanitizeFileName(label || "customers")}.xlsx"`
    });
    res.end(buffer);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/export.vcf") {
    const db = await readDb();
    const id = url.searchParams.get("id");
    let customers = filterCustomers(db.customers, url);
    if (id) customers = customers.filter((c) => c.id === id);
    const body = buildVcf(customers);
    res.writeHead(200, {
      "content-type": "text/vcard; charset=utf-8",
      "content-disposition": `attachment; filename="${id ? "customer" : sanitizeFileName(exportLabel(url) || "contacts")}.vcf"`
    });
    res.end(body);
    return;
  }

  sendJson(res, 404, { error: "Not found" });
}

async function serveStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname.startsWith("/uploads/cards/")) {
    await serveCardUpload(req, res, pathname);
    return;
  }
  if (pathname === "/") pathname = "/index.html";
  const safe = path.normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  let filePath = path.join(PUBLIC_DIR, safe);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  if (!fssync.existsSync(filePath)) {
    filePath = path.join(PUBLIC_DIR, "index.html");
  }
  const ext = path.extname(filePath).toLowerCase();
  const types = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml"
  };
  res.writeHead(200, {
    "content-type": types[ext] || "application/octet-stream",
    "cache-control": "no-store"
  });
  res.end(await fs.readFile(filePath));
}

async function serveCardUpload(req, res, pathname) {
  const filename = path.basename(pathname);
  const filePath = path.join(CARD_DIR, filename);
  if (!filePath.startsWith(CARD_DIR) || !fssync.existsSync(filePath)) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  const types = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".heic": "image/heic",
    ".heif": "image/heif"
  };
  res.writeHead(200, {
    "content-type": types[ext] || "application/octet-stream",
    "cache-control": "no-store"
  });
  res.end(await fs.readFile(filePath));
}

async function runCardOcr(imagePath) {
  if (!fssync.existsSync(OCR_SCRIPT) || !fssync.existsSync("/usr/bin/swift")) {
    return { ocrStatus: "unavailable", ocrText: "", extracted: {}, message: "Local OCR is not available on this machine." };
  }
  try {
    const { stdout } = await execFileAsync("/usr/bin/swift", [OCR_SCRIPT, imagePath], {
      timeout: 8000,
      maxBuffer: 1024 * 1024 * 2
    });
    const ocrText = normalizeOcrText(stdout);
    return {
      ocrStatus: ocrText ? "ok" : "empty",
      ocrText,
      extracted: extractCardFields(ocrText)
    };
  } catch (error) {
    return {
      ocrStatus: "error",
      ocrText: "",
      extracted: {},
      message: error.killed || error.signal === "SIGTERM"
        ? "Local OCR was too slow, so the card was saved for AI/manual review."
        : String(error.stderr || error.message || error)
    };
  }
}

async function getAiStatus() {
  if (OPENAI_API_KEY) {
    return {
      aiStatus: "ready",
      aiModel: OPENAI_MODEL,
      aiProvider: "openai",
      message: "OpenAI card reader is ready for sharper phone-card extraction."
    };
  }
  if (GEMINI_API_KEY) {
    return {
      aiStatus: "ready",
      aiModel: GEMINI_MODEL,
      aiProvider: "gemini",
      message: "Gemini card reader is ready for sharper phone-card extraction."
    };
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const response = await fetch(`${OLLAMA_URL}/api/tags`, { signal: controller.signal });
    clearTimeout(timeout);
    if (!response.ok) return { aiStatus: "error", aiModel: OLLAMA_VISION_MODEL, message: `Ollama returned HTTP ${response.status}` };
    const body = await response.json();
    const models = (body.models || []).map((model) => model.name).filter(Boolean);
    const exact = models.includes(OLLAMA_VISION_MODEL);
    const familyMatch = models.some((name) => name.split(":")[0] === OLLAMA_VISION_MODEL.split(":")[0]);
    return {
      aiStatus: exact || familyMatch ? "ready" : "model_missing",
      aiModel: OLLAMA_VISION_MODEL,
      ollamaUrl: OLLAMA_URL,
      models,
      message: exact || familyMatch
        ? "Free local AI is ready for card photos."
        : `Ollama is running, but ${OLLAMA_VISION_MODEL} is not installed.`
    };
  } catch (error) {
    return {
      aiStatus: "unavailable",
      aiModel: OLLAMA_VISION_MODEL,
      ollamaUrl: OLLAMA_URL,
      models: [],
      message: "Free local AI is not running on this PC yet."
    };
  }
}

async function runBestCardAi(imagePath, ocrText = "", timeoutMs = 120000) {
  if (OPENAI_API_KEY) {
    const openai = await runOpenAiCardAi(imagePath, ocrText, timeoutMs);
    if (openai.aiStatus === "ok") return openai;
    if (!GEMINI_API_KEY) return openai;
  }
  if (GEMINI_API_KEY) {
    const gemini = await runGeminiCardAi(imagePath, ocrText, timeoutMs);
    if (gemini.aiStatus === "ok") return gemini;
    return gemini;
  }
  return runCardAi(imagePath, ocrText, timeoutMs);
}

async function runOpenAiCardAi(imagePath, ocrText = "", timeoutMs = 60000) {
  try {
    const imageBase64 = await fs.readFile(imagePath, "base64");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "authorization": `Bearer ${OPENAI_API_KEY}`,
        "content-type": "application/json"
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0,
        response_format: { type: "json_object" },
        max_tokens: 700,
        messages: [{
          role: "user",
          content: [
            {
              type: "text",
              text: [
                "Extract business-card contact data for a customer database.",
                "Return only one JSON object with these string keys:",
                "company, person, role, country, city, mobile, phone, email, website, address, notes.",
                "Use empty strings when unknown. Do not invent email, phone, country, or person names.",
                "Read sideways or rotated cards. Pay special attention to small printed Tel, Cell, Mobile, Email, Web, and Address lines.",
                "Copy phone numbers, emails, websites, and addresses exactly when readable.",
                "Put WhatsApp/mobile numbers in mobile and landline numbers in phone.",
                "If a printed line contains multiple emails or numbers, separate them with semicolons.",
                ocrText ? `Existing OCR text to cross-check:\n${ocrText}` : ""
              ].filter(Boolean).join("\n")
            },
            {
              type: "image_url",
              image_url: {
                url: `data:${imageMimeType(imagePath)};base64,${imageBase64}`,
                detail: "high"
              }
            }
          ]
        }]
      })
    });
    clearTimeout(timeout);
    const bodyText = await response.text();
    if (!response.ok) {
      const errorMessage = parseOpenAiError(bodyText) || `OpenAI returned HTTP ${response.status}`;
      return { aiStatus: "error", aiModel: OPENAI_MODEL, aiProvider: "openai", aiExtracted: {}, message: errorMessage };
    }
    const body = JSON.parse(bodyText);
    const text = body.choices?.[0]?.message?.content || "";
    const parsed = parseAiJson(text);
    return {
      aiStatus: parsed ? "ok" : "empty",
      aiModel: body.model || OPENAI_MODEL,
      aiProvider: "openai",
      aiExtracted: parsed || {},
      aiText: text
    };
  } catch (error) {
    const message = error.name === "AbortError"
      ? "OpenAI took too long on this card, so the app used the fallback reader."
      : "OpenAI is not available from this server PC right now.";
    return { aiStatus: "unavailable", aiModel: OPENAI_MODEL, aiProvider: "openai", aiExtracted: {}, message };
  }
}

function parseOpenAiError(text) {
  try {
    return JSON.parse(text)?.error?.message || "";
  } catch {
    return String(text || "").slice(0, 240);
  }
}

async function runGeminiCardAi(imagePath, ocrText = "", timeoutMs = 60000) {
  try {
    const imageBase64 = await fs.readFile(imagePath, "base64");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        generationConfig: {
          response_mime_type: "application/json",
          temperature: 0
        },
        contents: [{
          parts: [
            {
              text: [
                "Extract business-card contact data for a customer database.",
                "Return only one JSON object with these string keys:",
                "company, person, role, country, city, mobile, phone, email, website, address, notes.",
                "Use empty strings when unknown. Do not invent email, phone, country, or person names.",
                "Read sideways or rotated cards. Pay special attention to small printed Tel, Cell, Mobile, Email, Web, and Address lines.",
                "Copy phone numbers, emails, and websites exactly when readable.",
                "Put WhatsApp/mobile numbers in mobile and landline numbers in phone.",
                ocrText ? `Existing OCR text to cross-check:\n${ocrText}` : ""
              ].filter(Boolean).join("\n")
            },
            {
              inline_data: {
                mime_type: imageMimeType(imagePath),
                data: imageBase64
              }
            }
          ]
        }]
      })
    });
    clearTimeout(timeout);
    if (!response.ok) {
      return { aiStatus: "error", aiModel: GEMINI_MODEL, aiProvider: "gemini", aiExtracted: {}, message: `Gemini returned HTTP ${response.status}` };
    }
    const body = await response.json();
    const text = (body.candidates || [])
      .flatMap((candidate) => candidate.content?.parts || [])
      .map((part) => part.text || "")
      .join("\n")
      .trim();
    const parsed = parseAiJson(text);
    return {
      aiStatus: parsed ? "ok" : "empty",
      aiModel: GEMINI_MODEL,
      aiProvider: "gemini",
      aiExtracted: parsed || {},
      aiText: text
    };
  } catch (error) {
    const message = error.name === "AbortError"
      ? "Gemini took too long on this card, so the app used the fallback reader."
      : "Gemini is not available from this server PC right now.";
    return { aiStatus: "unavailable", aiModel: GEMINI_MODEL, aiProvider: "gemini", aiExtracted: {}, message };
  }
}

async function runCardAi(imagePath, ocrText = "", timeoutMs = 18000) {
  try {
    const imageBase64 = await fs.readFile(imagePath, "base64");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: OLLAMA_VISION_MODEL,
        stream: false,
        format: "json",
        keep_alive: "10m",
        options: {
          num_ctx: 1024,
          num_predict: 260,
          temperature: 0
        },
        images: [imageBase64],
        prompt: [
          "Extract business-card contact data for a customer database.",
          "Return only one JSON object with these string keys:",
          "company, person, role, country, city, mobile, phone, email, website, address, notes.",
          "Use empty strings when unknown. Do not invent email, phone, country, or person names.",
          "Put WhatsApp/mobile numbers in mobile and landline numbers in phone.",
          "Read the card even if it is sideways or rotated.",
          "Pay special attention to small printed Tel, Cell, Mobile, Email, Web, and Address lines.",
          "Copy phone numbers, emails, and websites exactly when readable.",
          "If the image is unclear, fill only fields you can read confidently.",
          ocrText ? `Existing OCR text to cross-check:\n${ocrText}` : ""
        ].filter(Boolean).join("\n")
      })
    });
    clearTimeout(timeout);
    if (!response.ok) {
      return { aiStatus: "error", aiModel: OLLAMA_VISION_MODEL, message: `Free local AI returned HTTP ${response.status}` };
    }
    const body = await response.json();
    const parsed = parseAiJson(body.response || "");
    return {
      aiStatus: parsed ? "ok" : "empty",
      aiModel: body.model || OLLAMA_VISION_MODEL,
      aiExtracted: parsed || {},
      aiText: body.response || ""
    };
  } catch (error) {
    const message = error.name === "AbortError"
      ? "Free local AI is still too slow on this card, so the photo was saved for manual review."
      : "Free local AI is not available yet. Install/start Ollama on the server PC to enable it.";
    return { aiStatus: "unavailable", aiModel: OLLAMA_VISION_MODEL, aiExtracted: {}, message };
  }
}

function imageMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".heic") return "image/heic";
  if (ext === ".heif") return "image/heif";
  return "image/jpeg";
}

function parseAiJson(text) {
  const cleaned = String(text || "")
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    const result = {};
    for (const key of ["company", "person", "role", "country", "city", "mobile", "phone", "email", "website", "address", "notes"]) {
      result[key] = normalizeText(parsed[key]);
    }
    return result;
  } catch {
    return null;
  }
}

function mergeExtractedFields(ocrExtracted = {}, aiExtracted = {}) {
  const merged = { ...ocrExtracted };
  for (const key of ["company", "person", "role", "country", "city", "mobile", "phone", "email", "website", "address"]) {
    if (aiExtracted[key]) merged[key] = aiExtracted[key];
  }
  const notes = [aiExtracted.notes, ocrExtracted.notes].filter(Boolean);
  if (notes.length) merged.notes = notes.join("\n\n");
  return merged;
}

function normalizeOcrText(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

function extractCardFields(text) {
  const lines = String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const joined = lines.join(" ");
  const emails = [...joined.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)].map((m) => m[0]);
  const websites = [...joined.matchAll(/(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+\/?/gi)]
    .map((m) => m[0])
    .filter((value) => !value.includes("@") && !emails.some((email) => email.includes(value)));
  const phones = [...joined.matchAll(/(?:\+|00)?\d[\d\s().-]{6,}\d/g)]
    .map((m) => m[0].replace(/\s+/g, " ").trim())
    .filter((value, index, arr) => digits(value).length >= 7 && arr.findIndex((item) => digits(item) === digits(value)) === index);
  const likelyCompany = lines.find((line) => isLikelyCompanyLine(line, emails, phones)) || "";
  const likelyPerson = lines.find((line) => isLikelyPersonLine(line, likelyCompany)) || "";
  return {
    company: likelyCompany,
    person: likelyPerson,
    email: emails.join("; "),
    website: websites[0] || "",
    mobile: phones.find((phone) => /(?:\+|00)?\d[\d\s().-]{7,}/.test(phone)) || "",
    phone: phones.slice(1).join("; "),
    notes: text ? `OCR text:\n${text}` : ""
  };
}

function isLikelyCompanyLine(line, emails, phones) {
  const lower = line.toLowerCase();
  if (emails.some((email) => line.includes(email))) return false;
  if (phones.some((phone) => line.includes(phone))) return false;
  if (/@|www\.|http|tel|fax|mobile|phone|email|whatsapp/i.test(line)) return false;
  if (/\b(ltd|limited|llc|l\.l\.c|co\.|company|trading|trade|imports?|exports?|international|foods?|rice|general)\b/i.test(line)) return true;
  return line.length > 4 && line.length < 60 && /[A-Za-z]/.test(line) && line === line.toUpperCase();
}

function isLikelyPersonLine(line, company) {
  if (!line || line === company) return false;
  if (/@|www\.|http|tel|fax|mobile|phone|email|whatsapp|\d{4,}/i.test(line)) return false;
  if (/\b(ltd|limited|llc|company|trading|imports?|exports?|address|street|road)\b/i.test(line)) return false;
  const words = line.split(/\s+/).filter(Boolean);
  return words.length >= 2 && words.length <= 4 && words.every((word) => /^[A-Za-z.'-]+$/.test(word));
}

function buildSummary(db) {
  const active = db.customers.filter((c) => !c.archivedAt);
  const countries = [...new Set(active.map((c) => normalizeCountryName(c.country)).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const sourceTypes = [...new Set(active.map((c) => c.sourceType).filter(Boolean))].sort();
  const ready = active.filter((c) => getDataQuality(c) === "clean");
  const research = active.filter((c) => getDataQuality(c) === "research_needed");
  const emailReady = active.filter((c) => contactMatches(c, "email"));
  const phoneReady = active.filter((c) => contactMatches(c, "any_phone"));
  return {
    totals: {
      active: active.length,
      archived: db.customers.length - active.length,
      missingEmail: active.filter((c) => !c.email).length,
      missingMobile: active.filter((c) => !c.mobile).length,
      countries: countries.length,
      duplicateGroups: findDuplicates(active, { limit: 500 }).length,
      clean: ready.length,
      researchNeeded: research.length,
      emailReady: emailReady.length,
      phoneReady: phoneReady.length
    },
    countries,
    sourceTypes,
    recentImports: db.imports.slice(-8).reverse()
  };
}

function buildOutreachStatus(db) {
  const active = db.customers.filter((c) => !c.archivedAt);
  const buyers = active.filter((c) => !isMiscellaneousContact(c));
  const miscellaneous = active.length - buyers.length;
  const buyerEmailRecords = buyers.filter((c) => contactMatches(c, "email"));
  const suppressedEmails = new Set((db.suppressions || []).map((item) => normalizeEmail(item.email)).filter(Boolean));
  const eligible = buyerEmailRecords.filter((customer) =>
    splitEmails(customer.email).some((email) => !suppressedEmails.has(normalizeEmail(email)))
  );
  const countries = [...new Set(eligible.map((c) => normalizeCountryName(c.country)).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  return {
    connected: Boolean(RESEND_API_KEY && RESEND_FROM_EMAIL && RESEND_DOMAIN),
    sendingEnabled: Boolean(RESEND_API_KEY),
    sender: `${RESEND_FROM_NAME} <${RESEND_FROM_EMAIL}>`,
    domain: RESEND_DOMAIN,
    domainVerified: RESEND_DOMAIN === "outreach.transtradeinternational.com",
    safety: {
      miscellaneousExcluded: true,
      suppressionListReady: Array.isArray(db.suppressions),
      unsubscribeReady: true,
      resendWebhookRecommended: true,
      sendGapMinutes: OUTREACH_SEND_GAP_MS / 60000,
      testRequiredByUi: true
    },
    totals: {
      active: active.length,
      buyerRecords: buyers.length,
      miscellaneousExcluded: miscellaneous,
      buyerEmailRecords: buyerEmailRecords.length,
      suppressedEmails: suppressedEmails.size,
      eligibleBuyerEmailRecords: eligible.length,
      eligibleCountries: countries.length
    },
    countries
  };
}

function getOutreachRecipients(db, { country = "" } = {}) {
  const selectedCountry = normalizeCountryName(country);
  const suppressedEmails = new Set((db.suppressions || []).map((item) => normalizeEmail(item.email)).filter(Boolean));
  const seen = new Set();
  const recipients = [];
  for (const customer of db.customers || []) {
    if (customer.archivedAt || isMiscellaneousContact(customer)) continue;
    if (selectedCountry && normalizeCountryName(customer.country) !== selectedCountry) continue;
    for (const email of splitEmails(customer.email)) {
      const normalized = normalizeEmail(email);
      if (!normalized || suppressedEmails.has(normalized) || seen.has(normalized)) continue;
      seen.add(normalized);
      recipients.push({ customer, email: normalized });
    }
  }
  return recipients.sort((a, b) => {
    const companyDiff = String(a.customer.company || "").localeCompare(String(b.customer.company || ""));
    if (companyDiff) return companyDiff;
    return a.email.localeCompare(b.email);
  });
}

async function draftOutreachEmail({ country, purpose }) {
  const prompt = [
    "Write a short B2B rice export revival email for Transtrade International.",
    `Country: ${country || "selected country"}.`,
    purpose ? `Extra context: ${purpose}.` : "",
    "Use a respectful business tone. Keep the subject under 55 characters.",
    "Do not invent prices, shipment details, certifications, or claims.",
    "Return strict JSON with subject and body fields. Body may use {{person}}, {{company}}, {{country}}, and {{unsubscribe_url}} placeholders."
  ].filter(Boolean).join("\n");

  if (OPENAI_API_KEY) {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "authorization": `Bearer ${OPENAI_API_KEY}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.4
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || "OpenAI draft failed");
    const text = data.choices?.[0]?.message?.content || "";
    return parseDraftJson(text, "openai");
  }

  if (GEMINI_API_KEY) {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.4 }
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || "Gemini draft failed");
    const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("\n") || "";
    return parseDraftJson(text, "gemini");
  }

  return {
    provider: "template",
    subject: `Rice business with Transtrade`,
    body: [
      "Dear {{person}},",
      "",
      "I hope you are well.",
      "",
      "We are reconnecting with rice buyers in {{country}} for upcoming business from Transtrade International. Please let us know if {{company}} is currently reviewing rice import requirements or supplier options.",
      "",
      "Regards,",
      "Transtrade International",
      "",
      "Unsubscribe: {{unsubscribe_url}}"
    ].join("\n")
  };
}

function parseDraftJson(text, provider) {
  const match = String(text || "").match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]);
      return {
        provider,
        subject: normalizeText(parsed.subject || "Rice business with Transtrade"),
        body: normalizeMultilineText(parsed.body || "")
      };
    } catch {}
  }
  return {
    provider,
    subject: "Rice business with Transtrade",
    body: normalizeMultilineText(text || "")
  };
}

async function processOutreachQueue() {
  if (outreachProcessing || !RESEND_API_KEY) return;
  outreachProcessing = true;
  try {
    const db = await readDb();
    let changed = false;
    const campaigns = db.campaigns || [];
    const dueTime = Date.now();
    for (const campaign of campaigns) {
      if (campaign.status === "complete" || campaign.status === "paused") continue;
      const dueItem = (campaign.items || []).find((item) => item.status === "queued" && Date.parse(item.scheduledAt) <= dueTime);
      if (!dueItem) {
        if ((campaign.items || []).some((item) => item.status === "queued")) campaign.status = "queued";
        continue;
      }
      const customer = (db.customers || []).find((c) => c.id === dueItem.customerId);
      if (!customer || isEmailSuppressed(db, dueItem.to)) {
        dueItem.status = "skipped";
        dueItem.skippedAt = now();
        campaign.skipped = (campaign.skipped || 0) + 1;
        campaign.updatedAt = now();
        changed = true;
        continue;
      }
      try {
        campaign.status = "running";
        dueItem.status = "sending";
        dueItem.attempts = (dueItem.attempts || 0) + 1;
        campaign.updatedAt = now();
        await writeDb(db);
        const result = await sendOutreachEmail({
          to: dueItem.to,
          cc: dueItem.cc || [],
          subject: campaign.subject,
          body: campaign.body,
          customer,
          campaignId: campaign.id,
          itemId: dueItem.id,
          testMode: false
        });
        dueItem.status = "sent";
        dueItem.sentAt = now();
        dueItem.providerId = result.id || "";
        campaign.sent = (campaign.sent || 0) + 1;
        campaign.updatedAt = now();
        db.events.push(event("outreach_email_sent", dueItem.to, { campaignId: campaign.id, itemId: dueItem.id, providerId: dueItem.providerId }));
      } catch (error) {
        dueItem.status = "failed";
        dueItem.failedAt = now();
        dueItem.error = String(error.message || error);
        campaign.failed = (campaign.failed || 0) + 1;
        campaign.updatedAt = now();
        db.events.push(event("outreach_email_failed", dueItem.to, { campaignId: campaign.id, itemId: dueItem.id, error: dueItem.error }));
      }
      if ((campaign.items || []).every((item) => item.status === "sent" || item.status === "failed" || item.status === "skipped")) {
        campaign.status = "complete";
        campaign.completedAt = now();
      }
      changed = true;
      break;
    }
    if (changed) await writeDb(db);
  } finally {
    outreachProcessing = false;
  }
}

async function sendOutreachEmail({ to, cc = [], subject, body, customer, campaignId, itemId, testMode }) {
  if (!RESEND_API_KEY) throw new Error("Resend API key is not configured");
  const unsubscribeUrl = buildUnsubscribeUrl(to);
  const renderedSubject = renderTemplate(subject || "Rice business with Transtrade", customer, { unsubscribeUrl, testMode });
  const renderedText = renderTemplate(body || "", customer, { unsubscribeUrl, testMode });
  const html = textToHtml(renderedText, unsubscribeUrl);
  const payload = {
    from: `${RESEND_FROM_NAME} <${RESEND_FROM_EMAIL}>`,
    to: [to],
    subject: testMode ? `[TEST] ${renderedSubject}` : renderedSubject,
    text: renderedText,
    html,
    headers: {
      "List-Unsubscribe": `<${unsubscribeUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"
    }
  };
  const cleanCc = [...new Set((cc || []).map(normalizeEmail).filter((email) => email && email !== to))];
  if (cleanCc.length) payload.cc = cleanCc;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "authorization": `Bearer ${RESEND_API_KEY}`,
      "content-type": "application/json",
      "idempotency-key": `tti-outreach-${campaignId}-${itemId}`
    },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || data.error || `Resend error ${response.status}`);
  return data;
}

function renderTemplate(template, customer, { unsubscribeUrl, testMode = false }) {
  const person = customer.person || "Sir/Madam";
  return String(template || "")
    .replaceAll("{{person}}", person)
    .replaceAll("{{company}}", customer.company || "your company")
    .replaceAll("{{country}}", customer.country || "your country")
    .replaceAll("{{email}}", splitEmails(customer.email)[0] || "")
    .replaceAll("{{unsubscribe_url}}", unsubscribeUrl)
    .replaceAll("{{test_note}}", testMode ? "This is a test email." : "");
}

function textToHtml(text, unsubscribeUrl) {
  const body = escapeHtml(String(text || "")).replace(/\n/g, "<br>");
  const link = escapeHtml(unsubscribeUrl);
  return `<!doctype html><html><body style="font-family:Arial,sans-serif;line-height:1.5;color:#1f2a22">${body}<hr><p style="font-size:12px;color:#667">Transtrade International<br><a href="${link}">Unsubscribe</a></p></body></html>`;
}

function buildUnsubscribeUrl(email) {
  const safeEmail = normalizeEmail(email);
  const token = crypto.createHmac("sha256", APP_PASSWORD || RESEND_API_KEY || "transtrade").update(safeEmail).digest("hex");
  return `https://buyers.transtradeinternational.com/unsubscribe?email=${encodeURIComponent(safeEmail)}&token=${encodeURIComponent(token)}`;
}

function verifyUnsubscribeToken(email, token) {
  const expected = crypto.createHmac("sha256", APP_PASSWORD || RESEND_API_KEY || "transtrade").update(normalizeEmail(email)).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(token || "").padEnd(expected.length, "0").slice(0, expected.length)));
}

async function handlePublicUnsubscribe(req, res, url) {
  const email = normalizeEmail(url.searchParams.get("email") || "");
  const token = url.searchParams.get("token") || "";
  if (!email || !verifyUnsubscribeToken(email, token)) {
    res.writeHead(400, { "content-type": "text/html; charset=utf-8" });
    res.end("<h1>Invalid unsubscribe link</h1>");
    return;
  }
  const db = await readDb();
  suppressEmail(db, email, "unsubscribe", "unsubscribe_link");
  await writeDb(db);
  if (req.method === "POST") {
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    res.end("");
    return;
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(`<!doctype html><html><body style="font-family:Arial,sans-serif"><h1>Unsubscribed</h1><p>${escapeHtml(email)} has been removed from Transtrade marketing outreach.</p></body></html>`);
}

function suppressEmail(db, email, reason, sourceId = "") {
  const normalized = normalizeEmail(email);
  if (!normalized) return;
  db.suppressions ||= [];
  const existing = db.suppressions.find((item) => normalizeEmail(item.email) === normalized);
  if (existing) {
    existing.reason = existing.reason || reason;
    existing.updatedAt = now();
    return;
  }
  db.suppressions.push({ email: normalized, reason, sourceId, createdAt: now() });
  db.events ||= [];
  db.events.push(event("email_suppressed", normalized, { reason, sourceId }));
}

function isEmailSuppressed(db, email) {
  const normalized = normalizeEmail(email);
  return (db.suppressions || []).some((item) => normalizeEmail(item.email) === normalized);
}

function campaignSummary(campaign) {
  const items = campaign.items || [];
  const queued = items.filter((item) => item.status === "queued").length;
  const next = items.filter((item) => item.status === "queued").sort((a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt))[0];
  return {
    id: campaign.id,
    country: campaign.country,
    subject: campaign.subject,
    status: campaign.status,
    total: campaign.total || items.length,
    sent: campaign.sent || items.filter((item) => item.status === "sent").length,
    failed: campaign.failed || items.filter((item) => item.status === "failed").length,
    skipped: campaign.skipped || items.filter((item) => item.status === "skipped").length,
    queued,
    sendGapMinutes: campaign.sendGapMinutes || OUTREACH_SEND_GAP_MS / 60000,
    nextSendAt: next?.scheduledAt || "",
    createdAt: campaign.createdAt,
    completedAt: campaign.completedAt || ""
  };
}

function getCustomerStatus(c) {
  if (c.archivedAt) return "archived";
  if (!c.email && !c.mobile && !c.phone) return "incomplete";
  if (!c.email) return "missing_email";
  if (!c.mobile) return "missing_mobile";
  if ((c.sourceTrust || 0) < 60) return "needs_review";
  return "ready";
}

function getDataQuality(c) {
  if (c.archivedAt) return "archived";
  if (!c.company || !c.country) return "research_needed";
  if (!c.email && !c.mobile && !c.phone) return "research_needed";
  if ((c.sourceTrust || 0) < 60) return "review";
  if (!c.email) return "phone_only";
  if (!c.mobile && !c.phone) return "email_only";
  return "clean";
}

function withCustomerCategory(customer) {
  return {
    ...customer,
    country: normalizeCountryName(customer.country),
    listCategory: isMiscellaneousContact(customer) ? "Miscellaneous" : "Potential Buyer"
  };
}

function sortCustomerList(customers) {
  return [...customers].map(withCustomerCategory).sort((a, b) => {
    const categoryDiff = customerCategoryRank(a) - customerCategoryRank(b);
    if (categoryDiff) return categoryDiff;
    const countryDiff = String(a.country || "").localeCompare(String(b.country || ""));
    if (countryDiff) return countryDiff;
    const companyDiff = String(a.company || "").localeCompare(String(b.company || ""));
    if (companyDiff) return companyDiff;
    return String(a.person || "").localeCompare(String(b.person || ""));
  });
}

function customerCategoryRank(customer) {
  return isMiscellaneousContact(customer) ? 1 : 0;
}

function isMiscellaneousContact(customer) {
  const text = [customer.company, customer.person, customer.role, customer.notes, customer.email, customer.website]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const nonTradePatterns = [
    /\bsgs\b/,
    /\binspection\b/,
    /\binspector\b/,
    /\binspections\b/,
    /\binspecteur\b/,
    /\binspect\b/,
    /\bsurvey\b/,
    /\bsurveillance\b/,
    /\bcotecna\b/,
    /\bbureau veritas\b/,
    /\bcontrol union\b/,
    /\bomic\b/,
    /\bembassy\b/,
    /\bconsulate\b/,
    /\bchamber\b/,
    /\bministry\b/,
    /\bminister\b/,
    /\bgovernment\b/,
    /\bsecretary\b/,
    /\bcounsellor\b/,
    /\bambassador\b/,
    /\btaxi\b/,
    /\bhotel\b/,
    /\bcourier\b/,
    /\bcargo\b/,
    /\blogistics\b/,
    /\bfreight\b/,
    /\bshipping\b/,
    /\bairline\b/,
    /\bsecurity\b/,
    /\bbank\b/,
    /\bbanking\b/,
    /\bexchange\b/,
    /\bfinance\b/,
    /\bfinancial\b/,
    /\binsurance\b/,
    /\bcredit\b/,
    /\bfinance corporation\b/,
    /\bsocial security\b/
  ];
  return nonTradePatterns.some((pattern) => pattern.test(text));
}

function contactMatches(c, contact) {
  if (contact === "email") return Boolean(c.email);
  if (contact === "mobile") return Boolean(c.mobile);
  if (contact === "any_phone") return Boolean(c.mobile || c.phone);
  if (contact === "email_or_phone") return Boolean(c.email || c.mobile || c.phone);
  if (contact === "no_contact") return !c.email && !c.mobile && !c.phone;
  return true;
}

function splitEmails(value) {
  return normalizeText(value)
    .split(/[;,|\s]+/)
    .map((email) => normalizeEmail(email))
    .filter(isValidEmail);
}

function normalizeEmail(value) {
  return normalizeText(value).toLowerCase().replace(/^mailto:/, "").replace(/[<>()"'.,;]+$/g, "");
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(value || ""));
}

function categoryMatches(c, category) {
  if (category === "buyer") return !isMiscellaneousContact(c);
  if (category === "misc" || category === "miscellaneous") return isMiscellaneousContact(c);
  return true;
}

function filterCustomers(allCustomers, url) {
  const country = url.searchParams.get("country");
  const status = url.searchParams.get("status");
  const contact = url.searchParams.get("contact");
  const quality = url.searchParams.get("quality");
  const sourceType = url.searchParams.get("sourceType");
  const category = url.searchParams.get("category");
  const includeArchived = url.searchParams.get("archived") === "1";
  let customers = allCustomers;
  if (!includeArchived) customers = customers.filter((c) => !c.archivedAt);
  if (country) customers = customers.filter((c) => normalizeCountryName(c.country) === normalizeCountryName(country));
  if (status) customers = customers.filter((c) => getCustomerStatus(c) === status);
  if (contact) customers = customers.filter((c) => contactMatches(c, contact));
  if (quality) customers = customers.filter((c) => getDataQuality(c) === quality);
  if (sourceType) customers = customers.filter((c) => c.sourceType === sourceType);
  if (category) customers = customers.filter((c) => categoryMatches(c, category));
  return sortCustomerList(customers);
}

function exportLabel(url) {
  const country = url.searchParams.get("country");
  const quality = url.searchParams.get("quality");
  const contact = url.searchParams.get("contact");
  const sourceType = url.searchParams.get("sourceType");
  const category = url.searchParams.get("category");
  return [country || "master", category, quality, contact, sourceType, "customers"].filter(Boolean).join("-");
}

function normalizeCustomer(record) {
  const customer = {};
  for (const key of ["company", "person", "role", "country", "city", "phone", "mobile", "email", "website", "address", "notes", "priority", "sourceType", "sourceId", "sourcePhoto", "sourceFile", "sourceSheet"]) {
    customer[key] = normalizeText(record[key]);
  }
  customer.country = normalizeCountryName(customer.country);
  customer.sourceTrust = Number(record.sourceTrust || SOURCE_TRUST[customer.sourceType] || 50);
  customer.status = getCustomerStatus(customer);
  return customer;
}

function normalizeCountryName(value) {
  const raw = normalizeText(value).replace(/Â/g, "").replace(/[“”]/g, "\"").replace(/[’]/g, "'");
  if (!raw || raw === "=") return "";
  if (raw === "中国") return "China";
  const simpleSlug = slug(raw);
  const countryAliases = {
    algerie: "Algeria",
    argentina: "Argentina",
    armenia: "Armenia",
    bahrain: "Bahrain",
    benin: "Benin",
    bissau: "Guinea-Bissau",
    bulgaria: "Bulgaria",
    cameron: "Cameroon",
    cameroun: "Cameroon",
    china: "China",
    coteivoire: "Côte d'Ivoire",
    cyprus: "Cyprus",
    drcongo: "Democratic Republic of the Congo",
    democraticrepublicofthecongo: "Democratic Republic of the Congo",
    republicdemocraticofcongo: "Democratic Republic of the Congo",
    egypt: "Egypt",
    ethiopia: "Ethiopia",
    ethopia: "Ethiopia",
    france: "France",
    gambia: "The Gambia",
    thegambia: "The Gambia",
    germany: "Germany",
    guinee: "Guinea",
    hk: "Hong Kong",
    hongkong: "Hong Kong",
    hongkongchina: "Hong Kong / China",
    hungary: "Hungary",
    iran: "Iran",
    iraq: "Iraq",
    jordan: "Jordan",
    jordon: "Jordan",
    kampalauganda: "Uganda",
    kenya: "Kenya",
    korea: "South Korea",
    kuwait: "Kuwait",
    lebanan: "Lebanon",
    lebanon: "Lebanon",
    madagascar: "Madagascar",
    mali: "Mali",
    mauritania: "Mauritania",
    mauritanie: "Mauritania",
    mauritius: "Mauritius",
    morroco: "Morocco",
    morocco: "Morocco",
    mozambique: "Mozambique",
    netherland: "Netherlands",
    netherlands: "Netherlands",
    nlends: "Netherlands",
    newyork: "United States",
    nigeria: "Nigeria",
    oman: "Oman",
    paris: "France",
    philippines: "Philippines",
    poland: "Poland",
    qatar: "Qatar",
    russia: "Russia",
    rwanda: "Rwanda",
    sarabia: "Saudi Arabia",
    sa: "Saudi Arabia",
    saudiarabia: "Saudi Arabia",
    senegal: "Senegal",
    serbia: "Serbia",
    singapore: "Singapore",
    somailand: "Somalia",
    somaialland: "Somalia",
    somaliland: "Somalia",
    somalilandsomalia: "Somalia",
    southafrifa: "South Africa",
    southafrica: "South Africa",
    southernsudan: "South Sudan",
    spain: "Spain",
    slanka: "Sri Lanka",
    srilanka: "Sri Lanka",
    sudan: "Sudan",
    switzerland: "Switzerland",
    togo: "Togo",
    turkey: "Turkey",
    uae: "United Arab Emirates",
    unitedarabemirates: "United Arab Emirates",
    uk: "United Kingdom",
    unitedkingdom: "United Kingdom",
    ukraine: "Ukraine",
    ukrain: "Ukraine",
    usa: "United States",
    unitedstates: "United States",
    uganda: "Uganda",
    westafrica: "West Africa",
    china: "China",
    中国: "China"
  };
  if (countryAliases[simpleSlug]) return countryAliases[simpleSlug];
  if (/[/,]/.test(raw)) {
    const parts = raw.split(/\s*[/,]\s*/).map(normalizeCountryName).filter(Boolean);
    const unique = [...new Set(parts)];
    if (unique.length === 1) return unique[0];
    return unique.join(" / ");
  }
  if (raw === raw.toUpperCase() && /[A-Z]/.test(raw)) return titleCaseCountry(raw);
  return raw;
}

function titleCaseCountry(value) {
  return value.toLowerCase().replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

function normalizeText(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function normalizeMultilineText(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function event(type, targetId, detail) {
  return { id: crypto.randomUUID(), type, targetId, detail, createdAt: now() };
}

function now() {
  return new Date().toISOString();
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[ch]));
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

async function readMultipart(req, contentType) {
  const boundary = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/)?.[1] || contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/)?.[2];
  if (!boundary) throw new Error("Missing multipart boundary");
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks);
  const parts = body.toString("binary").split(`--${boundary}`);
  const fields = {};
  const files = {};
  for (const part of parts) {
    if (!part.includes("Content-Disposition")) continue;
    const [rawHeaders, rawBody] = part.split("\r\n\r\n");
    if (!rawBody) continue;
    const name = rawHeaders.match(/name="([^"]+)"/)?.[1];
    const filename = rawHeaders.match(/filename="([^"]*)"/)?.[1];
    let content = Buffer.from(rawBody, "binary");
    if (content.subarray(-2).toString() === "\r\n") content = content.subarray(0, -2);
    if (!name) continue;
    if (filename) files[name] = { filename, data: content };
    else fields[name] = content.toString("utf8").trim();
  }
  return { fields, files };
}

async function parseImportFile(filePath, filename, options) {
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".csv") return parseCsv(await fs.readFile(filePath, "utf8"), options, filename);
  if (ext === ".xlsx") return parseXlsx(await fs.readFile(filePath), options, filename);
  throw new Error("Only .xlsx and .csv imports are supported in this first version");
}

function parseCsv(text, options, filename) {
  const rows = csvRows(text);
  if (!rows.length) return [];
  const headers = rows[0].map((h) => normalizeText(h));
  return rows.slice(1).map((row) => mapRow(headers, row, options, filename, "CSV")).filter((r) => r.company || r.email || r.mobile);
}

async function parseXlsx(buffer, options, filename) {
  const zip = await JSZip.loadAsync(buffer);
  const workbookXml = await zip.file("xl/workbook.xml").async("text");
  const workbook = xml2js(workbookXml, { compact: true });
  const relsXml = await zip.file("xl/_rels/workbook.xml.rels").async("text");
  const rels = xml2js(relsXml, { compact: true });
  const sharedStrings = await readSharedStrings(zip);
  const workbookNode = child(workbook, "workbook");
  const sheetsNode = child(workbookNode, "sheets");
  const relsNode = child(rels, "Relationships");
  const sheets = asArray(child(sheetsNode, "sheet"));
  const relMap = new Map(asArray(child(relsNode, "Relationship")).map((rel) => [rel._attributes.Id, rel._attributes.Target]));
  const allRecords = [];

  for (const sheet of sheets) {
    const sheetName = sheet._attributes.name;
    if (!shouldImportSheet(sheetName, options)) continue;
    const relId = sheet._attributes["r:id"];
    const target = relMap.get(relId);
    if (!target) continue;
    const sheetPath = `xl/${target.replace(/^\/?xl\//, "")}`;
    const xmlFile = zip.file(sheetPath);
    if (!xmlFile) continue;
    const rows = parseSheetXml(await xmlFile.async("text"), sharedStrings);
    const normalized = sheetRowsToRecords(rows, options, filename, sheetName);
    allRecords.push(...normalized);
  }
  return allRecords;
}

function shouldImportSheet(sheetName, options) {
  if (options.importMode === "tti_card_master") {
    return sheetName === "Master Priority List";
  }
  return true;
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
  const rows = asArray(child(sheetData, "row"));
  return rows.map((row) => {
    const cells = asArray(child(row, "c"));
    const values = [];
    for (const cell of cells) {
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

function sheetRowsToRecords(rows, options, filename, sheetName) {
  const records = [];
  for (let i = 0; i < Math.min(rows.length, 12); i++) {
    const headers = (rows[i] || []).map((h) => normalizeText(h));
    const matched = scoreHeaders(headers);
    if (matched < 2) continue;
    for (const row of rows.slice(i + 1)) {
      const record = mapRow(headers, row || [], options, filename, sheetName);
      if (record.company || record.email || record.mobile) records.push(record);
    }
    break;
  }
  return records;
}

function scoreHeaders(headers) {
  const labels = Object.values(COLUMN_ALIASES).flat();
  return headers.filter((h) => labels.includes(h.toLowerCase())).length;
}

function mapRow(headers, row, options, filename, sheetName) {
  const record = {
    country: options.countryFallback || "",
    sourceFile: filename,
    sourceSheet: sheetName,
    sourceType: options.sourceType
  };
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    const idx = headers.findIndex((h) => aliases.includes(String(h || "").toLowerCase().trim()));
    if (idx >= 0) record[field] = row[idx] || "";
  }
  if (options.importMode === "tti_card_master") {
    record.sourceType = "card_master";
    record.sourceTrust = SOURCE_TRUST.card_master;
    record.notes = [record.notes, "Imported from TTI Sales Master card database. Historical card-derived contact; verify before outreach."].filter(Boolean).join(" ");
  }
  return record;
}

function isTemporarilyExcludedRecord(record, importMode) {
  if (importMode !== "tti_card_master") return false;
  const country = slug(record.country || "");
  return country === "india" || country === "pakistan";
}

function findDuplicates(customers, options = {}) {
  const type = options.type || "all";
  const limit = Number(options.limit || 200);
  const ignored = new Set((options.ignored || []).map((item) => item.signature));
  const buckets = new Map();
  for (const c of customers) {
    const keys = [
      c.email && (type === "all" || type === "email") && contactDuplicateKey("email", splitFirst(c.email).toLowerCase(), c),
      c.mobile && (type === "all" || type === "mobile") && contactDuplicateKey("mobile", digits(c.mobile), c),
      c.phone && (type === "all" || type === "phone") && digits(c.phone).length >= 7 && contactDuplicateKey("phone", digits(c.phone), c),
      c.company && c.country && (type === "all" || type === "company") && companyDuplicateKey(c),
      c.website && (type === "all" || type === "website") && contactDuplicateKey("web", slug(c.website), c)
    ].filter(Boolean);
    for (const key of keys) {
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(c);
    }
  }
  const groups = [];
  const seen = new Set();
  for (const [key, list] of buckets) {
    const unique = [...new Map(list.map((c) => [c.id, c])).values()];
    if (unique.length < 2) continue;
    const signature = unique.map((c) => c.id).sort().join("|");
    if (seen.has(signature)) continue;
    if (ignored.has(signature)) continue;
    seen.add(signature);
    const sorted = unique.sort((a, b) => (duplicateRecordScore(b) - duplicateRecordScore(a)) || ((b.sourceTrust || 0) - (a.sourceTrust || 0)));
    groups.push({
      key,
      reason: duplicateReason(key),
      recommendedPrimaryId: sorted[0].id,
      score: duplicateGroupScore(key, sorted),
      customers: sorted.map((c) => ({
        ...c,
        dataQuality: getDataQuality(c),
        duplicateScore: duplicateRecordScore(c)
      }))
    });
  }
  return groups.sort((a, b) => b.score - a.score).slice(0, limit);
}

function findCompanyContactGroups(customers, options = {}) {
  const buckets = new Map();
  for (const c of customers) {
    if (!c.company || !c.country || !c.person) continue;
    const key = `company:${slug(c.company)}:${slug(c.country)}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(c);
  }
  const groups = [];
  for (const [key, list] of buckets) {
    const namedPeople = new Set(list.map((c) => personSlug(c.person)).filter(Boolean));
    if (namedPeople.size < 2) continue;
    const queryText = list.map((c) => `${c.company} ${c.country} ${c.person} ${c.email} ${c.mobile} ${c.phone}`).join(" ").toLowerCase();
    if (options.q && !queryText.includes(options.q)) continue;
    const sorted = [...list].sort((a, b) => String(a.person || "").localeCompare(String(b.person || "")));
    groups.push({
      key,
      company: sorted[0].company,
      country: sorted[0].country,
      contacts: sorted.map((c) => ({
        ...c,
        dataQuality: getDataQuality(c)
      }))
    });
  }
  return groups
    .sort((a, b) => b.contacts.length - a.contacts.length || a.company.localeCompare(b.company))
    .slice(0, Number(options.limit || 200));
}

function companyDuplicateKey(c) {
  const company = slug(c.company);
  const country = slug(c.country);
  if (!company || !country) return "";
  const person = personSlug(c.person);
  return person ? `company-person:${company}:${country}:${person}` : `company-blank-person:${company}:${country}`;
}

function contactDuplicateKey(kind, value, c) {
  if (!value) return "";
  const person = personSlug(c.person);
  return person ? `${kind}-person:${value}:${person}` : `${kind}-blank-person:${value}`;
}

function duplicateSignature(ids) {
  return [...new Set(ids)].filter(Boolean).sort().join("|");
}

function duplicateReason(key) {
  if (key.startsWith("email-person:")) return "Same email and person";
  if (key.startsWith("email-blank-person:")) return "Same email with missing person";
  if (key.startsWith("mobile-person:")) return "Same mobile and person";
  if (key.startsWith("mobile-blank-person:")) return "Same mobile with missing person";
  if (key.startsWith("phone-person:")) return "Same phone and person";
  if (key.startsWith("phone-blank-person:")) return "Same phone with missing person";
  if (key.startsWith("company-person:")) return "Same company, country, and person";
  if (key.startsWith("company-blank-person:")) return "Same company/country with missing person";
  if (key.startsWith("web-person:")) return "Same website and person";
  if (key.startsWith("web-blank-person:")) return "Same website with missing person";
  return "Possible duplicate";
}

function duplicateGroupScore(key, customers) {
  const base = key.startsWith("email-") || key.startsWith("mobile-") ? 100 : key.startsWith("phone-") || key.startsWith("web-") ? 80 : 55;
  return base + Math.min(20, customers.length * 3) + Math.max(...customers.map(duplicateRecordScore));
}

function duplicateRecordScore(c) {
  return completenessScore(c) * 10 + Number(c.sourceTrust || 0);
}

function splitFirst(value) {
  return String(value || "").split(/[;,]/)[0].trim();
}

function personSlug(value) {
  return slug(String(value || "")
    .replace(/\b(mr|mrs|ms|miss|dr|eng|engr|haji|alhaj|syed|mohd|mohammad|muhammad)\b/gi, " ")
    .replace(/\b(partner|director|manager|owner|ceo|md)\b/gi, " "));
}

function mergeCustomers(db, ids, primaryId) {
  const uniqueIds = [...new Set(ids)].filter(Boolean);
  const customers = uniqueIds
    .map((id) => db.customers.find((c) => c.id === id && !c.archivedAt))
    .filter(Boolean);
  if (customers.length < 2) return null;

  const primary = customers.find((c) => c.id === primaryId) || pickBestCustomer(customers);
  const others = customers.filter((c) => c.id !== primary.id);
  const merged = mergeCustomerFields(primary, customers);
  Object.assign(primary, merged, {
    updatedAt: now(),
    mergedFrom: [...new Set([...(primary.mergedFrom || []), ...others.map((c) => c.id), ...others.flatMap((c) => c.mergedFrom || [])])]
  });

  for (const other of others) {
    other.archivedAt = now();
    other.updatedAt = now();
    other.mergedInto = primary.id;
  }

  return { primary, mergedIds: others.map((c) => c.id) };
}

function pickBestCustomer(customers) {
  return [...customers].sort((a, b) => {
    const trustDiff = (b.sourceTrust || 0) - (a.sourceTrust || 0);
    if (trustDiff) return trustDiff;
    return completenessScore(b) - completenessScore(a);
  })[0];
}

function mergeCustomerFields(primary, customers) {
  const fields = ["company", "person", "role", "country", "city", "phone", "mobile", "email", "website", "address", "priority", "sourceId", "sourcePhoto", "sourceFile", "sourceSheet"];
  const output = {};
  for (const field of fields) {
    output[field] = bestFieldValue(field, primary, customers);
  }
  const notes = customers.map((c) => c.notes).filter(Boolean);
  const sources = customers.map((c) => [c.sourceType, c.sourceFile, c.sourceSheet].filter(Boolean).join(" / ")).filter(Boolean);
  output.notes = [...new Set([primary.notes, ...notes, sources.length ? `Merged sources: ${[...new Set(sources)].join("; ")}` : ""].filter(Boolean))].join(" | ");
  output.sourceTrust = Math.max(...customers.map((c) => Number(c.sourceTrust || 0)));
  output.sourceType = primary.sourceType || pickBestCustomer(customers).sourceType || "";
  output.status = getCustomerStatus(output);
  return output;
}

function bestFieldValue(field, primary, customers) {
  if (primary[field]) return primary[field];
  const sorted = [...customers].sort((a, b) => (b.sourceTrust || 0) - (a.sourceTrust || 0));
  return sorted.find((c) => c[field])?.[field] || "";
}

function completenessScore(customer) {
  return ["company", "person", "country", "mobile", "phone", "email", "website", "address"].filter((field) => customer[field]).length;
}

function buildVcf(customers) {
  return customers.map((c) => [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `FN:${vcfEscape(c.person || c.company || "Customer")}`,
    c.company ? `ORG:${vcfEscape(c.company)}` : "",
    c.role ? `TITLE:${vcfEscape(c.role)}` : "",
    c.mobile ? `TEL;TYPE=CELL:${vcfEscape(c.mobile)}` : "",
    c.phone ? `TEL;TYPE=WORK:${vcfEscape(c.phone)}` : "",
    c.email ? `EMAIL;TYPE=INTERNET:${vcfEscape(c.email)}` : "",
    c.website ? `URL:${vcfEscape(c.website)}` : "",
    c.address ? `ADR;TYPE=WORK:;;${vcfEscape(c.address)};${vcfEscape(c.city)};;${vcfEscape(c.country)};` : "",
    c.notes ? `NOTE:${vcfEscape(c.notes)}` : "",
    "END:VCARD"
  ].filter(Boolean).join("\r\n")).join("\r\n");
}

function vcfEscape(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

function digits(value) {
  return String(value || "").replace(/\D/g, "");
}

function slug(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function sanitizeFileName(value) {
  return String(value || "file").replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120);
}

function csvRows(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '"' && quoted && next === '"') {
      cell += '"';
      i++;
    } else if (ch === '"') {
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

async function buildXlsx(customers, title) {
  const headers = ["List Section", "Company", "Person", "Role", "Country", "City", "Phone", "Mobile", "Email", "Website", "Address", "Priority", "Status", "Data Quality", "Source Type", "Source ID", "Source Photo", "Notes"];
  const sorted = sortCustomerList(customers);
  const buyers = sorted.filter((c) => !isMiscellaneousContact(c));
  const miscellaneous = sorted.filter((c) => isMiscellaneousContact(c));
  const rows = [
    headers,
    ["Potential Buyers"],
    ...buyers.map(exportCustomerRow),
    [],
    ["Miscellaneous"],
    ...miscellaneous.map(exportCustomerRow)
  ];
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`);
  zip.folder("_rels").file(".rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  zip.folder("xl").file("workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${escapeXml(title.slice(0, 31))}" sheetId="1" r:id="rId1"/></sheets></workbook>`);
  zip.folder("xl").folder("_rels").file("workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  zip.folder("xl").file("styles.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Arial"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>`);
  zip.folder("xl").folder("worksheets").file("sheet1.xml", buildSheetXml(rows));
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

function exportCustomerRow(c) {
  return [
    c.listCategory || (isMiscellaneousContact(c) ? "Miscellaneous" : "Potential Buyer"),
    c.company,
    c.person,
    c.role,
    normalizeCountryName(c.country),
    c.city,
    c.phone,
    c.mobile,
    c.email,
    c.website,
    c.address,
    c.priority,
    getCustomerStatus(c),
    getDataQuality(c),
    c.sourceType,
    c.sourceId,
    c.sourcePhoto,
    c.notes
  ];
}

function buildSheetXml(rows) {
  const body = rows.map((row, rIdx) => {
    const cells = row.map((value, cIdx) => {
      const ref = `${colName(cIdx + 1)}${rIdx + 1}`;
      return `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(value || "")}</t></is></c>`;
    }).join("");
    return `<row r="${rIdx + 1}">${cells}</row>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
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

function colName(index) {
  let name = "";
  while (index > 0) {
    const mod = (index - 1) % 26;
    name = String.fromCharCode(65 + mod) + name;
    index = Math.floor((index - mod) / 26);
  }
  return name;
}

function escapeXml(value) {
  return String(value ?? "").replace(/[<>&'"]/g, (ch) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[ch]));
}
