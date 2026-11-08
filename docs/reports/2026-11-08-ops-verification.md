# Nghiệm thu vận hành ngày 08/11/2026

Thời điểm kiểm tra: 07:50–08:02 giờ Việt Nam (UTC+7) ngày 08/11/2026. Tài khoản `138150704839`.

Phương pháp: chỉ đọc qua AWS CloudShell (`aws` CLI, Region mặc định `ap-southeast-1`) và CloudWatch Console. Không sửa cấu hình, không ghi/xóa dữ liệu, không mở nội dung `exports/ducminh_credentials.csv`. Email được che dạng `x***@domain`. Mọi giờ dưới đây là giờ Việt Nam, kèm UTC khi cần đối chiếu log.

## Tổng hợp

| # | Hạng mục | Kết quả |
|---|---|---|
| 1 | Export theo lịch (EventBridge → exporter → DynamoDB Export → S3 SG → bản sao Tokyo) | **PASS** |
| 2 | Replication DynamoDB Global Tables và S3 hai chiều | **PASS** (chiều S3 TYO→SG chỉ có metric 0 vì không có object mới; xem ghi chú) |
| 3 | Route 53 latency + health check + alarm us-east-1 | **PASS** |
| 4 | CloudWatch dashboard và 13 alarm | **PASS** (2 alarm 5xx vừa ALARM 07:55–07:58 do kiểm thử lỗi chủ ý, đã về OK) |
| 5 | SNS + Budget | **PASS cấu hình / CẦN NGƯỜI DÙNG** xác nhận thư tới hộp thư |
| 6 | X-Ray | **PASS** |
| 7 | Bảo mật S3 | **PASS** Block Public Access; **CẦN NGƯỜI DÙNG** xử lý object `ducminh_credentials.csv` |

## 1. Export theo lịch

| Hạng mục | Bằng chứng | Kết quả |
|---|---|---|
| EventBridge rule `mrapi-export-daily` (SG) | `describe-rule`: `ENABLED`, `cron(0 18 * * ? *)` = 01:00 giờ VN, target `mrapi-exporter` | PASS |
| Rule thực sự kích hoạt | Metric `AWS/Events Invocations` rule `mrapi-export-daily` = 1 trong giờ 01:00 ngày 08/11 (18:00 UTC 07/11); `FailedInvocations` không có điểm đo từ 01/11 | PASS |
| Invocation do lịch gần nhất | Log stream `2026/11/07/[$LATEST]4dc28e46…`: START 01:00:13 ngày 08/11, RequestId `645b9585-c037-4d94-9be4-e84cfa3a8d99`, log `EXPORT_REQUESTED` status `IN_PROGRESS`, REPORT 1133 ms, không ERROR, X-Ray trace `1-6aef672d-697ee1d6655ce4f4437408f0`. Các đêm 05/11, 06/11 (và 02–04/11) cũng có invocation lúc 01:00 | PASS |
| DynamoDB Export | `…/table/mrapi-telemetry/export/01794074414775-375b8340`: `COMPLETED`, bắt đầu 01:00:14, xong 01:07:12, 28 item, 9.723 byte, `DYNAMODB_JSON`, không FailureMessage, đích `s3://mrapi-exports-sg/exports/telemetry/` | PASS |
| Object trong `mrapi-exports-sg` | 9 object dưới `exports/telemetry/AWSDynamoDB/01794074414775-375b8340/` (`_started`, 4 file `data/*.json.gz`, 4 manifest), ReplicationStatus `COMPLETED` | PASS |
| Bản sao trong `mrapi-exports-tyo` | Đủ 9 object cùng key, ETag và dung lượng khớp từng file, ReplicationStatus `REPLICA` | PASS |

## 2. Replication

### DynamoDB Global Tables (version 2019.11.21)

