# Vong do failover chay tren may local. Moi lan goi mo ket noi moi bang curl.exe.
# Dung: powershell -File measure.ps1 -OutFile run-N.csv -Seconds 1500 -Interval 5
param([string]$OutFile, [int]$Seconds = 1500, [int]$Interval = 5)
$url = 'https://api.multi-region.io.vn/health'
$hostName = 'api.multi-region.io.vn'
"timestamp_utc,http_status,x_served_region,dns_ip,connected_ip" | Out-File -FilePath $OutFile -Encoding ascii
$end = (Get-Date).AddSeconds($Seconds)
while ((Get-Date) -lt $end) {
  $tick = Get-Date
  $ts = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
  try { $dns = (Resolve-DnsName $hostName -Type A -ErrorAction Stop | Where-Object { $_.IPAddress } | Select-Object -ExpandProperty IPAddress) -join ';' } catch { $dns = 'DNS_ERROR' }
  $tmp = [System.IO.Path]::GetTempFileName()
  $out = & curl.exe -s -o NUL -D $tmp --max-time 4 -w '%{http_code} %{remote_ip}' $url
  $parts = "$out".Split(' ')
  $region = ''
  foreach ($line in (Get-Content $tmp)) { if ($line -match '^(?i)x-served-region:\s*(\S+)') { $region = $Matches[1] } }
  Remove-Item $tmp -ErrorAction SilentlyContinue
  "$ts,$($parts[0]),$region,$dns,$($parts[1])" | Out-File -FilePath $OutFile -Encoding ascii -Append
  $wait = $Interval - ((Get-Date) - $tick).TotalSeconds
  if ($wait -gt 0) { Start-Sleep -Milliseconds ([int]($wait * 1000)) }
}
