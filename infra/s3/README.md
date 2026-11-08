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

