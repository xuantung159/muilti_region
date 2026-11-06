# Backend giám sát

Lambda `mrapi-monitoring` (handler `monitoring/index.handler`, Node.js 24.x) đọc CloudWatch của **cả hai Region** và trả đúng hợp đồng [backend-api.md](../../monitoring-web/docs/integration/backend-api.md).

| Endpoint | Nguồn dữ liệu |
|---|---|
| `GET /monitoring/snapshot?range=1h\|6h\|24h\|7d` (mặc định 6h) | API Gateway, Lambda, DynamoDB `ReplicationLatency`, S3 `ReplicationLatency` |
| `GET /monitoring/endpoints?range=…` | Metric API Gateway theo `Resource` + `Method` (cần stage bật detailed metrics) |
| `GET /monitoring/incidents` | `DescribeAlarmHistory` 7 ngày gần nhất, `origin: "aws"` |
| `GET /monitoring/sources` | Trạng thái thật của từng nguồn, suy ra từ kết quả truy vấn |

## Quy tắc

- Metric không có dữ liệu trả `missing` (`unavailable` hoặc `not_configured`), không bao giờ trả `0`.
- Cả hai Region lỗi (ví dụ thiếu quyền) → HTTP 502. Một Region lỗi → Region đó `missing`, Region kia vẫn có số.
- `trafficSharePct` chỉ tính khi cả hai Region có số liệu.
- p95 cả khoảng xem là truy vấn riêng (Period = cả khoảng). Nếu CloudWatch từ chối Period dài (có thể xảy ra ở 7d), metric đó là `unavailable`.
- Không lấy ô thời gian đang diễn ra (trễ 2 phút); cache 45 giây trong mỗi container.
- Chưa tích hợp: Route 53 (`healthCheck`, `routingPolicy`) và X-Ray, luôn `not_connected`.
- Endpoint chỉ trả method GET/POST/PUT/DELETE (đúng kiểu `HttpMethod` của hợp đồng); PATCH, OPTIONS bị bỏ qua.
- **Hàm không tự xác thực.** Route `/monitoring/*` phải đặt sau authorizer của API Gateway trước khi công khai.

## Biến môi trường

| Biến | Ý nghĩa |
|---|---|
| `MONITORING_ALLOWED_ORIGIN` | Origin của dashboard (CORS). Không đặt thì không gửi header CORS |
| `MONITORING_CONFIG` | JSON ghi đè tên tài nguyên, ví dụ `{"regions":{"ap-northeast-1":{"apiName":"<tên API Tokyo>"}}}` |

Mặc định lấy từ `list-metrics` thật ở Singapore: API `mrapi-api-sg`, stage `demo`, hàm `mrapi-proxy`, bảng `mrapi-telemetry`, rule S3 `mrapi-sg-to-tyo`. **Tên API Gateway ở Tokyo (`mrapi-api-tyo`) là giả định chưa xác nhận.**

## IAM cho role monitoring (L cấp)

`cloudwatch:GetMetricData`, `cloudwatch:ListMetrics`, `cloudwatch:DescribeAlarmHistory` (Resource `*`; các action này không giới hạn theo Region) và quyền ghi log CloudWatch Logs của hàm.

## Chạy test

`npm test --prefix src` (test dùng client CloudWatch giả, không gọi AWS). Đóng gói: `npm run package --prefix src` → `artifacts/lambda/monitoring.zip`.
