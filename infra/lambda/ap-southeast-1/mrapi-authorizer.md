# mrapi-authorizer — Singapore (CHƯA DEPLOY)

Trạng thái 17/10/2026: code và test local đã xong trên nhánh `feature/gateway-proxy`; chưa xác nhận function trên AWS. Giá trị dưới là cấu hình cần đặt.

## Cấu hình cần đặt

| Thuộc tính | Giá trị |
|---|---|
| Tên | `mrapi-authorizer` (khớp log group trong `mrapi-authorizer-role`) |
| Gói / handler | `artifacts/lambda/authorizer.zip` / `authorizer/index.handler` |
| Runtime / kiến trúc | Node.js 24.x / arm64 |
| Role | `mrapi-authorizer-role` |
| Memory / timeout | 128–256 MB / 5 giây |
| `CONTROL_TABLE` | `mrapi-control` |

## Hành vi

| Tình huống | Kết quả authorizer | Client nhận |
|---|---|---|
| Thiếu `x-api-key`, sai định dạng, key không tồn tại, sai bí mật | ném `Unauthorized` | 401 |
| Key đã thu hồi | policy Deny, `context.reason = KEY_REVOKED` | 403 |
| API trong đường dẫn không nằm trong `apiIds` của key (kể cả API của doanh nghiệp khác, key cũ chưa có scope) | policy Deny, `context.reason = KEY_SCOPE_DENIED` | 403 |
| Hợp lệ | policy Allow cho `/*/proxy/<apiId>` và `/*/proxy/<apiId>/*` của mọi API trong scope; `context = { tenant_id, key_id }` | request tới `mrapi-proxy` |

Mọi lần từ chối có log `AUTHORIZER_DENY` (lý do, keyId, tenantId, path), không ghi key.

## Nối vào API Gateway (việc của C, ghi tại đây để bàn giao)

1. Authorizers → Create: Lambda `mrapi-authorizer`, loại **Request**, identity source header `x-api-key`.
2. **Authorization caching: TTL 0** khi demo/test thu hồi key. Nếu bật cache (vd. 60 giây), key bị thu hồi vẫn dùng được tối đa bằng TTL; policy đã liệt kê đủ API trong scope nên cache không làm lộ quyền sang API khác.
3. Resource `/proxy/{apiId}` và `/proxy/{apiId}/{proxy+}`, method `ANY`, Lambda proxy integration → `mrapi-proxy`, Authorization = authorizer trên.
4. Route `GET /health` → `mrapi-proxy` (hoặc `mrapi-api` nếu nhóm giữ hàm riêng), Authorization NONE.
5. Settings → Binary media types: thêm `*/*` nếu cần trả file nhị phân (ảnh, PDF). Proxy trả body nhị phân dạng base64; thiếu cài đặt này client nhận chuỗi base64.
6. (Tùy chọn) Gateway responses → `ACCESS_DENIED`: template `{"error":"Key không có quyền","code":"$context.authorizer.reason"}` để client thấy lý do 403. Chưa kiểm chứng biến `reason` có xuất hiện khi policy là Deny; nếu trống thì bỏ trường `code`, lý do vẫn có trong log `AUTHORIZER_DENY`.
7. Deploy stage `demo`, chạy `npm run test:e2e:proxy --prefix src`.
