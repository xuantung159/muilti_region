# mrapi-control — ap-southeast-1 (Singapore)

- Người thực hiện: L tạo bảng; A tiếp nhận và ghi nhận cấu hình
- Lần đối chiếu Console: 15/10/2026 qua ảnh Console (PK/SK, capacity, ARN, PITR, replica). TTL/tag A báo đã kiểm tra, chưa chép giá trị — đối chiếu lại bằng lệnh ở README
- Trạng thái: Đã cấu hình. Chưa test đọc/ghi từ Lambda thật (NOT TESTED)
- ARN: `arn:aws:dynamodb:ap-southeast-1:138150704839:table/mrapi-control`
- Tag: `Project=mrapi`; giá trị `Owner` điền theo Console (chưa chép)

## Cấu hình đang áp dụng

| Thuộc tính | Giá trị | Xác nhận |
|---|---|---|
| Partition key | `PK` (String) | Ảnh Console 15/10 |
| Sort key | `SK` (String) | Ảnh Console 15/10 |
| Capacity mode | On-demand | Ảnh Console 15/10 |
| Table status | Active | Ảnh Console 15/10 |
| PITR | Off | Ảnh Console 15/10 |
| Replica / Global Tables | 0 (chưa có Tokyo) | Ảnh Console 15/10 |
| TTL | Thuộc tính `expiresAt` (theo thiết kế và code) | A báo TTL đã bật; tên thuộc tính cần đối chiếu |
| Tag | `Project=mrapi` | A báo đã có tag; giá trị cần đối chiếu |

## Loại item đang dùng trong code (xem GATEWAY_DESIGN.md và src/)

| Loại | PK | SK |
|---|---|---|
| Tài khoản | `USER#<email>` | `META` |
| Phiên đăng nhập | `SESSION#<hash>` | `META` |
| API đích | `TENANT#<tenantId>` | `API#<apiId>` |
| API key (bản cũ, chưa có scope theo API) | `TENANT#<tenantId>` | `KEY#<keyId>` |
| Bộ đếm usage (bản cũ) | `TENANT#<tenantId>` | `USAGE#...` |

Cách lưu item API key mới (hash, trạng thái, tenant, scope) chưa được L/B/A chốt; cập nhật bảng này khi chốt.

## Cách dựng lại

1. DynamoDB → Create table → tên `mrapi-control`, PK `PK` (String), SK `SK` (String), On-demand.
2. Bật TTL thuộc tính `expiresAt`; thêm tag theo `mrapi-control.json`.
3. Hoặc dùng CLI/CloudShell: `aws dynamodb create-table --cli-input-json file://mrapi-control.json --region ap-southeast-1`, sau đó `aws dynamodb update-time-to-live --cli-input-json file://mrapi-control.ttl.json --region ap-southeast-1`.

`mrapi-control.json` và `mrapi-control.ttl.json` là định nghĩa dựng lại theo cấu hình đã quan sát, không phải bản xuất nguyên văn từ AWS. Bản xuất thực tế: xem lệnh `describe-table` ở README.

## Kiểm thử và bằng chứng

- Quyền role dashboard với bảng: xem `infra/iam/roles/mrapi-dashboard-role/permission.json` (GetItem, PutItem, DeleteItem, Query)
- Thực tế: NOT TESTED
- Bằng chứng: chưa có (đặt tại docs/evidence/dynamodb/)

## Bàn giao

- Config đã cập nhật: `config/demo/ap-southeast-1.json` đã có `tables.control`
- Consumer: L (dashboard), B (proxy, authorizer)
- Reviewer/kết luận: chưa điền
