# mrapi-proxy

## Chức năng

Chuyển request đã xác thực tới backend HTTPS và trả phản hồi về client.

## Ứng dụng trong project

Đọc cấu hình API đích, kiểm tra địa chỉ và timeout, chuyển tiếp request rồi ghi telemetry. Cùng hàm cũng phục vụ health check của Region.

## Ý nghĩa các file cấu hình

| File | Mục đích |
|---|---|
| `mrapi-proxy.config.json` | Thông số chạy của hàm: handler, runtime, role, tài nguyên, tracing và tên env. |
| `mrapi-proxy.resource-policy.json` | Quyền API Gateway hoặc EventBridge gọi hàm; giới hạn bằng service principal và SourceArn. |
| `mrapi-proxy.tags.json` | Tag quản lý tài nguyên. Không chứa secret hay mã nguồn. |

## Cấu hình và chi tiết

Phục vụ health và chuyển request tới backend doanh nghiệp. Chạy ở Singapore và Tokyo.

| Mục | Giá trị |
|---|---|
| Gói | `artifacts/lambda/api.zip` |
| Handler | `api/index.handler` |
| Runtime / kiến trúc | Node.js 24.x / arm64 |
| Role | `mrapi-proxy-role` |
| Memory / timeout | 256 MB / 15 giây |
| VPC | Không, cần gọi backend Internet |
| `CONTROL_TABLE` | `mrapi-control` |
| `TELEMETRY_TABLE` | `mrapi-telemetry` |
| `TELEMETRY_RETENTION_DAYS` | Mặc định 30 ngày nếu bỏ trống |
| `PROJECT` | Có cấu hình trên hai Region |
| `HEALTH_FORCE_FAIL` | Không đặt; chỉ bật khi test failover |

Timeout 15 giây đủ cho timeout backend tối đa 10 giây và bước ghi telemetry. TTL xóa có độ trễ, không đúng ngay giây hết hạn.

## Test trên Console

Event giả lập đã qua authorizer, API không tồn tại:

```json
{"httpMethod":"GET","path":"/proxy/a00000000000000000000000000000000/x","headers":{},
 "requestContext":{"requestId":"console-test-1","authorizer":{"tenant_id":"t0000000000","key_id":"000000000000"}}}
```

Mong đợi: 404, code `API_NOT_FOUND`, header `X-Mrapi-Source: gateway`; telemetry có PK `TENANT#t0000000000`, requestId `console-test-1`. Phép thử này ghi dữ liệu thật.

Không có `requestContext.authorizer` thì trả 500 và không gọi backend. Event `{"httpMethod":"GET","path":"/health"}` trả 200, status ok khi bảng/quyền hoạt động.

Cách nối route: [authorizer](mrapi-authorizer.md). Hash và env hai Region: [README Lambda](../README.md). Luồng proxy bằng key thật chưa nghiệm thu đầy đủ.
