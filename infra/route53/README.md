# Route 53

## Chức năng

Phân giải tên miền và chọn endpoint theo chính sách DNS, độ trễ và health check.

## Ứng dụng trong project

Đưa client của api.multi-region.io.vn tới Region phù hợp còn khỏe; app.multi-region.io.vn trỏ CloudFront. Route 53 không chuyển tiếp HTTP request như một proxy.

## Ý nghĩa các file cấu hình

| File | Ý nghĩa và cách dùng |
|---|---|
| `multi-region.io.vn.records.json` | NS/SOA, app/API và CNAME xác thực ACM thuộc dự án. Danh sách đã lọc, không phải toàn bộ hosted zone. |
| `api-latency-records.json` | Riêng hai Alias Latency của API: target, Region và health check. Dùng xem nhanh cấu hình định tuyến. |
| `health-checks.json` | Endpoint, path, interval và failure threshold của health check. Dùng kiểm tra điều kiện chọn Region; không phải kết quả test failover. |

Các thư mục Region dùng cấu trúc tương tự. File đối chiếu có thể chứa trường chỉ đọc; cần chọn đúng trường và định dạng input trước khi dùng với AWS CLI. Sửa file trong repo không tự thay đổi tài nguyên AWS.

## Cấu hình và chi tiết

Domain đang dùng: `multi-region.io.vn`. Frontend ở [app.multi-region.io.vn](https://app.multi-region.io.vn/portal), API ở [api.multi-region.io.vn/health](https://api.multi-region.io.vn/health).

Thông số zone, target và chứng chỉ ở [cấu hình domain](multi-region.io.vn.md); record API ở [api-latency-records.json](api-latency-records.json).

## Cách định tuyến

Hai A Alias cùng tên `api.multi-region.io.vn` dùng Latency routing. Mỗi record trỏ tới custom domain API Gateway của một Region và gắn health check riêng.

- SG: `mrapi-sg`, Region `ap-southeast-1`.
- Tokyo: `mrapi-tokyo`, Region `ap-northeast-1`.
- EvaluateTargetHealth: false vì đã gắn health check ứng dụng.
- Latency routing không bảo đảm chia đều traffic.

Custom domain map gốc tới stage `demo`. URL chung dùng `/health`, không thêm `/demo`; URL execute-api trực tiếp vẫn có stage.

## Health check

Mỗi check gọi HTTPS tới endpoint execute-api riêng, port 443, SNI bật, chu kỳ 30 giây, failure threshold 3, path `/demo/health`.

Không dùng hostname API chung làm đích health check vì hostname đó đang được định tuyến. Giữ execute-api endpoint bật để checker truy cập.

Nếu health trả 403/404, kiểm tra route, stage và quyền invoke. Nếu 503, kiểm tra Lambda, CONTROL_TABLE, quyền DynamoDB và log.

## Kiểm thử

DNS đã phân giải qua resolver mặc định, Google, Cloudflare và authoritative; HTTPS trả 200 ở cả hai Region. Ba chứng chỉ ACM có trạng thái ISSUED, ELIGIBLE.

Failover đã đo 3 lần mỗi chiều bằng lỗi health mô phỏng. Chiều SG → Tokyo: client chuyển sau 2:25–2:37, quay về sau 1:59–2:26.

Khi đo lại, ghi thời điểm bật `HEALTH_FORCE_FAIL=true`, checker đổi trạng thái và client chuyển Region. Gỡ biến sau test, chờ Healthy rồi kiểm tra lại. Cache DNS/kết nối làm thời gian chuyển khác nhau; không kết luận mất toàn Region hoặc zero downtime từ bài test này. Khi mọi đích đều unhealthy, Route 53 có thể vẫn trả endpoint theo fail-open.

Tài liệu AWS: [Alias tới API Gateway](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/routing-to-api-gateway.html), [health check](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/health-checks-creating-values.html), [Latency Alias](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/resource-record-sets-values-latency-alias.html).

