import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, "..");
const label = "com.transtrade.customerdb.live-sync";
const launchAgentsDir = path.join(os.homedir(), "Library", "LaunchAgents");
const logsDir = path.join(os.homedir(), "Library", "Logs", "TranstradeCustomerDatabase");
const plistPath = path.join(launchAgentsDir, `${label}.plist`);
const syncScript = path.join(rootDir, "scripts", "sync-live-database.mjs");

await fs.mkdir(launchAgentsDir, { recursive: true });
await fs.mkdir(logsDir, { recursive: true });

const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${process.execPath}</string>
    <string>${syncScript}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${rootDir}</string>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Weekday</key>
    <integer>1</integer>
    <key>Hour</key>
    <integer>9</integer>
    <key>Minute</key>
    <integer>0</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>${path.join(logsDir, "weekly-live-sync.log")}</string>
  <key>StandardErrorPath</key>
  <string>${path.join(logsDir, "weekly-live-sync.err.log")}</string>
  <key>RunAtLoad</key>
  <false/>
</dict>
</plist>
`;

await fs.writeFile(plistPath, plist);

try {
  await execFileAsync("launchctl", ["bootout", `gui/${process.getuid()}`, plistPath]);
} catch {}
await execFileAsync("launchctl", ["bootstrap", `gui/${process.getuid()}`, plistPath]);
await execFileAsync("launchctl", ["enable", `gui/${process.getuid()}/${label}`]);

console.log(`Weekly live sync installed: ${plistPath}`);
console.log("Schedule: every Monday at 09:00 on this Mac.");
console.log(`Logs: ${logsDir}`);
