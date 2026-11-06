# Quyền IAM giữa hai Region

## Chức năng

Mô tả phạm vi quyền mà các Lambda cần ở hai Region.

## Ứng dụng trong project

Dùng để đối chiếu quyền truy cập bảng, log và X-Ray khi triển khai cùng ứng dụng tại Singapore và Tokyo.

## Cấu hình và chi tiết

Các role Lambda dùng ARN tài nguyên của Singapore và Tokyo. Cấu hình chung ở [IAM](../README.md).

| Role | Inline policy | Quyền chính |
|---|---|---|
| proxy | `mrapi-proxy-data-access` | Đọc control, ghi telemetry, log và X-Ray |
| authorizer | `mrapi-authorizer-data-access` | Đọc key/scope, ghi log và X-Ray |
| dashboard | `mrapi-dashboard-access` | Quản lý tài khoản, API, key |
| dashboard | `ReadTelemetry` | Query telemetry hai Region |
| monitoring | `Policymrapi-monitoring-access` | Đọc metric, health check và telemetry |

Trust cho phép Lambda assume role. Boundary `mrapi-workload-boundary` giới hạn quyền workload. JSON của từng role nằm trong thư mục tương ứng.
