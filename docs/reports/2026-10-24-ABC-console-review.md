# Đánh giá tiến độ A/B/C qua AWS Console — 24/10/2026

Đối chiếu `docs/phan-cong-tokyo.md`, không đánh giá L. Nguồn: CloudShell trong AWS Console, tài khoản dự án 138150704839; lệnh chỉ đọc ở ap-southeast-1 và ap-northeast-1. Không thay đổi cấu hình hoặc chạy test gây lỗi/ghi dữ liệu. Đây là đánh giá đầu ra theo owner được giao, không xác nhận người trực tiếp thao tác; muốn xác định tác giả cần CloudTrail.

## A — dữ liệu: tiến triển rõ nhất, chưa đủ nghiệm thu toàn bộ

- Hai bảng mrapi-control và mrapi-telemetry đều ACTIVE ở SG/Tokyo, replica ACTIVE; Streams NEW_AND_OLD_IMAGES; TTL expiresAt ENABLED ở cả hai Region; GSI1 telemetry ACTIVE.
- Telemetry SG đã bật PITR 35 ngày; list-exports trả một export COMPLETED.
- Hai bucket mrapi-exports-sg và mrapi-exports-tyo có replication Enabled hai chiều. Tokyo có manifest và data của export DynamoDB dưới exports/telemetry/AWSDynamoDB/01792752415680-452d01dd/. Có object latency-test, nhưng tên object không chứng minh số đo replication hợp lệ. SG có replication metrics Enabled; chưa thấy cấu hình ReplicationTime trong destination.
- Bucket mrapi-web-sg đã có, cả bốn cờ Block Public Access bật; kiểm kê object không có Contents, chưa có bản frontend.
- Repo hiện chỉ có src/monitoring/README.md, chưa có handler backend monitoring. Cả hai Region chưa có Lambda monitoring.
- Cần bàn giao: đo ghi chéo 5 lần mỗi chiều, đo revoke xuyên Region, số đo export replication, backend monitoring và gói deploy. Kiểm tra cấu hình không thay kết quả thử nghiệm này.

## B — Lambda/X-Ray: Singapore có tiến triển, Tokyo chưa triển khai

- SG có mrapi-proxy, mrapi-authorizer, mrapi-dashboard; cả ba đã có CONTROL_TABLE, TELEMETRY_TABLE, PROJECT. Lỗi thiếu env trong snapshot 20/10 đã được xử lý về cấu hình.
- Cả ba Lambda SG vẫn TracingConfig.Mode=PassThrough, chưa bật Active tracing.
- Tokyo list-functions trả rỗng; chưa có ba hàm nghiệp vụ hoặc monitoring. SG cũng chưa có monitoring.
- Proxy có biến HEALTH_PORCE_FAIL rỗng, khác tên HEALTH_FORCE_FAIL trong phân công; cần kiểm tra/sửa trước test failover.
- Cần làm: bàn giao ZIP/hash khớp repo và test event, dựng Lambda Tokyo, deploy monitoring khi A giao, bật tracing và có trace đối chiếu log/telemetry. Chưa chạy test event hoặc D1–D8 trong đợt kiểm kê này.

## C — API/cảnh báo: Singapore có nền tảng, phần hai Region còn thiếu

- SG có REST API mrapi-api-sg (43vakggyh5), stage demo bật metrics, execution log INFO và access log /mrapi/apigateway/sg/demo; tracingEnabled=false.
- Vẫn có hai authorizer: mrapi-request-authorizer (gq9zp9) và mrapi-key-authorizer (sexy17), TTL 0; authorizer được yêu cầu dọn vẫn tồn tại.
- Bốn alarm SG đang OK. Alarm mrapi-sg-lambda-errors đã dùng SUM(METRICS()) gồm proxy/dashboard/authorizer thật nhưng vẫn giữ mr-api cũ: sửa một phần, cần dọn metric dư. OK không chứng minh đã nhận email khi gây lỗi.
- Log Lambda và execution log SG không có retentionInDays; access log SG 7 ngày, chưa theo yêu cầu 14 hoặc 30 ngày.
- SG có SNS mrapi-alerts. Tokyo chưa có REST API, alarm, SNS topic hoặc log group.
- ACM list-certificates và API Gateway get-domain-names đều rỗng ở hai Region. Cần phối hợp đầu vào domain/DNS, không quy toàn bộ blocker cho C.
- Cần làm: hoàn tất SG, dựng API Tokyo sau khi B giao ARN, bổ sung ACM/domain, monitoring routes, tracing, retention và test alarm/email. Chưa xác minh trạng thái subscription SG trong lần này.

## Ưu tiên bàn giao

1. A bàn giao bảng Tokyo đã sẵn và hoàn thiện backend monitoring/gói deploy.
2. B triển khai Lambda Tokyo để C có ARN nối API; bật Active tracing.
3. C hoàn thiện cấu hình SG và dựng API/alarm/SNS/log Tokyo; bật stage tracing.
4. A/B/C chạy nghiệm thu hai Region, lưu timeline/response/trace và cập nhật infra. Chưa đủ bằng chứng để đánh dấu DONE hoặc quy đổi thành phần trăm nghiệm thu chính xác.
