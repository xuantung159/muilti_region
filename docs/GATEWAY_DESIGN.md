# Thiết kế gateway đa doanh nghiệp — bản chốt cho hướng mới

Tài liệu thiết kế hiện hành. Các tài liệu orders cũ đã được xóa khỏi repo; không dùng route orders để nghiệm thu gateway.

## Mục tiêu và luồng

Doanh nghiệp đăng ký tài khoản → khai báo backend HTTPS → tạo key và cấp quyền API → gửi request qua `/proxy/{apiId}/{path}` → gateway xác thực/chuyển tiếp → ghi nhận kết quả → trả status/body backend.

Singapore và Tokyo chạy cùng code. Route 53 định tuyến tầng gateway; không khắc phục backend doanh nghiệp bị hỏng. Key bí mật dùng ở backend doanh nghiệp. Giai đoạn này hoàn thành control plane (tài khoản và đăng ký API), chưa xây proxy/key scope/telemetry mới.

## Bốn phần đầu

1. Thiết kế mới: tài liệu này và contract dưới đây.
2. AWS base: IAM/MFA/Budget/SNS/tag; cần xác nhận trên Console theo runbook.
3. Tài khoản: signup/login/logout/me; mật khẩu băm scrypt với salt, phiên 8 giờ, token chỉ lưu hash, expiry kiểm tra trong code.
4. API đích: tạo/liệt kê/xem/sửa/bật/tắt; quyền sở hữu lấy từ phiên, không nhận tenantId từ client.

## Contract control plane

REST API Lambda proxy integration, response JSON có `region`. Lỗi hiện tại có dạng `{"error":"Thông báo"}`. Định dạng lỗi proxy sẽ chốt riêng trước phần 7.

| Method | Path | Auth | Thành công |
|---|---|---|---|
| POST | /api/signup | Không | 201: token, tenantId, orgName, email |
| POST | /api/login | Không | 200: token, tenantId, orgName, email |
| POST | /api/logout | Bearer token nếu có | 200; gọi lại an toàn |
| GET | /api/me | Bearer token | 200: tenantId, orgName, email |
| POST | /api/apis | Bearer token | 201: api |
| GET | /api/apis | Bearer token | 200: apis |
| GET | /api/apis/{apiId} | Bearer token | 200: api |
| PATCH | /api/apis/{apiId} | Bearer token | 200: api |

Create body: `{"name":"Payments","baseUrl":"https://backend.company.com/v1","timeoutMs":5000,"enabled":true}`. PATCH nhận một hoặc nhiều trường trên, không nhận trường khác. API ID do server sinh. Name 1–100 ký tự; timeout số nguyên 1000–10000 ms; chỉ HTTPS cổng 443, không URL credentials/query/fragment, không IP literal hoặc hostname nội bộ. URL cấu hình chưa được gọi hay xác minh quyền sở hữu.

Mã lỗi: 400 dữ liệu sai; 401 phiên sai/hết hạn; 404 API không tồn tại hoặc thuộc doanh nghiệp khác; 409 email trùng/cập nhật cạnh tranh; 405 method không hỗ trợ; 500 lỗi nội bộ.

## Dữ liệu

Bốn phần đầu chỉ cần `mrapi-control`, PK/SK String, on-demand, TTL `expiresAt`.

| Item | PK | SK | Nội dung |
|---|---|---|---|
| User | USER#email | META | tenantId, orgName, email, salt, passwordHash |
| Session | SESSION#hash(token) | META | tenantId, orgName, email, expiresAt |
| API config | TENANT#tenantId | API#apiId | apiId, tenantId, name, baseUrl, timeoutMs, enabled, revision, createdAt, updatedAt |

Key hiện tại vẫn có KEY# trong control nhưng chưa có quyền theo apiId; sẽ nâng cấp ở phần 5. Usage hiện tại là bộ đếm cũ; chưa chứng minh thống kê proxy. Không cần bảng orders. Nếu orders đã tồn tại, giữ nguyên dữ liệu cho đến khi chốt dọn dẹp. Bảng telemetry/log request sẽ thiết kế ở phần 9.

