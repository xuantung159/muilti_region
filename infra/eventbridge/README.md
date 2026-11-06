# EventBridge

## Chức năng

Kích hoạt tác vụ tự động theo lịch hoặc sự kiện.

## Ứng dụng trong project

Gọi Lambda exporter tại Singapore lúc 01:00 giờ Việt Nam hằng ngày để yêu cầu xuất telemetry từ DynamoDB sang S3.

## Ý nghĩa các file cấu hình

| File | Ý nghĩa và cách dùng |
|---|---|
| `ap-southeast-1/mrapi-export-daily.json` | Rule chứa lịch và trạng thái; Targets chứa Lambda được gọi. Dùng đối chiếu tác vụ export. Khi dựng lại phải tách input cho put-rule và put-targets. |

Các thư mục Region dùng cấu trúc tương tự. File đối chiếu có thể chứa trường chỉ đọc; cần chọn đúng trường và định dạng input trước khi dùng với AWS CLI. Sửa file trong repo không tự thay đổi tài nguyên AWS.

## Cấu hình và chi tiết

Lịch export telemetry chỉ chạy tại Singapore.

| Thuộc tính | Giá trị |
|---|---|
| Rule | `mrapi-export-daily` |
| Event bus | `default` |
| Trạng thái | ENABLED |
| Lịch | `cron(0 18 * * ? *)` |
| Giờ Việt Nam | 01:00 hôm sau |
| Target ID | `mrapi-exporter` |
| Target ARN | `arn:aws:lambda:ap-southeast-1:138150704839:function:mrapi-exporter` |

[Rule và target](ap-southeast-1/mrapi-export-daily.json). Quyền invoke nằm trong [resource policy Lambda](../lambda/ap-southeast-1/mrapi-exporter.resource-policy.json).

Rule không cấu hình Input, RetryPolicy hoặc DeadLetterConfig riêng trong target trả về. Không thấy rule mrapi ở Tokyo. Rule ENABLED không tự chứng minh lần export gần nhất đã hoàn tất.
