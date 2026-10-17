# Tùng thực hiện bốn phần đầu

Quy trình bắt buộc cho từng bước: **cấu hình AWS Console → mở lại kiểm tra → ghi cấu hình thực tế vào infra → cập nhật config → test và lưu bằng chứng**. Mẫu/cách copy JSON tại [RECORD_CONSOLE_CONFIG.md](RECORD_CONSOLE_CONFIG.md).

## 1. Thiết kế

Đọc [GATEWAY_DESIGN.md](../GATEWAY_DESIGN.md), xác nhận contract/schema với nhóm. Hướng mới là proxy request, không orders. Chưa deploy route proxy cho đến khi có kiểm tra key scope và đích kết nối.

## 2. AWS base — kiểm tra bằng admin có MFA

IAM user đã có; các bước dưới chưa được agent xác minh trên AWS.

- Root: MFA, không access key; admin và thành viên: MFA, group/policy đúng. Thành viên làm theo MEMBER_LOGIN_MFA.md.
- Billing: bật IAM access nếu cần; tạo Budget mrapi-monthly theo BASE_SETUP mục 6, đặt ngân sách/threshold/email thực tế; budget là cảnh báo, không tự dừng tài nguyên.
- SNS: mrapi-alerts ở Singapore/Tokyo/us-east-1, Standard, email subscription đã confirmed.
- Resource Groups: mrapi theo Project=mrapi ở Singapore/Tokyo.
- Cost allocation tag Project: activate khi xuất hiện.
- Lưu ảnh đã che thông tin nhạy cảm và ghi trạng thái; không báo xong chỉ vì đã có user.

## 3–4. Triển khai tài khoản và đăng ký API tại Singapore

1. DynamoDB: tạo mrapi-control, PK/SK String, on-demand, TTL expiresAt, tag Project=mrapi. Điền config/demo/ap-southeast-1.json.
2. IAM: kiểm tra role mrapi-dashboard-role đã tạo, trust Lambda và boundary mrapi-workload-boundary; không tạo lại role. Inline policy tham khảo ở mục bên dưới nếu cần đối chiếu. Repo hiện không có infra/iam/roles/mrapi-dashboard-role.json. Lưu ARN thực tế vào config/demo/global.json.
3. Chạy `npm ci --prefix src`, `npm test --prefix src`, `npm run package --prefix src`.
4. Lambda mrapi-dashboard: Node.js 22.x, role trên, ZIP artifacts/lambda/dashboard.zip, handler dashboard/index.handler; CONTROL_TABLE=mrapi-control, PROJECT=mrapi. Memory 256 MB, timeout 10 giây ban đầu. Log retention 14 ngày.
5. REST API: GET / → dashboard; /api/{proxy+} ANY → dashboard, Lambda proxy integration. Portal tự kiểm tra Bearer phiên; không gắn authorizer API key vào các route portal. Cho API Gateway invoke Lambda.
6. Deploy stage demo; điền baseUrl có stage, ví dụ https://API_ID.execute-api.ap-southeast-1.amazonaws.com/demo. Frontend đã gộp vào `monitoring-web/`: cấu hình `PORTAL_API_TARGET` bằng URL stage trong `.env.local`, chạy `npm run dev --prefix monitoring-web` rồi mở `/portal`. Khi deploy frontend tĩnh, dùng `VITE_PORTAL_API_URL`, đặt `PORTAL_ALLOWED_ORIGIN` trên Lambda và mở OPTIONS qua Lambda/CORS ở API Gateway. Đặt `FRONTEND_URL` trên Lambda nếu muốn URL gốc API chuyển hướng tới frontend. Xem [README frontend](../../monitoring-web/README.md).
7. Thử đăng ký/đăng nhập; tab API đích: tạo HTTPS backend, sửa tên/timeout/URL, tắt rồi bật API. Logout và kiểm tra token cũ bị từ chối.
8. Tạo tài khoản thứ hai: không thấy API của tài khoản đầu; gọi GET/PATCH ID của tài khoản đầu phải 404. Thử URL IP/HTTP, timeout sai phải 400.
9. Chạy `node tests/e2e/control-plane.mjs` khi URL đã điền. Script tạo dữ liệu thử thật, giữ API ở trạng thái tắt; tài khoản/cấu hình vẫn còn để kiểm tra và dọn thủ công.

