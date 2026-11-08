# X-Ray

## Chức năng

Thu thập trace để xem đường đi và thời gian xử lý của request.

## Ứng dụng trong project

Tracing trên API Gateway và Lambda hỗ trợ tìm chặng chậm hoặc lỗi. Sampling chỉ thu một phần request; dashboard chưa tích hợp nguồn X-Ray.

## Ý nghĩa các file cấu hình

| File | Ý nghĩa và cách dùng |
|---|---|
| `<region>/sampling.json` | Sampling rule gồm fixed rate, reservoir, priority và bộ lọc. Dùng kiểm tra request nào được chọn lấy trace; không chứa trace của request thật. |

Các thư mục Region dùng cấu trúc tương tự. File đối chiếu có thể chứa trường chỉ đọc; cần chọn đúng trường và định dạng input trước khi dùng với AWS CLI. Sửa file trong repo không tự thay đổi tài nguyên AWS.

## Cấu hình và chi tiết

Chín Lambda bật tracing Active. Stage demo của hai API Gateway bật tracingEnabled.

Sampling dùng rule Default: FixedRate 0.05, ReservoirSize 1, Priority 10000, các trường lọc wildcard. Không thấy rule tùy chỉnh trong kết quả đọc.

[Sampling SG](ap-southeast-1/sampling.json), [Tokyo](ap-northeast-1/sampling.json). Trạng thái tracing xem config Lambda và stage trong các thư mục tương ứng.

Sampling không thu mọi request. Dashboard chưa tích hợp nguồn X-Ray; bật tracing không tự chứng minh trace, log và telemetry đã khớp requestId.
