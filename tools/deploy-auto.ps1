$ErrorActionPreference = "Stop"
$src = "C:\workspace\VirtualBrowser\local-sync-ext"
$dst = "C:\Program Files\VirtualBrowser\resources\local-sync"
$extract = "C:\workspace\VirtualBrowser\_asar_extract\dist\app\local-sync"
Get-Process VirtualBrowser -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
New-Item -ItemType Directory -Force -Path $dst | Out-Null
New-Item -ItemType Directory -Force -Path $extract | Out-Null
Copy-Item "$src\*" $dst -Force
Copy-Item "$src\*" $extract -Force
"OK $(Get-Date -Format o)" | Set-Content "C:\workspace\VirtualBrowser\tools\deploy-auto.log"
Get-ChildItem $dst | ForEach-Object { "$($_.Name) $($_.Length) $($_.LastWriteTime)" } | Add-Content "C:\workspace\VirtualBrowser\tools\deploy-auto.log"
