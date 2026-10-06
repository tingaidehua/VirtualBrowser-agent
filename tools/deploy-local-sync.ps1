$ErrorActionPreference = "Stop"
$log = "C:\workspace\VirtualBrowser\tools\deploy-local-sync.log"
function L($m) { $line = "$(Get-Date -Format o) $m"; Add-Content -Path $log -Value $line; Write-Host $line }

L "START deploy"

# Ensure app is not running
Get-Process VirtualBrowser -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

$resources = "C:\Program Files\VirtualBrowser\resources"
$asar = Join-Path $resources "app.asar"
$asarBak = Join-Path $resources "app.asar.official.bak"
$appDir = Join-Path $resources "app"
$extract = "C:\workspace\VirtualBrowser\_asar_extract"
$localSyncSrc = "C:\workspace\VirtualBrowser\local-sync-ext"
$localSyncDst = Join-Path $resources "local-sync"

if (-not (Test-Path $extract)) { throw "extract missing: $extract" }
if (-not (Test-Path $localSyncSrc)) { throw "local-sync-ext missing" }

# Backup asar once
if ((Test-Path $asar) -and -not (Test-Path $asarBak)) {
  L "Backing up app.asar -> app.asar.official.bak"
  Move-Item -LiteralPath $asar -Destination $asarBak -Force
} elseif (Test-Path $asar) {
  L "Moving current app.asar aside"
  $tmp = Join-Path $resources ("app.asar.prev-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
  Move-Item -LiteralPath $asar -Destination $tmp -Force
}

# Remove old app dir/junction
if (Test-Path $appDir) {
  L "Removing existing resources/app"
  cmd /c "rmdir `"$appDir`"" | Out-Null
  if (Test-Path $appDir) {
    Remove-Item -LiteralPath $appDir -Recurse -Force
  }
}

# Junction extract -> resources/app
L "Creating junction resources/app -> extract"
cmd /c "mklink /J `"$appDir`" `"$extract`""
if (-not (Test-Path $appDir)) { throw "junction failed" }

# Copy local-sync extension beside resources
if (Test-Path $localSyncDst) { Remove-Item $localSyncDst -Recurse -Force }
L "Copy local-sync to resources"
Copy-Item $localSyncSrc $localSyncDst -Recurse -Force

# Ensure asar extract also has latest local-sync
$inApp = Join-Path $extract "dist\app\local-sync"
New-Item -ItemType Directory -Force -Path $inApp | Out-Null
Copy-Item (Join-Path $localSyncSrc "*") $inApp -Force

L "Deploy done"
L "app.js: $((Get-Content (Join-Path $appDir 'dist\app\app.js') -TotalCount 3) -join ' | ')"
Get-ChildItem $localSyncDst | ForEach-Object { L ("local-sync file: " + $_.Name) }
