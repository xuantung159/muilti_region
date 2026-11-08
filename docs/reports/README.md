# docs/reports

Kết quả kiểm thử và nghiệm thu trên AWS thật. Giờ ghi trong từng báo cáo là giờ Việt Nam.

| File | Nội dung |
|---|---|
| [e2e-acceptance.md](e2e-acceptance.md) | Nghiệm thu luồng portal → key → proxy → telemetry ở hai Region (38/39 ca đạt), đo thu hồi key xuyên Region, đối chiếu requestId → log → X-Ray |
| [ops-verification.md](ops-verification.md) | Export theo lịch, replication DynamoDB/S3, Route 53, 13 alarm, SNS/Budget, X-Ray, bảo mật S3 |
| [config-fixes.md](config-fixes.md) | Cấu hình đã sửa: monitoring Tokyo, Cache-Control CloudFront; TLS và quota Lambda |
| [failover.md](failover.md) | Mô phỏng Region Singapore lỗi, đo thời gian chuyển sang Tokyo (3 lần) |
| [data-replication.md](data-replication.md) | Đồng bộ DynamoDB Global Tables và số liệu monitoring |
| [route53-live-test.md](route53-live-test.md) | Định tuyến theo độ trễ và health check Route 53 |
| [Final-report.pptx](Final-report.pptx) | Slide báo cáo cuối |
| [progress/](progress/) | Báo cáo tiến độ lần 1, lần 2 |

Bằng chứng (ảnh, CSV, output CLI) ở [docs/evidence](../evidence/README.md). Không lưu secret, API key hay mật khẩu.
