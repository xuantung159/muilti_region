# Portal: đăng nhập, khai báo API, lấy key

Hướng dẫn cho người dùng thử và cho nhóm khi kiểm tra. Portal ở https://app.multi-region.io.vn/portal.

Không ghi mật khẩu, token hay key thật vào repo hoặc ảnh chụp.

## Dùng portal

1. **Đăng ký.** Bấm "Chưa có tài khoản? Đăng ký doanh nghiệp", nhập tên doanh nghiệp, email, mật khẩu (từ 8 ký tự). Đăng ký xong là vào luôn. Email trùng sẽ báo lỗi.
2. **Đăng nhập** các lần sau bằng email và mật khẩu. Phiên kéo dài 8 giờ, đóng tab là mất.
3. **Khai báo API đích.** Tab *API đích*: nhập tên, URL backend (HTTPS, tên miền công khai), timeout 1000–10000 ms. Lưu lại **ID** của API (bắt đầu bằng chữ `a`).
4. **Tạo key.** Tab *API key*: đặt tên, tick những API key được gọi, bấm *Tạo key*. Key dạng `mrk_...` chỉ hiện đúng một lần, sao chép ngay. Mất thì tạo key mới và thu hồi key cũ.
5. **Thu hồi key.** Bấm *Thu hồi* ở dòng key. Ứng dụng dùng key đó sẽ nhận 403.
6. **Tổng quan.** Xem số lượt gọi, số lỗi, độ trễ theo API, theo key, theo region.
7. **Đăng xuất.** Token cũ gọi lại sẽ bị 401.

Mỗi doanh nghiệp tối đa 20 key, mỗi key 1–20 API.

Nút *Trải nghiệm demo* chỉ chạy trong trình duyệt, key có chữ `DEMO_ONLY` và không dùng được thật.

## Gọi API bằng key

```bash
curl -i "https://api.multi-region.io.vn/proxy/<apiId>/orders" -H "x-api-key: <key>"
```

| Kết quả | Nghĩa |
|---|---|
| Mã của backend | Đã chuyển tiếp thành công |
| 401 | Thiếu key hoặc key sai |
| 403 | Key đã thu hồi, hoặc API không nằm trong phạm vi key |
| 404 | Không có API này |
| 502 / 504 | Backend lỗi hoặc trả lời quá chậm |

Header `X-Served-Region` cho biết region nào đã xử lý.

## Gọi API portal bằng curl

```bash
BASE=https://api.multi-region.io.vn
```

```bash
curl -s -X POST "$BASE/api/login" -H "Content-Type: application/json" -d '{"email":"test@example.com","password":"<mat-khau>"}'
```

Lấy `token` trong kết quả rồi gọi:

```bash
curl -s "$BASE/api/keys" -H "Authorization: Bearer <token>"
```

Lưu ý: token đăng nhập đi trong `Authorization`, còn API key đi trong `x-api-key`. Hai cái không dùng thay nhau được.

## Chạy portal ở máy

Tạo `monitoring-web/.env.local` (không commit):

```
PORTAL_API_TARGET=https://43vakggyh5.execute-api.ap-southeast-1.amazonaws.com/demo
```

```bash
npm run dev --prefix monitoring-web
```

Mở http://localhost:5173/portal.

## Lỗi hay gặp

| Hiện tượng | Xử lý |
|---|---|
| "Chưa kết nối API doanh nghiệp" | Thiếu `PORTAL_API_TARGET`, sửa `.env.local` rồi chạy lại |
| "Lỗi hệ thống" (500) | Xem log `/aws/lambda/mrapi-dashboard`, thường do thiếu biến `CONTROL_TABLE` |
| `Task timed out after 3.00 seconds` | Tăng timeout Lambda lên 10 giây |
| `Cannot find module` | Handler phải là `dashboard/index.handler`, đóng gói bằng `npm run package` |
| `Missing Authentication Token` | URL thiếu `/demo` hoặc chưa deploy stage |

## Kiểm thử tự động

```bash
npm run test:e2e --prefix src
```

Script tự tạo 2 tài khoản thử, kiểm tra trùng email, đăng nhập, tách tenant, đăng xuất. Dữ liệu thử (`control-...@example.com`) còn lại trong bảng.
