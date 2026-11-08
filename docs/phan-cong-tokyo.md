# Đợt dựng Tokyo

Cách chia như [phan-cong.md](phan-cong.md): Tùng làm phần toàn cục, ba bạn còn lại mỗi người giữ dịch vụ của mình ở cả Singapore và Tokyo.

Thứ tự: ổn định Singapore → dựng Tokyo → domain, định tuyến, giám sát → thử chuyển vùng.

## Việc từng người

**Tùng**
- Gom các nhánh về `main` trước để mọi người nhân Tokyo từ cùng một bản.
- IAM: thêm ARN Tokyo và quyền X-Ray cho role proxy, authorizer, dashboard; tạo role monitoring, exporter. Lambda Tokyo dùng chung role với Singapore.
- Budget `mrapi-monthly` 10 USD, bật trước khi dựng Tokyo.
- Domain `multi-region.io.vn`, hosted zone, cert ACM us-east-1, gắn `app.multi-region.io.vn` vào CloudFront.
- Hai health check (`/demo/health`, 30 giây, lỗi 3 lần), hai record latency cho `api.multi-region.io.vn`.
- SNS và alarm health check ở us-east-1 (metric Route 53 chỉ có ở đây).
- Thử chuyển vùng cùng Toan.

**Minh**
- Bật Streams, thêm replica Tokyo cho `mrapi-control` và `mrapi-telemetry`. Làm theo [runbook Global Tables](runbooks/dynamodb-replica-tokyo.md).
- Export telemetry sang `mrapi-exports-sg`, kiểm tra tự chép sang `mrapi-exports-tyo`.
- Bucket `mrapi-web-sg` để chứa web.
- Viết Lambda monitoring theo [contract của frontend](../monitoring-web/docs/integration/backend-api.md).

**Toan**
- Đặt đủ biến môi trường cho Lambda Singapore trước khi deploy lại.
- Tạo proxy, authorizer, dashboard ở Tokyo với cùng ZIP, role, biến.
- Deploy monitoring ở hai region. Bật X-Ray cho Lambda.
- Bật/tắt `HEALTH_FORCE_FAIL` khi thử chuyển vùng.

**Nhân**
- Dọn Singapore: xóa authorizer thừa, sửa alarm, đặt thời hạn log 14 ngày.
- Dựng API Tokyo bằng cách import file OpenAPI xuất từ Singapore (đổi ARN sang `ap-northeast-1`), tạo authorizer, deploy stage `demo`.
- Cert ACM và custom domain `api.multi-region.io.vn` ở hai region.
- Alarm và SNS ở Tokyo.

## Hiện trạng

| ID | Tiêu chí | Người | Kết quả |
|---|---|---|---|
| R1 | D1–D8 đạt ở cả hai region | Minh, Toan, Nhân | Một phần: đã deploy đủ, còn thiếu lượt nghiệm thu bằng key thật |
| R2 | Ghi ở region này đọc được ở region kia | Minh | Đạt: 10/10 item, khoảng 1 giây |
| R3 | Thu hồi key ở một region bị chặn ở region kia | Minh, Toan | Chưa đo |
| R4 | Một hostname HTTPS định tuyến theo độ trễ | Tùng, Nhân | Đạt |
| R5 | Chuyển vùng và phục hồi, 3 lần | Tùng, Toan | Đạt cả hai chiều (lỗi giả lập ở `/health`) |
| R6 | File export có ở cả hai bucket | Minh | Đạt; lịch chạy tự động chưa kiểm lại |
| R7 | Web qua CloudFront hiện số liệu thật | Cả nhóm | Đạt |
| R8 | Alarm và health check gửi SNS; Budget chạy | Nhân, Tùng | Một phần: alarm đã gọi SNS, chưa xác nhận email tới |
| R9 | Trace X-Ray khớp requestId với log, telemetry | Toan, Nhân | Một phần: khớp trace, chưa đối chiếu log và telemetry |
| R10 | `infra/` khớp AWS cả hai region | Cả nhóm | Gần xong, còn lệch TLS ở API Tokyo |

Chi tiết từng lần kiểm tra nằm trong `docs/reports/`.

## Rủi ro đã gặp

- Domain `.click` không mua được bằng tài khoản free plan, chuyển sang `multi-region.io.vn`.
- Quota Lambda chỉ 10 lần chạy đồng thời mỗi region. Khi demo không bắn tải lớn.
- Chi phí Global Tables, health check, CloudFront tính theo lượng dùng. Sau khi chấm dọn theo [don-tai-nguyen.md](runbooks/don-tai-nguyen.md).
