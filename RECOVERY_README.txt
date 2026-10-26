TRANSTRADE BUYERS — RECOVERY

The Windows setup downloads Excel exports and a complete private recovery snapshot. The snapshot includes application code, data/database.json, data/users.json, imports, uploads/cards and .env when present. Keep this folder private: it contains customer records, login hashes and server API keys. Do not commit or share it publicly.

RESTORE: Open TTI_Buyers_Setup.exe, choose Restore Saved Folder, select the dated snapshot with TTI_RECOVERY_MANIFEST.json, then choose an EMPTY destination. The tool verifies every file, copies the full tree, and disables outreach sending in the restored .env to prevent queued campaigns sending again. It never automatically uploads or overwrites the running website.

NEW HOSTING: The restored app requires Node.js 20 or later and tar on the server. Deploy the restored folder with its data, imports, uploads and .env. Install dependencies using npm ci, set hosting startup to node server.js, and configure HOST/PORT for the new host. Preserve users.json; old account hashes remain. Existing API keys and mail settings are in the private snapshot; review domain/mail configuration for new hosting. Do not enable outreach until queued campaign history is reviewed.

A source-code-only ZIP is NOT a live-data backup. A dated recovery snapshot produced successfully by the Windows EXE is the full recovery copy. Excel files alone cannot restore cards, users, campaign history or server settings.

Default PC save folder: E:\TTI DOCS\buyer list by APP
Default schedule: Monday 15:30, Windows local time. Keep Windows configured for Pakistan time if 15:30 Pakistan is intended. PC must be on and the installing user signed in. Missed runs catch up at the next sign-in. Login is encrypted for that Windows user; enter login again on a replacement PC.
