# Multi-Region API — cổng doanh nghiệp

Một hàm Lambda và một bảng DynamoDB. Hàm gồm hai file: [lambda/index.mjs](lambda/index.mjs) (xử lý phía máy chủ) và [lambda/page.html](lambda/page.html) (giao diện). Doanh nghiệp mở trang web, đăng ký tài khoản, tự tạo và thu hồi API key, dùng key đó gọi `/orders`, và xem thống kê lượt gọi theo thời gian, theo region và theo từng key.

| Method | Đường dẫn | Xác thực | Mô tả |
|---|---|---|---|
| GET | `/` | Không | Trang web: đăng ký, đăng nhập, thống kê, quản lý key, thử API, hướng dẫn |
| POST | `/api/signup` | Không | Body `{"orgName","email","password"}` → tạo tài khoản, trả token phiên |
| POST | `/api/login` | Không | Body `{"email","password"}` → trả token phiên (8 giờ) |
| POST | `/api/logout` | Token phiên | Huỷ phiên |
| GET, POST | `/api/keys` | Token phiên | Liệt kê / tạo key (body `{"name"}`); key chỉ trả về một lần |
| DELETE | `/api/keys/{keyId}` | Token phiên | Thu hồi key |
| GET | `/api/usage?range=24h` | Token phiên | Thống kê lượt gọi: tổng, theo region, theo key, theo thời gian. `range` là `1h`, `24h` hoặc `7d` |
| GET | `/health` | Không | 200 nếu đọc được DynamoDB |
| GET, POST | `/orders` | Header `x-api-key` | Liệt kê / tạo đơn của doanh nghiệp sở hữu key |
| GET, DELETE | `/orders/{id}` | Header `x-api-key` | Đọc / xoá một đơn |

Token phiên gửi trong header `Authorization: Bearer <token>`.

## Dựng trên AWS Console (region Singapore)

### 1. Bảng DynamoDB

DynamoDB → Tables → Create table:

- Table name: `mr-main`
- Partition key: `PK` (String), Sort key: `SK` (String)
- Table settings: Customize → Capacity mode: **On-demand**

Sau khi bảng tạo xong (tuỳ chọn): tab Additional settings → Time to Live → bật với thuộc tính `expiresAt`, để phiên đăng nhập hết hạn và bộ đếm lượt gọi cũ hơn 8 ngày tự bị xoá.

### 2. Hàm Lambda

Lambda → Create function → Author from scratch:

- Function name: `mr-api`, Runtime: **Node.js 22.x**
- Tab Code: mở file `index.mjs`, xoá hết, dán toàn bộ nội dung `lambda/index.mjs`.
- Vẫn trong tab Code: tạo file mới tên `page.html` cùng cấp với `index.mjs` (chuột phải vào thư mục → New File), dán toàn bộ nội dung `lambda/page.html`.
- Bấm **Deploy**. Thiếu `page.html` thì hàm sẽ lỗi ngay khi khởi động.
- Configuration → Environment variables → thêm `TABLE_NAME` = `mr-main`.
- Configuration → General configuration → Edit: Memory **256 MB**, Timeout **10 giây** (băm mật khẩu cần nhiều CPU hơn mức mặc định).

### 3. Quyền đọc ghi bảng

Configuration → Permissions → bấm vào tên role → Add permissions → Create inline policy → tab JSON, dán:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem", "dynamodb:Query"],
    "Resource": "arn:aws:dynamodb:*:*:table/mr-main"
  }]
}
```

Đặt tên policy `mr-main-access`.

### 4. Địa chỉ web

Configuration → Function URL → Create function URL → Auth type: **NONE** → Save.

Mở địa chỉ `https://….lambda-url.ap-southeast-1.on.aws/`: thấy trang "Cổng doanh nghiệp" và dòng "Đang phục vụ từ region: ap-southeast-1" là xong.

## Thử

1. Bấm "Chưa có tài khoản? Đăng ký doanh nghiệp", nhập tên, email, mật khẩu.
2. Nhập tên ứng dụng, bấm "Tạo key", sao chép key.
3. Sang tab Thử API, bấm "Tạo đơn hàng thử" rồi "Xem danh sách đơn" vài lần.
4. Sang tab Tổng quan, chọn "1 giờ": số lượt gọi và biểu đồ tăng lên (trang tự làm mới mỗi 15 giây).
5. Bấm "Thu hồi" ở tab API key rồi gọi lại: nhận HTTP 401.
6. Đăng ký một doanh nghiệp thứ hai: key của họ không thấy đơn của doanh nghiệp đầu.

Gọi từ dòng lệnh:

```bash
curl -H "x-api-key: mrk_…" https://….lambda-url.ap-southeast-1.on.aws/orders
```

## Giới hạn của bản này

- Ai có địa chỉ cũng đăng ký được; chưa xác minh email, chưa có quên mật khẩu.
- Chưa giới hạn số lần đăng nhập sai và số request theo key.
- Thống kê chỉ đếm request có key hợp lệ; request bị từ chối vì key sai không được tính. Mỗi request tốn thêm một lần ghi DynamoDB để cộng bộ đếm.
- Mỗi doanh nghiệp một tài khoản, tối đa 20 key.
- Function URL chỉ để thử nhanh. Khi làm Route 53 và tên miền riêng sẽ chuyển sang API Gateway; code không phải sửa.
"# muilti_region" 
