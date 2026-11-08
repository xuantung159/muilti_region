# Tùng — IAM, Budget, SNS trên Console

Account `138150704839`, user `admin`.

## Đã làm

- SNS us-east-1: tạo topic `mrapi-alerts`, thêm email. Lúc đó email còn chờ xác nhận.
- IAM: thêm ARN Tokyo và quyền X-Ray cho `mrapi-proxy-role`, `mrapi-authorizer-role`, `mrapi-dashboard-role`. Dashboard giữ hai inline policy riêng (`mrapi-dashboard-access` và `ReadTelemetry`).
- Tạo role `mrapi-monitoring-role` cho Lambda monitoring, có boundary.
- Budget `mrapi-monthly`: 10 USD/tháng, báo khi thực tế vượt 50%, 80% và khi dự báo vượt 100%.
- Thử mua domain `multi-region.click` qua Route 53 nhưng bị chặn vì tài khoản free plan. Porkbun bán 1,54 USD năm đầu, chưa mua.
- Tạo trước hosted zone `multi-region.click` để thử DNS.

Ảnh chụp ở `docs/evidence/`.

## File đã cập nhật

- `infra/iam/roles/*/permission.json` cho ba role trên và role monitoring.
- `infra/iam/policies/mrapi-workload-boundary.json` (chỉ copy, không sửa).
- `infra/monitoring/budget.md`, `infra/monitoring/sns/`.
- `config/demo/global.json`: ARN các role.

## Còn lại lúc đó

- Mua domain, rồi làm ACM, CloudFront, health check. (Sau đổi sang `multi-region.io.vn`.)
- Xác nhận email SNS và email của Budget.
- Chờ Tokyo có API và Lambda mới làm định tuyến và thử chuyển vùng.

## Cách làm lại các phần chính

**Budget:** Billing → Budgets → Create budget → Cost budget, theo tháng, tên `mrapi-monthly`, nhập số tiền, thêm 3 ngưỡng và email.

**Health check và record latency:** Route 53 → Health checks, mỗi region một cái, trỏ vào URL execute-api của region đó, path `/demo/health`, 30 giây, lỗi 3 lần. Sau đó tạo hai record A alias cùng tên `api.<domain>`, routing Latency, mỗi record chọn đúng region và health check của nó.

**CloudFront:** cần cert ở us-east-1 trước. Origin S3 qua OAC, các đường `/api/*`, `/proxy/*`, `/health`, `/monitoring/*` trỏ về API và tắt cache.

**Thử chuyển vùng (cùng Toan):** Toan bật `HEALTH_FORCE_FAIL=true` ở một region, Tùng ghi giờ health check báo lỗi và giờ DNS đổi. Gỡ biến, ghi giờ phục hồi. Làm 3 lần.
