# Đối chiếu phân công với AWS Console — 27/10/2026

Phân công: `docs/phan-cong-tokyo.md` (đợt hai Region, ưu tiên hơn bảng trạng thái cũ trong WORK_ASSIGNMENT). Kiểm tra trực tiếp qua CloudShell trong AWS Console, account 138150704839, user admin. Các lời gọi AWS chỉ đọc; không deploy, sửa quyền, ghi dữ liệu thử hay gây lỗi. Báo cáo xác nhận đầu ra theo owner được giao, không xác định ai trực tiếp thao tác.

## Kết quả theo người

| Owner | Đã xác nhận trên AWS | Còn thiếu / chưa nghiệm thu |
|---|---|---|
| L | Bốn role proxy/authorizer/dashboard/monitoring có ARN Tokyo và action X-Ray trong inline policy; đều gắn workload boundary. Budget mrapi-monthly 10 USD, Actual 50/80%, Forecasted 100%. Hosted zone multi-region.click tồn tại. CloudFront E33WCNP66CDRPQ Enabled, origin S3 private và API SG. SNS us-east-1 có email subscription đã xác nhận. | Zone chỉ có NS/SOA, không có record latency; không có health check; không có alarm us-east-1. Không có cert ACM us-east-1 hoặc alias domain CloudFront. CloudFront chưa có behavior /monitoring/*, backend chỉ SG. Chưa xác minh toàn bộ policy hiệu lực/khớp JSON repo hoặc email Budget và failover. |
| A | Hai bảng control/telemetry ACTIVE ở SG/Tokyo, replica ACTIVE hai chiều, Streams NEW_AND_OLD_IMAGES, TTL expiresAt ENABLED; GSI1 telemetry ACTIVE cả hai. S3 replication Enabled hai chiều; cùng prefix export DynamoDB có data ở hai bucket. Bucket hosting mrapi-web-sg có 3 object và bật cả 4 cờ Block Public Access. | Chưa đo ghi chéo 5 lần mỗi chiều, revoke xuyên Region và độ trễ export. Không có ReplicationTime trong destination (RTC chưa bật, đây là mục cân nhắc). Lambda monitoring đã có nhưng chưa kiểm chứng backend trả số liệu thật và nguồn/ZIP bàn giao. |
| B | SG và Tokyo đều có proxy, authorizer, dashboard, monitoring; Node.js 24.x; cả 8 hàm Active tracing. CodeSha256 khớp từng cặp hai Region. Monitoring State Active, LastUpdateStatus Successful. | Chưa đối chiếu ZIP với commit repo, handler/arm64/role từng hàm và chưa chạy test event/D1–D8. Chưa có bằng chứng trace khớp log/telemetry. Proxy SG còn biến HEALTH_PORCE_FAIL rỗng (sai tên so với HEALTH_FORCE_FAIL trong phân công). |
| C | API SG 43vakggyh5 và Tokyo n39r5pits8; stage demo có metrics, INFO execution log, access log, tracing=true. Cả hai có route health, portal, proxy và GET /monitoring/{proxy+}. SG đã bỏ authorizer thừa, còn mrapi-request-authorizer; Tokyo có authorizer cùng tên TTL 0. SG có 4 alarm OK, alarm Lambda chỉ còn proxy/dashboard/authorizer thật. Access log hai Region retention 14 ngày. SNS topic mrapi-alerts có ở cả hai. | Tokyo không có metric alarm hoặc SNS subscription. Log 4 Lambda mỗi Region và API execution log chưa đặt retention. ACM và API custom domain đều trống hai Region. Chưa test alarm/email và D1–D8. |

## Điểm nối cần xử lý trước

1. C bổ sung 4 alarm Tokyo và subscription SNS; đặt retention 14/30 ngày cho log Lambda và execution log ở cả hai Region.
2. L cùng A/B/C hoàn tất monitoring: CloudFront hiện chỉ có /api/*, /health, /proxy/*; chưa có /monitoring/*. Hai Lambda monitoring có MONITORING_CONFIG và MONITORING_ALLOWED_ORIGIN rỗng: cần kiểm tra contract/default trong code và response thực tế, không tự kết luận hỏng chỉ từ env rỗng. Route monitoring Tokyo dùng authorizationType NONE tại API Gateway; cần xác minh xác thực trong Lambda trước khi mở dữ liệu riêng tư.
3. L/C hoàn tất đầu vào domain/delegation, ACM đúng Region, custom domain, latency records, health check và alarm us-east-1. Hosted zone tồn tại chưa chứng minh quyền sở hữu/delegation domain hoạt động.
4. B rà tên HEALTH_FORCE_FAIL, bàn giao ZIP/commit/hash và bằng chứng trace. Cấu hình Active chưa chứng minh trace xuyên suốt.
5. A/B/C chạy nghiệm thu thật hai Region; L/B đo failover/phục hồi 3 lần khi DNS sẵn sàng. Cập nhật config/infra theo tài nguyên mới.

## Thay đổi so với báo cáo 24/10

- Tokyo đã có đủ 4 Lambda và API; SG cũng đã có monitoring.
- Lambda và API stage hai Region đã bật tracing.
- Authorizer SG thừa đã được dọn; metric mr-api cũ đã bỏ khỏi alarm Lambda.
- Access log SG đã tăng từ 7 lên 14 ngày; Tokyo cũng 14 ngày.
- SNS Tokyo đã có topic nhưng chưa có subscription; alarm Tokyo vẫn thiếu.
- Hosting đã có object và CloudFront đã triển khai; monitoring qua CloudFront chưa nối.

## Giới hạn kết luận

Không đánh dấu DONE hay phần trăm hoàn thành từ kiểm kê cấu hình. R1–R5, R7–R9 còn cần bằng chứng chức năng/timeline/response/trace/email; R6 có object export ở hai bucket nhưng chưa đo thời gian; R10 cần đối chiếu và cập nhật hồ sơ toàn bộ. Không chạy lại D1–D8, đọc dữ liệu tenant, invoke Lambda, gửi SNS test hoặc mô phỏng lỗi trong phiên này. Hash hai Region khớp chỉ chứng minh ZIP triển khai khớp nhau, không chứng minh khớp source repo.
