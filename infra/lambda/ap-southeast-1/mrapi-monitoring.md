# mrapi-monitoring — Singapore (ap-southeast-1)

## Trạng thái và nguồn ghi nhận

- Người thực hiện: B
- Trạng thái AWS: ACTIVE
- Cập nhật hồ sơ: 25/10/2026.
- Repository source: src/monitoring/index.mjs; README: src/monitoring/README.md; contract: monitoring-web/docs/integration/backend-api.md.

## Cấu hình source/thiết kế cần đối chiếu

| Thuộc tính           | Giá trị tham chiếu                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------------- |
| Function name        | mrapi-monitoring                                                                                        |
| Function ARN         | arn:aws:lambda:ap-southeast-1::runtime:b7778d7d9d048df4a9bce496d1cc9424fe9844534468d732394872ce927254bc |
| Package              | artifacts/lambda/monitoring.zip                                                                         |
| Handler              | monitoring/index.handler                                                                                |
| Runtime              | Node.js 24.x theo src/monitoring/README.md                                                              |
| Architecture         | Chưa được README/source quy định; nhận xác nhận từ A/L                                                  |
| Execution role       | L cấp/xác nhận; tên và ARN chưa được ghi trong repo                                                     |
| Memory / timeout     | Chưa được A bàn giao trong README                                                                       |
| VPC / layers         | Đối chiếu AWS Console/A handoff                                                                         |
| Log group            | /aws/lambda/mrapi-monitoring                                                                            |
| X-Ray Active tracing | Đã bật                                                                                                  |

## Environment variables

| Tên                             | Giá trị/ý nghĩa                                                                                | Ghi nhận                                                          |
| ------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| MONITORING_ALLOWED_ORIGIN       | Origin dashboard cố định do C/L xác nhận; unset thì Lambda không trả CORS header               | Source dùng                                                       |
| MONITORING_CONFIG               | JSON override ApiName/stage/Lambda/table/S3 config; cùng cấu hình đã duyệt ở cả hai deployment | Source dùng                                                       |
| AWS_REGION                      | Region của function                                                                            | Lambda runtime cấp tự động; không đặt thủ công                    |
| CONTROL_TABLE / TELEMETRY_TABLE | Không dùng để đọc bảng trong source hiện tại                                                   | Handler hiện chỉ truy vấn CloudWatch; không query telemetry items |

## CloudWatch dimension/defaults cần xác nhận

| Resource                              | Default trong code                                         | Xác nhận                                                |
| ------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------- |
| API Gateway Singapore ApiName / stage | mrapi-api-sg / demo                                        | C đối chiếu metric thật                                 |
| API Gateway Tokyo ApiName / stage     | mrapi-api-tyo / demo                                       | mrapi-api-tyo là giả định trong source; C phải xác nhận |
| Lambda FunctionName metric            | mrapi-proxy                                                | B/C xác nhận function name thực                         |
| DynamoDB metric table                 | mrapi-telemetry                                            | A xác nhận Global Table                                 |
| S3 Singapore replication              | mrapi-exports-sg → mrapi-exports-tyo, rule mrapi-sg-to-tyo | A xác nhận rule                                         |
| S3 Tokyo metric                       | null trong cấu hình hiện tại                               | Trả not_configured theo thiết kế                        |

MONITORING_CONFIG cần được chốt từ tên API/stage/FunctionName thật; không để Tokyo API name giả định nếu khác AWS. CORS origin cũng phải trùng origin được duyệt.

## IAM và security dependencies

- Identity policy của role cần cloudwatch:GetMetricData, cloudwatch:ListMetrics, cloudwatch:DescribeAlarmHistory và quyền ghi CloudWatch Logs.
- CloudWatch actions cần Resource \* theo README hiện tại; role phải đọc metrics ở cả hai Region.
- Nếu permission boundary mrapi-workload-boundary được gắn, bản repo liệt kê DescribeAlarms nhưng không liệt kê DescribeAlarmHistory. L xác nhận boundary thực tế có cho action này không; nếu không, incidents có thể lỗi dù identity policy grant.
- Source hiện không cần dynamodb:Query; nếu A bàn giao code khác có query telemetry, A phải chỉ rõ resource/index/action để L duyệt.
- Lambda không tự xác thực. Không tạo Function URL public hoặc public resource policy. C phải đặt route /monitoring/\* sau cơ chế auth đã thống nhất trước khi công khai.

## Bàn giao

Gửi ARN ap-southeast-1 cho C cùng artifact hash, handler/runtime/role/env không secret, test/log evidence, API metric config và auth dependency. A xác nhận source/ZIP; L xác nhận IAM/boundary; C tích hợp API Gateway. Cập nhật config/demo/global.json roles.monitoring chỉ bằng role ARN lấy từ IAM thực tế.
