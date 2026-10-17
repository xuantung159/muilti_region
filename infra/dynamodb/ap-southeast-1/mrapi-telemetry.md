# mrapi-telemetry — ap-southeast-1 (Singapore)

- Người thực hiện: A
- Lần đối chiếu Console: ảnh Console 16/10/2026 (form tạo bảng, trang bảng, tab Indexes); các mục còn lại do A xác nhận bằng lời, cần đối chiếu bằng lệnh ở README
- Trạng thái: Đã cấu hình. Chưa test ghi/đọc/query/TTL (NOT TESTED)
- ARN: `arn:aws:dynamodb:ap-southeast-1:138150704839:table/mrapi-telemetry`
- Tag: `Project=mrapi`, `Owner=A`

## Cấu hình đang áp dụng

| Thuộc tính | Giá trị | Xác nhận |
|---|---|---|
| Partition key | `PK` (String) | Ảnh Console 16/10 |
| Sort key | `SK` (String) | Ảnh Console 16/10 |
| Capacity mode | On-demand | Theo hướng dẫn tạo bảng; cần đối chiếu |
| Index `GSI1` | PK `GSI1PK` (String), SK `GSI1SK` (String), projection All | A báo Active |
| TTL | Thuộc tính `expiresAt` (epoch giây) | A báo đã bật |
| Tag | `Project=mrapi`, `Owner=A` | A báo đã thêm; cần đối chiếu |
| Replica / Global Tables | Chưa có (Tokyo làm sau nghiệm thu Singapore) | Theo kế hoạch |

## Thiết kế dữ liệu (đề xuất của A, CHƯA được L/B xác nhận)

Mỗi request đi qua gateway ghi một dòng, ghi một lần và không sửa.

- `PK` = `TENANT#<tenantId>`
- `SK` = `<timestamp ISO 8601>#<requestId>`, ví dụ `2026-10-16T08:30:15.123Z#req-8f3a`
- Request lỗi gateway phát hiện có thêm `GSI1PK` = `TENANT#<tenantId>#ERR` và `GSI1SK` = giá trị của `SK`; request không lỗi không có hai trường này nên không vào `GSI1`
- `expiresAt` = thời điểm ghi cộng thời gian giữ dữ liệu (đề xuất 30 ngày; chưa chốt)

Item mẫu:

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
  "status": 502,
  "errorType": "UPSTREAM_TIMEOUT",
  "latencyMs": 5003,
  "region": "ap-southeast-1",
  "timestamp": "2026-10-16T08:30:15.123Z",
  "expiresAt": 1795000000,
  "GSI1PK": "TENANT#t123#ERR",
  "GSI1SK": "2026-10-16T08:30:15.123Z#req-8f3a"
}
```

Quy tắc ghi: không ghi API key hay hash của key (chỉ `keyId`), không ghi query string, body hoặc header. Tên trường DynamoDB không tự kiểm tra, B phải ghi đúng tên ở trên.

Đề xuất `errorType` (chỉ request có `errorType` mới vào `GSI1`): `UPSTREAM_TIMEOUT`, `UPSTREAM_UNREACHABLE`, `UPSTREAM_5XX`, `API_DISABLED`, `API_NOT_FOUND`, `KEY_REVOKED`, `KEY_SCOPE_DENIED`, `TARGET_BLOCKED`, `GATEWAY_INTERNAL`. Lỗi 4xx do backend doanh nghiệp trả về không gán `errorType`.

## Access pattern

| Câu hỏi | Cách truy vấn |
|---|---|
| Request của tenant trong khoảng thời gian | Query bảng chính: `PK` = tenant, `SK` trong khoảng thời gian |
| Chỉ một API | Như trên, thêm filter `apiId` |
| Request lỗi gần đây của tenant | Query `GSI1`: `GSI1PK` = `TENANT#<id>#ERR` |
| Tra theo `requestId` | Chưa hỗ trợ trực tiếp; tìm trong log CloudWatch hoặc thêm index sau |

## Cách dựng lại

1. DynamoDB → Create table → tên `mrapi-telemetry`, PK `PK` (String), SK `SK` (String), Customize settings → On-demand.
2. Tab Indexes → Create index trong khung Global secondary indexes: PK `GSI1PK` (String), SK `GSI1SK` (String), tên `GSI1`, projection All.
3. Tab Settings → bật TTL thuộc tính `expiresAt`; thêm tag `Project=mrapi`, `Owner=A`.
4. Hoặc dùng CLI/CloudShell: `aws dynamodb create-table --cli-input-json file://mrapi-telemetry.json --region ap-southeast-1`, sau đó `aws dynamodb update-time-to-live --cli-input-json file://mrapi-telemetry.ttl.json --region ap-southeast-1`.

`mrapi-telemetry.json` và `mrapi-telemetry.ttl.json` là định nghĩa dựng lại theo cấu hình A đã làm, không phải bản xuất nguyên văn từ AWS.

## Quyền cần cấp (index cần ARN riêng)

- Proxy: `dynamodb:PutItem` trên bảng (đã có trong `infra/iam/roles/mrapi-proxy-role/permission.json`)
- Monitoring (chưa tạo role): `dynamodb:Query` trên `arn:aws:dynamodb:ap-southeast-1:138150704839:table/mrapi-telemetry` và `.../table/mrapi-telemetry/index/*`
- Authorizer ghi telemetry khi từ chối key hay không: chưa chốt với B

## Kiểm thử và bằng chứng

- Thao tác cần chạy: ghi item mẫu của hai tenant (có và không có `GSI1PK`), query theo tenant và khoảng thời gian, query `GSI1`, kiểm tra tenant A không đọc được dữ liệu tenant B, kiểm tra `expiresAt` là epoch giây
- Mong đợi: query chỉ trả đúng tenant; `GSI1` chỉ chứa request lỗi
- Thực tế: NOT TESTED
- Bằng chứng: chưa có (đặt tại docs/evidence/dynamodb/)
- Hạn chế: TTL xóa không tức thời, code đọc vẫn phải lọc theo thời gian; Tokyo chưa làm

## Bàn giao

- Config đã cập nhật: `config/demo/ap-southeast-1.json` thêm `tables.telemetry` (tên dự kiến, ghi nhận bảng đã tạo)
- Consumer: B (proxy ghi, authorizer nếu ghi), L (monitoring đọc)
- Reviewer/kết luận: chưa điền (L và B)
