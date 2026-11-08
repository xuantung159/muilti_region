# mrapi-exporter — Singapore

## Chức năng

Gửi yêu cầu xuất bảng DynamoDB sang S3.

## Ứng dụng trong project

Nhận lịch EventBridge, yêu cầu export telemetry vào bucket Singapore rồi kết thúc. DynamoDB thực hiện export bất đồng bộ; S3 sao chép kết quả sang Tokyo.

## Ý nghĩa các file cấu hình

| File | Mục đích |
|---|---|
| `mrapi-exporter.config.json` | Thông số chạy của hàm: handler, runtime, role, tài nguyên, tracing và tên env. |
| `mrapi-exporter.resource-policy.json` | Quyền API Gateway hoặc EventBridge gọi hàm; giới hạn bằng service principal và SourceArn. |
| `mrapi-exporter.tags.json` | Tag quản lý tài nguyên. Không chứa secret hay mã nguồn. |

## Cấu hình và chi tiết

Chỉ triển khai tại Singapore. ARN `arn:aws:lambda:ap-southeast-1:138150704839:function:mrapi-exporter`.

## Cấu hình

| Thuộc tính | Giá trị |
|---|---|
| Tên | `mrapi-exporter` |
| Gói / handler | `artifacts/lambda/exporter.zip` / `exporter/index.handler` |
| SHA-256 gói | `9C78B0D231E99AE9641396F58110B2955114464B47728DE1C8487DA1BEBA06E8` |
| `CodeSha256` trên Lambda | `nHiw0jHpmulkE5b1gRCylVEURktHco3hyEh9ob66Bug=` |
| Runtime / kiến trúc | Node.js 24.x / arm64 |
| Role | `mrapi-exporter-role` |
| Memory / timeout | 128 MB / 15 giây |
| Tracing / log | Active / log group `/aws/lambda/mrapi-exporter`, giữ 14 ngày |
| `TABLE_ARN` | `arn:aws:dynamodb:ap-southeast-1:138150704839:table/mrapi-telemetry` |
| `EXPORT_BUCKET` | `mrapi-exports-sg` |
| `EXPORT_PREFIX` | `exports/telemetry/` (code bỏ dấu `/` cuối cho khớp export cũ) |

## Hành vi

Mỗi lần chạy gửi một `ExportTableToPointInTime` (FULL_EXPORT, DYNAMODB_JSON) rồi kết thúc, không chờ export xong và không đọc dữ liệu bảng. Lỗi AWS được ném lại để metric `Errors` ghi nhận.

`ClientToken` dùng ngày UTC: `mrapi-telemetry-YYYY-MM-DD`. Retry dùng lại token; không coi đây là bảo đảm chỉ một export mỗi ngày vì token có thời hạn, cần kiểm tra khi chạy lại ngoài cửa sổ hiệu lực.

Lần chạy đo được: 1,09 giây, bộ nhớ dùng 96/128 MB, init 325 ms.

## Lịch và alarm

- EventBridge `mrapi-export-daily`, `cron(0 18 * * ? *)`, ENABLED, target `mrapi-exporter`, resource policy chỉ cho đúng ARN rule. Lịch chạy tương ứng 01:00 hôm sau giờ Việt Nam.
- Alarm `mrapi-sg-exporter-errors`, `AWS/Lambda` `Errors` theo `FunctionName`, Sum, 60 giây, ngưỡng >= 1, 1/1 datapoint, `notBreaching`, gửi `mrapi-alerts` SG.

## Gỡ khi không dùng

Chạy theo thứ tự, Region `ap-southeast-1`:

```
aws events remove-targets --rule mrapi-export-daily --ids mrapi-exporter --region ap-southeast-1
aws events delete-rule --name mrapi-export-daily --region ap-southeast-1
aws cloudwatch delete-alarms --alarm-names mrapi-sg-exporter-errors --region ap-southeast-1
aws lambda delete-function --function-name mrapi-exporter --region ap-southeast-1
aws logs delete-log-group --log-group-name /aws/lambda/mrapi-exporter --region ap-southeast-1
```
