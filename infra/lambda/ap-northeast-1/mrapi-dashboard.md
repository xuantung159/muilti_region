# mrapi-dashboard — Tokyo (ap-northeast-1)

## Trạng thái và nguồn ghi nhận

- Người thực hiện: B
- Trạng thái AWS: ACTIVE
- Cập nhật hồ sơ: 25/10/2026.
- Source: `src/dashboard/index.mjs`, `src/dashboard/apis.mjs`, `src/shared/lib.mjs`.
- Cấu hình tham chiếu Region: `config/demo/ap-northeast-1.json`.

## Cấu hình cần đối chiếu trên AWS

| Thuộc tính                   | Giá trị tham chiếu                                                                                      |
| ---------------------------- | ------------------------------------------------------------------------------------------------------- |
| Function name                | `mrapi-dashboard`                                                                                       |
| Function ARN                 | arn:aws:lambda:ap-northeast-1::runtime:b7778d7d9d048df4a9bce496d1cc9424fe9844534468d732394872ce927254bc |
| Package                      | `artifacts/lambda/dashboard.zip`                                                                        |
| Handler                      | `dashboard/index.handler`                                                                               |
| Runtime / architecture       | Node.js 24.x / `arm64` theo phân công                                                                   |
| Execution role               | `mrapi-dashboard-role`; L xác nhận ARN, trust, policy, boundary và quyền Tokyo                          |
| Memory / timeout             | Runbook tham chiếu 256 MB / 10 giây                                                                     |
| VPC / layers                 | Chưa xác nhận; ghi cấu hình live, không tự thêm                                                         |
| Version / alias / CodeSha256 | Ghi phiên bản caller thực tế, alias và CodeSha256 sau deploy                                            |
| Log group                    | `/aws/lambda/mrapi-dashboard`                                                                           |
| X-Ray Active tracing         | đã bật                                                                                                  |

## Environment variables

| Tên                     | Giá trị/nguồn                                                                   | Source usage                                                                                              |
| ----------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `CONTROL_TABLE`         | `mrapi-control` theo `config/demo/ap-northeast-1.json`                          | Đọc/ghi tài khoản, session, API, key và usage data trong control table                                    |
| `PROJECT`               | `mrapi` theo `config/demo/global.json`                                          | Tạo prefix health check `<PROJECT>-hc-`                                                                   |
| `FRONTEND_URL`          | Chỉ dùng URL đã được C/L xác nhận; chưa có giá trị Tokyo chắc chắn trong config | Redirect từ `/` tới `/portal` khi được đặt                                                                |
| `PORTAL_ALLOWED_ORIGIN` | Chỉ dùng origin đã được C/L xác nhận                                            | CORS origin                                                                                               |
| `TELEMETRY_TABLE`       | Không được source hiện tại dùng để query telemetry                              | Dashboard lấy usage counters từ `CONTROL_TABLE`; không tự cấp quyền Query telemetry chỉ dựa trên tên biến |

## Source, quyền và dependency

- Dashboard dùng DynamoDB control-table actions theo các API của source (GetItem, PutItem, DeleteItem, Query). Đối chiếu release B1 và policy đã được L duyệt.
- Source có Route 53 health-check reads (`ListHealthChecks`, `GetHealthCheckStatus`) để hiển thị health checks mang prefix dự án; SDK client dùng `us-east-1`. L xác nhận role quyền này, nhưng B không tạo/sửa health checks.
- IAM JSON trong repo chỉ là tham chiếu và có scope Singapore; không chứng minh quyền bảng/logs Tokyo. Permission boundary cũng phải được L xác nhận.
- `config/demo/ap-northeast-1.json` chưa có API ID/base URL; C cung cấp endpoint/integration Tokyo. Không thay bằng URL Singapore.

## Bàn giao

Bàn giao ARN Tokyo, environment values không secret, artifact/hash/commit và test/log evidence cho C; L xác nhận IAM/boundary; A review các dependency dữ liệu. Chỉ đánh dấu `DONE & VERIFIED` sau khi có kiểm tra live và test phù hợp.