| Bảng | Region đọc | Trạng thái bảng | Replica |
|---|---|---|---|
| `mrapi-control` | SG | ACTIVE | ap-northeast-1 ACTIVE |
| `mrapi-telemetry` | SG | ACTIVE | ap-northeast-1 ACTIVE |
| `mrapi-control` | Tokyo | ACTIVE | ap-southeast-1 ACTIVE |
| `mrapi-telemetry` | Tokyo | ACTIVE | ap-southeast-1 ACTIVE |

`ReplicationLatency` (giờ gần nhất, bucket 06:55–07:55 VN, có lượt ghi từ agent E2E):

| Bảng | Chiều | Average | Maximum | Số mẫu |
|---|---|---|---|---|
| `mrapi-control` | SG → Tokyo | 691 ms | 1.192 ms | 15 |
| `mrapi-telemetry` | SG → Tokyo | 789 ms | 1.108 ms | 3 |
| `mrapi-control` | Tokyo → SG | 779 ms | 1.178 ms | 14 |
| `mrapi-telemetry` | Tokyo → SG | 851 ms | — | 3 |

Kết quả: **PASS**. Độ trễ dưới khoảng 1,2 giây ở cả hai chiều.

### S3 Replication

| Rule | Cấu hình | Metric | Kết quả |
|---|---|---|---|
| `mrapi-sg-to-tyo` (`mrapi-exports-sg` → `mrapi-exports-tyo`) | Enabled, Metrics Enabled, không RTC | Ở `ap-northeast-1`: ReplicationLatency max theo ngày 43 s (05/11), 163 s (06/11), 108 s (07/11); OperationsPendingReplication max 4–8 rồi về 0. Ở `ap-southeast-1`: OperationsFailedReplication = 0 | PASS |
| `mrapi-tyo-to-sg` (`mrapi-exports-tyo` → `mrapi-exports-sg`) | Enabled, Metrics Enabled, không RTC | Ở `ap-southeast-1`: ReplicationLatency và OperationsPendingReplication có đủ 1.440 mẫu/ngày, giá trị 0 | PASS cấu hình; chưa có object mới để đo độ trễ thực |

Ghi chú:

- Metric Latency/Pending được phát ở **Region đích**, còn OperationsFailedReplication ở Region nguồn. Code monitoring hoặc widget nào đọc sai Region sẽ thấy “không có dữ liệu”.
- Chiều TYO→SG có giá trị 0 vì exporter chỉ chạy ở SG, Tokyo không phát sinh object mới. Bằng chứng gần nhất cho chiều này là object `exports/ducminh_credentials.csv` (bản ở SG là `REPLICA`, ở Tokyo là `COMPLETED`). Không tạo object thử vì phạm vi chỉ đọc.
- Dashboard `mrapi-overview` chỉ có widget S3 cho chiều SG→TYO, chưa có widget TYO→SG. Đây là thiếu sót nhỏ, không phải lỗi replication.

## 3. Route 53

| Hạng mục | Bằng chứng | Kết quả |
|---|---|---|
| Hosted zone | `multi-region.io.vn.` ID `Z03093462BF2L4GV4FGRD`, 15 record set | PASS |
| Latency record `api.multi-region.io.vn` A (alias) | SetIdentifier `mrapi-sg` Region `ap-southeast-1` → `d-zd1hv50jn0.execute-api.ap-southeast-1.amazonaws.com`, health check `c7764d38-…`; SetIdentifier `mrapi-tokyo` Region `ap-northeast-1` → `d-csqvriesoh.execute-api.ap-northeast-1.amazonaws.com`, health check `bfa2df95-…` | PASS |
| Health check SG `c7764d38-b17d-44df-8d44-4f2791296adc` | HTTPS `43vakggyh5.execute-api.ap-southeast-1.amazonaws.com/demo/health`; 16/16 checker `Success: HTTP Status` | PASS (Healthy) |
| Health check Tokyo `bfa2df95-4abf-40d2-a240-dbd04acf735c` | HTTPS `n39r5pits8.execute-api.ap-northeast-1.amazonaws.com/demo/health`; 16/16 checker `Success` | PASS (Healthy) |
| Alarm us-east-1 | `mrapi-health-sg` OK, `mrapi-health-tyo` OK (từ 01/11), metric `HealthCheckStatus`, action SNS `arn:aws:sns:us-east-1:138150704839:mrapi-alerts` | PASS |

