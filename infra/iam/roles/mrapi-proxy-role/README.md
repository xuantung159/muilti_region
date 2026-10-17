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
| Lambda gắn role | mrapi-proxy (tên Lambda chưa chốt với B) (chưa gắn / chưa xác nhận) |

## Quyền

- Đọc cấu hình API đích ở `mrapi-control`: `GetItem` (B cần `Query` thì bổ sung).
- Ghi `mrapi-telemetry`: `PutItem`.
- Ghi log CloudWatch cho log group `/aws/lambda/mrapi-proxy` (tên Lambda do B chốt).
- Chưa cấp X-Ray vì chưa có yêu cầu từ B.

## Kiểm thử và bằng chứng

- Thực tế: NOT TESTED (chưa chạy Lambda thật với role này)
- Bằng chứng: chưa có (đặt tại docs/evidence/iam/)
- Lưu ý: dòng log group trong `permission.json` phụ thuộc đúng tên Lambda; đổi tên Lambda thì sửa dòng đó, nếu không Lambda chạy nhưng không ghi được log

## Bàn giao

- Consumer: B (gắn role vào Lambda, đặt biến môi trường tên bảng)
- Reviewer/kết luận: chưa điền (L và B)
