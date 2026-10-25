# mrapi-authorizer — Singapore (ap-southeast-1)

## Trạng thái và nguồn ghi nhận

- Người thực hiện: B
- Trạng thái AWS: ACTIVE
- Cập nhật hồ sơ: 25/10/2026.
- Source: src/authorizer/index.mjs và src/shared/lib.mjs.
- Bản ghi cũ ngày 17/10/2026.

## Cấu hình source/thiết kế cần đối chiếu

| Thuộc tính                   | Giá trị tham chiếu                                                                                      |
| ---------------------------- | ------------------------------------------------------------------------------------------------------- |
| Function name                | mrapi-authorizer                                                                                        |
| Function ARN                 | arn:aws:lambda:ap-southeast-1::runtime:b7778d7d9d048df4a9bce496d1cc9424fe9844534468d732394872ce927254bc |
| Package                      | artifacts/lambda/authorizer.zip; npm run package --prefix src                                           |
| Handler                      | authorizer/index.handler                                                                                |
| Runtime / architecture       | Node.js 24.x / arm64 theo phân công mới                                                                 |
| Execution role               | mrapi-authorizer-role theo thiết kế                                                                     |
| Memory / timeout             | 128–256 MB / 5 giây theo runbook                                                                        |
| VPC / layers                 | Đối chiếu live; source không yêu cầu VPC                                                                |
| Version / alias / CodeSha256 | Ghi caller/API Gateway đang invoke                                                                      |
| Log group                    | /aws/lambda/mrapi-authorizer dự kiến                                                                    |
| X-Ray Active tracing         | đã bật                                                                                                  |

## Environment variables

| Tên             | Giá trị                                            |
| --------------- | -------------------------------------------------- |
| CONTROL_TABLE   | mrapi-control theo config/demo/ap-southeast-1.json |
| TELEMETRY_TABLE | mrapi-telemetry theo phân công B                   |
| PROJECT         | mrapi theo phân công B                             |

## Quyền và dependency

- Source hiện gọi DynamoDB GetItem trên control table, key PK=TENANT#<tenantId>, SK=KEY#<keyId>, ConsistentRead=true.
- Source không ghi telemetry; các lần từ chối ghi sự kiện AUTHORIZER_DENY vào CloudWatch Logs nhưng không ghi API key hoặc hash.
- Role JSON trong infra/iam/roles/mrapi-authorizer-role/permission.json là cấu hình repo tham chiếu ap-southeast-1; chưa chứng minh role/policy được gắn trên AWS.
- Cần CloudWatch Logs CreateLogGroup/CreateLogStream/PutLogEvents theo log group thực tế. L xác nhận role, trust, boundary và policy.
- API Gateway authorizer, invoke permission, route/cache/stage do C quản lý. Cần xác nhận API target thực tế do config/demo dùng mrapi-api, còn phân công đề cập mrapi-proxy.

## Bàn giao

Bàn giao ARN, Region, handler, role, cấu hình env không secret, ZIP/hash/commit, kết quả test/log cho C và reviewer A. C xác nhận authorizer REQUEST, identity source x-api-key, cache, routes và invoke permission; L xác nhận IAM.
