# mrapi-apigateway-cloudwatch-role

## Chức năng

Cho phép API Gateway ghi log vào CloudWatch.

## Ứng dụng trong project

Lưu log của stage demo để tra lỗi route, xác thực và Lambda integration.

## Ý nghĩa các file cấu hình

| File | Mục đích |
|---|---|
| `attachments.json` | Managed policy gắn vào role; rỗng không có nghĩa role không có inline policy. |
| `role-metadata.json` | ARN, path và trust để nhận diện role; không suy ra boundary từ trường bị thiếu. |
| `trust.json` | Service được assume role; không quy định quyền đọc/ghi dữ liệu. |

## Cấu hình và chi tiết

Role để API Gateway ghi log vào CloudWatch.

- ARN: `arn:aws:iam::138150704839:role/mrapi-apigateway-cloudwatch-role`.
- Trust: [trust.json](trust.json), service `apigateway.amazonaws.com`.
- Managed policy: `AmazonAPIGatewayPushToCloudWatchLogs` (AWS quản lý). Không có inline policy.
- Boundary: chính `AmazonAPIGatewayPushToCloudWatchLogs`, không phải `mrapi-workload-boundary`.
