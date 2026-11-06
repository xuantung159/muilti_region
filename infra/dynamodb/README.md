# DynamoDB

## Chức năng

Lưu dữ liệu theo khóa; Global Tables sao chép dữ liệu giữa các Region.

## Ứng dụng trong project

Bảng control giữ tài khoản, phiên, API đích và key; bảng telemetry giữ nhật ký request. Hai Region dùng bản sao dữ liệu để phục vụ cùng nền tảng.

## Ý nghĩa các file cấu hình

| File | Ý nghĩa và cách dùng |
|---|---|
| `ap-southeast-1/mrapi-control.json`, `mrapi-telemetry.json` | Input tạo bảng: tên, PK/SK, capacity và GSI của telemetry. Chưa bao gồm toàn bộ replica/PITR. |
| `ap-southeast-1/*.ttl.json` | Input bật TTL trên expiresAt. Giúp tự dọn item hết hạn; không thay việc kiểm tra phiên hết hạn trong code. |
| `<region>/*.describe.json` | Cấu hình bảng thực tế: schema, index, stream, replica và deletion protection. Dùng đối chiếu, không đưa nguyên file vào create-table. |
| `<region>/*.backup.json` | Trạng thái continuous backup/PITR. Dùng kiểm tra khả năng phục hồi theo thời điểm, không chứa dữ liệu backup. |

Các thư mục Region dùng cấu trúc tương tự. File đối chiếu có thể chứa trường chỉ đọc; cần chọn đúng trường và định dạng input trước khi dùng với AWS CLI. Sửa file trong repo không tự thay đổi tài nguyên AWS.

## Cấu hình và chi tiết

Hai bảng dùng Global Tables giữa Singapore và Tokyo.

| Bảng | Dữ liệu | Hồ sơ |
|---|---|---|
| `mrapi-control` | Tài khoản, phiên, API đích, key | [Cấu hình](ap-southeast-1/mrapi-control.md) |
| `mrapi-telemetry` | Nhật ký request qua proxy | [Cấu hình](ap-southeast-1/mrapi-telemetry.md) |

Cả hai dùng PK/SK kiểu String, On-demand, TTL `expiresAt`, replica `ap-northeast-1`. PITR và deletion protection bật ở cả hai Region. Muốn xóa bảng phải tắt deletion protection trước.

JSON là định nghĩa dựng lại, không phải bản xuất đầy đủ từ AWS. Tạo bảng từ JSON chưa bao gồm mọi thiết lập replica/PITR; xem [Global Tables](../../docs/runbooks/DYNAMODB_GLOBAL_TABLES.md).

## Kiểm tra cấu hình

Thay tên bảng hoặc Region khi cần:

```bash
aws dynamodb describe-table --table-name mrapi-telemetry --region ap-southeast-1 --no-cli-pager
aws dynamodb describe-time-to-live --table-name mrapi-telemetry --region ap-southeast-1 --no-cli-pager
aws dynamodb describe-continuous-backups --table-name mrapi-telemetry --region ap-southeast-1 --no-cli-pager
aws dynamodb list-tags-of-resource --resource-arn arn:aws:dynamodb:ap-southeast-1:138150704839:table/mrapi-telemetry --region ap-southeast-1 --no-cli-pager
```

Kiểm thử đồng bộ: 10/10 item xuất hiện ở Region kia trong khoảng 1 giây. Cần thêm mẫu để đánh giá p95.

Còn cần nghiệm thu ghi/query qua proxy và portal, cách ly tenant và TTL. TTL xóa có độ trễ; code vẫn phải kiểm tra thời gian.

