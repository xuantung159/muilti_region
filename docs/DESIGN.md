# Thiết kế kỹ thuật — API contract và schema

Trạng thái tài liệu: BẢN NHÁP v0 — L chốt contract (L-04), A chốt schema (A-01) sau khi nhóm review.

## 1. Quy ước chung

| Hạng mục | Giá trị |
|---|---|
| Region | Singapore `ap-southeast-1`, Tokyo `ap-northeast-1` |
| Tiền tố tài nguyên | `mrapi-` (ví dụ `mrapi-main`, `mrapi-orders`, `mrapi-authorizer`) |
| Tag bắt buộc | `Project=mrapi`, `Owner=<L/A/B/C>` |
| Runtime Lambda | Python 3.13 |
| Biến môi trường Lambda | `TABLE_NAME`, `APP_VERSION` (Region lấy từ `AWS_REGION` có sẵn) |
| Header xác thực | `x-api-key` |
| Header trả về | `x-served-region` — Region đã xử lý request, dùng để chứng minh routing |
| Log | JSON một dòng: `level`, `message`, `requestId`, `tenantId`, `region`, `route`; không bao giờ log API key gốc |

## 2. API contract v1

Base URL: `https://api.<domain>` (trước khi có domain: URL mặc định của API Gateway từng Region).

| Method | Path | Xác thực | Mô tả | Thành công |
|---|---|---|---|---|
| GET | `/health` | Không | Trạng thái Region | 200 |
| POST | `/tenants` | Không | Đăng ký tenant, trả API key đầu tiên | 201 |
| POST | `/keys` | API key | Tạo thêm API key | 201 |
| GET | `/keys` | API key | Liệt kê key (không trả key gốc) | 200 |
| DELETE | `/keys/{keyId}` | API key | Thu hồi key | 204 |
| POST | `/orders` | API key | Tạo đơn hàng | 201 |
| GET | `/orders/{orderId}` | API key | Xem một đơn | 200 |
| GET | `/orders` | API key | Liệt kê đơn của tenant (`limit`, `nextToken`) | 200 |
| GET | `/orders/{orderId}/receipt` | API key | Trả presigned URL tải biên nhận từ S3 (hết hạn sau 5 phút) | 200 |
| GET | `/stats` | API key | Thống kê theo ngày (`from`, `to`) | 200 |

Ví dụ:

```http
POST /tenants
{"name": "Cong ty ABC", "email": "admin@abc.example"}

201
{"tenantId": "t_01J...", "apiKey": {"keyId": "k_01J...", "secret": "mrk_...", "createdAt": "2026-10-13T08:00:00Z"}}
```

```http
POST /orders
x-api-key: mrk_...
{"items": [{"sku": "A1", "quantity": 2, "unitPrice": 50000}], "note": "giao gio hanh chinh"}

201
{"orderId": "o_01J...", "status": "CREATED", "total": 100000, "createdAt": "...", "createdRegion": "ap-southeast-1"}
```

```http
GET /health

200
{"status": "ok", "region": "ap-southeast-1", "version": "1.0.0"}
```

Định dạng lỗi thống nhất:

```json
{"error": {"code": "VALIDATION_ERROR", "message": "items is required", "requestId": "..."}}
```

| HTTP | code | Khi nào |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Body sai định dạng, thiếu trường |
| 401 | `UNAUTHORIZED` | Thiếu key, key sai, key đã thu hồi |
| 404 | `NOT_FOUND` | Không tồn tại, hoặc thuộc tenant khác |
| 409 | `CONFLICT` | Trùng (ví dụ email tenant đã đăng ký) |
| 429 | `THROTTLED` | Vượt giới hạn |
| 500 | `INTERNAL_ERROR` | Lỗi không lường trước; không trả stack trace |

Quy tắc bắt buộc:

- `tenantId` chỉ lấy từ context của authorizer, không nhận từ body, query hay path.
- Tài nguyên của tenant khác trả 404, không trả 403, để không lộ sự tồn tại.
- `secret` của API key chỉ xuất hiện một lần trong response tạo key.
- `POST /tenants` để công khai là chấp nhận được cho đồ án; ghi rõ trong báo cáo là production cần cơ chế bảo vệ.

## 3. Schema DynamoDB (single-table)

Bảng `mrapi-main`, on-demand, khóa `PK` (String) + `SK` (String), Global Table ở 2 Region.

