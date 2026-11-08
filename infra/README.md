# Hạ tầng AWS

Cấu hình thực tế của dự án, account `138150704839`. [Tổng quan](DEPLOYED_STATE.md).

| Thư mục | Nội dung |
|---|---|
| [apigateway](apigateway/README.md) | REST API, stage, authorizer, route và integration hai Region |
| [lambda](lambda/README.md) | Config, tên biến môi trường, tag và resource policy của 9 hàm |
| [dynamodb](dynamodb/README.md) | Schema, replica, stream, PITR và deletion protection |
| [s3](s3/README.md) | Versioning, encryption, replication, lifecycle và hosting bucket |
| [cloudfront](cloudfront/README.md) | Distribution, origin, behavior và bucket policy |
| [route53](route53/README.md) | Record domain dự án và health check |
| [iam](iam/README.md) | Role, trust, inline policy và managed policy attachment |
| [monitoring](monitoring/README.md) | Alarm, log group, metric filter, SNS và Budget |
| [eventbridge](eventbridge/README.md) | Lịch export và Lambda target |
| [acm](acm/README.md) | Chứng chỉ frontend và API |
| [xray](xray/README.md) | Sampling rule và nơi bật tracing |
| [quotas](quotas/README.md) | Giới hạn concurrent executions của Lambda |

JSON được lấy từ AWS qua CloudShell bằng các lệnh đọc. Đã bỏ metadata request, thời điểm kiểm kê và số đếm thay đổi liên tục. Không lưu giá trị biến môi trường Lambda, thông tin đăng nhập hay dữ liệu trong bảng/bucket.

File `*.config.json`, `*.describe.json`, `role-metadata.json` là cấu hình để đối chiếu, không phải tất cả đều dùng trực tiếp với lệnh tạo tài nguyên. Các JSON tạo bảng và TTL được giữ riêng.

## Điểm cần lưu ý

- REST API Singapore dùng `SecurityPolicy_TLS13_1_2_2021_06`, endpoint access `STRICT`; Tokyo trả về `TLS_1_0`. Đây là policy của REST API, khác với policy custom domain.
- Lambda concurrent executions chỉ 10 mỗi Region.
- Hai bucket export không có bucket policy riêng; bucket frontend không có replication hoặc lifecycle.
- Email Budget còn Pending, 0/1 verified. Không lưu địa chỉ người nhận vào repo.

Phạm vi: các thành phần phục vụ gateway tại Singapore/Tokyo và các dịch vụ dùng chung của dự án. Không đưa tài nguyên khác trong account vào thư mục này.
