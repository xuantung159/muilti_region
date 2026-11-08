# Kịch bản quay video demo — Multi-Region API Platform

Thời lượng dự kiến: 18–22 phút (không tính cảnh failover tùy chọn). Mỗi cảnh ghi: **mở gì → bấm vào đâu → gõ lệnh gì → trên màn hình phải thấy gì → nói gì**.

Tài khoản AWS `138150704839`. Singapore = `ap-southeast-1`, Tokyo = `ap-northeast-1`.

---

## 0. Chuẩn bị trước khi bấm quay (không quay)

1. Đăng nhập AWS Console (IAM user + MFA). Che hoặc cắt phần tên user, email nếu không muốn lộ.
2. Mở sẵn các tab trình duyệt theo đúng thứ tự dưới đây để khi quay chỉ cần chuyển tab:

| Tab | Mở URL | Dùng ở cảnh |
|---|---|---|
| 1 | https://app.multi-region.io.vn/portal | 2, 3, 9 |
| 2 | https://ap-southeast-1.console.aws.amazon.com/route53/v2/hostedzones | 5 |
| 3 | https://ap-southeast-1.console.aws.amazon.com/apigateway/main/apis?region=ap-southeast-1 | 1, 4 |
| 4 | https://ap-southeast-1.console.aws.amazon.com/lambda/home?region=ap-southeast-1#/functions | 1, 4 |
| 5 | https://ap-southeast-1.console.aws.amazon.com/dynamodbv2/home?region=ap-southeast-1#tables | 6 |
| 6 | https://s3.console.aws.amazon.com/s3/buckets?region=ap-southeast-1 | 7 |
| 7 | https://ap-southeast-1.console.aws.amazon.com/cloudwatch/home?region=ap-southeast-1#dashboards/dashboard/mrapi-overview | 8 |
| 8 | https://ap-southeast-1.console.aws.amazon.com/cloudshell/home?region=ap-southeast-1 | 6, 7, 8 |
| 9 | https://ap-southeast-1.console.aws.amazon.com/xray/home?region=ap-southeast-1#/service-map | 8 |

3. Mở **PowerShell** trên máy, `cd D:\BTL\aws`, phóng to chữ (Ctrl + lăn chuột) cho dễ đọc. Chạy trước `npm ci --prefix src` để lúc quay không phải chờ cài.
4. Chuẩn bị một email demo chưa dùng, ví dụ `demo-video-01@example.com`, và một mật khẩu tạm.
5. Tắt thông báo Windows/Zalo/Messenger. Không mở file `exports/ducminh_credentials.csv` khi quay.
6. Kiểm nhanh hệ thống còn sống:

```powershell
curl.exe -s https://api.multi-region.io.vn/health
```

Phải thấy `{"status":"ok"...}`. Nếu không, đừng quay, kiểm tra lại trước.

---

## Cảnh 1 — Giới thiệu kiến trúc (2 phút)

**Màn hình:** slide kiến trúc trong `docs/reports/Final-report.pptx`, hoặc bảng trong `infra/DEPLOYED_STATE.md`.

**Nói:** "Hệ thống là gateway API cho nhiều doanh nghiệp, chạy song song ở hai Region Singapore và Tokyo. Người dùng vào `app.multi-region.io.vn` qua CloudFront. API đi qua `api.multi-region.io.vn`; Route 53 chọn Region gần nhất theo độ trễ và bỏ Region hỏng nhờ health check. Mỗi Region có API Gateway, Lambda (proxy, authorizer, dashboard, monitoring), dữ liệu nằm trong DynamoDB Global Tables, file export trong S3 có replication hai chiều. Giám sát bằng CloudWatch, X-Ray, SNS và Budget."

**Chuyển sang Tab 3 (API Gateway, Singapore):**
- Chỉ vào API `mrapi-api-sg` (ID `43vakggyh5`).
- Đổi Region góc phải trên sang **Asia Pacific (Tokyo)** → thấy `mrapi-api-tyo` (ID `n39r5pits8`).
- **Nói:** "Hai Region dùng cùng một bản code, cùng cấu trúc route."

**Chuyển sang Tab 4 (Lambda, Singapore):** chỉ 5 hàm `mrapi-proxy`, `mrapi-authorizer`, `mrapi-dashboard`, `mrapi-monitoring`, `mrapi-exporter`. Đổi sang Tokyo → 4 hàm (exporter chỉ chạy ở Singapore theo thiết kế).

