# mrapi-monitoring — Tokyo (ap-northeast-1)

## Trạng thái và nguồn ghi nhận

- Người thực hiện: B (deploy); A bàn giao source/package và contract.
- Trạng thái AWS: ACTIVE
- Cập nhật hồ sơ: 25/10/2026.
- Source: `src/monitoring/index.mjs`; hướng dẫn A: `src/monitoring/README.md`; contract: `monitoring-web/docs/integration/backend-api.md`.

## Cấu hình cần A/L xác nhận và đối chiếu trên AWS

| Thuộc tính           | Giá trị tham chiếu                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------------- |
| Function name        | `mrapi-monitoring`                                                                                      |
| Function ARN         | arn:aws:lambda:ap-northeast-1::runtime:b7778d7d9d048df4a9bce496d1cc9424fe9844534468d732394872ce927254bc |
| Handler              | `monitoring/index.handler`                                                                              |
| Runtime              | Node.js 24.x theo README monitoring                                                                     |
| Architecture         | Chưa được source/README quy định; nhận xác nhận từ A/L, không tự suy ra                                 |
| Execution role       | L cấp/xác nhận; tên/ARN chưa có bằng chứng trong repo                                                   |
| Memory / timeout     | Chưa được A bàn giao                                                                                    |
| VPC / layers         | Xác nhận theo ZIP/handoff và cấu hình live                                                              |
| Log group            | `/aws/lambda/mrapi-monitoring`                                                                          |
| X-Ray Active tracing | đã bật                                                                                                  |

## Environment variables và metric sources

| Tên                                 | Ý nghĩa / giá trị Tokyo                                                                                                                                                                          |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `MONITORING_ALLOWED_ORIGIN`         | Origin dashboard do C/L xác nhận; nếu unset thì không có CORS header                                                                                                                             |
| `MONITORING_CONFIG`                 | JSON override tên tài nguyên/Region. Tokyo `apiName` phải là API Gateway thật do C xác nhận; `mrapi-api-tyo` trong source là giả định chưa xác nhận. Không chép cấu hình Singapore nguyên trạng. |
| `AWS_REGION`                        | Lambda runtime cung cấp `ap-northeast-1`; không tự đặt                                                                                                                                           |
| `CONTROL_TABLE` / `TELEMETRY_TABLE` | Source monitoring hiện truy vấn CloudWatch, không query DynamoDB telemetry items                                                                                                                 |

## Quyền và bảo mật

- Role cần `cloudwatch:GetMetricData`, `cloudwatch:ListMetrics`, `cloudwatch:DescribeAlarmHistory` và quyền ghi CloudWatch Logs, theo README hiện hành. L xác nhận identity policy, resource scope, trust và permission boundary.
- Permission boundary thực tế có thể giới hạn `DescribeAlarmHistory`; L đối chiếu trước test. Không sửa IAM trong hồ sơ này.
- Source không query telemetry table; không yêu cầu `dynamodb:Query` trừ khi A bàn giao source khác và nêu rõ resource/index/action.
- Lambda không tự xác thực. C chỉ expose `/monitoring/*` sau authorizer/API Gateway auth đã thống nhất; không tạo Function URL public hoặc public resource policy.

## Bàn giao

Bàn giao ARN Tokyo cho C để tích hợp route `/monitoring/*` sau auth; gửi A artifact provenance/contract mismatch và L yêu cầu IAM/boundary cần thiết. Ghi lại test/log evidence và mọi `missing`/dependency. Chỉ đánh dấu `DONE & VERIFIED` sau khi A xác nhận artifact, L xác nhận role, AWS live settings và test có bằng chứng.
