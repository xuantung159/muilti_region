# Kiểm tra Route 53 và DNS — 28/10/2026

Thời điểm kiểm tra: 08:12–08:13 UTC+7. Bằng chứng: [DNS và HTTPS](../evidence/2026-10-28/L/route53-dns-verification.txt).

## Kết quả

- NS công khai của `multi-region.io.vn` trả đúng bốn nameserver AWS đã lưu trong cấu hình.
- `api.multi-region.io.vn` phân giải A thành công qua resolver mặc định của máy, Google `8.8.8.8`, Cloudflare `1.1.1.1` và authoritative `ns-179.awsdns-22.com`; TTL quan sát là 60 giây.
- HTTPS `https://api.multi-region.io.vn/health` bằng resolver mặc định trả HTTP 200, `X-Served-Region: ap-southeast-1`, JSON `status: ok`.
- HTTPS `https://app.multi-region.io.vn/health` trả HTTP 200 qua CloudFront, backend Singapore.
- Phân giải mới từng regional custom domain, dùng `curl --resolve` với hostname/SNI `api.multi-region.io.vn`: cả Singapore và Tokyo trả HTTP 200, header/body Region tương ứng, `Cache-Control: no-store`. TLS được xác minh bình thường, không dùng `-k`.

Lỗi không phân giải hostname trên máy ghi trong phiên 27/10 không còn tái hiện. Lần chạy đầu trong sandbox bị `Access is denied`; chạy lại ngoài sandbox thành công. Không quy lỗi quyền sandbox thành sự cố DNS.

## Phạm vi và bước tiếp theo

Đây là kiểm tra DNS/HTTPS chỉ đọc; không đổi DNS hệ thống, record hoặc cấu hình AWS. IP trong bằng chứng chỉ là kết quả tức thời, không dùng làm record cố định. Chưa đọc lại trạng thái health checker từ AWS và chưa gây lỗi để kiểm thử failover. Kết quả không chứng minh traffic đã tự chuyển khi một Region lỗi.

Phần tiếp theo là phiên failover có phối hợp theo `infra/route53/README.md`: ghi cấu hình ban đầu, timeline health/DNS/request, phục hồi ngay và xác minh cả hai Region. Portal CloudFront vẫn dùng origin Singapore; failover API hostname không tự chứng minh portal đã failover.