---

## Cảnh 2 — Doanh nghiệp đăng ký và tạo API đích (2 phút)

**Tab 1 — Portal** `https://app.multi-region.io.vn/portal`

1. Chọn **Đăng ký doanh nghiệp**, nhập **Tên doanh nghiệp** `Demo Video`, **Email** `demo-video-01@example.com`, **Mật khẩu** tạm → bấm **Đăng ký**. Thấy vào trang **Tổng quan**.
2. Mở tab **API đích** → **Đăng ký API đích**:
   - **Tên API**: `httpbin-demo`
   - **URL backend**: `https://httpbin.org`
   - Bấm **Đăng ký API**. Thấy API mới trong danh sách, **ghi lại giá trị `ID:`** hiển thị dưới tên API.
3. Thử đăng ký thêm một API có **URL backend** `http://127.0.0.1` → portal báo lỗi.
   **Nói:** "Hệ thống chặn đăng ký địa chỉ nội bộ để tránh tấn công SSRF."

---

## Cảnh 3 — Tạo API key có phạm vi (1 phút)

**Tab 1 — Portal**, tab **API key**:

1. **Tên ứng dụng**: `key-video`. Ở **API được phép gọi**, chỉ tích `httpbin-demo` → bấm **Tạo key**.
2. Portal hiện key **một lần duy nhất** (có dòng "← sao chép giá trị này"). Sao chép key.
   **Khi dựng video: làm mờ chuỗi key.**
   **Nói:** "Key chỉ hiện một lần. Trong DynamoDB chỉ lưu bản băm, không lưu key gốc."

---

## Cảnh 4 — Gọi API qua gateway, kiểm tra phân quyền (3 phút)

**PowerShell**. Dán key và apiId vào biến (không quay lúc dán key, hoặc làm mờ):

```powershell
$KEY = "<dán key vừa sao chép>"
$API = "<apiId của httpbin-demo>"
$GW  = "https://api.multi-region.io.vn"
```

**4.1 Key đúng → 200**

```powershell
curl.exe -i -X POST "$GW/proxy/$API/anything/orders?x=1" -H "x-api-key: $KEY" -H "Content-Type: application/json" -d '{\"item\":\"demo\"}'
```

Chỉ vào trên màn hình:
- `HTTP/1.1 200`
- `X-Mrapi-Source: upstream` (response thật từ backend doanh nghiệp)
- `X-Served-Region: ap-southeast-1` (Region đang phục vụ, do Route 53 chọn)
- `X-Request-Id: ...` (**ghi lại**, dùng ở cảnh 8)
- Trong body, phần `headers` **không có** `X-Api-Key` → proxy đã gỡ key trước khi gửi đi.

**4.2 Thiếu key → 401**

```powershell
curl.exe -i "$GW/proxy/$API/get"
```

**4.3 Key sai → 401**

```powershell
curl.exe -i "$GW/proxy/$API/get" -H "x-api-key: sai-key-123"
```

**4.4 Gọi thẳng từng Region** (chứng minh hai Region cùng phục vụ một key):

```powershell
curl.exe -i "https://43vakggyh5.execute-api.ap-southeast-1.amazonaws.com/demo/proxy/$API/get" -H "x-api-key: $KEY"
curl.exe -i "https://n39r5pits8.execute-api.ap-northeast-1.amazonaws.com/demo/proxy/$API/get" -H "x-api-key: $KEY"
```

Chỉ vào `X-Served-Region: ap-southeast-1` rồi `X-Served-Region: ap-northeast-1`, cả hai `200`.
**Nói:** "Key tạo ở Singapore dùng được ngay ở Tokyo nhờ DynamoDB Global Tables."

**4.5 Backend lỗi / chậm**

```powershell
curl.exe -i "$GW/proxy/$API/status/500" -H "x-api-key: $KEY"
curl.exe -i "$GW/proxy/$API/delay/5" -H "x-api-key: $KEY"
```

Thấy `500` (trả nguyên lỗi của backend) và `504` có `UPSTREAM_TIMEOUT` (gateway cắt sau 2 giây).

**4.6 (Nếu muốn) chạy bộ test tự động** — chứng minh có kiểm thử đầy đủ:

