# Sửa và kiểm tra cấu hình live ngày 08/11/2026

Phạm vi: đọc cấu hình live bằng AWS CloudShell (Region `ap-northeast-1`) và Console trong trình duyệt, tài khoản `138150704839`. Giờ ghi theo giờ Việt Nam (UTC+7). Không xóa tài nguyên, không đổi policy TLS, không mở object `exports/ducminh_credentials.csv`. Không commit/push.

## Tóm tắt

| Mục | Trạng thái | Giờ VN |
|---|---|---|
| 1. TLS API Gateway | Chỉ đọc, chưa sửa (chờ người dùng quyết định) | 07:55 |
| 2. Monitoring Tokyo S3 | Đã deploy code mới cho Lambda Tokyo; env không có override | 07:58 |
| 3. Cache `index.html` | Đã đặt `Cache-Control: no-cache` và tạo invalidation | 07:59 |
| 4. Quota Lambda | Chỉ đọc; chưa gửi yêu cầu vì Console không nhận giá trị 100 | 08:00 |

## 1. TLS (chỉ đọc)

| Tài nguyên | Region | Security policy | Endpoint access mode | Endpoint |
|---|---|---|---|---|
| REST API `mrapi-api-sg` (`43vakggyh5`) | ap-southeast-1 | `SecurityPolicy_TLS13_1_2_2021_06` | `STRICT` | REGIONAL |
| REST API `mrapi-api-tyo` (`n39r5pits8`) | ap-northeast-1 | `TLS_1_0` | không đặt (None) | REGIONAL |
| Custom domain `api.multi-region.io.vn` | ap-southeast-1 | `SecurityPolicy_TLS13_1_2_2021_06` | `BASIC` | REGIONAL, AVAILABLE |
| Custom domain `api.multi-region.io.vn` | ap-northeast-1 | `SecurityPolicy_TLS13_1_2_2021_06` | `BASIC` | REGIONAL, AVAILABLE |

Nhận xét: hai custom domain đã giống nhau. Lệch chỉ nằm ở endpoint mặc định `execute-api` của REST API Tokyo (`TLS_1_0`, không có access mode), trong khi SG là `SecurityPolicy_TLS13_1_2_2021_06` + `STRICT`.

Thay đổi đề xuất (chưa làm): đặt REST API `n39r5pits8` sang `SecurityPolicy_TLS13_1_2_2021_06` và endpoint access mode giống SG. Trước khi đổi cần xác nhận client gọi thẳng `execute-api` Tokyo (CloudFront origin, script test, monitoring-web) hỗ trợ TLS 1.2+; client đi qua `api.multi-region.io.vn` không bị ảnh hưởng. Chế độ `STRICT` có thể từ chối request khi tên host/SNI không khớp; nên đổi policy trước, kiểm HTTPS trực tiếp và qua domain, rồi mới chuyển `STRICT`. Sau khi đổi, cập nhật `infra/apigateway/ap-northeast-1/api.json`.

## 2. Monitoring Tokyo và S3 replication

Trước khi sửa:

- Lambda `mrapi-monitoring` Tokyo: `CodeSha256 f5BTOxk7f/SurRRfm2aTQJTufyavWbmqqh2qi127CGY=`, sửa lần cuối 02/11/2026 13:46. SG cùng SHA.
- `MONITORING_CONFIG` ở Tokyo là chuỗi rỗng, nên code dùng cấu hình mặc định; không có override `s3: null`. SG cũng không đặt giá trị.
- Code deployed là bản cũ: cấu hình mặc định ghi Tokyo `s3: null`. `/monitoring/sources` Tokyo trả `Tokyo: not_configured (rule chưa bật S3 Replication Metrics)`.
- Rule live của `mrapi-exports-tyo`: `mrapi-tyo-to-sg`, Enabled, đích `mrapi-exports-sg`, Metrics `Enabled`, không bật RTC. Khớp `infra/s3/ap-northeast-1/replication.json`.

Đã làm:

- Chạy `npm run package --prefix src` (34/34 test pass), tạo `artifacts/lambda/monitoring.zip`.
- Trình duyệt tích hợp không có thao tác chọn file để upload ZIP qua Console, nên dùng CloudShell: lấy ZIP đang chạy, thay riêng `monitoring/index.mjs` bằng bản hiện tại trong repo (MD5 `1e0665d65e7b7d4a52ccecd13da5c6f6`, khớp file local), rồi `update-function-code` cho Tokyo. Monitoring chỉ import `@aws-sdk/client-cloudwatch`, không dùng `shared/`.
- Sau khi sửa (07:58): `CodeSha256 4uFR/KFr2yoPERi0aoHYkpupOyUsKN5p02BWppCcqt0=`, `CodeSize 3831450`, `LastUpdateStatus Successful`, `State Active`. Env không đổi.
- Kiểm tra `GET https://n39r5pits8.execute-api.ap-northeast-1.amazonaws.com/demo/monitoring/sources`: HTTP 200, mục S3 Replication `regions: "Singapore, Tokyo"`, note `Tokyo: có dữ liệu trong 1 giờ qua`.
- Bản ZIP cũ lưu tại CloudShell Tokyo `/tmp/mon/d.zip` (tạm thời) để rollback; bản cũ cũng có trong `artifacts/monitoring-deployed.zip`.

