# Backend giám sát

Hàm `mrapi-monitoring`, handler `monitoring/index.handler`, đã chạy ở Singapore và Tokyo cùng một ZIP. Đọc CloudWatch của 2 Region và us-east-1, không trả dữ liệu giả.

Contract: [backend-api.md](../../monitoring-web/docs/integration/backend-api.md).
Frontend: [monitoring-web](../../monitoring-web/README.md).
Cấu hình và hash đang chạy: [infra/lambda/README.md](../../infra/lambda/README.md).

Route `/monitoring/*` công khai theo quyết định của nhóm ngày 01/11/2026, chỉ trả số liệu tổng hợp.

Metric S3 Replication được truy vấn ở Region của bucket đích (`metricRegion`), dùng `Maximum`. Metric DynamoDB Replication truy vấn ở Region nguồn.

Sau khi đóng gói bằng `npm --prefix src run package`, cập nhật cả 2 Region bằng đúng một ZIP rồi đối chiếu CodeSha256.
