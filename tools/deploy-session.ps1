$ErrorActionPreference="Stop"
$src="C:\workspace\VirtualBrowser\local-sync-ext"
$dst="C:\Program Files\VirtualBrowser\resources\local-sync"
$extract="C:\workspace\VirtualBrowser\_asar_extract\dist\app\local-sync"
Get-Process VirtualBrowser -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep 2
Copy-Item "$src\*" $dst -Force
Copy-Item "$src\*" $extract -Force
# Keep session-restore pointing to env 1 for first boot test if empty - will be overwritten when running
$sess = "$env:LOCALAPPDATA\VirtualBrowser\session-restore.json"
if (-not (Test-Path $sess)) {
  '{"runningIds":["1"],"savedAt":0}' | Set-Content $sess -Encoding UTF8
} else {
  # ensure 1 is recorded since we launched it in probe
  $j = Get-Content $sess -Raw | ConvertFrom-Json
  if (-not $j.runningIds) { $j | Add-Member runningIds @("1") -Force }
  if ($j.runningIds -notcontains "1") { $j.runningIds += "1" }
  $j.savedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  $j | ConvertTo-Json | Set-Content $sess -Encoding UTF8
}
"deployed $(Get-Date -Format o)" | Set-Content "C:\workspace\VirtualBrowser\tools\deploy-session.log"
Get-Content $sess | Add-Content "C:\workspace\VirtualBrowser\tools\deploy-session.log"
