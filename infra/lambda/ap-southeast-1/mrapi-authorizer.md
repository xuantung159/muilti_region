# mrapi-authorizer

## Chức năng

Xác thực API key và kiểm tra quyền gọi từng API.

## Ứng dụng trong project

Đứng trước route proxy, đọc trạng thái key và danh sách API được phép gọi; từ chối key sai, bị thu hồi hoặc ngoài scope trước khi proxy chạy.

## Ý nghĩa các file cấu hình

| File | Mục đích |
|---|---|
| `mrapi-authorizer.config.json` | Thông số chạy của hàm: handler, runtime, role, tài nguyên, tracing và tên env. |
| `mrapi-authorizer.resource-policy.json` | Quyền API Gateway hoặc EventBridge gọi hàm; giới hạn bằng service principal và SourceArn. |
| `mrapi-authorizer.tags.json` | Tag quản lý tài nguyên. Không chứa secret hay mã nguồn. |

## Cấu hình và chi tiết

Kiểm tra API key và phạm vi API được gọi. Chạy ở Singapore và Tokyo.

| Mục | Giá trị |
|---|---|
| Gói | `artifacts/lambda/authorizer.zip` |
| Handler | `authorizer/index.handler` |
| Runtime / kiến trúc | Node.js 24.x / arm64 |
| Role | `mrapi-authorizer-role` |
| Memory / timeout | 128 MB / 5 giây |
| Env | `CONTROL_TABLE=mrapi-control`, `TELEMETRY_TABLE=mrapi-telemetry`, `PROJECT` |

## Kết quả xác thực

| Trường hợp | Client nhận |
|---|---|
| Thiếu key, sai định dạng, không tồn tại hoặc sai secret | 401 |
| Key đã thu hồi | 403, lý do log `KEY_REVOKED` |
| API ngoài scope, khác tenant hoặc key cũ chưa có scope | 403, lý do log `KEY_SCOPE_DENIED` |
| Key hợp lệ | Chuyển tới proxy với `tenant_id`, `key_id` |

Policy Allow chỉ áp dụng `/*/proxy/<apiId>` và `/*/proxy/<apiId>/*` cho các API trong scope. Log từ chối dùng `AUTHORIZER_DENY`, không ghi secret. Authorizer không ghi telemetry.

## Nối API Gateway

- REQUEST authorizer, identity source header `x-api-key`, cache TTL 0.
- Gắn vào ANY `/proxy/{apiId}` và `/proxy/{apiId}/{proxy+}`; integration là `mrapi-proxy`.
- `GET /health` không gắn authorizer.
- Nếu cần trả file nhị phân, kiểm tra Binary media types `*/*`; proxy trả base64.
- Deploy stage `demo`, rồi chạy `npm run test:e2e:proxy --prefix src`. Script tạo dữ liệu thật.

Nếu bật cache, key thu hồi có thể tiếp tục dùng tới hết TTL. Template ACCESS_DENIED dùng `$context.authorizer.reason` chưa được kiểm chứng; lý do 403 vẫn xem được trong log.

Thiếu/sai key đã trả 401 ở hai Region. Luồng key thật, scope và thu hồi xuyên Region còn cần nghiệm thu. Hash gói ở [README Lambda](../README.md).
