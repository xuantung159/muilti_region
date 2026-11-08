# mrapi-proxy-role

## Chức năng

Cấp quyền dữ liệu và ghi log cho Lambda proxy.

## Ứng dụng trong project

Cho proxy đọc cấu hình backend từ control, ghi nhật ký vào telemetry ở Region đang xử lý và gửi log, trace phục vụ chẩn đoán.

## Ý nghĩa các file cấu hình

| File | Mục đích |
|---|---|
| `attachments.json` | Managed policy gắn vào role; rỗng không có nghĩa role không có inline policy. |
| `permission.json` | Action và ARN được phép; dùng đối chiếu policy quyền dữ liệu. |
| `role-metadata.json` | ARN, path và trust để nhận diện role; không suy ra boundary từ trường bị thiếu. |
| `trust.json` | Service được assume role; không quy định quyền đọc/ghi dữ liệu. |

## Cấu hình và chi tiết

Role của Lambda `mrapi-proxy` ở Singapore và Tokyo.

- ARN: `arn:aws:iam::138150704839:role/mrapi-proxy-role`.
- Trust: `lambda.amazonaws.com`, xem [trust.json](trust.json).
- Boundary: `mrapi-workload-boundary`.
- Inline policy: `mrapi-proxy-data-access`, xem [permission.json](permission.json).
- Không gắn managed policy.

## Quyền

Đọc control bằng GetItem, ghi telemetry bằng PutItem ở hai Region; ghi log `/aws/lambda/mrapi-proxy` và X-Ray. Health cũng dùng GetItem trên control.

Gọi backend Internet không cần quyền IAM. Lambda hiện không dùng VPC; nếu đưa vào VPC cần cấu hình đường ra Internet. Đổi tên function phải kiểm tra lại ARN log group trong policy.

Health đã trả 200 ở hai Region. Luồng proxy bằng key thật và telemetry còn cần nghiệm thu đầy đủ. [Cấu hình Lambda](../../../lambda/ap-southeast-1/mrapi-proxy.md).
