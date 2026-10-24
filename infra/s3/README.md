# infra/s3

Cấu hình S3 đã làm trên AWS Console/CLI theo [GATEWAY_DESIGN.md](../../docs/GATEWAY_DESIGN.md). Thư mục này không tự tạo hay cập nhật tài nguyên AWS. Không lưu secret.

## Bucket

| Bucket | Region | Vai trò | Cấu hình đã lưu |
|---|---|---|---|
| `mrapi-exports-sg` | ap-southeast-1 | Nhận export telemetry; nguồn replication sang Tokyo | `ap-southeast-1/*.json` |
| `mrapi-exports-tyo` | ap-northeast-1 | Nhận bản chép từ Singapore; nguồn replication ngược sang Singapore | `ap-northeast-1/*.json` |
| `mrapi-web-sg` | ap-southeast-1 | Chứa `monitoring-web/dist`, CloudFront đọc qua OAC (L nối) | `ap-southeast-1/mrapi-web-sg/*.json`, [mô tả](ap-southeast-1/mrapi-web-sg.md) |

Cả ba bucket: Block Public Access bật đủ 4 cờ, mã hóa AES256. Hai bucket export bật versioning.

## Replication

| Chiều | Rule | Bộ lọc | Metrics |
|---|---|---|---|
| Singapore → Tokyo | `mrapi-sg-to-tyo` | prefix `exports/` | Bật (có metric `ReplicationLatency`), chưa bật Replication Time Control |
| Tokyo → Singapore | `mrapi-tyo-to-sg` | prefix `exports/` **và** tag `Project=mrapi` | Chưa bật |

Object do Export to S3 của DynamoDB không có tag, nên chiều Tokyo → Singapore chỉ chép object có gắn tag `Project=mrapi`. Dashboard sẽ hiện `not_configured` cho độ trễ S3 chiều Tokyo → Singapore vì rule chưa bật Metrics.

## Producer export (đã làm, 23/10/2026)

- Cách dùng: DynamoDB **Export to S3** từ bảng `mrapi-telemetry` (Singapore), PITR đã bật. Chạy thủ công bằng CLI, chưa chạy định kỳ.
- Lệnh: `aws dynamodb export-table-to-point-in-time --table-arn <ARN bảng telemetry> --s3-bucket mrapi-exports-sg --s3-prefix exports/telemetry/ --export-format DYNAMODB_JSON`
- Prefix phải bắt đầu bằng `exports/`, nếu không rule replication không chép.
- Kết quả: export `01792752415680-452d01dd`, trạng thái COMPLETED, 30 item, tạo 9 object dưới `exports/telemetry/AWSDynamoDB/01792752415680-452d01dd/`.

## Kiểm thử và bằng chứng

- R6, object có ở cả hai bucket: cả 9 object có `ReplicationStatus = COMPLETED` ở Singapore và đủ 9 object cùng đường dẫn, cùng kích thước ở `mrapi-exports-tyo` (lệnh `aws s3 ls` hai bucket, 23/10/2026)
- Thời gian chép: 3 lần đo bằng file nhỏ `exports/latency-test/run-N-<epoch>.txt`, từ lúc bắt đầu upload đến lúc `head-object` ở Tokyo thấy object: **23.8 s, 23.7 s, 23.8 s**. Đo từ CloudShell Singapore (gồm độ trễ mạng), chỉ 3 mẫu, không bật Replication Time Control nên AWS không cam kết thời gian
- Không dùng cột ngày giờ của `aws s3 ls` để suy ra thời gian chép: object nhân bản giữ nguyên giờ sửa đổi của bản gốc nên hai bucket hiện giờ giống hệt nhau
- Bằng chứng: ảnh output CloudShell (`describe-export`, vòng lặp `head-object`, hai lệnh `ls`, ba lần đo) cần bổ sung vào `docs/evidence/s3/`
- Chưa làm: export chạy định kỳ; đối chiếu với metric `ReplicationLatency` trên CloudWatch (xuất hiện chậm khoảng 15 phút); chiều Tokyo → Singapore chưa kiểm thử
