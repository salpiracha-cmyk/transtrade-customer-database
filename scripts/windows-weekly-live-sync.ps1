$ErrorActionPreference = "Stop"

$AppRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$EnvPath = Join-Path $AppRoot ".env"
if (Test-Path $EnvPath) {
  Get-Content $EnvPath | ForEach-Object {
    $Line = $_.Trim()
    if (-not $Line -or $Line.StartsWith("#") -or -not $Line.Contains("=")) { return }
    $Parts = $Line.Split("=", 2)
    [Environment]::SetEnvironmentVariable($Parts[0].Trim(), $Parts[1].Trim().Trim('"').Trim("'"), "Process")
  }
}

$LogDir = if ($env:SYNC_LOG_DIR) { $env:SYNC_LOG_DIR } else { Join-Path $AppRoot "logs" }
$Stamp = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
$LogFile = Join-Path $LogDir "weekly-live-sync-$Stamp.log"

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
Set-Location $AppRoot

"[$(Get-Date -Format s)] Starting Transtrade weekly live sync" | Tee-Object -FilePath $LogFile
"App folder: $AppRoot" | Tee-Object -FilePath $LogFile -Append

node .\scripts\sync-live-database.mjs 2>&1 | Tee-Object -FilePath $LogFile -Append

if ($LASTEXITCODE -ne 0) {
  "[$(Get-Date -Format s)] Weekly live sync failed with exit code $LASTEXITCODE" | Tee-Object -FilePath $LogFile -Append
  exit $LASTEXITCODE
}

"[$(Get-Date -Format s)] Weekly live sync completed" | Tee-Object -FilePath $LogFile -Append
