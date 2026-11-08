# Role S3 replication

## Chức năng

Cho phép S3 đọc object nguồn và tạo bản sao tại bucket đích.

## Ứng dụng trong project

Hai role đang dùng phục vụ replication SG → Tokyo và Tokyo → SG; quyền giới hạn theo bucket và thao tác sao chép.

## Ý nghĩa các file cấu hình

| File | Mục đích |
|---|---|
| `mrapi-exports-sg.permission.json` | Action và ARN được phép; dùng đối chiếu policy quyền dữ liệu. |
| `mrapi-exports-tyo.permission.json` | Action và ARN được phép; dùng đối chiếu policy quyền dữ liệu. |
| `s3crr_role_for_mrapi-exports-sg.attachments.json` | Managed policy gắn vào role; rỗng không có nghĩa role không có inline policy. |
| `s3crr_role_for_mrapi-exports-sg.metadata.json` | ARN, path và trust để nhận diện role; không suy ra boundary từ trường bị thiếu. |
| `s3crr_role_for_mrapi-exports-tyo_1.attachments.json` | Managed policy gắn vào role; rỗng không có nghĩa role không có inline policy. |
| `s3crr_role_for_mrapi-exports-tyo_1.metadata.json` | ARN, path và trust để nhận diện role; không suy ra boundary từ trường bị thiếu. |
| `trust.json` | Service được assume role; không quy định quyền đọc/ghi dữ liệu. |

## Cấu hình và chi tiết

Các role dùng path `/service-role/`, không có boundary hoặc inline policy. Trust chung: [trust.json](trust.json).

| Role | Managed policy | Nội dung | Sử dụng |
|---|---|---|---|
| `s3crr_role_for_mrapi-exports-sg` | `s3crr_for_mrapi-exports-sg_f789ba` | [SG → Tokyo](mrapi-exports-sg.permission.json) | Rule SG |
| `s3crr_role_for_mrapi-exports-tyo_1` | `s3crr_for_mrapi-exports-tyo_56a4d3` | [Tokyo → SG](mrapi-exports-tyo.permission.json) | Rule Tokyo |

Rule Tokyo dùng role có hậu tố `_1`.
