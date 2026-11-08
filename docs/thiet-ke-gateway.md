# Thiết kế gateway

Doanh nghiệp đã có backend riêng. Họ khai báo backend đó lên portal, tạo API key, rồi cho ứng dụng gọi qua gateway của nhóm thay vì gọi thẳng. Gateway kiểm tra key, chuyển request tới backend và ghi lại kết quả.

Singapore và Tokyo chạy cùng một bản code. Route 53 đưa request vào region gần nhất. Gateway không sửa được backend của khách: backend chết thì gateway trả 502/504, không che lỗi.

## Luồng chính

1. Đăng ký tài khoản trên portal.
2. Khai báo backend HTTPS, nhận `apiId`.
3. Tạo key, chọn những API mà key được gọi.
4. Ứng dụng gọi `https://api.multi-region.io.vn/proxy/{apiId}/...` kèm header `x-api-key`.
5. Authorizer kiểm tra key, proxy chuyển request đi và ghi telemetry.

## API của portal

Tất cả trả JSON, có trường `region`. Lỗi có dạng `{"error": "..."}`.

| Method | Path | Cần đăng nhập | Kết quả |
|---|---|---|---|
| POST | /api/signup | Không | 201, trả token |
| POST | /api/login | Không | 200, trả token |
| POST | /api/logout | Có thể | 200 |
| GET | /api/me | Có | Thông tin tổ chức |
| POST, GET | /api/apis | Có | Tạo hoặc liệt kê API đích |
| GET, PATCH | /api/apis/{apiId} | Có | Xem hoặc sửa |
| POST, GET | /api/keys | Có | Tạo hoặc liệt kê key |
| GET | /api/usage | Có | Thống kê từ telemetry |

Ví dụ tạo API đích:

```json
{"name": "Payments", "baseUrl": "https://backend.company.com/v1", "timeoutMs": 5000, "enabled": true}
```

Quy định cho API đích: tên 1–100 ký tự, timeout 1000–10000 ms, URL phải là HTTPS cổng 443, không chứa IP, user/password, query hay tên máy nội bộ.

Tenant luôn lấy từ phiên đăng nhập. Client không gửi `tenantId`, nên đổi tham số cũng không sửa được dữ liệu của doanh nghiệp khác (trả 404).

## Key và authorizer

- Tạo key: `POST /api/keys` với `{"name": "App", "apiIds": ["a..."]}`, mỗi key 1–20 API. Muốn đổi phạm vi thì tạo key mới.
- Key chỉ hiện một lần. Bảng chỉ lưu SHA-256 của key.
- Authorizer loại REQUEST, đọc header `x-api-key`, cache TTL 0 để thu hồi có tác dụng ngay.
- Thiếu hoặc sai key: 401. Key đã thu hồi: 403 (body mặc định của API Gateway; lý do `KEY_REVOKED` ghi trong log `AUTHORIZER_DENY`). API không nằm trong phạm vi: 403 `KEY_SCOPE_DENIED`.

## Proxy

Route `ANY /proxy/{apiId}/{proxy+}`. Proxy đọc cấu hình API theo tenant mà authorizer trả về, ghép URL, giữ nguyên method, path, query và body.

Trước khi gửi đi, proxy gỡ `x-api-key`, `authorization`, `cookie`, header hop-by-hop và header nội bộ của AWS, rồi thêm `x-request-id`. Proxy không tự theo redirect.

Để chống SSRF, proxy phân giải DNS rồi mới chặn các dải private, loopback, link-local, reserved (cả IPv4 và IPv6). Kiểm tra URL lúc khai báo là chưa đủ, vì tên miền có thể đổi IP sau đó.

Response của backend trả nguyên về, có header `X-Mrapi-Source: upstream`. Lỗi do gateway thì header là `gateway` và body `{"error", "code", "requestId"}`:

| HTTP | code | Khi nào |
|---|---|---|
| 400 | BAD_PATH | Đường dẫn có `..` |
| 403 | API_DISABLED | API đang tắt |
| 403 | TARGET_BLOCKED | Đích trỏ vào mạng nội bộ |
| 404 | API_NOT_FOUND | Không có API này, hoặc thuộc tenant khác |
| 413 | PAYLOAD_TOO_LARGE | Body quá 1 MB |
| 502 | UPSTREAM_UNREACHABLE | Không kết nối được backend |
| 502 | UPSTREAM_TOO_LARGE | Response quá 4 MB |
| 504 | UPSTREAM_TIMEOUT | Backend trả lời quá thời gian chờ |
| 500 | GATEWAY_INTERNAL | Lỗi của gateway |

## Dữ liệu

Bảng `mrapi-control` (PK/SK dạng chuỗi, on-demand, TTL `expiresAt`):

| Bản ghi | PK | SK |
|---|---|---|
| Người dùng | USER#email | META |
| Phiên | SESSION#hash(token) | META |
| API đích | TENANT#tenantId | API#apiId |
| Key | TENANT#tenantId | KEY#keyId |

Bảng `mrapi-telemetry` ghi mỗi request một dòng: PK `TENANT#tenantId`, SK `thời điểm#requestId`. Request lỗi có thêm GSI1 để tra nhanh. Dòng tự xóa sau 30 ngày. Không lưu key, query, body hay header. Chi tiết: [mrapi-telemetry.md](../infra/dynamodb/ap-southeast-1/mrapi-telemetry.md).

Request bị authorizer chặn không vào telemetry, chỉ có log `AUTHORIZER_DENY`. Ghi telemetry lỗi thì request vẫn trả bình thường, log `TELEMETRY_WRITE_FAILED`.

## Giới hạn

- Hai region đồng bộ sau khoảng 1 giây. Vừa thu hồi key ở Singapore thì Tokyo có thể vẫn cho qua trong khoảng đó.
- Hai region cùng sửa một bản ghi thì bản ghi sau thắng.
- Mỗi doanh nghiệp một tài khoản. Chưa có xác minh email, quên mật khẩu, giới hạn đăng nhập sai.
- Gateway chỉ bảo vệ tầng của nó. Backend khách đặt một nơi thì vẫn là điểm lỗi đơn.
