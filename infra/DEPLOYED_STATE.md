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
| Monitoring thật | Theo dõi health hai Region; metric DynamoDB có thể thiếu điểm đo khi không có lượt ghi |
| Key thật và thống kê portal | Chưa nghiệm thu đầy đủ ở hai Region |
| Thu hồi key xuyên Region | Chưa có số đo |
| Trace → log → telemetry | Chưa đối chiếu đủ trên request proxy thật |
| Email cảnh báo | SNS đã được gọi; chưa xác nhận thư tới hộp thư. Email Budget còn chờ xác minh |

Cần kiểm tra file tên `exports/ducminh_credentials.csv` còn trong S3; chưa mở nội dung nên chưa xác nhận có credential thật. Quota Lambda đang lưu trong cấu hình là 10 concurrent executions mỗi Region, cần kiểm lại trước demo tải. Monitoring vẫn ghi Tokyo chưa bật S3 metrics dù rule đã bật.

## Tài liệu từng dịch vụ

[API Gateway](apigateway/README.md) · [Lambda](lambda/README.md) · [DynamoDB](dynamodb/README.md) · [S3](s3/README.md) · [IAM](iam/README.md) · [CloudFront](cloudfront/README.md) · [Route 53](route53/README.md) · [Monitoring](monitoring/README.md)

## File cấu hình bổ sung

Xem [danh mục hạ tầng](README.md) cho EventBridge, ACM, X-Ray và quota. REST API Tokyo còn policy TLS_1_0, cần đối chiếu với cấu hình TLS của Singapore.
