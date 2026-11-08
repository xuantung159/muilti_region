# Bàn giao bốn phần đầu — hướng gateway

## Trạng thái

Cập nhật từ Tùng ngày 14/10/2026: đã hoàn thành đến bước 5 hướng dẫn chi tiết (tạo và cấu hình Lambda dashboard sau bảng/role/đóng gói). Chưa có bằng chứng test Lambda/API Gateway/e2e trong báo cáo; trạng thái dưới cần điền sau kiểm thử thật.

| Phần | Kết quả trong repo | AWS thực tế |
|---|---|---|
| Thiết kế | thiet-ke-gateway.md có contract, schema và giới hạn | Chưa cần tài nguyên |
| AWS base | dung-portal-singapore.md có checklist MFA/Budget/SNS/tag | User/group/IAM được người dùng xác nhận trước đó; Budget/SNS/tag chưa xác minh |
| Tài khoản | Có signup/login/logout/me, hash mật khẩu/token, kiểm tra expiry | Đã tạo/cấu hình Lambda theo xác nhận của Tùng; test thật chưa xác nhận |
| API đích | Có create/list/get/patch/enable/disable, tenant isolation, validation và UI | Cùng Lambda dashboard đã cấu hình; test thật chưa xác nhận |

## Kiểm thử local

`npm test --prefix src`: 4 nhóm test dùng DynamoDB giả lập trong bộ nhớ, không phải AWS thật.

- Tài khoản: validation, email trùng, hash, login sai/đúng, logout, expiry.
- API đích: tạo/sửa/tắt, danh sách, không đọc/sửa được API tenant khác, không chấp nhận client tenantId.
- URL/timeout: HTTP, IP, hostname nội bộ, URL credentials/query, cổng khác, timeout sai bị chặn.

## Điền sau khi triển khai

- Người thực hiện và ngày giờ: …
- Commit/version Lambda: …
- Bảng/role/Lambda/API/stage/URL: …
- Trạng thái MFA/Budget/SNS subscription/tag: …
- Output `npm run test:e2e --prefix src`: …
- Ảnh giao diện đăng ký/sửa/bật/tắt và bằng chứng hai tenant: …
- Lỗi còn lại, owner, hạn sửa: …
- Reviewer và kết luận: …

## Giới hạn bàn giao

Chưa có proxy, key scope theo API, DNS/IP validation khi kết nối, telemetry request mới, reset password/email verification/login rate limit hoặc AWS test thực tế. URL cấu hình chưa được xác minh quyền sở hữu. Code orders cũ đã được xóa; Lambda api chỉ còn health đọc control.