## 4. CloudWatch

Dashboard `mrapi-overview` (SG) có 11 widget và 44 metric, sửa lần cuối 15:26 ngày 01/11. Khi mở trên Console lúc khoảng 08:00, các widget API requests, 5xx/4xx, latency, Lambda errors/duration hai Region đều có trục giá trị và dữ liệu trong 3 giờ gần nhất. Không có widget nào hiện “No data”. Ví dụ: latency 14,9–151 ms; Lambda duration SG tối đa khoảng 224 ms. Kết quả: **PASS**.

Trạng thái 13 alarm, đọc lại lúc 08:01:44:

| Alarm | Region | Metric | State | Ghi chú |
|---|---|---|---|---|
| `mrapi-sg-api-5xx` | SG | 5XXError | OK (từ 07:58) | Đã ALARM 07:55:02–07:58 (xem dưới) |
| `mrapi-sg-api-latency` | SG | Latency | OK | |
| `mrapi-sg-exporter-errors` | SG | Errors | OK | |
| `mrapi-sg-lambda-errors` | SG | metric math | OK | |
| `mrapi-sg-monitoring-errors` | SG | Errors | OK | missing = notBreaching |
| `mrapi-sg-telemetry-write-failed` | SG | TelemetryWriteFailed | OK | missing = notBreaching |
| `mrapi-tyo-api-5xx` | Tokyo | 5XXError | OK (từ 07:58) | Đã ALARM 07:55:59–07:58 (xem dưới) |
| `mrapi-tyo-api-latency` | Tokyo | Latency | OK | |
| `mrapi-tyo-lambda-errors` | Tokyo | metric math | OK | |
| `mrapi-tyo-monitoring-errors` | Tokyo | Errors | OK | |
| `mrapi-tyo-telemetry-write-failed` | Tokyo | TelemetryWriteFailed | OK | |
| `mrapi-health-sg` | us-east-1 | HealthCheckStatus | OK | |
| `mrapi-health-tyo` | us-east-1 | HealthCheckStatus | OK | |

Không alarm nào ở trạng thái INSUFFICIENT_DATA. Mọi alarm đều đặt `TreatMissingData = notBreaching`.

Giải thích các lần ALARM:

- **`mrapi-sg-api-5xx` / `mrapi-tyo-api-5xx` (07:54–07:56):** API Gateway 5XXError SG = 2+2, Tokyo = 1+1 trong phút 07:54 và 07:55. Log `mrapi-proxy` cho thấy đây là các ca kiểm thử lỗi upstream của agent E2E: `/delay/5` → 504 `UPSTREAM_TIMEOUT`, `/status/503` → 503, upstream sai chứng chỉ TLS (`ERR_TLS_CERT_ALTNAME_INVALID`) → 502 `UPSTREAM_UNREACHABLE`. Alarm hoạt động đúng thiết kế và tự về OK. Không có lỗi hạ tầng.
- **Lambda Errors của `mrapi-authorizer`** (SG 2+14, Tokyo 1+20 trong 07:51–07:56): authorizer cố ý `throw Error("Unauthorized")` để API Gateway trả 401 khi key sai, thiếu hoặc đã thu hồi. Đây là cách làm chuẩn của Lambda authorizer, nhưng mỗi lần từ chối được tính là một Lambda Error và làm đồ thị “Lambda errors” trên dashboard nhảy lên. Hai alarm `*-lambda-errors` vẫn OK. Đề xuất (không bắt buộc): ghi chú cho người xem dashboard, hoặc loại authorizer khỏi phép tính lỗi.