```powershell
$env:API_BASE_URL = "https://api.multi-region.io.vn"
npm run test:e2e:proxy --prefix src
```

Chờ chạy xong, thấy các dòng `✔` / `pass`. Khoảng 10–15 giây.

---

## Cảnh 5 — Route 53: định tuyến theo độ trễ và health check (2 phút)

**Tab 2 — Route 53** → **Hosted zones** → bấm `multi-region.io.vn`.

1. Lọc record `api.multi-region.io.vn` → thấy **2 record A**, Routing policy **Latency**:
   - Record ID `mrapi-sg`, Region `ap-southeast-1`
   - Record ID `mrapi-tokyo`, Region `ap-northeast-1`
   - Cả hai có gắn **Health check ID**.
2. Menu trái → **Health checks** → thấy 2 health check (SG `c7764d38…`, Tokyo `bfa2df95…`), cột Status **Healthy**. Bấm vào một cái → tab **Health checkers** → các checker trên thế giới báo `Success: HTTP Status Code 200`.

**Nói:** "Route 53 trả về IP của Region có độ trễ thấp nhất với người dùng. Nếu health check của một Region báo hỏng, Route 53 tự chuyển toàn bộ lưu lượng sang Region còn lại."

**PowerShell** — xem DNS:

```powershell
nslookup api.multi-region.io.vn
```

### Cảnh 5b (TÙY CHỌN, mất ~10 phút) — Failover thật

Chỉ quay nếu còn thời gian; đây là thay đổi tạm trên AWS, **nhớ trả lại**.

1. Tab 4 → Lambda **Singapore** → `mrapi-proxy` → **Configuration** → **Environment variables** → **Edit** → **Add** `HEALTH_FORCE_FAIL` = `true` → **Save**.
2. PowerShell chạy vòng lặp theo dõi Region:

```powershell
while ($true) { $r = curl.exe -s -D - -o NUL "https://api.multi-region.io.vn/health"; ($r | Select-String "HTTP/|X-Served-Region"); Get-Date -Format "HH:mm:ss"; Start-Sleep 5 }
```

3. Khoảng 1–2 phút sau, health check SG chuyển **Unhealthy** (Tab 2). Sau khi DNS hết hạn, vòng lặp đổi từ `X-Served-Region: ap-southeast-1` sang `ap-northeast-1`.
4. **Trả lại:** quay về `mrapi-proxy` SG → Edit env → **Remove** `HEALTH_FORCE_FAIL` → Save. Đợi health check về Healthy. Bấm Ctrl+C để dừng vòng lặp.

Báo cáo đo trước: `docs/reports/2026-11-01-failover.md` (3 lần, có timeline), có thể chiếu thay nếu không muốn quay trực tiếp.

---

## Cảnh 6 — DynamoDB Global Tables (2 phút)

**Tab 5 — DynamoDB (Singapore)** → **Tables**:

1. Bấm `mrapi-control` → tab **Global tables** → thấy replica `ap-northeast-1` trạng thái **Active**.
2. Bấm **Explore table items** → bấm **Scan** → **Run**. Tìm item có email `demo-video-01@example.com` (tenant vừa tạo ở cảnh 2).
3. Đổi Region sang **Tokyo** → mở `mrapi-control` → **Explore table items** → **Run** → thấy **cùng tenant đó**.
   **Nói:** "Ghi ở Singapore, Tokyo có dữ liệu trong khoảng 1 giây. Đo hôm 08/11: độ trễ trung bình 0,7–0,85 giây."
4. Mở `mrapi-telemetry` → Explore items → thấy các dòng request vừa gọi ở cảnh 4 (cột `status`, `latencyMs`, `region`).
5. Tab **Backups**: chỉ Point-in-time recovery **On**. Tab **Additional settings**: Deletion protection **On**, TTL thuộc tính `expiresAt`.

**Tab 8 — CloudShell** (tùy chọn, chứng minh số liệu replication):

```bash
aws dynamodb describe-table --table-name mrapi-control --region ap-southeast-1 --query "Table.Replicas"
aws cloudwatch get-metric-statistics --region ap-southeast-1 --namespace AWS/DynamoDB --metric-name ReplicationLatency --dimensions Name=TableName,Value=mrapi-control Name=ReceivingRegion,Value=ap-northeast-1 --start-time $(date -u -d '-3 hours' +%FT%TZ) --end-time $(date -u +%FT%TZ) --period 3600 --statistics Average Maximum
```

