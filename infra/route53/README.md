# Triển khai Route 53 cho gateway Singapore và Tokyo

Trạng thái 17/10/2026: **chưa triển khai AWS**. Repo chưa ghi domain, hostedZoneId và API endpoint hai Region. Tài liệu này là hướng dẫn, không phải bằng chứng cấu hình đã xong.

## 1. Đầu vào cần có

| Đầu vào | Singapore | Tokyo |
|---|---|---|
| Region | ap-southeast-1 | ap-northeast-1 |
| API ID / stage | Chưa bàn giao / demo | Chưa bàn giao / demo |
| URL trực tiếp `/demo/health` | Chưa bàn giao | Chưa bàn giao |
| ACM certificate cho hostname API chung | Chưa bàn giao | Chưa bàn giao |
| Regional custom domain target | Chưa bàn giao | Chưa bàn giao |
| Target hosted zone ID của API Gateway | Chưa bàn giao | Chưa bàn giao |
| Health check ID | Chưa tạo | Chưa tạo |

Chốt domain sở hữu và hostname API trước, ví dụ `api.example.com` chỉ là minh họa. Không mua domain hoặc tạo public hosted zone trùng khi chưa kiểm tra tài nguyên có sẵn. Nếu mới có Singapore, triển khai DNS một Region trước; chưa tạo record Tokyo khi endpoint chưa hoạt động.

## 2. Kiểm tra API và health trước DNS

1. Từng Region phải có REST API Regional, stage đã deploy, `GET /health` gọi Lambda api, không yêu cầu API key/authorizer và không cache.
2. Gọi URL execute-api trực tiếp có stage: `/demo/health` phải trả HTTP 200 và JSON `status: ok`. Lambda hiện kiểm tra quyền truy cập bảng control; item HEALTH không cần tồn tại.
3. Nếu 403/404: kiểm tra route/stage/invoke permission. Nếu 503: kiểm tra role, biến CONTROL_TABLE, bảng và log. Chưa sửa health thì chưa cấu hình định tuyến hai Region.

## 3. Domain, ACM và custom domain API Gateway

1. Route 53 → Hosted zones: tiếp nhận public zone đúng domain. Nếu chưa có, tạo public hosted zone cho domain hoặc subdomain được giao; cấu hình NS delegation tại DNS cha/registrar tương ứng. Tạo zone không tự đăng ký domain hoặc đổi nameserver.
2. ACM ở Singapore: yêu cầu public certificate cho hostname API chung, dùng DNS validation. Thêm CNAME validation tại DNS có thẩm quyền, chờ Issued. Làm tương tự Tokyo nếu triển khai Region này.
3. API Gateway từng Region → Custom domain names: tạo **cùng hostname API chung**, endpoint Regional và chọn certificate đúng Region.
4. API mappings/base path mappings: map đường dẫn gốc tới REST API và stage `demo`. Với mapping gốc, URL chung là `/health`, `/api/...`, `/proxy/...`, không thêm `/demo` vào URL chung.
5. Ghi regional target domain và hosted zone ID do API Gateway cung cấp. Đây là đích Alias; không dùng URL có `https://` hoặc path, không tự suy ra target từ API ID.

## 4. Health check riêng từng Region

Route 53 → Health checks → Create health check, tạo một check cho mỗi endpoint đang hoạt động:

- Tên: `mrapi-sg-health` / `mrapi-tokyo-health`.
- Monitor endpoint, protocol HTTPS, port 443, chọn domain name của endpoint execute-api trực tiếp từng Region; không dùng hostname API chung đang được định tuyến.
- Path `/demo/health` với stage demo; dùng đúng stage thực tế nếu khác.
- Request interval 30 giây, failure threshold 3, bật SNI cho HTTPS.
- Chờ trạng thái Healthy trước khi gắn record. Không cần tạo A record cho endpoint execute-api AWS đã có DNS.

