import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, "..");
const dbPath = process.env.MASTER_EXPORT_DB_PATH || path.join(rootDir, "data", "database.json");
const outputDir = process.env.MASTER_EXPORT_DIR || path.join(rootDir, "outputs", "weekly-master");
const today = new Date().toISOString().slice(0, 10);
const outputPath = path.join(outputDir, `TTI_Sales_Master_Live_Backup_${today}.xlsx`);

const db = JSON.parse(await fs.readFile(dbPath, "utf8"));
const active = (db.customers || []).filter((customer) => !customer.archivedAt);
const sorted = sortCustomerList(active);
const buyers = sorted.filter((customer) => !isMiscellaneousContact(customer));
const miscellaneous = sorted.filter(isMiscellaneousContact);
const rows = [
  ["List Section", "Company", "Person", "Role", "Country", "City", "Phone", "Mobile", "Email", "Website", "Address", "Priority", "Status", "Data Quality", "Source Type", "Source ID", "Source Photo", "Source File", "Source Sheet", "Notes"],
  ["Potential Buyers"],
  ...buyers.map(exportCustomerRow),
  [],
  ["Miscellaneous"],
  ...miscellaneous.map(exportCustomerRow)
];

await fs.mkdir(outputDir, { recursive: true });
const buffer = await buildXlsx(rows, "TTI Sales Master");
await fs.writeFile(outputPath, buffer);
await fs.writeFile(path.join(outputDir, "latest-master-workbook.txt"), outputPath);
console.log(`Master workbook updated: ${outputPath}`);

function exportCustomerRow(c) {
  return [
    isMiscellaneousContact(c) ? "Miscellaneous" : "Potential Buyer",
    c.company || "",
    c.person || "",
    c.role || "",
    c.country || "",
    c.city || "",
    c.phone || "",
    c.mobile || "",
    c.email || "",
    c.website || "",
    c.address || "",
    c.priority || "",
    getCustomerStatus(c),
    getDataQuality(c),
    c.sourceType || "",
    c.sourceId || "",
    c.sourcePhoto || "",
    c.sourceFile || "",
    c.sourceSheet || "",
    c.notes || ""
  ];
}

function getCustomerStatus(c) {
  if (!c.email && !c.mobile && !c.phone) return "incomplete";
  if (!c.email) return "missing_email";
  if (!c.mobile && !c.phone) return "missing_mobile";
  if ((c.sourceTrust || 0) < 60) return "needs_review";
  return "ready";
}

function getDataQuality(c) {
  if (!c.company || !c.country) return "research_needed";
  if (!c.email && !c.mobile && !c.phone) return "research_needed";
  if ((c.sourceTrust || 0) < 60) return "review";
  if (!c.email) return "phone_only";
  if (!c.mobile && !c.phone) return "email_only";
  return "clean";
}

function sortCustomerList(customers) {
  return [...customers].sort((a, b) => {
    const categoryDiff = (isMiscellaneousContact(a) ? 1 : 0) - (isMiscellaneousContact(b) ? 1 : 0);
    if (categoryDiff) return categoryDiff;
    const countryDiff = String(a.country || "").localeCompare(String(b.country || ""));
    if (countryDiff) return countryDiff;
    const companyDiff = String(a.company || "").localeCompare(String(b.company || ""));
    if (companyDiff) return companyDiff;
    return String(a.person || "").localeCompare(String(b.person || ""));
  });
}

function isMiscellaneousContact(customer) {
  const text = [customer.company, customer.person, customer.role, customer.notes, customer.email, customer.website]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return [
    /\bsgs\b/, /\binspection\b/, /\binspector\b/, /\binspections\b/, /\binspecteur\b/, /\binspect\b/,
    /\bsurvey\b/, /\bsurveillance\b/, /\bcotecna\b/, /\bbureau veritas\b/, /\bcontrol union\b/, /\bomic\b/,
    /\bembassy\b/, /\bconsulate\b/, /\bchamber\b/, /\bministry\b/, /\bminister\b/, /\bgovernment\b/,
    /\bsecretary\b/, /\bcounsellor\b/, /\bambassador\b/, /\btaxi\b/, /\bhotel\b/, /\bcourier\b/,
    /\bcargo\b/, /\blogistics\b/, /\bfreight\b/, /\bshipping\b/, /\bairline\b/, /\bsecurity\b/,
    /\bbank\b/, /\bbanking\b/, /\bexchange\b/, /\bfinance\b/, /\bfinancial\b/, /\binsurance\b/,
    /\bcredit\b/, /\bfinance corporation\b/, /\bsocial security\b/
  ].some((pattern) => pattern.test(text));
}

async function buildXlsx(dataRows, title) {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`);
  zip.folder("_rels").file(".rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  zip.folder("xl").file("workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${escapeXml(title.slice(0, 31))}" sheetId="1" r:id="rId1"/></sheets></workbook>`);
  zip.folder("xl").folder("_rels").file("workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  zip.folder("xl").file("styles.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><sz val="10"/><name val="Arial"/></font><font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Arial"/></font><font><b/><sz val="10"/><color rgb="FF103B2C"/><name val="Arial"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1F6F4A"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE7F1DF"/></patternFill></fill></fills><borders count="2"><border/><border><left style="thin"><color rgb="FFD9DFD2"/></left><right style="thin"><color rgb="FFD9DFD2"/></right><top style="thin"><color rgb="FFD9DFD2"/></top><bottom style="thin"><color rgb="FFD9DFD2"/></bottom></border></borders><cellXfs count="4"><xf fontId="0" fillId="0" borderId="1" xfId="0"/><xf fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1"/><xf fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1"/><xf fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment wrapText="0" vertical="top"/></xf></cellXfs></styleSheet>`);
  zip.folder("xl").folder("worksheets").file("sheet1.xml", worksheetXml(dataRows));
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

function worksheetXml(dataRows) {
  const rows = dataRows.map((row, rowIndex) => {
    const style = rowIndex === 0 ? 1 : row[0] === "Potential Buyers" || row[0] === "Miscellaneous" ? 2 : 3;
    const cells = row.map((value, colIndex) => {
      const ref = `${columnName(colIndex + 1)}${rowIndex + 1}`;
      return `<c r="${ref}" t="inlineStr" s="${style}"><is><t>${escapeXml(value || "")}</t></is></c>`;
    }).join("");
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols>${Array.from({ length: 20 }, (_, i) => `<col min="${i + 1}" max="${i + 1}" width="${i === 10 || i === 19 ? 42 : i === 1 ? 32 : 18}" customWidth="1"/>`).join("")}</cols><sheetData>${rows}</sheetData><autoFilter ref="A1:T${dataRows.length}"/></worksheet>`;
}

function columnName(index) {
  let name = "";
  while (index > 0) {
    const remainder = (index - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    index = Math.floor((index - 1) / 26);
  }
  return name;
}

function escapeXml(value) {
  return String(value ?? "").replace(/[<>&"']/g, (ch) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[ch]));
}