---

## Cảnh 7 — Export S3 theo lịch và replication hai chiều (2 phút)

**Tab 6 — S3**:

1. Bấm bucket `mrapi-exports-sg` → tab **Management** → mục **Replication rules** → thấy rule `mrapi-sg-to-tyo`, Status **Enabled**, Replication metrics **Enabled**, đích `mrapi-exports-tyo`.
2. Ngay dưới: **Lifecycle rules** → dọn multipart sau 7 ngày, xóa version cũ sau 30 ngày.
3. Tab **Objects** → vào `exports/telemetry/AWSDynamoDB/` → mở thư mục export mới nhất (`01794074414775-375b8340`, ngày 08/11) → bấm một file `data/*.json.gz` → mục **Object management overview** → **Replication status: COMPLETED**.
4. Quay lại danh sách bucket → `mrapi-exports-tyo` → cùng đường dẫn → cùng file → **Replication status: REPLICA**. Bucket này có rule ngược `mrapi-tyo-to-sg`.
5. Tab **Permissions** của một bucket → **Block public access: On** (cả 4 mục).

**Nói:** "Mỗi đêm 01:00 giờ Việt Nam, EventBridge gọi Lambda exporter xuất bảng telemetry sang S3 Singapore, rồi S3 tự sao chép sang Tokyo."

**Tab 8 — CloudShell** (chứng minh lịch chạy):

```bash
aws events describe-rule --name mrapi-export-daily --region ap-southeast-1 --query "{State:State,Schedule:ScheduleExpression}"
aws dynamodb list-exports --region ap-southeast-1 --max-results 3 --query "ExportSummaries[].[ExportArn,ExportStatus]" --output table
```

Thấy `ENABLED`, `cron(0 18 * * ? *)` (18:00 UTC = 01:00 VN) và export `COMPLETED`.

---

## Cảnh 8 — Giám sát: CloudWatch, X-Ray, log, cảnh báo (3 phút)

**Tab 7 — CloudWatch dashboard `mrapi-overview`**:
- Đặt khung thời gian **1h** góc phải trên. Chỉ widget request, 4xx/5xx, latency của hai Region, Lambda errors/duration — có các điểm vừa sinh ra ở cảnh 4.
- Menu trái **Alarms** → **All alarms** → thấy 11 alarm `mrapi-sg-*` / `mrapi-tyo-*`, trạng thái **OK**. Đổi Region sang **US East (N. Virginia)** → 2 alarm `mrapi-health-sg`, `mrapi-health-tyo` (theo dõi health check Route 53).
- **Nói:** "Lúc chạy thử lỗi 500/504, alarm `mrapi-sg-api-5xx` đã chuyển ALARM, gửi SNS rồi tự về OK."

**Lần theo một request (dùng `X-Request-Id` ghi ở cảnh 4.1)** — Tab 8 CloudShell:

```bash
REQ=<dán X-Request-Id>
aws logs filter-log-events --region ap-southeast-1 --log-group-name /aws/lambda/mrapi-proxy --filter-pattern "\"$REQ\"" --start-time $(( ($(date +%s) - 3600) * 1000 )) --query "events[].message" --output text
```

Thấy dòng `PROXY_REQUEST` có cùng requestId, status, latency. (Nếu request đi Tokyo thì đổi `--region ap-northeast-1`.)

**Tab 9 — X-Ray Service map** (CloudWatch → **X-Ray traces** → **Trace Map**), khung 1h:
- Thấy chuỗi `api.multi-region.io.vn` → `mrapi-api-sg/demo` → `mrapi-authorizer` → `mrapi-proxy`.
- Bấm **Traces** → chọn trace có HTTP 500 (từ cảnh 4.5) → xem timeline từng đoạn: authorizer vài chục ms, proxy chờ backend.

**SNS và Budget:**
- Đổi Region Singapore → **SNS** → **Topics** → `mrapi-alerts` → **Subscriptions**: email trạng thái **Confirmed** (làm mờ email).
- Mở hộp thư Gmail (tab riêng) → tìm thư `ALARM: "mrapi-sg-api-5xx"` từ AWS Notifications.
- **Billing → Budgets** → `mrapi-monthly`: 10 USD/tháng, ngưỡng 50%, 80%, dự báo 100%.

