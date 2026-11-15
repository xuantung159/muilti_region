# Request HTTPS that tu nhieu nuoc toi api.multi-region.io.vn qua mang probe Globalping (globalping.io).
# Moi probe la mot may that o nuoc do: tu phan giai DNS bang resolver cua no, goi HTTPS, tra header.
# Doc X-Served-Region de thay Route 53 latency routing dua tung nuoc ve Region nao.
#
# Chay:  powershell -ExecutionPolicy Bypass -File scripts\demo-geo-globalping.ps1
#        ... -Countries VN,DE,US          (chon nuoc)
#        ... -Path /proxy/<apiId>/products -ApiKey <key TAM>   (tinh vao dashboard)
#
# Canh bao -ApiKey: key duoc gui toi probe cua ben thu ba (tinh nguyen vien). Chi dung key tao rieng
# cho demo, thu hoi ngay sau khi chay. Khong dung key production.
# Khong can tai khoan: gioi han khoang 250 probe/gio cho moi IP.

param(
  [string]$Target = 'api.multi-region.io.vn',
  [string]$Path = '/health',
  [string[]]$Countries = @('VN','SG','HK','ID','IN','AU','AE','ZA','DE','GB','FR','JP','KR','US','CA','BR'),
  [string]$ApiKey
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$request = @{ method = 'GET'; path = $Path }
if ($ApiKey) { $request.headers = @{ 'x-api-key' = $ApiKey } }

$body = @{
  type      = 'http'
  target    = $Target
  locations = @($Countries | ForEach-Object { @{ country = $_; limit = 1 } })
  measurementOptions = @{ protocol = 'HTTPS'; request = $request }
} | ConvertTo-Json -Depth 6

Write-Host "Gui request tu $($Countries.Count) nuoc toi https://$Target$Path ..."
$m = Invoke-RestMethod -Method Post -Uri 'https://api.globalping.io/v1/measurements' -ContentType 'application/json' -Body $body
Write-Host "Measurement $($m.id), $($m.probesCount) probe. Link cong khai: https://globalping.io/?measurement=$($m.id)"

do {
  Start-Sleep -Milliseconds 1500
  $r = Invoke-RestMethod -Uri "https://api.globalping.io/v1/measurements/$($m.id)"
} while ($r.status -eq 'in-progress')

$rows = foreach ($x in $r.results) {
  $h = $x.result.headers
  $served = if ($h) { $h.'x-served-region' } else { $null }
  if ($served -is [array]) { $served = $served[0] }
  [pscustomobject]@{
    'Nuoc'          = $x.probe.country
    'Thanh pho'     = $x.probe.city
    'Nha mang'      = ($x.probe.network -replace '^(.{24}).+$', '$1...')
    'IP tra ve'     = $x.result.resolvedAddress
    'HTTP'          = $x.result.statusCode
    'Region phuc vu'= if ($served) { $served } else { "(loi: $($x.result.status))" }
    'Tong (ms)'     = $x.result.timings.total
  }
}

$rows | Sort-Object 'Region phuc vu', 'Nuoc' | Format-Table -AutoSize
Write-Host 'Tong ket:'
$rows | Group-Object 'Region phuc vu' | ForEach-Object { '  {0}: {1} nuoc ({2})' -f $_.Name, $_.Count, (($_.Group.'Nuoc' | Sort-Object) -join ', ') }
$missing = $Countries | Where-Object { $_ -notin $rows.'Nuoc' }
if ($missing) { Write-Host "Khong co probe ranh o: $($missing -join ', ')" }
