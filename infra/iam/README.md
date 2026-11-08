# IAM

## Chức năng

Quản lý danh tính và quyền truy cập tài nguyên AWS.

## Ứng dụng trong project

Cấp quyền cho thành viên và execution role của Lambda, API Gateway, S3 replication. Trust xác định ai được assume role; policy và boundary giới hạn thao tác, tài nguyên.

## Ý nghĩa các file cấu hình

| File | Ý nghĩa và cách dùng |
|---|---|
| `policies/mrapi-dev-iam.json` | Quyền IAM cho thành viên phát triển trong phạm vi dự án. |
| `policies/mrapi-dev-services.json` | Quyền và giới hạn sử dụng các dịch vụ AWS của nhóm phát triển. |
| `policies/mrapi-force-mfa.json` | Yêu cầu MFA cho các thao tác được bảo vệ; giữ nguyên biến aws:username. |
| `policies/mrapi-region-guardrail.json` | Giới hạn thao tác theo Region và các ngoại lệ dịch vụ toàn cục. |
| `policies/mrapi-workload-boundary.json` | Trần quyền cho execution role. Boundary không tự cấp quyền; còn phải có permission policy cho phép. |
| `roles/*/trust.json` | Ai hoặc service nào được assume role, ví dụ Lambda hay API Gateway. Đây không phải quyền đọc/ghi dữ liệu. |
| `roles/*/permission.json` | Inline policy quy định action và ARN tài nguyên mà role được dùng. |
| `roles/mrapi-dashboard-role/ReadTelemetry.permission.json` | Policy riêng cho dashboard Query bảng telemetry. Tách đúng với inline policy trên AWS. |
| `roles/*/attachments.json` | Tên và ARN managed policy gắn vào role. Danh sách rỗng nghĩa không có managed policy, không có nghĩa role không có inline policy. |
| `roles/*/role-metadata.json` | ARN, path, trust và thông tin role để đối chiếu. Bản lấy từ list_roles không trả đầy đủ boundary. |
| `roles/s3crr/*.permission.json` | Quyền sao chép object SG → Tokyo và Tokyo → SG, giới hạn theo bucket. |
| `roles/s3crr/*.metadata.json`, `*.attachments.json` | Nhận diện đúng role replication và managed policy đi kèm; Tokyo dùng tên có hậu tố _1. |

Các thư mục Region dùng cấu trúc tương tự. File đối chiếu có thể chứa trường chỉ đọc; cần chọn đúng trường và định dạng input trước khi dùng với AWS CLI. Sửa file trong repo không tự thay đổi tài nguyên AWS.

## Cấu hình và chi tiết

File JSON lưu cấu hình để kiểm tra và dựng lại; sửa file không tự đổi quyền trên AWS.

## User và group

| Group | User | Policy |
|---|---|---|
| `mrapi-admins` | `admin` | `mrapi-force-mfa`, `mrapi-region-guardrail`, `AdministratorAccess` |
| `mrapi-developers` | `ducminh`, `phamtoan`, `thenhan`, `test` | `mrapi-force-mfa`, `mrapi-dev-iam`, `mrapi-region-guardrail`, `mrapi-dev-services`, `PowerUserAccess` |

Cả 5 user và root có MFA, không có access key. Developer vẫn có quyền rộng trong hai Region; chưa rà từng action.

## Policy

Các file trong `policies/` trùng tên policy AWS.

- `mrapi-dev-iam`: quyền IAM thành viên.
- `mrapi-dev-services`: quyền dịch vụ, theo v4.
- `mrapi-force-mfa`: yêu cầu MFA; giữ nguyên biến `${aws:username}`.
- `mrapi-region-guardrail`: giới hạn Region.
- `mrapi-workload-boundary`: trần quyền workload, default v3, dùng cho 6 role.

Boundary v3 thêm `s3:AbortMultipartUpload` và `s3:PutObjectAcl` trong `ProjectBuckets`. File repo dùng cùng phiên bản với AWS.

## Role

| Role | Dùng cho |
|---|---|
| `mrapi-proxy-role` | Đọc control, ghi telemetry, log và X-Ray |
| `mrapi-authorizer-role` | Đọc key/scope, ghi log và X-Ray |
| `mrapi-dashboard-role` | Tài khoản, API, key và thống kê portal |
| `mrapi-monitoring-role` | Metric, health check và telemetry |
| `mrapi-exporter-role` | Export DynamoDB sang S3 |
| `mrapi-apigateway-cloudwatch-role` | API Gateway ghi log |
| `s3crr_*` | S3 replication |

Trust và permission nằm trong từng thư mục `roles/`. Dashboard tách hai inline policy: `permission.json` cho `mrapi-dashboard-access`, `ReadTelemetry.permission.json` cho `ReadTelemetry`.

## Khi cập nhật

Chép đúng trust, policy và boundary đang áp dụng. ARN role dùng chung lưu ở [config](../../config/demo/global.json). Không thay bản thực tế bằng policy mẫu.

Không lưu password, secret key, token hoặc QR MFA. [Hướng dẫn đăng nhập](../../docs/dang-nhap-mfa.md).

