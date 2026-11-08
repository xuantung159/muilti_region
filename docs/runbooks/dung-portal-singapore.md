# Bốn phần đầu: dựng portal ở Singapore

Tùng làm. Mục tiêu: doanh nghiệp đăng ký, đăng nhập, khai báo API đích được trên Singapore. Tokyo dựng sau bằng cách nhân lại.

Mỗi bước làm theo nhịp: làm trên Console, mở lại xem đã lưu đúng chưa, ghi vào `infra/`, rồi mới sang bước tiếp.

## 1. Thiết kế

Chốt contract API và cấu trúc bảng với nhóm theo [thiet-ke-gateway.md](../thiet-ke-gateway.md).

## 2. Nền AWS

- Tài khoản root bật MFA, không tạo access key.
- Tạo group `mrapi-developers`, 5 policy nền (bắt buộc MFA, giới hạn region...), user cho từng người. Thành viên tự bật MFA theo [dang-nhap-mfa.md](../dang-nhap-mfa.md).
- Budget `mrapi-monthly` 10 USD, chi tiết ở [budget.md](../../infra/monitoring/budget.md).
- Gắn tag `Project=mrapi` cho mọi tài nguyên.

## 3. Bảng, role, Lambda

1. DynamoDB: tạo `mrapi-control`, khóa `PK`/`SK` kiểu String, on-demand, bật TTL trên `expiresAt`.
2. IAM: role `mrapi-dashboard-role`, trust cho Lambda, gắn boundary `mrapi-workload-boundary`. Quyền: đọc ghi bảng control, ghi log, đọc trạng thái health check Route 53.
3. Đóng gói:

   ```bash
   npm ci --prefix src
   ```

   ```bash
   npm test --prefix src
   ```

   ```bash
   npm run package --prefix src
   ```

4. Lambda `mrapi-dashboard`: Node.js 24.x, arm64, upload `artifacts/lambda/dashboard.zip`, handler `dashboard/index.handler`. Biến `CONTROL_TABLE=mrapi-control`, `PROJECT=mrapi`. Memory 256 MB, timeout 10 giây (băm mật khẩu khá chậm, để 3 giây mặc định sẽ bị timeout).

## 4. API Gateway và thử

1. Tạo REST API `mrapi-api-sg`. Route `GET /` và `ANY /api/{proxy+}` trỏ vào dashboard, kiểu Lambda proxy integration. Không gắn authorizer vào các route này, Lambda tự kiểm tra token.
2. Deploy stage `demo`. Ghi URL vào `config/demo/ap-southeast-1.json`.
3. Mở portal, đăng ký, tạo API đích, sửa, tắt rồi bật lại. Đăng xuất, thử lại token cũ phải bị từ chối.
4. Tạo tài khoản thứ hai. Không được thấy API của tài khoản đầu; gọi thẳng ID của tài khoản đầu phải ra 404.
5. Chạy e2e:

   ```bash
   npm run test:e2e --prefix src
   ```

   Script tạo dữ liệu thử thật trong bảng, nhớ dọn sau.

## Ghi lại vào repo

| Xong bước | Ghi vào |
|---|---|
| Bảng | `infra/dynamodb/ap-southeast-1/mrapi-control.md` |
| Role | `infra/iam/roles/mrapi-dashboard-role/` |
| Lambda | `infra/lambda/ap-southeast-1/mrapi-dashboard.md` |
| API Gateway | `infra/apigateway/ap-southeast-1/` |
| Kết quả thử | `docs/reports/e2e-acceptance.md` |

Không chụp hay ghi mật khẩu, token vào báo cáo.
