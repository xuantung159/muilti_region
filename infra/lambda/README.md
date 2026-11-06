# Lambda

## Chức năng

Chạy mã backend theo request hoặc sự kiện mà không cần quản lý máy chủ.

## Ứng dụng trong project

Dashboard phục vụ portal; authorizer kiểm tra key; proxy gọi backend doanh nghiệp; monitoring đọc số liệu. Exporter chỉ chạy tại Singapore theo lịch.

## Ý nghĩa các file cấu hình

| File | Ý nghĩa và cách dùng |
|---|---|
| `<region>/<function>.config.json` | Runtime, handler, role, memory, timeout, tracing, VPC, hash gói và tên env. Dùng đối chiếu hoặc chuẩn bị cấu hình deploy; không chứa mã nguồn hay giá trị env. |
| `<region>/<function>.resource-policy.json` | Quyền service bên ngoài invoke Lambda, gồm API Gateway/EventBridge và SourceArn. Khác execution role mà Lambda dùng để truy cập DynamoDB/S3. |
| `<region>/<function>.tags.json` | Nhãn tài nguyên như Project=mrapi để quản lý. Tag không tự cấp quyền hoặc đưa tài nguyên vào Budget. |

Các thư mục Region dùng cấu trúc tương tự. File đối chiếu có thể chứa trường chỉ đọc; cần chọn đúng trường và định dạng input trước khi dùng với AWS CLI. Sửa file trong repo không tự thay đổi tài nguyên AWS.

## Cấu hình và chi tiết

Với từng hàm dưới đây, ZIP và env của bản Singapore khớp bản Tokyo. Bảng chỉ liệt kê tên biến môi trường.

Tất cả dùng `nodejs24.x`, arm64, tracing Active. Mỗi hàm có cùng tên ở `ap-southeast-1` và `ap-northeast-1`. Cả 4 hàm dưới đây có tag `Project=mrapi` ở 2 Region.

| Hàm | Handler | Memory / timeout | Role | Biến môi trường (tên) | CodeSha256 (2 Region trùng) |
|---|---|---|---|---|---|
| `mrapi-proxy` | `api/index.handler` | 256 MB / 15 s | `mrapi-proxy-role` | `CONTROL_TABLE`, `PROJECT`, `TELEMETRY_RETENTION_DAYS`, `TELEMETRY_TABLE` | `Ot7hINFMLTRDaFPXDvOFw+lXiH1lHHQK6kERyUu/HIA=` |
| `mrapi-authorizer` | `authorizer/index.handler` | 128 MB / 5 s | `mrapi-authorizer-role` | `CONTROL_TABLE`, `PROJECT`, `TELEMETRY_TABLE` | `rVBoGTgN7bcEKk9b82GX1I65U/8e4prTfy0c3FHsLOM=` |
| `mrapi-dashboard` | `dashboard/index.handler` | 256 MB / 10 s | `mrapi-dashboard-role` | `CONTROL_TABLE`, `FRONTEND_URL`, `PORTAL_ALLOWED_ORIGIN`, `PROJECT`, `TELEMETRY_TABLE` | `6j5+KNl+NH8rOICWWSUzQ5GCr2OK8vZgdhagS7FLZaI=` |
| `mrapi-monitoring` | `monitoring/index.handler` | 256 MB / 10 s | `mrapi-monitoring-role` | `MONITORING_ALLOWED_ORIGIN`, `MONITORING_CONFIG` (đều rỗng) | `f5BTOxk7f/SurRRfm2aTQJTufyavWbmqqh2qi127CGY=` |

Hash dùng để kiểm tra hai Region chạy cùng gói triển khai.

Thông số dựng hàm proxy và authorizer: [mrapi-proxy.md](ap-southeast-1/mrapi-proxy.md), [mrapi-authorizer.md](ap-southeast-1/mrapi-authorizer.md).

## Exporter và thống kê

[Exporter](ap-southeast-1/mrapi-exporter.md) chỉ chạy tại Singapore: `exporter/index.handler`, 128 MB / 15 giây, role `mrapi-exporter-role`, tracing Active. Lịch 18:00 UTC hằng ngày.

