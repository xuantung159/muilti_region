# mrapi-telemetry

## Chức năng

Lưu thông tin xử lý của từng request để truy vấn và thống kê.

## Ứng dụng trong project

Proxy ghi tenant, API, key ID, status, độ trễ và Region. Dashboard tổng hợp usage theo doanh nghiệp; Global Tables sao chép bản ghi giữa hai Region.

## Ý nghĩa các file cấu hình

| File | Mục đích |
|---|---|
| `mrapi-telemetry.json` | Input tạo bảng, khóa và index. |
| `mrapi-telemetry.ttl.json` | Input bật TTL trên expiresAt. |
| `mrapi-telemetry.describe.json` | Schema, stream, replica và bảo vệ xóa đang có trên AWS; dùng để đối chiếu. |
| `mrapi-telemetry.backup.json` | Trạng thái continuous backup/PITR, không chứa dữ liệu backup. |

## Cấu hình và chi tiết

Lưu một dòng cho mỗi request vào proxy. A phụ trách bảng; B ghi dữ liệu, dashboard và monitoring đọc.

## Cấu hình

| Thuộc tính | Giá trị |
|---|---|
| ARN SG | `arn:aws:dynamodb:ap-southeast-1:138150704839:table/mrapi-telemetry` |
| Khóa | `PK`, `SK`, String |
| Capacity | On-demand |
| GSI1 | `GSI1PK`, `GSI1SK`, String, projection ALL |
| TTL | `expiresAt`, epoch giây |
| Replica | Tokyo, `ap-northeast-1` |
| PITR / deletion protection | Bật cả hai Region |
| Tag khi tạo | `Project=mrapi`, `Owner=A` |

## Dữ liệu

- `PK = TENANT#<tenantId>`.
- `SK = <timestamp ISO 8601>#<requestId>`.
- Request có errorType thêm `GSI1PK = TENANT#<tenantId>#ERR`, `GSI1SK = SK`.
- `expiresAt` mặc định sau 30 ngày, chỉnh bằng `TELEMETRY_RETENTION_DAYS`.

Ví dụ request timeout:

```json
{
  "PK": "TENANT#t123",
  "SK": "2026-10-16T08:30:15.123Z#req-8f3a",
  "requestId": "req-8f3a",
  "tenantId": "t123",
  "apiId": "api1",
  "keyId": "key-77",
  "method": "GET",
  "path": "/orders",
  "status": 504,
  "errorType": "UPSTREAM_TIMEOUT",
  "latencyMs": 5003,
  "region": "ap-southeast-1",
  "timestamp": "2026-10-16T08:30:15.123Z",
  "expiresAt": 1795000000,
  "GSI1PK": "TENANT#t123#ERR",
  "GSI1SK": "2026-10-16T08:30:15.123Z#req-8f3a"
}
```

Không lưu API key, hash key, query string, body hoặc header. Lỗi 4xx từ backend không gán errorType. Request bị authorizer chặn chỉ có log authorizer, không có dòng telemetry.

## Truy vấn và quyền

| Nhu cầu | Cách đọc |
|---|---|
| Request tenant theo thời gian | Query PK tenant và khoảng SK |
| Chỉ một API | Thêm filter `apiId` |
| Lỗi của tenant | Query GSI1 theo `TENANT#<id>#ERR` |
| Tra requestId | Tìm log hoặc query khoảng thời gian; chưa có index riêng |

Proxy có PutItem. Monitoring có Query bảng và index hai Region. Dashboard chỉ Query bảng chính, không dùng GSI1.

## Dựng lại và kiểm thử

Tại thư mục JSON:

```bash
aws dynamodb create-table --cli-input-json file://mrapi-telemetry.json --region ap-southeast-1
aws dynamodb update-time-to-live --cli-input-json file://mrapi-telemetry.ttl.json --region ap-southeast-1
```

JSON có GSI1; replica/PITR/deletion protection làm tiếp theo [runbook](../../../docs/runbooks/dynamodb-replica-tokyo.md).

Kiểm thử đồng bộ: 10/10 item xuất hiện ở Region kia trong khoảng 1 giây. Cần thêm mẫu để đánh giá p95.
