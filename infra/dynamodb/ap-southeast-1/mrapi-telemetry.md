# mrapi-telemetry — ap-southeast-1 (Singapore)

- Người thực hiện: A
- Lần đối chiếu Console: ảnh Console 16/10/2026 (form tạo bảng, trang bảng, tab Indexes); các mục còn lại do A xác nhận bằng lời, cần đối chiếu bằng lệnh ở README
- Trạng thái: Đã cấu hình. Test ghi/query/GSI1/tách tenant/`expiresAt`: PASS ngày 23/10/2026 (TTL xóa thật chưa kiểm tra được ngay). Replica Tokyo Active
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
| Replica / Global Tables | Replica Tokyo `ap-northeast-1`, ACTIVE, Global Tables phiên bản 2019.11.21, Eventual consistency (last-writer-wins) | `describe-table` ở Tokyo, 23/10/2026 |
| Streams | Bật, `NEW_AND_OLD_IMAGES` (bắt buộc cho Global Tables 2019.11.21) | `describe-table` ở Tokyo, 23/10/2026 |
| PITR (Singapore) | Bật, giữ 35 ngày (cần cho Export to S3) | Output `update-continuous-backups`, 23/10/2026 |

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

- Thao tác đã chạy: `npm run test:telemetry --prefix src` (CloudShell Singapore, 23/10/2026): ghi 4 item cho 2 tenant thử (có và không có `GSI1PK`), query theo tenant và khoảng thời gian, query `GSI1`, kiểm tra tenant B không thấy dữ liệu tenant A, kiểm tra `expiresAt` là epoch giây
- Mong đợi: query chỉ trả đúng tenant; `GSI1` chỉ chứa request lỗi
- Thực tế: PASS cả 5 kiểm tra. Test này dùng credentials của thành viên, không dùng role Lambda, nên chưa chứng minh quyền của role proxy
- Replication Singapore ↔ Tokyo (R2): xem [../ap-northeast-1/mrapi-telemetry.md](../ap-northeast-1/mrapi-telemetry.md)
- Export sang S3 (R6): 30 item, trạng thái COMPLETED, xem [../../s3/README.md](../../s3/README.md)
- Bằng chứng: `docs/evidence/dynamodb/replication-latency-2026-10-23.json`; ảnh output CloudShell của test cần bổ sung vào `docs/evidence/dynamodb/`
- Hạn chế: TTL xóa không tức thời, code đọc vẫn phải lọc theo thời gian; chưa test TTL xóa thật

## Bàn giao

- Config đã cập nhật: `config/demo/ap-southeast-1.json` thêm `tables.telemetry` (tên dự kiến, ghi nhận bảng đã tạo)
- Consumer: B (proxy ghi, authorizer nếu ghi), L (monitoring đọc)
- Reviewer/kết luận: chưa điền (L và B)
