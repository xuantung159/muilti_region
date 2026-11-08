# Kiểm thử Route 53 latency và health checks — 27/10/2026 22:39 UTC+7

## Kết quả

- Console Route 53: mrapi-sg-health và mrapi-tokyo-health đều Enabled, Healthy; biểu đồ hiện Healthy 3 giờ 26 phút, Unhealthy 0 phút tại lúc đọc.
- DNS A api.multi-region.io.vn qua 8.8.8.8 trả 52.74.58.114, qua 1.1.1.1 và NS authoritative trả 47.128.196.219; TTL 60.
- Route 53 Test record, tên api, type A, resolver IP mô phỏng 54.251.131.234 (IP endpoint SG đã phân giải): No Error, trả 47.128.196.219. HTTPS /health tới IP này với hostname/SNI api.multi-region.io.vn trả 200, X-Served-Region ap-southeast-1, status ok.
- Test record với resolver IP mô phỏng 54.92.95.254 (IP endpoint Tokyo đã phân giải): No Error, trả 18.178.167.215. HTTPS /health tới IP này với cùng hostname/SNI trả 200, X-Served-Region ap-northeast-1, status ok.
- HTTPS trực tiếp tới target IP vừa phân giải của mỗi Region cũng trả 200, header/body Region đúng.

## Giới hạn

Test record là mô phỏng lựa chọn DNS theo địa chỉ resolver, không phải request phát từ máy thật đặt ở SG/Tokyo. curl --resolve dùng IP trả từ DNS/test record, vẫn xác minh TLS, không dùng -k và không thay DNS hệ thống. Ba request dùng resolver mặc định của máy còn lỗi Could not resolve host; vì vậy chưa xác nhận truy cập domain API bình thường trên máy này. Không gây lỗi, không đổi health/env/record và chưa kiểm thử failover. Không kết luận latency phải chia đều traffic hoặc đo được thời gian failover từ kết quả này.

## Bằng chứng

- [Output DNS và HTTP](../evidence/2026-10-27/L/route53-live-test.txt)
- [Mô phỏng Singapore](../evidence/2026-10-27/L/latency-test-singapore.png)
- [Mô phỏng Tokyo](../evidence/2026-10-27/L/latency-test-tokyo.png)
- [Health checks](../evidence/2026-10-27/L/health-checks-live-test.png)
