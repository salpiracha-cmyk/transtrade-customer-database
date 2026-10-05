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
