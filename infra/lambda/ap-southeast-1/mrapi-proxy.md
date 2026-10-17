# mrapi-proxy — Singapore (CHƯA DEPLOY)

Trạng thái 17/10/2026: code và test local đã xong trên nhánh `feature/gateway-proxy`; **chưa tạo function trên AWS**. Các giá trị dưới đây là cấu hình cần đặt, không phải cấu hình đã quan sát. Sau khi tạo, sửa file này theo Console thực tế.

## Cấu hình cần đặt

| Thuộc tính | Giá trị | Ghi chú |
|---|---|---|
| Tên | `mrapi-proxy` | Khớp log group trong `mrapi-proxy-role` |
| Gói | `artifacts/lambda/api.zip` | `npm run package --prefix src` |
| Handler | `api/index.handler` | Một hàm phục vụ cả `/health` và `/proxy/...` |
| Runtime / kiến trúc | Node.js 24.x / arm64 | Giống `mrapi-dashboard` |
| Role | `mrapi-proxy-role` | Có sẵn, boundary `mrapi-workload-boundary` |
| Memory | 256 MB | |
| Timeout | 15 giây | Lớn hơn timeout tối đa của API đích (10 giây) cộng thời gian ghi telemetry |
| VPC | Không | Cần ra Internet để gọi backend doanh nghiệp |
| `CONTROL_TABLE` | `mrapi-control` | |
| `TELEMETRY_TABLE` | `mrapi-telemetry` | |
| `TELEMETRY_RETENTION_DAYS` | `30` (mặc định nếu bỏ trống) | Số ngày trước khi TTL xóa dòng telemetry |
| `HEALTH_FORCE_FAIL` | không đặt | Chỉ đặt `true` khi test failover |

## Test trên Console trước khi nối API Gateway

Tab Test, event (giả lập request đã qua authorizer, API không tồn tại):

```json
{"httpMethod":"GET","path":"/proxy/a00000000000000000000000000000000/x","headers":{},
 "requestContext":{"requestId":"console-test-1","authorizer":{"tenant_id":"t0000000000","key_id":"000000000000"}}}
```

Mong đợi: statusCode 404, body có `"code":"API_NOT_FOUND"`, header `X-Mrapi-Source: gateway`; bảng `mrapi-telemetry` có dòng `PK = TENANT#t0000000000`, `requestId = console-test-1`. Event không có `requestContext.authorizer` phải trả 500 và không gọi backend.

Event `{"httpMethod":"GET","path":"/health"}` phải trả 200 `status: ok`.

## Bàn giao cho C (API Gateway)

Xem mục "Nối vào API Gateway" trong [mrapi-authorizer.md](mrapi-authorizer.md). Sau khi deploy, ghi function ARN, SHA-256 gói, ngày giờ và kết quả test vào file này.