## 5. SNS và Budget

| Hạng mục | Bằng chứng | Kết quả |
|---|---|---|
| SNS `mrapi-alerts` SG | 1 subscription email `d***@gmail.com`, có SubscriptionArn (Confirmed) | PASS |
| SNS `mrapi-alerts` Tokyo | 1 subscription email `d***@gmail.com`, Confirmed | PASS |
| SNS `mrapi-alerts` us-east-1 | 1 subscription email `d***@gmail.com`, Confirmed | PASS |
| Thư cảnh báo tới hộp thư | Alarm 5xx SG/Tokyo đã chuyển ALARM rồi OK lúc 07:55–07:58, nên SNS đã được kích hoạt. Không thể kiểm tra hộp thư từ phía hệ thống | **CẦN NGƯỜI DÙNG**: mở hộp thư `d***@gmail.com`, tìm thư ALARM/OK của `mrapi-sg-api-5xx` và `mrapi-tyo-api-5xx` sáng 08/11 (kiểm cả Spam) |
| Budget `mrapi-monthly` | 10,0 USD, MONTHLY; ActualSpend 0,0 USD; Forecast không có | PASS cấu hình |
| Notification Budget | ACTUAL > 50% (OK), ACTUAL > 80% (OK), FORECASTED > 100% (OK); subscriber EMAIL `d***@gmail.com` | PASS cấu hình |
| Email Budget đã xác minh chưa | API không cho biết trạng thái xác minh email | **CẦN NGƯỜI DÙNG** mở Billing → Budgets → `mrapi-monthly` để xem email đã xác minh chưa; nếu còn chờ, bấm gửi lại và xác nhận từ hộp thư |
| Chi phí tháng 11 (01–08/11) | Cost Explorer: UnblendedCost sau credit ≈ 0 USD; **trước credit = 7,94 USD** | Lưu ý |

Lưu ý chi phí: Budget tính cả credit nên đang 0 USD và sẽ không cảnh báo. Chi phí sử dụng thực trước credit đã là 7,94 USD sau 8 ngày, gần mức 80% (8 USD). Theo nhịp này, cả tháng có thể vượt 10 USD. Không cần sửa trước hạn nộp. Nếu muốn Budget phản ánh mức dùng thật, chủ tài khoản có thể loại Credit khỏi phạm vi Budget; việc này là thay đổi cấu hình nên phiên này chưa thực hiện.

## 6. X-Ray

| Hạng mục | Bằng chứng | Kết quả |
|---|---|---|
| Tracing Lambda SG | `mrapi-authorizer`, `mrapi-dashboard`, `mrapi-monitoring`, `mrapi-proxy`, `mrapi-exporter`: `Active`, nodejs24.x, arm64 | PASS |
| Tracing Lambda Tokyo | `mrapi-authorizer`, `mrapi-dashboard`, `mrapi-proxy`, `mrapi-monitoring`: `Active`, nodejs24.x, arm64 | PASS |
| Trace SG (6 giờ) | Khoảng 3.350 trace summary. Lọc `service("mrapi-proxy")` có trace, ví dụ `1-6aefbcfa-247d64b9837f131a0e7ded8a` (HTTP 200, 37 ms). Service graph 1 giờ gồm `api.multi-region.io.vn`, `mrapi-api-sg/demo`, `mrapi-authorizer`, `mrapi-dashboard`, `mrapi-proxy` | PASS |
| Trace Tokyo (6 giờ) | Khoảng 7.100 trace summary. Có trace `mrapi-proxy`, ví dụ `1-6aefc868-657e57f164ef41e82cd4ee77` (HTTP 200, 21 ms). Service graph gồm `mrapi-api-tyo/demo`, `mrapi-authorizer`, `mrapi-dashboard`, `mrapi-monitoring`, `mrapi-proxy` | PASS |
| Log ↔ trace | Log proxy có dòng `XRAY TraceId … Sampled: true`, ví dụ Tokyo `1-6aefc8af-3f0e217c3524a5f943a5b54f` cho request `/status/503` | PASS |

