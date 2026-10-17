# mrapi-proxy-role

- Người thực hiện: A
- Role ARN: `arn:aws:iam::138150704839:role/mrapi-proxy-role` (suy ra từ tên role và Account ID; copy lại ARN từ IAM → Roles → mrapi-proxy-role để đối chiếu)
- Dùng cho: Lambda proxy chuyển request tới backend doanh nghiệp và ghi telemetry
- Tag: `Project=mrapi`, `Owner=A`

## Cấu hình

| Thuộc tính | Giá trị |
|---|---|
| Trust | `lambda.amazonaws.com` (`trust.json`) |
| Permissions boundary | `mrapi-workload-boundary` (`arn:aws:iam::138150704839:policy/mrapi-workload-boundary`) |
| Inline policy | Nội dung trong `permission.json`; tên policy điền theo Console |
| Managed policy gắn thêm | Không (điền lại nếu Console khác) |
| Lambda gắn role | `mrapi-proxy`, chạy gói `api.zip` (handler `api/index.handler`); chưa deploy — xem [mrapi-proxy.md](../../../lambda/ap-southeast-1/mrapi-proxy.md) |

## Quyền

- Đọc cấu hình API đích ở `mrapi-control`: `GetItem` (B cần `Query` thì bổ sung).
- Ghi `mrapi-telemetry`: `PutItem`.
- Ghi log CloudWatch cho log group `/aws/lambda/mrapi-proxy` (tên Lambda do B chốt).
- Chưa cấp X-Ray vì chưa có yêu cầu từ B.

## Đối chiếu với code proxy (17/10/2026)

Code `src/api/proxy.mjs` chỉ gọi `GetItem` trên control (đọc cấu hình API) và `PutItem` trên telemetry (ghi một dòng mỗi request), khớp với `permission.json`; không cần sửa policy. Gọi backend doanh nghiệp đi qua Internet nên không cần quyền IAM, nhưng Lambda **không được đặt trong VPC** (nếu đặt thì cần NAT). Health `/health` cũng chạy được bằng role này vì chỉ cần `GetItem` trên control.

Đặt tên function đúng `mrapi-proxy`, nếu không dòng log group trong policy không khớp và Lambda không ghi được log.

## Kiểm thử và bằng chứng

- Thực tế: NOT TESTED (chưa chạy Lambda thật với role này)
- Bằng chứng: chưa có (đặt tại docs/evidence/iam/)
- Lưu ý: dòng log group trong `permission.json` phụ thuộc đúng tên Lambda; đổi tên Lambda thì sửa dòng đó, nếu không Lambda chạy nhưng không ghi được log

## Bàn giao

- Consumer: B (gắn role vào Lambda, đặt biến môi trường tên bảng)
- Reviewer/kết luận: chưa điền (L và B)