**Trang giám sát của nhóm** — Tab 1, mở `https://app.multi-region.io.vn/regions` và `/sources`:
- Hai Region Healthy, số request, error rate, độ trễ.
- `/sources`: các nguồn dữ liệu thật (CloudWatch, Route 53, S3 replication).

---

## Cảnh 9 — Thu hồi key, có hiệu lực ở cả hai Region (2 phút)

**Tab 1 — Portal** → tab **Tổng quan**, chọn **1 giờ**: thẻ **Tổng lượt gọi**, **Lượt lỗi**, biểu đồ **Lượt gọi theo thời gian**, bảng **Theo region** và **Theo API key**. Số liệu khớp số lần gọi ở cảnh 4 (bấm **Làm mới** nếu chưa thấy).

**Thu hồi:** tab **API key** → dòng `key-video` → **Thu hồi** → xác nhận.

**PowerShell** ngay sau đó:

```powershell
curl.exe -i "https://43vakggyh5.execute-api.ap-southeast-1.amazonaws.com/demo/proxy/$API/get" -H "x-api-key: $KEY"
curl.exe -i "https://n39r5pits8.execute-api.ap-northeast-1.amazonaws.com/demo/proxy/$API/get" -H "x-api-key: $KEY"
```

Cả hai trả **403**.

**Nói:** "Thu hồi ở Singapore, Tokyo chặn sau dưới 1 giây. Đo 10 lần ngày 08/11: trung vị khoảng 0,2 giây, chậm nhất 1,34 giây (`docs/reports/2026-11-08-e2e-acceptance.md`). Authorizer không cache (TTL 0) để thu hồi có hiệu lực gần như ngay."

(Tùy chọn) Chạy script đo tự động:

```powershell
$env:ROUNDS = "3"
node tests/e2e/revoke-cross-region.mjs
```

---

## Cảnh 10 — Kết quả kiểm thử và tổng kết (1–2 phút)

**PowerShell** — unit test:

```powershell
npm test --prefix src
cd monitoring-web; npx vitest run; cd ..
```

Thấy backend `pass 34 / fail 0`, frontend `36 passed`.

**Mở trong VS Code / trình xem Markdown** và lướt các bảng PASS:
- `docs/reports/2026-11-08-e2e-acceptance.md` — 38/39 ca đạt (ca còn lại là lệch tài liệu, đã sửa).
- `docs/reports/2026-11-08-ops-verification.md` — 7/7 hạng mục vận hành đạt.
- `docs/reports/2026-11-08-config-fixes.md` — cấu hình đã sửa.

**Nói kết:** "Hệ thống chạy active-active ở hai Region, dữ liệu đồng bộ dưới 1,2 giây, tự chuyển Region khi một bên hỏng, có giám sát, cảnh báo và kiểm soát chi phí. Giới hạn hiện tại: quota Lambda tài khoản chỉ 10 concurrent mỗi Region, và failover mới thử bằng cách mô phỏng health check hỏng, chưa thử mất cả Region."

---

## Sau khi quay

1. Portal → xóa/thu hồi API `httpbin-demo` của tenant `Demo Video` nếu không cần.
2. Nếu đã quay cảnh 5b: kiểm lại `mrapi-proxy` Singapore **không còn** biến `HEALTH_FORCE_FAIL`, cả hai health check **Healthy**.
3. Khi dựng: làm mờ API key, email, tên IAM user, Account ID nếu không muốn công khai.

## Lỗi hay gặp khi quay

| Hiện tượng | Cách xử lý |
|---|---|
| `curl` trả 500/429 hàng loạt | Quota Lambda chỉ 10 concurrent mỗi Region — đừng chạy nhiều lệnh/vòng lặp song song, gọi tuần tự |
| Lệnh `-d '{...}'` lỗi JSON trong PowerShell | Giữ đúng dạng `'{\"item\":\"demo\"}'` như trên, hoặc bỏ `-d` |
| CloudWatch Logs Console báo "Unable to load content" | Dùng lệnh `aws logs filter-log-events` trong CloudShell như cảnh 8 |
| httpbin.org chậm | Lỗi của dịch vụ công khai; quay lại sau ít phút hoặc chỉ dùng `/get` |
| Portal không hiện số liệu ngay | Telemetry ghi sau mỗi request; bấm làm mới sau vài giây |