Endpoint trực tiếp phải còn được bật và truy cập công khai cho health checker. Nếu thiết kế tắt execute-api endpoint, cần health hostname riêng từng Region hoặc phương án health khác; không dùng hostname chung để thay thế.

## 5. Tạo record latency

Trong public hosted zone, tạo hai record khi cả hai Region sẵn sàng:

| Trường | Singapore | Tokyo |
|---|---|---|
| Record name | Hostname API chung | Cùng hostname |
| Type | A, Alias bật | A, Alias bật |
| Target | Regional custom domain target SG | Regional custom domain target Tokyo |
| Routing policy | Latency | Latency |
| Region | ap-southeast-1 | ap-northeast-1 |
| Record ID | mrapi-sg | mrapi-tokyo |
| Health check | Check SG | Check Tokyo |
| Evaluate target health | No; dùng health check riêng | No; dùng health check riêng |

Nếu chỉ có Singapore, dùng Simple A Alias tới custom domain Singapore; khi thêm Tokyo, kiểm tra và chuyển record cùng tên sang bộ Latency phù hợp, không tạo Simple và Latency chồng nhau. Alias tới API Gateway không đặt TTL tùy ý như record thường. Chỉ thêm AAAA khi endpoint/IP mode thực tế hỗ trợ.

Health check riêng kiểm tra đường đi tới ứng dụng; Evaluate target health đơn thuần không đủ phản ánh Lambda hoặc DynamoDB hỏng. Latency routing chọn Region theo độ trễ DNS, không bảo đảm chia đều traffic.

## 6. Kiểm thử và phục hồi

1. Kiểm tra NS delegation, DNS hostname chung và HTTPS certificate. Gọi hostname chung `/health`, portal và route ứng dụng; đối chiếu Region trong response/log.
2. Khi cả hai Region hoạt động và đã thống nhất cửa sổ test, đặt `HEALTH_FORCE_FAIL=true` ở Lambda api của một Region. Health trực tiếp phải trả 503; ghi thời điểm health check chuyển Unhealthy, DNS và request thực tế chuyển Region.
3. Khôi phục giá trị env ban đầu ngay sau test, đợi Healthy và kiểm tra lại. Lặp ba lần theo kế hoạch nhóm, ghi output đã che secret và thời gian thực tế.
4. Cache DNS/kết nối có thể làm request tiếp tục tới Region cũ. Không kết luận failover sau đúng 90 giây. Nếu mọi record đều unhealthy, Route 53 có thể vẫn trả endpoint theo cơ chế fail-open; health check không phải cơ chế chặn toàn bộ traffic.

## 7. Hồ sơ bàn giao

- `config/demo/global.json`: domain/hostedZoneId thực tế, ghi rõ domain là hostname API chung hay zone trong hồ sơ bên dưới.
- `config/demo/<region>.json`: API ID/stage/baseUrl trực tiếp thực tế; giữ URL execute-api để kiểm thử từng Region.
- Lưu tại thư mục này: `deployment.md` (zone/domain/NS delegation, mapping, certificate ARN, target/target zone ID, record policy, health ID/parameters, người làm/ngày), bản xuất record/health config và link bằng chứng. Chỉ tạo hồ sơ triển khai sau khi có giá trị thật.
- Cập nhật trạng thái Route 53 trong `docs/WORK_ASSIGNMENT.md` sau khi đã lưu cấu hình; không đánh dấu xong chỉ vì đã có hướng dẫn.

## Nguồn AWS

- [Trỏ domain tới API Gateway](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/routing-to-api-gateway.html).
- [Health check cho failover API Gateway](https://docs.aws.amazon.com/apigateway/latest/developerguide/dns-failover.html).
- [Thông số health check](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/health-checks-creating-values.html).
- [Latency Alias](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/resource-record-sets-values-latency-alias.html).
- [Xác định trạng thái endpoint](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/dns-failover-determining-health-of-endpoints.html).


