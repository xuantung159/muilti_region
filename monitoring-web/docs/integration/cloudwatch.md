# Tích hợp AWS CloudWatch

CloudWatch là nguồn của gần như mọi con số trên dashboard: metric của API Gateway, Lambda, DynamoDB và S3 đều đọc qua đây. Các tài liệu còn lại chỉ nêu tên metric; cách gọi nằm ở tài liệu này.

## Cần chuẩn bị

| Hạng mục | Giá trị |
|---|---|
| Quyền IAM của backend | `cloudwatch:GetMetricData` (không giới hạn được theo resource, dùng `"Resource": "*"`) |
| Region | Tạo một CloudWatch client cho mỗi Region: `ap-southeast-1` và `ap-northeast-1` |
| Thêm cho alarm (tùy chọn) | `cloudwatch:DescribeAlarms`, `cloudwatch:DescribeAlarmHistory` |

Metric nằm ở Region của tài nguyên sinh ra nó. Backend đặt ở một Region vẫn đọc được Region kia bằng cách tạo client với `region` tương ứng.

## Cách gọi

Dùng `GetMetricData`, gom nhiều metric vào một lần gọi cho mỗi Region.

| Mục đích | `Period` | `Stat` |
|---|---|---|
| Chuỗi thời gian (`series`) | Bằng độ dài ô của khoảng xem: 60, 300, 900 hoặc 7200 giây | `Sum` cho số đếm, `Average` cho latency |
| Tổng của cả khoảng xem | Bằng cả khoảng xem (ví dụ 21600 giây cho 6 giờ) | `Sum` |
| p95 của cả khoảng xem | Bằng cả khoảng xem | `p95` |

Lưu ý:

- **Không tính p95 bằng cách lấy trung bình các p95 của từng ô.** Hãy gọi riêng một truy vấn có `Period` bằng cả khoảng xem.
- Ô thời gian không có request sẽ không có điểm dữ liệu. Với số đếm, coi là 0; với latency, bỏ qua ô đó.
- Metric có độ trễ khoảng 1–3 phút. Đừng lấy ô thời gian đang diễn ra; kết thúc truy vấn ở đầu ô hiện tại.
- Nếu cả khoảng xem không có điểm nào, trả metric `{ "kind": "missing", "reason": "unavailable" }`.

## Ánh xạ vào dashboard

| Trường trong `MonitoringSnapshot` | Nguồn |
|---|---|
| `requests`, `errorRatePct`, `successRatePct`, `latencyAvgMs`, `latencyP95Ms`, `apiGateway.*` | [api-gateway.md](api-gateway.md) |
| `lambda.*` | [lambda.md](lambda.md) |
| `dynamodbReplicationLatencyMs` | [dynamodb-global-tables.md](dynamodb-global-tables.md) |
| `s3ReplicationLatencyS` | [s3-replication.md](s3-replication.md) |
| `healthCheck` | [route53.md](route53.md) |

## Sự kiện từ alarm

Để trang Failover & Incidents có sự kiện loại `aws`:

1. Tạo alarm cho 5xx của API Gateway và Errors của Lambda ở từng Region.
2. Backend gọi `DescribeAlarmHistory` với `HistoryItemType=StateUpdate`.
3. Mỗi lần chuyển sang `ALARM` là `startedAt`, lần chuyển về `OK` kế tiếp là `endedAt`.

## Chi phí

`GetMetricData` tính phí theo số metric được yêu cầu. Với khoảng 15 metric mỗi Region và refresh 30 giây, hãy cache kết quả ở backend ít nhất 30–60 giây để nhiều người mở dashboard không nhân số lần gọi.

## Kiểm tra

Mở CloudWatch Console → Metrics, chọn cùng Region, cùng khoảng thời gian, cùng statistic, và so từng con số với dashboard. Chỉ đổi trạng thái nguồn sang `connected` khi số liệu khớp.
