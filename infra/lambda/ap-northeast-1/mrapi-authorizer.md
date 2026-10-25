# mrapi-authorizer — Tokyo (ap-northeast-1)

## Trạng thái và nguồn ghi nhận

- Người thực hiện: B
- Trạng thái AWS: ACTIVE
- Cập nhật hồ sơ: 25/10/2026.
- Source: `src/authorizer/index.mjs`, `src/shared/lib.mjs`.
- Cấu hình tham chiếu Region: `config/demo/ap-northeast-1.json`.

## Cấu hình cần đối chiếu trên AWS

| Thuộc tính                   | Giá trị tham chiếu                                                                                      |
| ---------------------------- | ------------------------------------------------------------------------------------------------------- |
| Function name                | `mrapi-authorizer`                                                                                      |
| Function ARN                 | arn:aws:lambda:ap-northeast-1::runtime:b7778d7d9d048df4a9bce496d1cc9424fe9844534468d732394872ce927254bc |
| Package                      | `artifacts/lambda/authorizer.zip`                                                                       |
| Handler                      | `authorizer/index.handler`                                                                              |
| Runtime / architecture       | Node.js 24.x / `arm64` theo phân công                                                                   |
| Execution role               | `mrapi-authorizer-role`; L xác nhận role/ARN, trust, policy, boundary và quyền Tokyo                    |
| Memory / timeout             | 128–256 MB / 5 giây theo runbook                                                                        |
| VPC / layers                 | Chưa xác nhận; ghi cấu hình live, không tự thêm                                                         |
| Version / alias / CodeSha256 | Ghi phiên bản caller thực tế, alias và CodeSha256 sau deploy                                            |
| Log group                    | `/aws/lambda/mrapi-authorizer`                                                                          |
| X-Ray Active tracing         | đã bật                                                                                                  |

## Environment variables

| Tên               | Giá trị tham chiếu Tokyo | Ghi chú                                                                                         |
| ----------------- | ------------------------ | ----------------------------------------------------------------------------------------------- |
| `CONTROL_TABLE`   | `mrapi-control`          | Tên logic bảng trong `config/demo/ap-northeast-1.json`; xác nhận bảng Tokyo đang `ACTIVE` với A |
| `TELEMETRY_TABLE` | `mrapi-telemetry`        | Theo yêu cầu phân công B; handler hiện tại không đọc/ghi telemetry                              |
| `PROJECT`         | `mrapi`                  | Theo `config/demo/global.json` và phân công; handler hiện tại không dùng biến này               |

Không đưa ARN Singapore vào cấu hình quyền Tokyo. Dùng tên bảng regional/global table đã xác nhận; AWS SDK của Lambda chọn Region runtime (`ap-northeast-1`).

## Source, quyền và dependency

- Handler xác thực API key bằng `GetItem` trên `CONTROL_TABLE`, với khóa tenant/key và consistent read. Không ghi telemetry.
- Role cần quyền DynamoDB `GetItem` trên bảng control Tokyo và quyền CloudWatch Logs phù hợp với `/aws/lambda/mrapi-authorizer`. L phải xác nhận policy hiệu lực; file policy trong repo đang scope ARN Singapore, không chứng minh quyền Tokyo.
- API Gateway authorizer, identity source, cache, route và Lambda invoke permission do C quản lý. Cần chốt tên integration target vì `config/demo/ap-northeast-1.json` hiện ghi `functions.api=mrapi-api`, trong khi phân công B gọi function proxy là `mrapi-proxy`.
- Không ghi API key, hash của key, token hoặc secret vào log/evidence/repository.

## Bàn giao

Bàn giao ARN Tokyo, cấu hình đã đối chiếu, artifact/hash/commit, test/log evidence cho C và reviewer A. L xác nhận role và quyền Tokyo; C xác nhận authorizer/integration. Chỉ đổi trạng thái sang `DONE & VERIFIED` sau khi có bằng chứng cấu hình live và test.
