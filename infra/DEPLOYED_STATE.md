# Cấu hình AWS đang dùng

Tài khoản AWS của dự án: `138150704839`.

## Các dịch vụ chính

| Dịch vụ | Singapore (`ap-southeast-1`) | Tokyo (`ap-northeast-1`) |
|---|---|---|
| API Gateway | `mrapi-api-sg`, ID `43vakggyh5`, stage `demo` | `mrapi-api-tyo`, ID `n39r5pits8`, stage `demo` |
| Lambda | proxy, authorizer, dashboard, monitoring, exporter | proxy, authorizer, dashboard, monitoring |
| DynamoDB | `mrapi-control`, `mrapi-telemetry` | Replica của hai bảng |
| S3 | `mrapi-exports-sg`, `mrapi-web-sg` | `mrapi-exports-tyo` |
| CloudWatch | 6 alarm `mrapi-sg-*` | 5 alarm `mrapi-tyo-*` |
| SNS | `mrapi-alerts` | `mrapi-alerts` |

Toàn cục: Route 53 cho `multi-region.io.vn`, CloudFront `E33WCNP66CDRPQ`, Budget `mrapi-monthly` 10 USD/tháng. us-east-1 có chứng chỉ frontend, SNS và 2 alarm health check.

## Luồng hoạt động

- [Frontend](https://app.multi-region.io.vn/portal) lấy file từ S3 qua CloudFront.
- `/api/*`, `/health`, `/proxy/*`, `/monitoring/*` đi tới `api.multi-region.io.vn`. Route 53 chọn Region theo độ trễ và health check.
- Portal tự kiểm tra Bearer token. Proxy dùng authorizer kiểm tra `x-api-key`, cache TTL 0.
- Proxy đọc control, gọi backend doanh nghiệp và ghi telemetry. Dashboard đọc thống kê từ telemetry.

## Cấu hình đã chốt

- Hai bảng là Global Tables, TTL `expiresAt`. PITR và deletion protection bật ở cả hai Region.
- S3 replication hai chiều bật metrics, không RTC. Lifecycle cho `exports/telemetry/`: dọn multipart sau 7 ngày, version cũ sau 30 ngày; giữ version hiện hành.
- Exporter chạy ở SG lúc 18:00 UTC, tức 01:00 hôm sau giờ Việt Nam. Export đã hoàn tất và sao chép sang Tokyo.
- Lambda dùng Node.js 24.x, arm64, tracing Active. Monitoring: 256 MB, timeout 10 giây.
- CloudWatch `mrapi-overview`: 11 widget, 44 metric. Tổng 13 alarm; các nhóm log đã rà giữ 14 ngày.
- Boundary IAM mặc định v3; file repo đã sửa theo AWS.
- CloudFront dùng `mrapi-api-latency`; origin SG cũ giữ để rollback.

## Kiểm thử và việc còn lại

| Mục | Kết quả |
|---|---|
| Đồng bộ DynamoDB | 10/10 item thử xuất hiện ở Region kia trong khoảng 1 giây |
| Export S3 | 9 object Completed/Replica, ETag và dung lượng khớp |
| Failover | 3 lần mô phỏng mỗi chiều; chưa thử mất toàn Region |
| Monitoring thật | Theo dõi health hai Region. 08/11: Lambda monitoring Tokyo đã chạy code mới, đọc được S3 TYO→SG; Lambda monitoring SG còn code cũ |
| Key thật và thống kê portal | 08/11: nghiệm thu ở SG, Tokyo và domain latency, 38/39 ca PASS; `/api/usage` đếm đúng. Ca lệch duy nhất là body 403 của key đã thu hồi (xem bên dưới) |
| Thu hồi key xuyên Region | 08/11: 5 lượt mỗi chiều, median ~0,2 s, chậm nhất 1,34 s |
| Trace → log → telemetry | 08/11: đối chiếu được X-Request-Id → log proxy → telemetry (cả replica) → trace X-Ray |
| Export theo lịch | 08/11: lượt 01:00 giờ VN chạy tự động, export COMPLETED, 9 object REPLICA ở Tokyo |
| Alarm và cảnh báo | 08/11: 13/13 alarm OK; SNS ba Region Confirmed. Chưa xác nhận thư tới hộp thư; email Budget còn chờ xác minh |

Báo cáo chi tiết ngày 08/11: [cấu hình](../docs/reports/2026-11-08-config-fixes.md), [E2E](../docs/reports/2026-11-08-e2e-acceptance.md), [vận hành](../docs/reports/2026-11-08-ops-verification.md).

Key đã thu hồi bị authorizer chặn bằng 403 với body mặc định của API Gateway; mã `KEY_REVOKED` chỉ có trong log `AUTHORIZER_DENY`. File `exports/ducminh_credentials.csv` (112 byte, 2 version) còn ở cả hai bucket; chưa mở nội dung. Quota Lambda live vẫn 10 concurrent executions mỗi Region; Console chỉ cho xin tăng từ 1000. REST API Tokyo còn TLS_1_0 ở endpoint execute-api; custom domain hai Region đã dùng TLS 1.2/1.3.

## Tài liệu từng dịch vụ

[API Gateway](apigateway/README.md) · [Lambda](lambda/README.md) · [DynamoDB](dynamodb/README.md) · [S3](s3/README.md) · [IAM](iam/README.md) · [CloudFront](cloudfront/README.md) · [Route 53](route53/README.md) · [Monitoring](monitoring/README.md)

## File cấu hình bổ sung

Xem [danh mục hạ tầng](README.md) cho EventBridge, ACM, X-Ray và quota. REST API Tokyo còn policy TLS_1_0, cần đối chiếu với cấu hình TLS của Singapore.