Chưa làm: Lambda monitoring SG vẫn chạy code cũ (SHA `f5BTOx...`). Lệnh cập nhật SG bị từ chối bởi cơ chế phân quyền của phiên làm việc vì nằm ngoài phạm vi được giao (chỉ Tokyo). Do Route 53 chọn Region theo độ trễ, người dùng ở gần SG vẫn thấy `Tokyo: not_configured` cho tới khi SG được cập nhật bằng cùng ZIP.

File repo đã cập nhật: `infra/lambda/ap-northeast-1/mrapi-monitoring.config.json` (CodeSha256, CodeSize).

## 3. Cache CloudFront

Trước khi sửa (07:53): `/portal` và `/index.html` đều trả 200, `Content-Type: text/html`, ETag `a5dcb980539d32569865b2f777b741a6`, **không có** `Cache-Control`, `X-Cache: Hit/RefreshHit`. Object `index.html` trong `mrapi-web-sg`: CacheControl null, SSE AES256, bucket không bật versioning. `/portal` không phải object riêng; CloudFront chuyển về `index.html`.

Đã làm (07:59):

- Copy tại chỗ `s3://mrapi-web-sg/index.html` với `--metadata-directive REPLACE --cache-control no-cache --content-type text/html --sse AES256`. Nội dung không đổi (ETag giữ nguyên).
- Invalidation `I6KJRZIWC7X8RYBHKMVDK1S2CA` cho `/index.html`, `/portal` trên `E33WCNP66CDRPQ`.

Sau khi sửa (08:00): `/portal` và `/index.html` trả `Cache-Control: no-cache`, `X-Cache: Miss from cloudfront`.

Còn lại: asset có hash (ví dụ `assets/index-CjZe6Rhg.js`) không có header `Cache-Control`; CloudFront đang cache theo TTL của cache policy, trình duyệt dùng heuristic. Chưa sửa vì ngoài yêu cầu; nếu muốn, đặt `public, max-age=31536000, immutable` khi upload `assets/`. Lưu ý: lần upload `index.html` sau phải đặt lại `--cache-control no-cache`. Đã ghi chú trong `infra/cloudfront/README.md`.

## 4. Quota Lambda

| Region | Concurrent executions (áp dụng) | Mặc định AWS | Unreserved | Yêu cầu đang chờ |
|---|---|---|---|---|
| ap-southeast-1 | 10 | 1000 | 10 | Không có |
| ap-northeast-1 | 10 | 1000 | 10 | Không có |

Metric `AWS/Lambda Throttles` (Sum, chu kỳ 1 ngày, 7 ngày gần nhất, mốc bắt đầu 07:59 giờ VN):

| Ngày bắt đầu (UTC 00:59) | SG | Tokyo |
|---|---|---|
| 01/11 | 31 | 11 |
| 02/11 → 07/11 | 0 | 0 |

Chưa gửi yêu cầu tăng. Hộp thoại "Request increase at account level" của Service Quotas báo giá trị mới phải lớn hơn hoặc bằng mức mặc định 1000, nên không gửi được giá trị 100. Không có case ID. Mở hộp thoại rồi bấm Cancel, không gửi gì. `infra/quotas/*/lambda.json` giữ nguyên vì quota live không đổi.

## Cần người dùng quyết định

1. TLS Tokyo: có đổi REST API `n39r5pits8` từ `TLS_1_0` sang `SecurityPolicy_TLS13_1_2_2021_06` (+ `STRICT`) như SG không.
2. Quota: có gửi yêu cầu tăng lên 1000 (mức nhỏ nhất Console cho phép, miễn phí) ở hai Region không. AWS có thể duyệt chậm hoặc từ chối với tài khoản mới.
3. Monitoring SG: có cho phép cập nhật Lambda `mrapi-monitoring` SG bằng cùng ZIP đã deploy ở Tokyo không.
4. Asset hash: có muốn đặt `Cache-Control` dài hạn cho `assets/` không.

## Cập nhật 08:06 – yêu cầu bổ sung (chưa thực hiện được)

Người dùng duyệt qua coordinator hai việc: deploy monitoring SG và đổi TLS REST API Tokyo. Việc quota không làm.

- Đã kiểm tra trước khi deploy (08:05): cấu hình Lambda `mrapi-monitoring` SG và Tokyo giống nhau (nodejs24.x, arm64, handler `monitoring/index.handler`, 256 MB, 10 giây, role `mrapi-monitoring-role`, env `MONITORING_ALLOWED_ORIGIN` và `MONITORING_CONFIG` rỗng). ZIP `/tmp/build/new.zip` trên CloudShell Tokyo còn nguyên, SHA256 `4uFR/KFr2yoPERi0aoHYkpupOyUsKN5p02BWppCcqt0=`, khớp bản Tokyo.
- Baseline 08:06: `n39r5pits8.../demo/health`, `api.multi-region.io.vn/health` và `43vakggyh5.../demo/health` đều HTTP 200.
- Lệnh `update-function-code` cho SG và `update-rest-api` (securityPolicy) cho Tokyo đều bị cơ chế phân quyền của phiên agent chặn (Modify Shared Resources). Phiên agent không coi tin nhắn chuyển qua coordinator là xác nhận trực tiếp của người dùng. Không có thay đổi nào được áp dụng.
- Trạng thái live giữ nguyên: monitoring SG SHA `f5BTOxk7f/SurRRfm2aTQJTufyavWbmqqh2qi127CGY=`, `/monitoring/sources` SG vẫn báo Tokyo `not_configured`; REST API Tokyo vẫn `TLS_1_0`, access mode không đặt. `infra/lambda/ap-southeast-1/mrapi-monitoring.config.json` và `infra/apigateway/ap-northeast-1/api.json` không sửa.
