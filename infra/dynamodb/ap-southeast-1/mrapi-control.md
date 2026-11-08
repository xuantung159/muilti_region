# mrapi-control

## Chức năng

Lưu dữ liệu quản lý tài khoản và cấu hình gateway.

## Ứng dụng trong project

Dashboard quản lý tài khoản, phiên, API đích và key trong bảng này. Authorizer đọc key/scope, proxy đọc cấu hình backend; dữ liệu được sao chép sang Tokyo.

## Ý nghĩa các file cấu hình

| File | Mục đích |
|---|---|
| `mrapi-control.json` | Input tạo bảng, khóa và index. |
| `mrapi-control.ttl.json` | Input bật TTL trên expiresAt. |
| `mrapi-control.describe.json` | Schema, stream, replica và bảo vệ xóa đang có trên AWS; dùng để đối chiếu. |
| `mrapi-control.backup.json` | Trạng thái continuous backup/PITR, không chứa dữ liệu backup. |

## Cấu hình và chi tiết

Lưu tài khoản, phiên đăng nhập, API đích và API key.

| Thuộc tính | Giá trị |
|---|---|
| ARN SG | `arn:aws:dynamodb:ap-southeast-1:138150704839:table/mrapi-control` |
| Khóa | `PK`, `SK`, String |
| Capacity | On-demand |
| Replica | Tokyo, `ap-northeast-1` |
| TTL | `expiresAt`, epoch giây |
| PITR / deletion protection | Bật cả hai Region |
| Tag | `Project=mrapi`; Owner chưa ghi lại |

## Dữ liệu trong code

| Loại | PK | SK |
|---|---|---|
| Tài khoản | `USER#<email>` | `META` |
| Phiên | `SESSION#<hash>` | `META` |
| API đích | `TENANT#<tenantId>` | `API#<apiId>` |
| Key | `TENANT#<tenantId>` | `KEY#<keyId>` |
| Bộ đếm cũ | `TENANT#<tenantId>` | `USAGE#...` |

Key lưu `keyHash`, trạng thái và danh sách API `apiIds`. Secret chỉ trả một lần khi tạo. Dashboard hiện đọc thống kê từ telemetry, không dùng USAGE cũ.

## Dựng lại

Chạy tại thư mục JSON:

```bash
aws dynamodb create-table --cli-input-json file://mrapi-control.json --region ap-southeast-1
aws dynamodb update-time-to-live --cli-input-json file://mrapi-control.ttl.json --region ap-southeast-1
```

Cấu hình tiếp replica, PITR và deletion protection theo [runbook](../../../docs/runbooks/dynamodb-replica-tokyo.md). Hai lệnh trên chỉ tạo bảng và TTL.

Tên bảng đã lưu trong `config/demo/*.json`. Dashboard, proxy và authorizer dùng bảng này. Luồng tài khoản/API/key thật chưa nghiệm thu đầy đủ.
