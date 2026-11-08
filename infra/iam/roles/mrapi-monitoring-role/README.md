# mrapi-monitoring-role

## Chức năng

Cấp quyền đọc số liệu vận hành cho Lambda monitoring.

## Ứng dụng trong project

Cho backend monitoring đọc CloudWatch, Route 53 health check và truy vấn telemetry theo phạm vi đã cấp để phục vụ giao diện giám sát.

## Ý nghĩa các file cấu hình

| File | Mục đích |
|---|---|
| `attachments.json` | Managed policy gắn vào role; rỗng không có nghĩa role không có inline policy. |
| `permission.json` | Action và ARN được phép; dùng đối chiếu policy quyền dữ liệu. |
| `role-metadata.json` | ARN, path và trust để nhận diện role; không suy ra boundary từ trường bị thiếu. |
| `trust.json` | Service được assume role; không quy định quyền đọc/ghi dữ liệu. |

## Cấu hình và chi tiết

Dùng cho monitoring ở cả hai Region.

- ARN: `arn:aws:iam::138150704839:role/mrapi-monitoring-role`.
- Trust: Lambda, [trust.json](trust.json).
- Boundary: `mrapi-workload-boundary`.
- Inline policy thực tế: `Policymrapi-monitoring-access`, giữ đúng tiền tố Policy khi quản lý.
- Nội dung: [permission.json](permission.json). Không gắn managed policy.

Role đọc CloudWatch và health check Route 53, Query telemetry/index ở hai Region, ghi log riêng và X-Ray.

Đọc metric thật SG, Tokyo và us-east-1 qua `/monitoring/snapshot`. Query telemetry bằng role này chưa kiểm thử.