## Contract key scope và proxy (nhánh feature/gateway-proxy, 17/10/2026)

Code và test local xong, chưa deploy. Giải thích bằng lời thường: [GIAI_THICH_UU_TIEN_2.md](GIAI_THICH_UU_TIEN_2.md).

- **Tạo key:** `POST /api/keys` body `{"name":"App","apiIds":["a…"]}`; 1–20 API, mỗi API phải thuộc tenant của phiên, nếu không trả 400. Item `KEY#` thêm `apiIds`. `GET /api/keys` trả kèm `apiIds`. Không sửa scope; muốn đổi thì tạo key mới. Key cũ không có `apiIds` bị từ chối khi gọi proxy.
- **Authorizer (REQUEST, identity source `x-api-key`):** sai/thiếu key → 401; key thu hồi → 403 `KEY_REVOKED`; API ngoài scope → 403 `KEY_SCOPE_DENIED`. Allow liệt kê mọi API trong scope; context `{tenant_id, key_id}`. Cache TTL 0 khi test thu hồi.
- **Proxy `ANY /proxy/{apiId}/{proxy+}`:** đọc API theo `tenant_id` của authorizer; chuyển method, đường dẫn con, query, body; gỡ `x-api-key`, `authorization`, `cookie`, hop-by-hop, header AWS/CloudFront; thêm `x-request-id`. Không theo redirect. Trả nguyên status/header/body của backend với `X-Mrapi-Source: upstream`.
- **Lỗi gateway:** `{"error","code","requestId"}`, `X-Mrapi-Source: gateway`; mã: 400 `BAD_PATH`, 403 `API_DISABLED`/`TARGET_BLOCKED`, 404 `API_NOT_FOUND`, 413 `PAYLOAD_TOO_LARGE`, 502 `UPSTREAM_UNREACHABLE`/`UPSTREAM_TOO_LARGE`, 504 `UPSTREAM_TIMEOUT`, 500 `GATEWAY_INTERNAL`. Giới hạn body request 1 MB, response 4 MB.
- **Telemetry:** đúng schema [mrapi-telemetry.md](../infra/dynamodb/ap-southeast-1/mrapi-telemetry.md); `errorType` thêm `BAD_PATH`, `PAYLOAD_TOO_LARGE`, `UPSTREAM_TOO_LARGE`; backend 5xx → `UPSTREAM_5XX`, backend 4xx không có `errorType`. Request bị authorizer từ chối không ghi telemetry (chỉ log `AUTHORIZER_DENY`). Ghi thất bại → log `TELEMETRY_WRITE_FAILED`, response vẫn trả.

## Điều kiện trước khi proxy được mở

- Resolve DNS và chặn mọi địa chỉ private/link-local/loopback/reserved ở IPv4/IPv6; chống DNS rebinding tại kết nối. Validation URL trong control plane không đủ bảo vệ SSRF.
- Không theo redirect tùy ý; kiểm tra lại đích nếu có redirect.
- Không chuyển tiếp key gateway, hop-by-hop header hoặc token phiên portal sang backend.
- Giới hạn payload/timeout; phân quyền key theo tenant và apiId, không cho client cung cấp URL đích tự do.
- Phân biệt backend HTTP error, timeout, connection error và gateway error; không ghi credentials/body nhạy cảm vào log mặc định.

## Hạn chế hiện tại

Một tài khoản mỗi doanh nghiệp; chưa email verification/reset password/rate limit login. Giới hạn này phải được ghi trong báo cáo demo. Conditional write bảo vệ cập nhật trong một Region; chưa giải quyết xung đột Global Tables hai Region. Session logout ở Region khác còn phụ thuộc replication. Proxy, key scope, log chi tiết, S3 export và failover mới chưa triển khai.

