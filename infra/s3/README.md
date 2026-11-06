# S3

## Chức năng

Lưu object và sao chép object giữa các bucket.

## Ứng dụng trong project

Bucket web giữ giao diện private cho CloudFront. Hai bucket export giữ kết quả xuất telemetry và sao chép hai chiều; lifecycle dọn multipart, version cũ.

## Ý nghĩa các file cấu hình

| File | Ý nghĩa và cách dùng |
|---|---|
| `<region>/versioning.json` | Trạng thái versioning của bucket export. Dùng kiểm tra điều kiện replication và khả năng giữ nhiều phiên bản object. |
| `<region>/encryption.json` | Mã hóa mặc định và các tùy chọn encryption của bucket export. |
| `<region>/public-access-block.json` | Các cờ chặn public access. Dùng giữ bucket export không bị công khai. |
| `<region>/replication.json` | Rule, role, bucket đích, filter và metrics cho từng chiều sao chép. |
| `<region>/lifecycle.json` | Cấu hình lifecycle thực tế theo bucket: dọn multipart và version cũ. |
| `lifecycle.json` | Input rule lifecycle chung để áp vào bucket export; chỉ tác động prefix telemetry, không tự xóa version hiện hành. |
| `mrapi-web-sg/*.json` | Versioning, encryption và public access block của bucket frontend. Policy cho CloudFront đọc nằm tại ../cloudfront/mrapi-web-sg.bucket-policy.json. |

Các thư mục Region dùng cấu trúc tương tự. File đối chiếu có thể chứa trường chỉ đọc; cần chọn đúng trường và định dạng input trước khi dùng với AWS CLI. Sửa file trong repo không tự thay đổi tài nguyên AWS.

## Cấu hình và chi tiết

Hai bucket export dùng replication hai chiều.

| Bucket | Region | Rule | Filter | Role |
|---|---|---|---|---|
| `mrapi-exports-sg` | ap-southeast-1 | `mrapi-sg-to-tyo` | Prefix `exports/` | `s3crr_role_for_mrapi-exports-sg` |
| `mrapi-exports-tyo` | ap-northeast-1 | `mrapi-tyo-to-sg` | Mọi object | `s3crr_role_for_mrapi-exports-tyo_1` |

Cả hai bật versioning, rule Enabled, S3 Metrics bật. Không chép delete marker, không dùng RTC nên không cam kết thời gian sao chép. Object REPLICA không bị chép ngược thành vòng lặp.

Rule Tokyo rộng hơn thiết kế cũ; [replication.json](ap-northeast-1/replication.json) đã sửa theo AWS, gồm role hậu tố `_1`.

## Metric và lifecycle

Metric ReplicationLatency của SG → Tokyo nằm ở Region đích `ap-northeast-1`; backend truy vấn metric tại Region này. Tokyo → SG đã bật metrics nhưng backend monitoring còn cấu hình/nhãn cũ, cần cập nhật.

[Lifecycle](lifecycle.json) `mrapi-telemetry-cleanup` chỉ áp dụng `exports/telemetry/`: dọn multipart sau 7 ngày, xóa version cũ sau 30 ngày. Version hiện hành được giữ nên dung lượng vẫn tăng theo ngày.

## Export

Lambda `mrapi-exporter` chạy hằng ngày lúc 18:00 UTC, tức 01:00 hôm sau giờ Việt Nam. Export đã tạo object tại SG và sao chép sang Tokyo.

Còn file tên `exports/ducminh_credentials.csv` ở SG; chưa mở nội dung. Cần kiểm tra kín và xử lý nếu là credential thật, kể cả các version và bản sao Tokyo.

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
