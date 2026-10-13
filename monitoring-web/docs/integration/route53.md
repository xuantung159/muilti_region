# Tích hợp Amazon Route 53

Nguồn của trạng thái health check và thông tin định tuyến. Đây cũng là phần dễ bị diễn giải quá mức nhất, nên tài liệu này nêu rõ điều gì được phép kết luận.

## Cần chuẩn bị

| Hạng mục | Giá trị |
|---|---|
| Health check ID | Một ID cho mỗi Region |
| Quyền IAM | `route53:GetHealthCheckStatus`, `route53:ListHealthChecks`; thêm `route53:ListResourceRecordSets` nếu muốn đọc chính sách định tuyến |
| Region của API | Route 53 là dịch vụ toàn cục; tạo client với `us-east-1` |

## Trạng thái health check

Có hai cách, chọn một:

| Cách | Gọi | Ghi chú |
|---|---|---|
| API Route 53 | `GetHealthCheckStatus` | Trả kết quả của từng checker. Coi là `healthy` khi đa số checker báo thành công |
| CloudWatch | Namespace `AWS/Route53`, metric `HealthCheckStatus`, dimension `HealthCheckId`, client ở `us-east-1` | Giá trị 1 là healthy, 0 là unhealthy; có lịch sử theo thời gian |

Điền vào `healthCheck` của Region tương ứng. Không đọc được thì trả `missing`, và dashboard sẽ hiện Region đó là `Unknown`.

## Chính sách định tuyến

`routingPolicy` là một chuỗi mô tả. Có thể đặt cố định theo cấu hình đã triển khai, hoặc đọc bằng `ListResourceRecordSets` và kiểm tra record có `Region` (latency-based) và `HealthCheckId`.

## Tỷ lệ traffic

Route 53 không cung cấp số liệu "bao nhiêu phần trăm truy vấn được trả về Region nào" cho record thông thường. `trafficSharePct` lấy từ số request của API Gateway ở từng Region (xem [api-gateway.md](api-gateway.md)). Đây là traffic thực nhận, không phải quyết định của DNS.

## Sự kiện failover

Để trang Failover & Incidents có sự kiện loại `aws`:

1. Đọc lịch sử `HealthCheckStatus` từ CloudWatch. Mỗi lần giá trị từ 1 về 0 là `startedAt` của một sự kiện `incident`; lần trở lại 1 là `endedAt`.
2. Sự kiện `traffic_shift` chỉ tạo khi số request của Region đó thực sự giảm trong cùng khoảng thời gian.

## Điều được và không được kết luận

| Quan sát | Kết luận được phép |
|---|---|
| Health check chuyển unhealthy | Route 53 **sẽ ngừng trả** Region đó cho truy vấn DNS mới |
| Request của Region đó về 0, Region kia tăng | Traffic **đã** chuyển |
| Chỉ có quan sát thứ nhất | Chưa chứng minh failover thành công |

Thời gian chuyển hướng thực tế gồm chu kỳ health check, ngưỡng lỗi và TTL của DNS, cộng với cache ở phía client. Con số này phải do nhóm đo bằng script và ghi vào dashboard dưới nhãn `Manual test`; không suy ra từ trạng thái health check.

## Kiểm tra

Cho `/health` của một Region trả 503, theo dõi health check trong Route 53 Console và kiểm tra dashboard đổi trạng thái Region đó trong vòng một chu kỳ refresh sau khi Console đổi.
