// Retained as a read-only compatibility command. Row position is not evidence
// that a contact belongs to the previous company. Review the original source.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const dbPath = process.env.BUYER_APP_DB_PATH || path.join(root, "data", "database.json");
const db = JSON.parse(await fs.readFile(dbPath, "utf8"));
const candidates = (db.customers || []).filter(c => !c.archivedAt && !String(c.company || "").trim());
console.log(JSON.stringify({changed: 0, readOnly: true, reason: "Automatic company inheritance from nearby rows is disabled. Review original sources before assigning a company.", needsCompanyReview: candidates.length}, null, 2));
