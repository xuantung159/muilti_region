$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
$outputRoot = Join-Path $repo 'artifacts/language-demos'
New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
$results = @()
foreach ($demo in @(
  @{ Id='javascript'; Command='C:\Program Files\nodejs\node.exe'; Args=@('--env-file=.env','main.mjs') },
  @{ Id='java'; Command='D:\Code\Tools\Java\jdk-24.0.2\bin\java.exe'; Args=@('Main.java') },
  @{ Id='python'; Command='C:\Users\dxtun\AppData\Local\Programs\Python\Python314\python.exe'; Args=@('main.py') }
)) {
  $work = Join-Path $outputRoot $demo.Id
  New-Item -ItemType Directory -Path $work -Force | Out-Null
  Expand-Archive -LiteralPath (Join-Path $repo "monitoring-web/public/samples/mrapi-$($demo.Id).zip") -DestinationPath $work -Force
  Copy-Item -LiteralPath (Join-Path $repo 'project_test/.env') -Destination (Join-Path $work '.env')
  Push-Location $work
  try {
    $demoArgs = $demo.Args
    $lines = & $demo.Command @demoArgs
    if ($LASTEXITCODE -ne 0) { throw "$($demo.Id) failed" }
    $textResult = $lines -join "`n"
    if ($textResult -notmatch 'HTTP 200' -or $textResult -notmatch 'delectus aut autem') { throw 'Unexpected demo response' }
    $results += @{ language=$demo.Id; status=200; result=$textResult }
    Write-Output "$($demo.Id): $($lines[0])"
  } finally { Pop-Location }
}
@{ verifiedAt=[DateTimeOffset]::Now.ToString('o'); tests=$results } | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $outputRoot 'verification.json') -Encoding utf8
