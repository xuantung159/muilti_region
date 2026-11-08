# Quota Lambda

## Chức năng

Xác định giới hạn số lượt thực thi Lambda đồng thời trong mỗi Region.

## Ứng dụng trong project

Giúp chọn mức tải và tần suất polling phù hợp vì các Lambda cùng Region dùng chung quota; cần xem xét tăng giới hạn trước khi thử tải.

## Ý nghĩa các file cấu hình

| File | Ý nghĩa và cách dùng |
|---|---|
| `<region>/lambda.json` | Quota concurrent executions, mã quota và khả năng yêu cầu tăng. Dùng xác định giới hạn tải; sửa JSON không thay quota AWS. |

Các thư mục Region dùng cấu trúc tương tự. File đối chiếu có thể chứa trường chỉ đọc; cần chọn đúng trường và định dạng input trước khi dùng với AWS CLI. Sửa file trong repo không tự thay đổi tài nguyên AWS.

## Cấu hình và chi tiết

| Region | Concurrent executions |
|---|---|
| Singapore | 10 |
| Tokyo | 10 |

Quota code `L-B99A9384`, phạm vi account theo từng Region, cho phép yêu cầu tăng. Proxy, authorizer, dashboard và monitoring dùng chung giới hạn của Region; SG có thêm exporter.

[Cấu hình SG](ap-southeast-1/lambda.json), [Tokyo](ap-northeast-1/lambda.json). Giới hạn này khác throttle API Gateway. Khi vượt concurrency, integration có thể lỗi dù API Gateway chưa vượt rate limit.
