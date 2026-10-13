# Tích hợp Amazon S3 Replication

Nguồn của độ trễ replication giữa hai bucket. Trong dữ liệu mẫu, metric này cố ý hiển thị `Not configured` để minh họa trạng thái đó.

## Cần chuẩn bị

| Hạng mục | Giá trị |
|---|---|
| Tên bucket | Bucket ở Singapore và bucket ở Tokyo |
| Rule ID | ID của replication rule trên mỗi bucket |
| Quyền IAM | `cloudwatch:GetMetricData` |
| Bật thêm | Replication metrics trên **từng** rule (tùy chọn "Replication metrics" khi tạo hoặc sửa rule) |

Replication metrics không bật mặc định và có tính phí theo metric CloudWatch. Chưa bật thì backend trả `{ "kind": "missing", "reason": "not_configured" }`.

## Metric

Namespace `AWS/S3`, dimension `SourceBucket`, `DestinationBucket`, `RuleId`. Metric ghi ở Region của bucket nguồn.

| Metric | Ý nghĩa | Dùng cho |
|---|---|---|
| `ReplicationLatency` | Số giây bucket đích chậm hơn bucket nguồn | `s3ReplicationLatencyS` |
| `OperationsPendingReplication` | Số thao tác đang chờ replicate | Mở rộng sau |
| `BytesPendingReplication` | Dung lượng đang chờ replicate | Mở rộng sau |

Giống DynamoDB, mỗi chiều là một truy vấn riêng ở Region của bucket nguồn.

## Giới hạn cần biết

- Không có object mới thì không có điểm dữ liệu; trả `unavailable`.
- Metric có thể xuất hiện chậm khoảng 15 phút sau khi bật.
- Để kiểm tra một object cụ thể đã replicate chưa, dùng `HeadObject` và đọc `ReplicationStatus`; đó là bằng chứng trực tiếp hơn metric tổng hợp.

## Kiểm tra

Tải một file lên bucket Singapore, chờ `ReplicationStatus` chuyển `COMPLETED`, rồi so thời gian chờ với `ReplicationLatency` trên dashboard.
