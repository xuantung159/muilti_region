# Vong do CloudFront failover tren may local. Moi lan goi mo ket noi moi bang curl.exe.
# Do dong thoi app.* (qua CloudFront) va api.* (Route 53 truc tiep).
# Dung: powershell -File measure-app-api.ps1 -OutFile cf-run.csv -Seconds 900 -Interval 5
param([string]$OutFile, [int]$Seconds = 900, [int]$Interval = 5)
$urls = @('https://app.multi-region.io.vn/health', 'https://api.multi-region.io.vn/health')
"timestamp_utc,target,http_status,x_served_region,x_amz_cf_pop,connected_ip" | Out-File -FilePath $OutFile -Encoding ascii
$end = (Get-Date).AddSeconds($Seconds)
while ((Get-Date) -lt $end) {
  $tick = Get-Date
  foreach ($url in $urls) {
    $ts = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    $tmp = [System.IO.Path]::GetTempFileName()
    $out = & curl.exe -s -o NUL -D $tmp --max-time 4 -w '%{http_code} %{remote_ip}' $url
    $parts = "$out".Split(' ')
    $region = ''; $pop = ''
    foreach ($line in (Get-Content $tmp)) {
      if ($line -match '^(?i)x-served-region:\s*(\S+)') { $region = $Matches[1] }
      if ($line -match '^(?i)x-amz-cf-pop:\s*(\S+)') { $pop = $Matches[1] }
    }
    Remove-Item $tmp -ErrorAction SilentlyContinue
    $name = ([uri]$url).Host.Split('.')[0]
    "$ts,$name,$($parts[0]),$region,$pop,$($parts[1])" | Out-File -FilePath $OutFile -Encoding ascii -Append
  }
  $wait = $Interval - ((Get-Date) - $tick).TotalSeconds
  if ($wait -gt 0) { Start-Sleep -Milliseconds ([int]($wait * 1000)) }
}