### Ghi vào infra ngay sau từng bước Console

| Sau bước | File cần tạo/cập nhật | Ghi gì |
|---|---|---|
| 1 — bảng | infra/dynamodb/ap-southeast-1/mrapi-control.md | Schema PK/SK, capacity, TTL, tag, ARN và trạng thái |
| 2 — role | infra/iam/roles/mrapi-dashboard-role/README.md, trust.json, permissions.json | Copy JSON từ role đang có; boundary, policy attachment, ARN |
| 4 — Lambda | infra/lambda/ap-southeast-1/mrapi-dashboard.md | Handler/runtime/role/env/memory/timeout/log retention, ZIP/commit thực tế |
| 5–6 — API/stage | infra/apigateway/ap-southeast-1/portal.md | API ID, route → Lambda, proxy integration, auth, permission invoke, stage/URL |
| 7–9 — test | Cập nhật mục test trong file infra, link docs/evidence/ | Kết quả thật, thời điểm, lỗi còn lại; không lưu token/password |

AWS base: nhóm/policy JSON ghi infra/iam; Budget/SNS/tag/Resource Groups ghi infra/monitoring. Tài nguyên đã có thì mở Console đối chiếu rồi ghi lại, không tạo trùng.

Chưa cần deploy authorizer để chứng minh bốn phần này. Lambda api hiện chỉ có GET /health đọc bảng control; có thể nối route health riêng khi cần. Dashboard cũ có tab key/usage nhưng key scope/proxy chưa hoàn tất, không dùng làm bằng chứng cho gateway.

## Hồ sơ bàn giao

### Policy dashboard để đối chiếu

Role đã tạo trên AWS: giữ nguyên nếu quyền đúng. Nếu cần tạo/cập nhật inline policy, thay tất cả `<ACCOUNT_ID>` bằng Account ID thực tế, kiểm tra Region/table/log group. Đây là permission policy, không phải trust policy hoặc boundary.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Action": ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:DeleteItem", "dynamodb:Query"], "Resource": "arn:aws:dynamodb:ap-southeast-1:<ACCOUNT_ID>:table/mrapi-control" },
    { "Effect": "Allow", "Action": "logs:CreateLogGroup", "Resource": "arn:aws:logs:ap-southeast-1:<ACCOUNT_ID>:*" },
    { "Effect": "Allow", "Action": ["logs:CreateLogStream", "logs:PutLogEvents"], "Resource": "arn:aws:logs:ap-southeast-1:<ACCOUNT_ID>:log-group:/aws/lambda/mrapi-dashboard:*" },
    { "Effect": "Allow", "Action": ["route53:ListHealthChecks", "route53:GetHealthCheckStatus"], "Resource": "*" }
  ]
}
```

### Trạng thái hiện tại

Tùng xác nhận đã hoàn thành đến bước tạo/cấu hình Lambda dashboard sau bảng/role/đóng gói. Tiếp tục test Lambda, API Gateway, stage và e2e; chưa mặc định các kiểm thử đã đạt. Các mục đã có tài nguyên chỉ cần đối chiếu, không tạo trùng.

Tạo docs/reports/first-four-parts.md, ghi: commit/phiên bản, trạng thái từng phần, tên/ARN/URL tài nguyên, group/policy/MFA, Budget/SNS/tag, config Lambda/API, output test, ảnh tạo/sửa/tắt API, test hai tenant và session logout, lỗi/hạn chế, reviewer và kết luận. Không đưa password/token/key/QR MFA vào báo cáo.

Phần AWS chỉ đánh dấu DONE sau khi thực hiện trên Console và có bằng chứng. Code orders đã được dọn khỏi repo; không thay đổi tài nguyên AWS trong đợt dọn này.

