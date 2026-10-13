# Hợp đồng backend giám sát

Trình duyệt không được giữ thông tin xác thực AWS, nên dashboard không gọi AWS trực tiếp. Nó gọi một backend nhỏ (dự kiến là một Lambda sau API Gateway) và backend này dùng IAM role để đọc CloudWatch, Route 53 ở cả hai Region.

Kiểu TypeScript đầy đủ nằm ở [src/domain/types.ts](../../src/domain/types.ts). Backend phải trả đúng các kiểu đó.

## Endpoint

| Method | Path | Trả về | Dùng cho trang |
|---|---|---|---|
| GET | `/monitoring/snapshot?range=1h\|6h\|24h\|7d` | `MonitoringSnapshot` | System Overview, Multi-Region |
| GET | `/monitoring/endpoints?range=…` | `EndpointStat[]` | API Monitoring |
| GET | `/monitoring/incidents` | `IncidentEvent[]` | Failover & Incidents |
| GET | `/monitoring/sources` | `DataSource[]` | Data Sources |

Yêu cầu chung:

- Trả `Content-Type: application/json` và header CORS cho origin của dashboard.
- Lỗi trả mã HTTP 4xx/5xx. Dashboard sẽ hiện trạng thái lỗi kèm nút thử lại, không rơi về dữ liệu mẫu.
- Endpoint này lộ số liệu vận hành, nên cần xác thực trước khi đưa ra ngoài mạng nội bộ (ví dụ token phiên của trang quản trị). `HttpProvider` hiện chưa gửi header xác thực; thêm ở `src/data/providers.ts` khi chốt cơ chế.

## Quy tắc về metric

Mỗi metric là một trong hai dạng:

```json
{ "kind": "value", "value": 128960 }
```

```json
{ "kind": "missing", "reason": "not_connected" }
```

| `reason` | Khi nào dùng |
|---|---|
| `not_connected` | Backend chưa tích hợp nguồn này |
| `not_configured` | Đã tích hợp nhưng tài nguyên AWS chưa bật metric (ví dụ S3 replication metrics) |
| `unavailable` | Đã cấu hình nhưng CloudWatch không trả điểm dữ liệu nào trong khoảng xem |

Không trả `0` thay cho dữ liệu thiếu: `0` nghĩa là đã đo và kết quả bằng 0.

## Ví dụ `MonitoringSnapshot` (rút gọn)

```json
{
  "dataMode": "live",
  "generatedAt": 1791900000000,
  "range": "6h",
  "routingPolicy": { "kind": "value", "value": "Latency-based + health check" },
  "regions": [
    {
      "region": "ap-southeast-1",
      "healthCheck": { "kind": "value", "value": "healthy" },
      "trafficSharePct": { "kind": "value", "value": 61 },
      "requests": { "kind": "value", "value": 78291 },
      "successRatePct": { "kind": "value", "value": 98.48 },
      "errorRatePct": { "kind": "value", "value": 1.52 },
      "latencyAvgMs": { "kind": "value", "value": 49 },
      "latencyP95Ms": { "kind": "value", "value": 117 },
      "lambda": {
        "invocations": { "kind": "value", "value": 78291 },
        "errors": { "kind": "value", "value": 160 },
        "durationAvgMs": { "kind": "value", "value": 34 }
      },
      "apiGateway": {
        "requests": { "kind": "value", "value": 78291 },
        "error4xx": { "kind": "value", "value": 988 },
        "error5xx": { "kind": "value", "value": 200 }
      },
      "dynamodbReplicationLatencyMs": { "kind": "value", "value": 802 },
      "s3ReplicationLatencyS": { "kind": "missing", "reason": "not_configured" }
    }
  ],
  "series": [
    {
      "t": 1791878400000,
      "regions": {
        "ap-southeast-1": { "requests": 1210, "success": 1190, "error4xx": 16, "error5xx": 4, "latencyAvgMs": 48, "latencyP95Ms": 115 },
        "ap-northeast-1": { "requests": 840, "success": 827, "error4xx": 10, "error5xx": 3, "latencyAvgMs": 57, "latencyP95Ms": 139 }
      }
    }
  ]
}
```

- `regions` phải có đủ cả hai Region; Region chưa có số liệu thì trả metric dạng `missing`.
- `series` có thể rỗng. Độ dài ô thời gian theo [src/domain/range.ts](../../src/domain/range.ts): 1 phút (1h), 5 phút (6h), 15 phút (24h), 120 phút (7d).
- `generatedAt` là thời điểm backend lấy số liệu, tính bằng epoch mili giây.

## Sự kiện (`IncidentEvent`)

Trường `origin` quyết định nhãn trên giao diện:

| `origin` | Ai tạo | Ví dụ |
|---|---|---|
| `aws` | Backend, suy ra từ dữ liệu AWS | CloudWatch alarm chuyển ALARM, health check Route 53 đổi trạng thái |
| `manual_test` | Nhóm ghi lại sau khi tự đo | Kết quả bài test failover, có thời gian chuyển hướng đo bằng script |
| `simulated` | Chỉ dùng cho dữ liệu mẫu | Backend thật không bao giờ trả giá trị này |

`recoverySeconds` để `null` nếu chưa đo. Không điền số ước lượng.

## Các bước chuyển từ mock sang thật

1. Dựng backend trả `/monitoring/sources` trước, mọi nguồn ở trạng thái `not_connected`.
2. Tích hợp từng dịch vụ theo tài liệu riêng trong thư mục này; mỗi lần xong một nguồn thì đổi trạng thái nguồn đó thành `connected`.
3. Đặt `VITE_MONITORING_API_URL` trong `.env.local`, tắt "Chế độ dữ liệu demo" trong Settings.
4. Đối chiếu từng con số trên dashboard với CloudWatch Console trong cùng khoảng thời gian trước khi dùng dashboard làm bằng chứng.
