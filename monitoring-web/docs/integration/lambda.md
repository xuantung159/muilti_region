# Tích hợp AWS Lambda

Nguồn của ba dòng Lambda trên trang Multi-Region: invocations, errors, duration.

## Cần chuẩn bị

| Hạng mục | Giá trị |
|---|---|
| Tên hàm | Danh sách hàm ở từng Region (cùng tên ở hai Region nếu triển khai nhất quán) |
| Quyền IAM | `cloudwatch:GetMetricData` |

## Metric

Namespace `AWS/Lambda`, dimension `FunctionName`.

| Trường | Metric | Statistic |
|---|---|---|
| `lambda.invocations` | `Invocations` | `Sum`, cộng tất cả hàm |
| `lambda.errors` | `Errors` | `Sum`, cộng tất cả hàm |
| `lambda.durationAvgMs` | `Duration` | `Average` |

Lưu ý:

- `Errors` chỉ đếm lần hàm ném exception hoặc timeout. Hàm tự trả HTTP 500 một cách bình thường **không** được tính; con số đó nằm ở 5xx của API Gateway. Hai số này vì vậy thường khác nhau.
- Lambda authorizer cũng là một hàm. Nếu cộng nó vào, `invocations` sẽ lớn hơn số request. Quyết định có tính hay không và ghi rõ trong ghi chú của nguồn.
- Trung bình `Duration` của nhiều hàm phải tính có trọng số theo `Invocations`, hoặc hiển thị riêng từng hàm.
- Nên thêm `Throttles` vào backend khi mở rộng; dashboard chưa có ô hiển thị metric này.

## Kiểm tra

Trong Lambda Console, tab Monitor của từng hàm hiển thị cùng các metric. So tổng `Invocations` trong cùng khoảng thời gian với dashboard.