## 7. Bảo mật S3

| Bucket | Block Public Access (4 cờ) | Bucket policy | Object Ownership | Kết quả |
|---|---|---|---|---|
| `mrapi-exports-sg` | True/True/True/True | Không có policy | BucketOwnerEnforced | PASS |
| `mrapi-exports-tyo` | True/True/True/True | Không có policy | BucketOwnerEnforced | PASS |
| `mrapi-web-sg` | True/True/True/True | IsPublic = False; chỉ cho phép `cloudfront.amazonaws.com` `s3:GetObject` với `AWS:SourceArn` = distribution `E33WCNP66CDRPQ` | BucketOwnerEnforced | PASS |

CloudFront `E33WCNP66CDRPQ` có origin `mrapi-web-sg.s3.ap-southeast-1.amazonaws.com` dùng OAC `EWN75AS66OW4A`. Như vậy web chỉ truy cập được qua CloudFront OAC.

Block Public Access ở cấp tài khoản chưa cấu hình (`NoSuchPublicAccessBlockConfiguration`). Cả ba bucket đã bật ở cấp bucket nên hiện chưa có rủi ro. Có thể bật thêm ở cấp tài khoản để phòng bucket tạo sau; việc này là thay đổi cấu hình nên phiên này chưa thực hiện.

### Object `exports/ducminh_credentials.csv` (chỉ metadata, không mở nội dung)

| Bucket | Version hiện hành | Version cũ | Delete marker | Replication |
|---|---|---|---|---|
| `mrapi-exports-sg` | `5rQxLnQT…`, 112 byte, 22:32:51 ngày 17/10, SSE AES256 | `cHzu.WMn…`, 112 byte, 20:03:17 ngày 17/10 | Không | `REPLICA` |
| `mrapi-exports-tyo` | `5rQxLnQT…`, 112 byte, 22:32:51 ngày 17/10, SSE AES256 | `cHzu.WMn…`, 112 byte, 20:03:17 ngày 17/10 | `cSVKkURM…` lúc 22:15:26 ngày 17/10 (không phải bản hiện hành) | `COMPLETED` (nguồn) |

Kết quả: **CẦN NGƯỜI DÙNG**. Object **vẫn tồn tại** ở cả hai bucket, mỗi bucket có 2 version. Bucket không public nên object không lộ ra Internet, nhưng mọi principal IAM có quyền đọc bucket đều đọc được. Chủ tài khoản cần tự kiểm tra kín nội dung:

1. Nếu là access key thật: vô hiệu hóa hoặc xóa key trong IAM trước, rồi xóa **mọi version** của object ở **cả hai** bucket. Replication không tự sao chép thao tác xóa version, nên phải xóa riêng ở từng bucket.
2. Nếu không phải credential: ghi lại kết luận để đóng mục này.

Phiên này không xóa object vì không được phép xóa dữ liệu.

## Việc người dùng cần tự làm

1. Kiểm tra hộp thư `d***@gmail.com`, kể cả Spam: thư ALARM/OK sáng 08/11 từ SNS cho `mrapi-sg-api-5xx` và `mrapi-tyo-api-5xx`.
2. Mở Budget `mrapi-monthly` để xem email đã xác minh chưa; nếu chưa, gửi lại và xác nhận.
3. Kiểm tra kín `exports/ducminh_credentials.csv` và xử lý theo mục 7.
4. (Không bắt buộc) Thêm widget S3 TYO→SG vào dashboard; ghi chú rằng authorizer Errors là lỗi 401 chủ ý; cân nhắc loại Credit khỏi Budget và bật Block Public Access cấp tài khoản.
