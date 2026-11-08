# mrapi-authorizer-role

## Chức năng

Cấp quyền đọc dữ liệu xác thực và ghi log cho Lambda authorizer.

## Ứng dụng trong project

Cho authorizer đọc key và scope trong control ở hai Region, đồng thời ghi log từ chối và dữ liệu X-Ray; không cấp quyền ghi telemetry.

## Ý nghĩa các file cấu hình

| File | Mục đích |
|---|---|
| `attachments.json` | Managed policy gắn vào role; rỗng không có nghĩa role không có inline policy. |
| `permission.json` | Action và ARN được phép; dùng đối chiếu policy quyền dữ liệu. |
| `role-metadata.json` | ARN, path và trust để nhận diện role; không suy ra boundary từ trường bị thiếu. |
| `trust.json` | Service được assume role; không quy định quyền đọc/ghi dữ liệu. |

## Cấu hình và chi tiết

Role của Lambda kiểm tra `x-api-key` ở Singapore và Tokyo.

- ARN: `arn:aws:iam::138150704839:role/mrapi-authorizer-role`.
- Trust: `lambda.amazonaws.com`, xem [trust.json](trust.json).
- Boundary: `mrapi-workload-boundary`.
- Inline policy: `mrapi-authorizer-data-access`, xem [permission.json](permission.json).
- Không gắn managed policy.

## Quyền

GetItem và Query trên control hai Region; ghi log `/aws/lambda/mrapi-authorizer` và X-Ray. Code hiện dùng GetItem để đọc key, trạng thái và scope.

Authorizer không ghi telemetry. Request bị chặn 401/403 chỉ có log `AUTHORIZER_DENY`, không có dòng trong `mrapi-telemetry`; không cần PutItem cho role này.

Thiếu/sai key đã trả 401 ở hai Region. Key thật, scope và thu hồi xuyên Region chưa nghiệm thu đầy đủ. [Cấu hình Lambda](../../../lambda/ap-southeast-1/mrapi-authorizer.md).
