# Project Go kiểm tra tích hợp MRAPI

Chỉ dùng thư viện chuẩn Go, không cài package. Cần Go 1.22 trở lên.

1. Mở https://app.multi-region.io.vn/portal → đăng nhập/đăng ký tài khoản thật.
2. **API đích** → đăng ký URL backend HTTPS công khai có sẵn, sao chép API ID. Đường dẫn kiểm tra phải tồn tại trên backend đó.
3. **API key** → tạo key có quyền với API vừa đăng ký, sao chép ngay vì key chỉ hiện một lần.
4. Sao chép `.env.example` thành `.env`, dán API ID và key vào.
5. Mở terminal trong `project_test` và chạy:

```powershell
go run . /orders
```

Nếu máy chưa cài Go, bộ Go portable dùng để kiểm thử nằm ngoài project, tại `../artifacts/go-toolchain/go/bin/`. Trong PowerShell có thể chạy:

```powershell
../artifacts/go-toolchain/go/bin/go.exe run . /orders
```

Đổi `/orders` thành route của backend, ví dụ `go run . "/todos/1"` hoặc `go run . "/orders?limit=2"`. URL gọi là `<gateway>/proxy/<apiId>/<route>`, header là `x-api-key`. Server Go đọc `.env` trực tiếp; biến môi trường đã đặt được ưu tiên.

Kết quả gồm HTTP status, thời gian, region (nếu có) và response body. Lỗi mạng hoặc HTTP ngoài 2xx làm chương trình thoát với mã 1. Không in key. Timeout 15 giây, không theo redirect, giới hạn hiển thị 64 KiB.

Sau một lần gọi thành công: xem **Tổng quan** trên portal, thu hồi key trong **API key**, chạy lại để kiểm tra 401/403. Cần gateway/proxy/authorizer/telemetry đã triển khai; key `DEMO_ONLY` không dùng được. Client Go không bị giới hạn CORS như phép thử trong trình duyệt.

Có thể sao chép `.env.example` thành `.env` và điền thủ công. `.env` được gitignore; không commit secret hoặc chụp màn hình key. Client tích hợp nằm ở thư mục gốc; server API mẫu nằm trong `server/`.

## Backend mẫu có HTTPS

Server có `GET /orders` trả đơn hàng mẫu và `GET /health` trả trạng thái. Không phục vụ file trên đĩa, không chứa dữ liệu thật. Nhập URL tunnel in ra vào **URL backend** trên portal, không thêm `/orders`. Đường dẫn gọi từ client là `/orders`.

URL tunnel là tạm thời, chỉ hoạt động khi máy, server và tunnel còn chạy. Khởi động lại tunnel sẽ đổi URL; khi đó sửa URL backend trên portal, nếu không gateway trả 502 `UPSTREAM_UNREACHABLE`. Đây là endpoint mẫu công khai để test.

Mở hai terminal ở `project_test`:

```powershell
# Terminal 1: backend
../artifacts/go-toolchain/go/bin/go.exe run ./server
```

```powershell
# Terminal 2: HTTPS tunnel, lấy URL trycloudflare.com được in ra
../artifacts/tools/cloudflared.exe tunnel --url http://127.0.0.1:8080 --no-autoupdate --protocol http2
```

Không chạy thêm khi server nền vẫn đang giữ cổng 8080. Log tiến trình nền ở `../artifacts/logs/test-backend.*.log` và `../artifacts/logs/test-tunnel.*.log`.

Kiểm thử local (không cần AWS, không tạo API key thật):

```powershell
go test ./...
```
