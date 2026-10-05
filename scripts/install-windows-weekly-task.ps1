$ErrorActionPreference = "Stop"

$TaskName = "Transtrade Customer Database Weekly Sync"
$AppRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Runner = Join-Path $AppRoot "scripts\windows-weekly-live-sync.ps1"

if (-not (Test-Path $Runner)) {
  throw "Cannot find weekly sync runner at $Runner"
}

$Action = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$Runner`"" `
  -WorkingDirectory $AppRoot

$Trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday -At 3:30PM
$Settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Hours 2)

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $Action `
  -Trigger $Trigger `
  -Settings $Settings `
  -Description "Updates Transtrade live buyer database and refreshes local Excel master workbook every Monday." `
  -Force | Out-Null

Write-Host "Installed Windows Task Scheduler job: $TaskName"
Write-Host "Schedule: every Monday at 3:30 PM"
Write-Host "App folder: $AppRoot"
Write-Host "Runner: $Runner"
