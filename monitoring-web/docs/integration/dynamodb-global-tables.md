# Tích hợp DynamoDB Global Tables

Nguồn của độ trễ replication giữa hai Region.

## Cần chuẩn bị

| Hạng mục | Giá trị |
|---|---|
| Tên bảng | Các bảng Global Table của dự án |
| Quyền IAM | `cloudwatch:GetMetricData` |
| Điều kiện | Bảng đã có replica ở cả hai Region |

## Metric

Namespace `AWS/DynamoDB`, metric `ReplicationLatency`, đơn vị mili giây, dimension `TableName` và `ReceivingRegion`.

Metric được ghi ở **Region nguồn**. Để có đủ hai chiều cần hai truy vấn:

| Chiều | Client CloudWatch ở Region | `ReceivingRegion` | Điền vào |
|---|---|---|---|
| Singapore → Tokyo | `ap-southeast-1` | `ap-northeast-1` | `dynamodbReplicationLatencyMs` của Singapore |
| Tokyo → Singapore | `ap-northeast-1` | `ap-southeast-1` | `dynamodbReplicationLatencyMs` của Tokyo |

Dùng statistic `Average` cho cả khoảng xem. Nếu có nhiều bảng, hiển thị bảng có độ trễ lớn nhất hoặc bổ sung trường theo từng bảng.

## Giới hạn cần biết

- Metric chỉ có điểm dữ liệu khi có thao tác ghi. Bảng không có ghi trong khoảng xem thì trả `unavailable`, không trả 0.
- `ReplicationLatency` đo thời gian một bản ghi xuất hiện ở replica kia. Nó **không** cho biết có xung đột ghi hay không: Global Tables dùng last-writer-wins và không có metric đếm bản ghi bị ghi đè.
- Dashboard đánh giá `Healthy` khi dưới 2 giây và `Degraded` khi từ 2 giây (ngưỡng trong `src/domain/status.ts`). Đây là ngưỡng của dự án, không phải cam kết của AWS.

## Kiểm tra

Ghi một item ở Singapore, đọc lại ở Tokyo bằng script đo của nhóm, và so thời gian đo được với giá trị `ReplicationLatency` trên dashboard trong cùng phút.
