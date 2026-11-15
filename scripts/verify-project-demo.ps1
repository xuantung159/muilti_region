$ErrorActionPreference = 'Stop'
$workspace = Split-Path $PSScriptRoot -Parent
$demoConfig = @{}
Get-Content (Join-Path $workspace 'project_test/.env') | ForEach-Object {
  if ($_ -match '^(MRAPI_\w+)=(.*)$') { $demoConfig[$Matches[1]] = $Matches[2].Trim() }
}
if (!$demoConfig.MRAPI_API_KEY -or !$demoConfig.MRAPI_API_ID) { throw 'Missing existing project configuration' }
$client = [System.Net.Http.HttpClient]::new([System.Net.Http.HttpClientHandler]@{ AllowAutoRedirect = $false })
$client.Timeout = [TimeSpan]::FromSeconds(20)
$results = @()
try {
  foreach ($test in @(
    @{ Name = 'Upstream'; Base = 'https://jsonplaceholder.typicode.com'; Proxy = $false; Key = $false; Expected = 200 },
    @{ Name = 'Singapore'; Base = 'https://43vakggyh5.execute-api.ap-southeast-1.amazonaws.com/demo'; Proxy = $true; Key = $true; Expected = 200 },
    @{ Name = 'Tokyo'; Base = 'https://n39r5pits8.execute-api.ap-northeast-1.amazonaws.com/demo'; Proxy = $true; Key = $true; Expected = 200 },
    @{ Name = 'Latency domain'; Base = 'https://api.multi-region.io.vn'; Proxy = $true; Key = $true; Expected = 200 },
    @{ Name = 'Missing key'; Base = 'https://api.multi-region.io.vn'; Proxy = $true; Key = $false; Expected = 401 },
    @{ Name = 'Invalid key'; Base = 'https://api.multi-region.io.vn'; Proxy = $true; Key = $true; Invalid = $true; Expected = 401 }
  )) {
    $path = if ($test.Proxy) { '/proxy/' + $demoConfig.MRAPI_API_ID + '/todos/1' } else { '/todos/1' }
    $request = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::Get, $test.Base + $path)
    if ($test.Key) { $secret = if ($test.Invalid) { 'mrk_invalid_demo_key' } else { $demoConfig.MRAPI_API_KEY }; $request.Headers.Add('x-api-key', $secret) }
    $timer = [Diagnostics.Stopwatch]::StartNew()
    $response = $client.SendAsync($request).GetAwaiter().GetResult()
    $body = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
    $timer.Stop()
    $status = [int]$response.StatusCode
    $region = if ($response.Headers.Contains('x-served-region')) { ($response.Headers.GetValues('x-served-region') -join ',') } else { $null }
    if ($status -ne $test.Expected) { throw "$($test.Name): expected $($test.Expected), received $status" }
    if ($status -eq 200) { $todo = $body | ConvertFrom-Json; if ($todo.id -ne 1 -or $todo.title -ne 'delectus aut autem') { throw 'Unexpected Todo response' } }
    $results += [ordered]@{ name = $test.Name; status = $status; region = $region; durationMs = $timer.ElapsedMilliseconds; body = ($body | ConvertFrom-Json) }
    Write-Output "$($test.Name): HTTP $status; region=$region; $($timer.ElapsedMilliseconds) ms"
    $request.Dispose(); $response.Dispose()
  }
  $record = [ordered]@{ verifiedAt = [DateTimeOffset]::Now.ToString('o'); project = 'project_test (Go)'; upstream = 'https://jsonplaceholder.typicode.com'; path = '/todos/1'; tests = $results }
  $target = Join-Path $workspace 'artifacts/project-demo'
  New-Item -ItemType Directory -Path $target -Force | Out-Null
  $record | ConvertTo-Json -Depth 10 | Set-Content (Join-Path $target 'verification.json') -Encoding utf8
} finally { $client.Dispose(); $demoConfig.Clear(); $secret = $null }
