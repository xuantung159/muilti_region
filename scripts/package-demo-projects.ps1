$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
Add-Type -AssemblyName System.IO.Compression
$languages = @(
  @{ Id='javascript'; Label='JavaScript'; File='main.mjs'; Tool='Node.js 22+'; Check='node --version'; Run='node --env-file=.env main.mjs' },
  @{ Id='java'; Label='Java'; File='Main.java'; Tool='JDK 17+'; Check='java --version'; Run='java Main.java' },
  @{ Id='python'; Label='Python'; File='main.py'; Tool='Python 3.10+'; Check='python --version'; Run='python main.py' }
)
foreach ($language in $languages) {
  $destination = Join-Path $repo "monitoring-web/public/samples/mrapi-$($language.Id).zip"
  $readme = @"
# Project MRAPI - $($language.Label)

Yeu cau: $($language.Tool). Khong can package ngoai.
Huong dan tieng Viet: https://app.multi-region.io.vn/portal -> Huong dan -> Thuc hanh -> $($language.Label).

1. Giai nen, mo PowerShell tai thu muc co $($language.File). Kiem tra: $($language.Check).
2. Thu backend: curl.exe -i https://jsonplaceholder.typicode.com/todos/1 (can HTTP 200).
3. Dang nhap tai khoan that tren Cong doanh nghiep, khong dung che do DEMO PORTAL.
4. API dich: ten API Todo demo, URL https://jsonplaceholder.typicode.com, timeout 5000. Dang ky va sao chep API ID.
5. API key: ten Project $($language.Label) Todo, tich API Todo demo, Tao key. Sao chep secret mrk_ ngay.
6. Tao file cau hinh: Copy-Item .env.example .env; notepad .env. Dien API ID va key cua ban, luu Ctrl+S.
7. Chay: $($language.Run)
8. Can HTTP 200, region ap-southeast-1 hoac ap-northeast-1, JSON Todo id=1 va title=delectus aut autem.
   Portal -> Tong quan -> 1 gio -> Lam moi de xem telemetry. Co the cap nhat cham.

Lap 5 request: 1..5 | ForEach-Object { $($language.Run) }
Thu thieu key (thay API_ID_CUA_BAN): curl.exe -i https://api.multi-region.io.vn/proxy/API_ID_CUA_BAN/todos/1
Can HTTP 401. Request bi authorizer chan khong tinh trong telemetry proxy.

.env nam cung thu muc voi $($language.File), khong phai .env.txt. Khong them dau nhay quanh gia tri.
Bien moi truong he thong duoc uu tien hon .env. Khong commit .env hoac dua key vao frontend.
401/403: kiem tra secret, API ID, pham vi va trang thai key. 404: dung /todos/1, khong dung /orders.
502/504: kiem tra backend truc tiep va URL da dang ky. Khong tu dong theo redirect de tranh chuyen key sang host khac.
Kiem tra ket noi vuot 15 giay se bao loi; Java gioi han timeout ket noi va request.
"@
  $archive = [System.IO.Compression.ZipArchive]::new([System.IO.File]::Open($destination,[System.IO.FileMode]::Create),[System.IO.Compression.ZipArchiveMode]::Create)
  try {
    $source = Join-Path $repo "monitoring-web/src/portal/demo-projects/$($language.Id)/$($language.File)"
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive,$source,$language.File) | Out-Null
    foreach ($name in @('.env.example','.gitignore')) { [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive,(Join-Path $repo "project_test/$name"),$name) | Out-Null }
    $entry = $archive.CreateEntry('README.md'); $writer = [System.IO.StreamWriter]::new($entry.Open(),[System.Text.UTF8Encoding]::new($false))
    try { $writer.Write($readme) } finally { $writer.Dispose() }
  } finally { $archive.Dispose() }
  Write-Output "Packaged $($language.Label)"
}
