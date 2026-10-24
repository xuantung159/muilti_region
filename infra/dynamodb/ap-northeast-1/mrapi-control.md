# mrapi-control — ap-northeast-1 (Tokyo, replica)

- Người thực hiện: A
- Loại: **replica của Global Table** từ Singapore. Loại item và quy ước khóa giống [bản Singapore](../ap-southeast-1/mrapi-control.md)
- Lần đối chiếu: `describe-table`, `describe-time-to-live`, `list-tags-of-resource` ngày 23/10/2026
- Trạng thái: ACTIVE
- ARN: `arn:aws:dynamodb:ap-northeast-1:138150704839:table/mrapi-control`

## Cấu hình đang áp dụng

| Thuộc tính | Giá trị | Xác nhận |
|---|---|---|
| Partition key / Sort key | `PK` (String) / `SK` (String) | `describe-table` 23/10 |
| Capacity mode | On-demand | `describe-table` 23/10 |
| Index | Không có (bảng control không dùng GSI) | `describe-table` 23/10 |
| Streams | Bật, `NEW_AND_OLD_IMAGES` | `describe-table` 23/10 |
| Global Tables | Phiên bản 2019.11.21; replica còn lại: ap-southeast-1, ACTIVE | `describe-table` 23/10 |
| Consistency | Eventual consistency, last-writer-wins | Màn hình tạo replica 23/10 |
| TTL | Thuộc tính `expiresAt`, ENABLED | `describe-time-to-live` 23/10 |
| Tag | `Project=mrapi`, `Owner=A` (đã sửa khóa `"Project "` thừa dấu cách, A báo 23/10) | `list-tags-of-resource` + A báo |

## Lưu ý thiết kế khi bảng nằm ở hai Region

- Phiên đăng nhập (`SESSION#<hash>`) lưu trong bảng này nên đăng nhập ở Region này dùng được ở Region kia sau khi replicate (khoảng 1 giây ở bảng telemetry, chưa đo riêng cho bảng control).
- Bộ đếm `USAGE#<phút>#<region>#<keyId>` có Region trong khóa nên hai Region không ghi đè nhau.
- Thu hồi API key ở một Region chỉ có tác dụng ở Region kia sau khi replicate: cần đo thời gian thật cho R3 (chưa đo).

## Cách dựng lại

Không tạo bảng thủ công ở Tokyo; tạo replica từ bảng Singapore (xem [mrapi-telemetry.md](mrapi-telemetry.md)).

## Kiểm thử và bằng chứng

- Replication của bảng này chưa đo riêng; số liệu R2 hiện chỉ đo trên `mrapi-telemetry`
- Đọc/ghi từ Lambda Tokyo: NOT TESTED (B chưa deploy Lambda Tokyo tại thời điểm viết)

## Bàn giao

- Consumer: B (proxy, authorizer, dashboard ở Tokyo)
- Reviewer/kết luận: chưa điền