| Thực thể | PK | SK | Thuộc tính chính |
|---|---|---|---|
| Tenant | `TENANT#<tenantId>` | `PROFILE` | `name`, `email`, `createdAt` |
| API key (tra theo hash) | `APIKEY#<sha256(secret)>` | `META` | `tenantId`, `keyId`, `status`, `createdAt` |
| API key (liệt kê theo tenant) | `TENANT#<tenantId>` | `KEY#<keyId>` | `keyHash`, `status`, `createdAt`, `revokedAt` |
| Đơn hàng | `TENANT#<tenantId>` | `ORDER#<orderId>` | `items`, `total`, `status`, `createdAt`, `createdRegion` |
| Bộ đếm | `TENANT#<tenantId>` | `STATS#<yyyy-mm-dd>#<region>` | `requestCount`, `orderCount` |

| Access pattern | Thao tác |
|---|---|
| Authorizer tra key | `GetItem` PK=`APIKEY#<hash>`, SK=`META` |
| Liệt kê key của tenant | `Query` PK=`TENANT#<id>`, SK bắt đầu bằng `KEY#` |
| Xem một đơn | `GetItem` PK=`TENANT#<id>`, SK=`ORDER#<orderId>` |
| Liệt kê đơn | `Query` PK=`TENANT#<id>`, SK bắt đầu bằng `ORDER#` |
| Thống kê theo khoảng ngày | `Query` PK=`TENANT#<id>`, SK giữa `STATS#<from>` và `STATS#<to>~` rồi cộng theo Region |

Lưu ý thiết kế cho môi trường 2 Region:

- `orderId` dùng ULID sinh phía server: không trùng giữa hai Region và sắp xếp được theo thời gian.
- Tạo và thu hồi key ghi 2 item bằng `TransactWriteItems` để không lệch nhau.
- Bộ đếm tách theo Region vì Global Tables dùng last-writer-wins: hai Region cùng cộng dồn một item sẽ mất số liệu.
- Thu hồi key cần thời gian replication mới có hiệu lực ở Region kia; đo trong TC-11.
- Đơn hàng không sửa tại chỗ từ hai Region; nếu cần đổi trạng thái thì dùng điều kiện ghi và chấp nhận last-writer-wins, ghi rõ trong báo cáo.

## 4. S3 — biên nhận đơn hàng

| Hạng mục | Giá trị |
|---|---|
| Bucket | `mrapi-receipts-<account-suffix>-apse1` (Singapore), `mrapi-receipts-<account-suffix>-apne1` (Tokyo) |
| Object key | `tenants/<tenantId>/orders/<orderId>.json` |
| Versioning | Bật ở cả hai bucket (bắt buộc cho replication) |
| Public access | Chặn toàn bộ; chỉ tải qua presigned URL |
| Replication | 2 rule, mỗi bucket một rule trỏ sang bucket kia; bật replica modification sync và delete marker replication |
| Lifecycle | Xóa noncurrent version sau 7 ngày để không tích lũy dung lượng |
| Biến môi trường Lambda | `RECEIPT_BUCKET` — bucket của chính Region đó |

Luồng: `POST /orders` ghi item vào DynamoDB rồi ghi biên nhận vào bucket cùng Region. `GET /orders/{orderId}/receipt` kiểm tra đơn thuộc tenant trong DynamoDB, sau đó ký URL cho bucket cùng Region.

Lưu ý:

- Replication S3 là bất đồng bộ: ngay sau khi tạo đơn, biên nhận có thể chưa có ở Region kia dù item DynamoDB đã có. Endpoint trả 404 `NOT_FOUND` kèm message "receipt not replicated yet" trong trường hợp này; đo độ trễ trong A-11.
- Ghi biên nhận thất bại không được làm hỏng việc tạo đơn: log lỗi và trả đơn với `receiptStatus: "PENDING"`.
- Chi phí: dung lượng vài KB mỗi đơn, phí truyền liên Region tính theo GB — không đáng kể ở tải đồ án.

## 5. Phân quyền Lambda (A hoàn thiện trong A-03 và A-11)

`mrapi-orders` có thêm `s3:PutObject` và `s3:GetObject` trên `arn:aws:s3:::<bucket>/tenants/*` của cả hai bucket.

| Lambda | Quyền DynamoDB trên `mrapi-main` |
|---|---|
| `mrapi-health` | Không |
| `mrapi-authorizer` | `GetItem` |
| `mrapi-tenants` | `PutItem`, `TransactWriteItems` |
| `mrapi-keys` | `Query`, `GetItem`, `PutItem`, `UpdateItem`, `TransactWriteItems` |
| `mrapi-orders` | `PutItem`, `GetItem`, `Query`, `UpdateItem` |
| `mrapi-stats` | `Query` |

Mọi role thêm quyền ghi CloudWatch Logs cho đúng log group của mình. IAM là dịch vụ toàn cục: một role dùng cho cả hai Region, policy liệt kê ARN bảng ở cả hai Region.
