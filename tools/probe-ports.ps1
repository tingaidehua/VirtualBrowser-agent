try { $r = Invoke-RestMethod "http://127.0.0.1:9000/api/getBrowserRunningList" -TimeoutSec 3; $r | ConvertTo-Json -Depth 5 } catch { Write-Host "9000 fail: $_" }
try { $r = Invoke-RestMethod "http://127.0.0.1:9000/api/getRuningBrowser" -TimeoutSec 3; $r | ConvertTo-Json -Depth 5 } catch { Write-Host "9000 runing fail: $_" }
foreach ($port in 9222,9224,9225,9000) {
  try {
    $j = Invoke-RestMethod "http://127.0.0.1:$port/json/version" -TimeoutSec 2
    Write-Host "PORT $port VERSION:" ($j | ConvertTo-Json -Compress)
  } catch { Write-Host "PORT $port no version" }
  try {
    $list = Invoke-RestMethod "http://127.0.0.1:$port/json/list" -TimeoutSec 2
    Write-Host "PORT $port LIST count=$($list.Count)"
    $list | Select-Object -First 5 | ForEach-Object { Write-Host " -" $_.title $_.url }
  } catch { Write-Host "PORT $port no list" }
}
