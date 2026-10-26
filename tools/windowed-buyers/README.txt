TTI BUYERS BACKUP AND RECOVERY — WINDOWED EDITION

Extract ALL files, then double-click TTI_Buyers_Backup.exe.
The EXE contains its Python scripts; keep Python installed.
Requires installed Python 3.12 or newer with Tcl/Tk.
Enter the website administrator login, then Install / Update Monday Setup.
Wait for schedule installed and verified, then SUCCESS for the first backup.

Defaults: Monday 15:30 local PC time; E:\TTI DOCS\buyer list by APP.
Change these in the window and click Install / Update Monday Setup.
Keep the PC on and the installing Windows user signed in.
The password is protected using Windows DPAPI for that user.
The schedule uses installed Python; do not uninstall or move Python afterward.

Version 1.5: Excel files update in their existing folders as each download is
validated; unchanged files are left alone. A later failure does not undo these
Excel updates, and FAILED means the full requested backup did not finish.
Recovery/Current contains the most recent complete verified recovery.
Recovery/Previous retains the preceding complete recovery. Older dated snapshots
are left untouched. A complete archive is still downloaded on every recovery run;
this version does not yet transfer only changed server files.
UTF-8 database and settings text is read explicitly, independent of Windows locale.

Open Save Folder shows exports and the Current recovery folder.
Open Logs shows activity.log and status.json. Restore Saved Folder accepts the
main save folder and restores Current to an EMPTY folder (Previous if Current is
missing, or a legacy dated snapshot when neither exists).
It prepares files; it does not deploy them onto a replacement hosting server.
This utility ZIP does not contain your live database or server credentials.

This is a small ordinary .NET Windows launcher with readable Python source.
It does not bundle a runtime, use obfuscation, disable antivirus, or add exclusions.
It is not code-signed. A scan result does not guarantee acceptance by every
antivirus or Windows reputation policy. If blocked, stop and share the detection.
See the included Defender scan report for the build's actual scan result.


PEN DRIVE: After SUCCESS, copy the WHOLE buyer list by APP folder, including
Recovery, to the pen drive, plus this EXE and README. The EXE alone has no data.
Keep the old pen-drive copy until the replacement copy finishes successfully.
RESTORE: Open the EXE, choose Restore Saved Folder, select the copied main folder,
then choose a separate EMPTY destination. Checksums are checked before and after
copying. Restored outreach sending is disabled. Hosting setup and Node.js may be
needed to RUN the restored website; this backup utility itself uses Python.
