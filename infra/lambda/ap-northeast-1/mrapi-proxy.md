# mrapi-proxy — Tokyo (ap-northeast-1)

## Trạng thái và nguồn ghi nhận

- Người thực hiện: B
- Trạng thái AWS: ACTIVE
- Cập nhật hồ sơ: 25/10/2026.
- Source: `src/api/index.mjs`, `src/api/proxy.mjs`, `src/api/target.mjs`, `src/shared/lib.mjs`.
- Cấu hình tham chiếu Region: `config/demo/ap-northeast-1.json`.

## Cấu hình cần đối chiếu trên AWS

| Thuộc tính                   | Giá trị tham chiếu                                                                                      |
| ---------------------------- | ------------------------------------------------------------------------------------------------------- |
| Function name                | `mrapi-proxy` theo phân công B; cần C/L chốt mapping do config hiện ghi `functions.api=mrapi-api`       |
| Function ARN                 | arn:aws:lambda:ap-northeast-1::runtime:b7778d7d9d048df4a9bce496d1cc9424fe9844534468d732394872ce927254bc |
| Package                      | `artifacts/lambda/api.zip`                                                                              |
| Handler                      | `api/index.handler`                                                                                     |
| Runtime / architecture       | Node.js 24.x / `arm64` theo phân công                                                                   |
| Execution role               | `mrapi-proxy-role`; L xác nhận ARN, trust, policy, boundary và quyền Tokyo                              |
| Memory / timeout             | 256 MB / 15 giây theo runbook                                                                           |
| VPC / layers                 | Runbook tham chiếu không gắn VPC; xác nhận live trước deploy, không đổi tùy tiện                        |
| Version / alias / CodeSha256 | Ghi caller/alias thực tế, version và CodeSha256 sau deploy                                              |
| Log group                    | `/aws/lambda/mrapi-proxy`                                                                               |
| X-Ray Active tracing         | đã bật                                                                                                  |

## Environment variables

| Tên                        | Giá trị tham chiếu Tokyo                                 | Source usage                                                                                      |
| -------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `CONTROL_TABLE`            | `mrapi-control` theo `config/demo/ap-northeast-1.json`   | Health check và đọc cấu hình API                                                                  |
| `TELEMETRY_TABLE`          | `mrapi-telemetry` theo `config/demo/ap-northeast-1.json` | Ghi telemetry cho request proxy; test write có thể tạo dữ liệu shared/replicate, phối hợp A trước |
| `PROJECT`                  | `mrapi` theo phân công/global config                     | Giữ theo yêu cầu; source proxy hiện không đọc biến                                                |
| `TELEMETRY_RETENTION_DAYS` | Mặc định source là 30 ngày                               | Chỉ đặt override nếu B1/release đã chốt                                                           |
| `HEALTH_FORCE_FAIL`        | Không đặt hoặc `false` trong hoạt động bình thường       | `true` làm `/health` trả 503; chỉ thay trong bài diễn tập đã thống nhất với L                     |

## Source, quyền và dependency

- Source cần `dynamodb:GetItem` trên control table Tokyo và `dynamodb:PutItem` trên telemetry table Tokyo, cùng CloudWatch Logs permissions cho log group thực tế.
- Các policy JSON trong repo đang scope `ap-southeast-1`; chúng không cấp/chứng minh quyền cho Tokyo. L xác nhận policy hiệu lực và boundary trước khi deploy/test.
- `config/demo/ap-northeast-1.json` hiện khai báo `functions.api=mrapi-api` nhưng runbook/phân công nói `mrapi-proxy`. C phải xác nhận tên target trước khi tạo function hoặc cấp ARN; không tạo function trùng.
- Backend URL/endpoint/API records phải là cấu hình đã được A/C xác nhận. Không dùng endpoint Region Singapore trong cấu hình Tokyo.

## Bàn giao

Bàn giao ARN Tokyo, target mapping đã được C xác nhận, env không secret, artifact/hash/commit và test/log evidence cho C; L xác nhận IAM; A xác nhận bảng/backend dependencies. Chỉ đổi sang `DONE & VERIFIED` khi cấu hình live và test có bằng chứng.
