param([int]$Port = 0, [switch]$Test)
$ErrorActionPreference = 'Stop'

# Tim JDK 17+ thay vi java/javac cu trong PATH cua may.
$jdkCandidates = @()
if ($env:JAVA_HOME) { $jdkCandidates += $env:JAVA_HOME }
foreach ($parent in @('C:\Program Files\Eclipse Adoptium', 'C:\Program Files\Java')) {
    if (Test-Path $parent) { $jdkCandidates += Get-ChildItem $parent -Directory | ForEach-Object FullName }
}
if (Test-Path "$env:USERPROFILE\.jdks") {
    $jdkCandidates += Get-ChildItem "$env:USERPROFILE\.jdks" -Directory | Sort-Object Name | ForEach-Object FullName
}
$compiler = Get-Command javac -ErrorAction SilentlyContinue
if ($compiler) { $jdkCandidates += Split-Path (Split-Path $compiler.Source) }
$jdk = $null
foreach ($candidate in $jdkCandidates) {
    $releaseFile = Join-Path $candidate 'release'
    if (!(Test-Path $releaseFile) -or !(Test-Path (Join-Path $candidate 'bin\javac.exe'))) { continue }
    $release = Get-Content $releaseFile -Raw
    if ($release -match 'JAVA_VERSION="(\d+)' -and [int]$Matches[1] -ge 17) { $jdk = $candidate; break }
}
if (!$jdk) { throw 'Can cai JDK 17 tro len va dat JAVA_HOME tro toi thu muc JDK.' }
$buildPath = Join-Path $PSScriptRoot 'build'
New-Item -ItemType Directory -Path $buildPath -Force | Out-Null
$sources = @(Get-ChildItem (Join-Path $PSScriptRoot 'src') -Filter '*.java' | ForEach-Object FullName)
if ($Test) { $sources += Get-ChildItem (Join-Path $PSScriptRoot 'tests') -Filter '*.java' | ForEach-Object FullName }
& "$jdk\bin\javac.exe" --release 17 -encoding UTF-8 -d $buildPath @sources
if ($LASTEXITCODE -ne 0) { throw 'Bien dich Java that bai.' }
if ($Test) {
    & "$jdk\bin\java.exe" -cp $buildPath DemoTest $PSScriptRoot
} elseif ($Port -gt 0) {
    & "$jdk\bin\java.exe" -cp $buildPath Main $PSScriptRoot $Port
} else {
    & "$jdk\bin\java.exe" -cp $buildPath Main $PSScriptRoot
}
if ($LASTEXITCODE -ne 0) { throw 'Chuong trinh Java dung voi loi.' }
