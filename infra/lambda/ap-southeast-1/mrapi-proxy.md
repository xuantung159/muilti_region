# mrapi-proxy — Singapore (ap-southeast-1)

## Trạng thái và nguồn ghi nhận

- Người thực hiện: B
- Trạng thái AWS: ACTIVE
- Cập nhật hồ sơ: 25/10/2026.
- Source: src/api/index.mjs, src/api/proxy.mjs, src/api/target.mjs, src/shared/lib.mjs.
- Bản ghi cũ ghi ngày 17/10/2026.

## Cấu hình source/thiết kế cần đối chiếu

| Thuộc tính                   | Giá trị tham chiếu                                                                                      |
| ---------------------------- | ------------------------------------------------------------------------------------------------------- |
| Function name                | mrapi-proxy (phân công B)                                                                               |
| Function ARN                 | arn:aws:lambda:ap-southeast-1::runtime:b7778d7d9d048df4a9bce496d1cc9424fe9844534468d732394872ce927254bc |
| Package                      | artifacts/lambda/api.zip; script chuẩn npm run package --prefix src                                     |
| Handler                      | api/index.handler                                                                                       |
| Runtime / architecture       | Node.js 24.x / arm64 theo phân công mới                                                                 |
| Execution role               | mrapi-proxy-role theo thiết kế; ARN thật phải xác nhận ở Lambda/IAM                                     |
| Memory / timeout             | 256 MB / 15 giây theo runbook proxy                                                                     |
| VPC / layers                 | Không gắn VPC theo runbook vì proxy gọi backend HTTPS công khai; layer cần ghi nếu có                   |
| Version / alias / CodeSha256 | Ghi phiên bản/alias mà API Gateway invoke và CodeSha256 trước/sau deploy                                |
| Log group                    | /aws/lambda/mrapi-proxy                                                                                 |
| X-Ray Active tracing         | Đã bật                                                                                                  |

## Environment variables

| Tên                      | Giá trị                                            | Source sử dụng                                                   |
| ------------------------ | -------------------------------------------------- | ---------------------------------------------------------------- |
| CONTROL_TABLE            | mrapi-control theo config/demo/ap-southeast-1.json | Có; health GetItem và đọc cấu hình API                           |
| TELEMETRY_TABLE          | mrapi-telemetry theo config                        | Có; ghi một record telemetry mỗi request proxy                   |
| PROJECT                  | mrapi theo phân công B                             | Hiện source proxy không đọc biến này; giữ theo yêu cầu phân công |
| TELEMETRY_RETENTION_DAYS | source mặc định 30                                 | Có; dùng tính expiresAt                                          |
| HEALTH_FORCE_FAIL        | unset hoặc false trong trạng thái bình thường      | Có; true làm GET /health trả 503, chỉ bật theo lịch test với L   |

## Quyền và dependency

- Source cần DynamoDB GetItem trên bảng control; proxy đọc API record theo tenant/API.
- Source cần DynamoDB PutItem trên bảng telemetry; lỗi ghi telemetry được log và không nhất thiết làm hỏng response upstream.
- Cần quyền CloudWatch Logs CreateLogGroup/CreateLogStream/PutLogEvents theo log group thực tế.
- Role JSON trong infra/iam/roles/mrapi-proxy-role/permission.json là cấu hình repo theo ap-southeast-1.
- Function name trong config hiện là functions.api=mrapi-api, còn phân công/runbook nhắc mrapi-proxy. C/L phải xác nhận function/alias integration trước khi đổi tên hoặc tạo trùng.

## Bàn giao

Bàn giao ARN, Region, handler, role, env không secret, artifact/hash/commit, test/log evidence cho C và reviewer A. C xác nhận API Gateway target; L xác nhận IAM; A xác nhận table dependency. Không ghi secret hoặc key vào repository.
