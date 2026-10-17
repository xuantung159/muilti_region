# infra/dynamodb

Bản ghi cấu hình DynamoDB đã làm trên AWS Console, theo [RECORD_CONSOLE_CONFIG.md](../../docs/runbooks/RECORD_CONSOLE_CONFIG.md) và [GATEWAY_DESIGN.md](../../docs/GATEWAY_DESIGN.md). Thư mục này không tự tạo hay cập nhật tài nguyên AWS. Không lưu secret.

## Bảng đã ghi nhận

| Bảng | Region | Mục đích | Mô tả | Định nghĩa dựng lại |
|---|---|---|---|---|
| `mrapi-control` | ap-southeast-1 | Tài khoản, phiên, API đích, key | [mrapi-control.md](ap-southeast-1/mrapi-control.md) | `mrapi-control.json`, `mrapi-control.ttl.json` |
| `mrapi-telemetry` | ap-southeast-1 | Nhật ký từng request qua gateway | [mrapi-telemetry.md](ap-southeast-1/mrapi-telemetry.md) | `mrapi-telemetry.json`, `mrapi-telemetry.ttl.json` |

Tokyo (ap-northeast-1) và Global Tables chưa làm; chỉ thêm sau nghiệm thu Singapore.

## Trạng thái

- Các file `.json` ở đây là định nghĩa dựng lại theo cấu hình đã quan sát, không phải bản xuất nguyên văn từ AWS. Chạy các lệnh dưới đây để lưu bản thực tế và so sánh.
- Chưa test ghi/đọc/query/TTL: NOT TESTED. Đặt bằng chứng tại `docs/evidence/dynamodb/`.
- Schema telemetry là đề xuất của A, chưa được L/B xác nhận.

## Xuất cấu hình thực tế bằng CloudShell

Mở CloudShell trong Console (Region Singapore) và chạy cho từng bảng, thay tên bảng khi cần:

```bash
aws dynamodb describe-table --table-name mrapi-telemetry --region ap-southeast-1 --no-cli-pager
aws dynamodb describe-time-to-live --table-name mrapi-telemetry --region ap-southeast-1 --no-cli-pager
aws dynamodb list-tags-of-resource --resource-arn arn:aws:dynamodb:ap-southeast-1:138150704839:table/mrapi-telemetry --region ap-southeast-1 --no-cli-pager
```

Lưu kết quả `describe-table` thành `<bảng>.describe.json` cạnh file mô tả, rồi đối chiếu với bảng "Cấu hình đang áp dụng" và sửa phần "Xác nhận" cho đúng. Output có thể chứa Account ID; không chứa secret.
