# mrapi-telemetry — ap-northeast-1 (Tokyo, replica)

- Người thực hiện: A
- Loại: **replica của Global Table** từ Singapore, không phải bảng độc lập. Schema, thiết kế dữ liệu và access pattern giống hệt [bản Singapore](../ap-southeast-1/mrapi-telemetry.md)
- Lần đối chiếu: lệnh `describe-table`, `describe-time-to-live`, `list-tags-of-resource` chạy ngày 23/10/2026
- Trạng thái: ACTIVE. Độ trễ replication đã đo (xem dưới)
- ARN: `arn:aws:dynamodb:ap-northeast-1:138150704839:table/mrapi-telemetry`

## Cấu hình đang áp dụng

| Thuộc tính | Giá trị | Xác nhận |
|---|---|---|
| Partition key / Sort key | `PK` (String) / `SK` (String) | `describe-table` 23/10 |
| Capacity mode | On-demand | `describe-table` 23/10 |
| Index `GSI1` | `GSI1PK` / `GSI1SK`, ACTIVE (tự sao chép từ Singapore) | `describe-table` 23/10 |
| Streams | Bật, `NEW_AND_OLD_IMAGES` | `describe-table` 23/10 |
| Global Tables | Phiên bản 2019.11.21; replica còn lại: ap-southeast-1, ACTIVE | `describe-table` 23/10 |
| Consistency | Eventual consistency, last-writer-wins (chọn lúc tạo replica) | Màn hình tạo replica 23/10 |
| TTL | Thuộc tính `expiresAt`, ENABLED | `describe-time-to-live` 23/10 |
| Tag | `Project=mrapi`, `Owner=A` | `list-tags-of-resource` 23/10 |

Không chọn Strong consistency (multi-Region strong consistency) vì chế độ đó không hỗ trợ TTL, mà hai bảng dùng TTL `expiresAt`.

## Cách dựng lại

Không tạo bảng thủ công ở Tokyo. Replica phải do DynamoDB tự tạo từ bảng Singapore; nếu Tokyo đã có bảng trùng tên thì tạo replica lỗi "one or more replicas already existed as tables" (đã gặp ngày 23/10/2026, phải xóa bảng thủ công rồi tạo lại).

1. Singapore: bật Streams `NEW_AND_OLD_IMAGES`.
2. Bảng → tab Global tables → Create replica → Asia Pacific (Tokyo), Eventual consistency.
3. Kiểm tra ở Tokyo: ACTIVE, GSI1 ACTIVE, TTL `expiresAt`, tag.

Các file `*.json` định nghĩa tạo bảng độc lập đã bỏ khỏi thư mục này vì không còn đúng. Bản thực tế: lưu `describe-table` thành `mrapi-telemetry.describe.json` (lệnh ở [README](../README.md)).

## Kiểm thử và bằng chứng

- Đo replication (R2): `node tests/replication/replication-latency.mjs`, CloudShell Singapore, 23/10/2026, 5 lần mỗi chiều, bảng `mrapi-telemetry`

| Chiều | Nhỏ nhất | Trung bình | Lớn nhất |
|---|---|---|---|
| Singapore → Tokyo | 900 ms | 1068 ms | 1165 ms |
| Tokyo → Singapore | 548 ms | 983 ms | 1103 ms |

- Cách đo: từ lúc gửi `PutItem` đến lúc đọc được ở Region đích (eventually consistent). Client đặt ở Singapore nên số đo gồm độ trễ mạng tới Tokyo (khoảng 70 ms mỗi lần gọi), là cận trên chứ không phải độ trễ thuần của DynamoDB. Mẫu ít (5), chưa so với metric `ReplicationLatency` trên CloudWatch
- Bằng chứng: `docs/evidence/dynamodb/replication-latency-2026-10-23.json`
- Chưa kiểm tra: ghi đồng thời cùng khóa ở hai Region (xung đột last-writer-wins); PITR của replica Tokyo

## Bàn giao

- Đã báo B bảng Tokyo Active: cần xác nhận lại với B
- Consumer: B (Lambda Tokyo ghi/đọc), A (script đo, export từ Singapore)
- Reviewer/kết luận: chưa điền (theo phân công, A review B; người review bảng này là L)
