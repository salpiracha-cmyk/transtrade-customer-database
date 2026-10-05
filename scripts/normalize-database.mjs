import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.join(__dirname, "..", "data", "database.json");

const db = JSON.parse(await fs.readFile(dbPath, "utf8"));
let changed = 0;

for (const customer of db.customers || []) {
  const country = normalizeCountryName(customer.country);
  if ((customer.country || "") !== country) {
    customer.country = country;
    customer.updatedAt ||= new Date().toISOString();
    changed++;
  }
}

await fs.writeFile(dbPath, `${JSON.stringify(db, null, 2)}\n`);
console.log(`Normalized ${changed} customer countries.`);

function normalizeText(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\s+/g, " ").trim();
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
    westafrica: "West Africa"
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

function slug(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}
