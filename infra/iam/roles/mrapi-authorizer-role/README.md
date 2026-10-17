# mrapi-authorizer-role

- Người thực hiện: A
- Trạng thái: Đã tạo trên Console (A xác nhận). JSON chép theo hướng dẫn đã áp dụng, chưa đối chiếu nguyên văn với Console
- Role ARN: `arn:aws:iam::138150704839:role/mrapi-authorizer-role` (suy ra từ tên role và Account ID; copy lại ARN từ IAM → Roles → mrapi-authorizer-role để đối chiếu)
- Dùng cho: Lambda authorizer kiểm tra `x-api-key`
- Tag: `Project=mrapi`, `Owner=A`

## Cấu hình

| Thuộc tính | Giá trị |
|---|---|
| Trust | `lambda.amazonaws.com` (`trust.json`) |
| Permissions boundary | `mrapi-workload-boundary` (`arn:aws:iam::138150704839:policy/mrapi-workload-boundary`) |
| Inline policy | Nội dung trong `permission.json`; tên policy điền theo Console |
| Managed policy gắn thêm | Không (điền lại nếu Console khác) |
| Lambda gắn role | mrapi-authorizer (chưa gắn / chưa xác nhận) |

## Quyền

- Đọc bảng `mrapi-control`: `GetItem`, `Query` (kiểm tra key và scope).
- Ghi log CloudWatch cho log group `/aws/lambda/mrapi-authorizer`.
- Chưa có quyền ghi `mrapi-telemetry`. Nếu nhóm chốt authorizer ghi telemetry khi từ chối key thì thêm `dynamodb:PutItem` cho bảng telemetry và cập nhật cả file này lẫn Console.

## Kiểm thử và bằng chứng

- Thực tế: NOT TESTED (chưa chạy Lambda thật với role này)
- Bằng chứng: chưa có (đặt tại docs/evidence/iam/)
- Lưu ý: dòng log group trong `permission.json` phụ thuộc đúng tên Lambda; đổi tên Lambda thì sửa dòng đó, nếu không Lambda chạy nhưng không ghi được log

## Bàn giao

- Consumer: B (gắn role vào Lambda, đặt biến môi trường tên bảng)
- Reviewer/kết luận: chưa điền (L và B)
