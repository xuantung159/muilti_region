# mrapi-exporter-role

## Chức năng

Cấp quyền yêu cầu export DynamoDB và ghi kết quả vào S3.

## Ứng dụng trong project

Cho exporter xuất bảng telemetry tại Singapore tới bucket mrapi-exports-sg, kèm quyền ghi log và X-Ray.

## Ý nghĩa các file cấu hình

| File | Mục đích |
|---|---|
| `attachments.json` | Managed policy gắn vào role; rỗng không có nghĩa role không có inline policy. |
| `permission.json` | Action và ARN được phép; dùng đối chiếu policy quyền dữ liệu. |
| `role-metadata.json` | ARN, path và trust để nhận diện role; không suy ra boundary từ trường bị thiếu. |
| `trust.json` | Service được assume role; không quy định quyền đọc/ghi dữ liệu. |

## Cấu hình và chi tiết

Dùng cho export telemetry sang S3.

- ARN: `arn:aws:iam::138150704839:role/mrapi-exporter-role`.
- Trust: Lambda, [trust.json](trust.json).
- Inline policy: `mrapi-exporter-access`, [permission.json](permission.json).
- Boundary: `mrapi-workload-boundary`, default v3. File repo đã đồng bộ theo AWS.

Boundary v3 thêm AbortMultipartUpload và PutObjectAcl cho ProjectBuckets. Quyền X-Ray dùng Resource * vì không hỗ trợ ARN riêng; các statement khác giới hạn ARN.

Mô phỏng quyền: 10 action cần có allowed, 9 phép thử ngoài phạm vi implicitDeny. Lần invoke thật tạo export Completed và sao chép sang Tokyo.

Nếu gỡ, gỡ Lambda trước rồi xóa inline policy và role.
