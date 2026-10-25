# Transtrade Customer Database

Separate local-first customer database app for buyer lists, card-derived contacts, duplicate review, country filters, archive/delete workflow, and Excel-compatible exports.

## Run

```bash
npm start
```

Open `http://localhost:4177`.

If `node` is not on PATH in this Codex workspace, run:

```bash
/Users/salmanpiracha/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node server.js
```

## Current Scope

- Manual customer entry
- CSV/XLSX import
- TTI card master import mapping
- Source trust tracking
- Duplicate detection
- Archive and restore
- Master and country export as `.xlsx`
- Local JSON storage under `data/database.json`
- Card upload storage under `uploads/cards`

## Production Notes

### Company cleanup and retained cards

Click a company name in Customers or Dashboard search to see its contact details and retained card images. Missing server image files are identified explicitly; source references are preserved. Merged records keep all email addresses, phone numbers, people, remarks, aliases and card references, while original rows are archived and recoverable.

Duplicates → Review all company duplicates loads a complete review of matching company names within the same country, including records with different people. Select reviewed identities before merging. The server checks the review fingerprint, saves a private pre-cleanup database backup, and refuses stale plans. Name variants and businesses in different countries require separate identity review; no fuzzy merge runs automatically.

The Dashboard's Explain counts distinguishes records with email fields from unique mailboxes and groups counts by import source. Neither measure claims delivery verification or a unique company count.

Run the isolated merge/card/count tests with `node --test tests/company-cleanup.test.js`. No production database is used by these tests.

Deploy `server.js`, `lib/company-records.js` and the `public` assets together, then restart the Node application. Preserve the live `data`, `uploads`, `imports` and environment settings. Do not upload a stale database or use restore-database to deploy code. A repository commit does not prove deployment on Hostinger; check the deployed interface before cleanup.

This app needs Node.js hosting because it has a backend for imports, exports, card uploads, OCR/AI, and outreach status.

Keep these values in the hosting environment, not in GitHub:

- `APP_USER`
- `APP_PASSWORD`
- `GEMINI_API_KEY`
- `GEMINI_MODEL`
- `RESEND_API_KEY`
- `RESEND_FROM_NAME`
- `RESEND_FROM_EMAIL`
- `RESEND_DOMAIN`
- `OUTREACH_SEND_ENABLED`

The live database and card uploads are intentionally excluded from GitHub:

- `data/database.json`
- `imports/`
- `uploads/cards/`

Move those to the server separately during deployment.

OCR, local AI enrichment, and outreach account status are available. Bulk outreach sending should remain disabled until unsubscribe pages, bounce/complaint webhooks, and suppression checks are live.
