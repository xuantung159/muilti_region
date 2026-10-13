# Tích hợp Amazon API Gateway

Nguồn của số request, tỷ lệ lỗi và latency theo Region, và của bảng endpoint.

## Cần chuẩn bị

| Hạng mục | Giá trị |
|---|---|
| API ID và stage | Của API ở từng Region (hai giá trị khác nhau) |
| Quyền IAM | `cloudwatch:GetMetricData`; thêm `apigateway:GET` nếu muốn tự liệt kê route |
| Bật thêm | Detailed metrics trên stage, nếu cần số liệu theo từng route |

Hiện tại backend của dự án còn chạy bằng Lambda Function URL. Function URL không sinh metric của API Gateway, nên nguồn này chỉ kết nối được sau khi chuyển sang API Gateway.

## Metric

Namespace `AWS/ApiGateway`. Tên metric khác nhau giữa hai loại API:

| Nội dung | HTTP API | REST API |
|---|---|---|
| Số request | `Count` | `Count` |
| Lỗi phía client | `4xx` | `4XXError` |
| Lỗi phía server | `5xx` | `5XXError` |
| Latency | `Latency` | `Latency` |
| Dimension | `ApiId`, `Stage` | `ApiName`, `Stage` |

Hãy xác nhận tên metric và dimension thực tế trong CloudWatch Console trước khi viết truy vấn.

## Ánh xạ

| Trường | Cách tính |
|---|---|
| `requests`, `apiGateway.requests` | `Sum` của `Count` |
| `apiGateway.error4xx`, `apiGateway.error5xx` | `Sum` của metric lỗi tương ứng |
| `errorRatePct` | (4xx + 5xx) / Count × 100 |
| `successRatePct` | 100 − `errorRatePct` |
| `latencyAvgMs` | `Average` của `Latency` |
| `latencyP95Ms` | `p95` của `Latency`, `Period` bằng cả khoảng xem |
| `trafficSharePct` | Count của Region này / tổng Count hai Region, tính trên ô thời gian gần nhất đã đủ dữ liệu |

`Latency` đo từ lúc API Gateway nhận request đến lúc trả response, không gồm thời gian mạng từ người dùng. Ghi rõ điều này nếu đưa số liệu vào báo cáo.

## Bảng endpoint (`/monitoring/endpoints`)

1. Bật detailed metrics trên stage của từng Region. Việc này làm tăng số metric và chi phí CloudWatch.
2. Truy vấn cùng các metric trên với dimension theo route (kiểm tra tên dimension trong Console, vì khác nhau giữa HTTP API và REST API).
3. Mỗi cặp (route, Region) là một dòng `EndpointStat`.

Chưa bật detailed metrics thì trả mảng rỗng; dashboard sẽ hiện empty state thay vì số liệu suy đoán.

## Kiểm tra

Gọi thử 10 request vào một Region, chờ khoảng 3 phút, rồi kiểm tra `requests` của Region đó trên dashboard tăng đúng 10 và Region kia không đổi.
