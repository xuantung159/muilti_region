# mrapi-dashboard — Singapore (ap-southeast-1)

## Trạng thái và nguồn ghi nhận

- Người thực hiện: B
- Trạng thái AWS: ACTIVE
- Cập nhật hồ sơ: 25/10/2026.
- Source: src/dashboard/index.mjs, src/dashboard/apis.mjs và src/shared/lib.mjs.

## Cấu hình source/thiết kế cần đối chiếu

| Thuộc tính                   | Giá trị tham chiếu                                                                                      |
| ---------------------------- | ------------------------------------------------------------------------------------------------------- |
| Function name                | mrapi-dashboard                                                                                         |
| Function ARN                 | arn:aws:lambda:ap-southeast-1::runtime:b7778d7d9d048df4a9bce496d1cc9424fe9844534468d732394872ce927254bc |
| Package                      | artifacts/lambda/dashboard.zip                                                                          |
| Handler                      | dashboard/index.handler                                                                                 |
| Runtime / architecture       | Node.js 24.x / arm64 theo phân công mới                                                                 |
| Execution role               | mrapi-dashboard-role theo thiết kế                                                                      |
| Memory / timeout             | 256 MB / 10 giây đúng cấu hình hiện tại                                                                 |
| VPC / layers                 | Đối chiếu AWS Console                                                                                   |
| Version / alias / CodeSha256 | Ghi caller/alias thực tế nếu đã được API Gateway gọi                                                    |
| Log group                    | /aws/lambda/mrapi-dashboard                                                                             |
| X-Ray Active tracing         | Đã bật                                                                                                  |

## Environment variables

| Tên                   | Giá trị tham chiếu                     | Source sử dụng                                                                            |
| --------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------- |
| CONTROL_TABLE         | mrapi-control                          | Có; tài khoản, session, API và key access                                                 |
| PROJECT               | mrapi                                  | Có; tạo prefix <PROJECT>-hc- để lọc Route 53 health checks                                |
| FRONTEND_URL          | Chỉ đặt URL đã được C/L xác nhận       | Có; GET / redirect tới /portal                                                            |
| PORTAL_ALLOWED_ORIGIN | Chỉ đặt origin đã được C/L xác nhận    | Có; CORS origin cố định                                                                   |
| TELEMETRY_TABLE       | Không được yêu cầu bởi source hiện tại | Dashboard source đang đọc usage counters trong CONTROL_TABLE, không query TELEMETRY_TABLE |

## Quyền và dependency

- DynamoDB control: GetItem, PutItem, DeleteItem, Query theo các API session/account/API/key/usage.
- Route 53: ListHealthChecks và GetHealthCheckStatus; Route 53 client trong source cấu hình region us-east-1.
- CloudWatch Logs: tạo log group/stream và PutLogEvents theo log group thật.
- Policy tham chiếu trong infra/iam/roles/mrapi-dashboard-role/permission.json scope DynamoDB tới mrapi-control Singapore và có Route 53 read.
- Role ARN hiện cần lấy từ Lambda/IAM Console; config/demo/global.json trường roles.dashboard đang rỗng. L xác nhận trust, boundary, attachments và quyền thực tế. Không tự sửa IAM.
- Nếu Route 53 health checks chưa được L tạo, endpoint dashboard status có thể trả regions rỗng; đây là dependency, không tự tạo health check.

## Bàn giao

Ghi ARN, cấu hình đã đối chiếu, artifact/hash/commit, env không secret và test/log evidence. C xác nhận frontend/API Gateway integration; L xác nhận IAM; reviewer A review B.
