# Rà soát hạ tầng từ repo ngày 06/11/2026

Phạm vi: đọc `infra/`, `config/demo/`, script parity và báo cáo mới nhất 04/11. Không gọi AWS API, không đăng nhập Console, không sửa tài nguyên hoặc cấu hình. Các giá trị dưới đây là hồ sơ đã lưu, **chưa xác nhận live ngày 06/11**. Không tìm thấy `AGENTS.md` trong workspace. AWS CLI không có trong PATH của môi trường kiểm tra này.

## Các lỗi và khoảng trống có căn cứ

| Ưu tiên | Vấn đề | Căn cứ trong repo | Điều kiện hoàn tất |
|---|---|---|---|
| P1 | Monitoring không đọc replication Tokyo → SG theo mặc định | `src/monitoring/index.mjs` đặt Tokyo `s3: null`, `/sources` nói chưa bật; `infra/s3/ap-northeast-1/replication.json` và báo cáo 02/11 ghi Metrics Enabled | Đọc lại rule live; cấu hình source `mrapi-exports-tyo`, destination `mrapi-exports-sg`, rule `mrapi-tyo-to-sg`, metric Region `ap-southeast-1`; kiểm cả `MONITORING_CONFIG` live vì override có thể giữ giá trị cũ; deploy code, tạo mẫu chép và đối chiếu metric. Không đổi thiếu mẫu thành 0. |
| P1 | Policy TLS REST API lệch giữa hai Region | SG `SecurityPolicy_TLS13_1_2_2021_06`, `endpointAccessMode: STRICT`; Tokyo `TLS_1_0` trong `infra/apigateway/*/api.json` | Đọc lại API/domain live, xác định client cần hỗ trợ, cập nhật Tokyo theo policy đã chọn; kiểm HTTPS trực tiếp và qua domain. Sửa JSON local không hoàn tất việc này. |
| P1 | Quota Lambda rất thấp | `infra/quotas/README.md`: concurrent executions 10 mỗi Region; báo cáo 04/11 dẫn lần thử trước gây 500 | Đọc quota/throttles live, giới hạn tải/polling hoặc yêu cầu tăng quota; ghi rõ giới hạn demo. |
| P1 | Tài liệu mô tả trạng thái mâu thuẫn | README nói proxy/monitoring/export chưa deploy, trái `infra/DEPLOYED_STATE.md` và báo cáo 01–04/11 | Sửa các đoạn cũ dựa vào bảng trạng thái hiện hành, giữ riêng việc đã dựng với việc chưa nghiệm thu. |
| P1 | Script parity chưa đủ để nghiệm thu hệ thống | `scripts/check-region-parity.mjs` chỉ đọc 4 Lambda/Region; không so Architecture, tracing, policy, API routes/stage/authorizer, IAM boundary, bảng, bucket, alarms hoặc exporter SG | Chạy khi có CLI/session hợp lệ; đối chiếu thêm các dịch vụ trên. Phân loại biến môi trường khác nhau hợp lệ theo Region, không coi mọi khác biệt là lỗi. Không xuất giá trị secret trong báo cáo. |
| P2 | HTML cache chưa được chốt | `infra/cloudfront/README.md` ghi `index.html` thiếu Cache-Control | Đọc response header live, đặt HTML cache ngắn và assets có hash cache dài; nghiệm thu refresh sau deploy. |

Backend agent đã được thông báo lỗi cấu hình monitoring Tokyo để xử lý code. Báo cáo này không tự khẳng định bản sửa đã hoàn tất hoặc đã deploy.

## Các phần chưa có bằng chứng nghiệm thu đầy đủ

1. Portal → key có scope → proxy → telemetry ở cả hai Region: kiểm hai tenant, sai/thiếu/revoked key, sai scope, cách ly tenant, upstream lỗi/timeout, thống kê đúng. `tests/e2e/proxy.mjs` có khung thử nhưng tạo dữ liệu thật, mặc định dùng dịch vụ public và không đo thu hồi xuyên Region; chạy script đơn lẻ không đủ để kết luận toàn bộ.
2. Thu hồi key SG → Tokyo và Tokyo → SG: lưu timestamp/độ phân giải và nhiều lần đo. Global Tables không bảo đảm đồng bộ tức thì.
3. Export tự chạy theo lịch: EventBridge ENABLED và export thủ công thành công không chứng minh lượt theo lịch. Đối chiếu invocation/log sau 01:00 giờ VN, trạng thái export COMPLETED, object SG và bản REPLICA Tokyo.
4. Trace → CloudWatch log → telemetry: chọn request proxy thật có sampling và đối chiếu requestId. Dashboard X-Ray chưa tích hợp không đồng nghĩa AWS X-Ray chưa bật.
5. Budget và email SNS: hồ sơ ghi Budget Pending, 0/1 verified. SNS subscription confirmed hoặc action thành công không chứng minh thư tới hộp thư; cần người nhận xác nhận.
6. Replication metric: báo cáo 04/11 có DynamoDB Unavailable, S3 0,0; cần lượt ghi/chép mới trong cửa sổ metric. Không kết luận replication hỏng chỉ từ thiếu mẫu, hoặc latency thực tế bằng 0 từ dữ liệu không đủ.
7. Object tên `exports/ducminh_credentials.csv`: báo cáo 04/11 chỉ xác nhận metadata SG, chưa đọc nội dung. Chủ tài khoản cần kiểm tra kín; chỉ khi xác nhận credential thật mới xác định credential cần vô hiệu hóa và các bản/version cần xử lý. Không sao chép nội dung vào log, ảnh hoặc repo.

## Không giao lại như dịch vụ chưa triển khai

Hồ sơ 01–04/11 ghi đã có proxy/authorizer hai Region, dashboard telemetry, monitoring backend, exporter SG và EventBridge, CloudFront qua latency domain, alarm, Global Tables, PITR/deletion protection, S3 replication/lifecycle và tag Lambda. Chúng cần kiểm live/nghiệm thu phần còn thiếu, không cần dựng trùng. Exporter chỉ chạy SG là thiết kế có chủ đích, không phải thiếu exporter Tokyo.

Failover đã đo là mô phỏng health lỗi, không phải mất toàn Region. Số request trên dashboard là tổng API Gateway, chưa chứng minh lưu lượng nghiệp vụ proxy. Phiên AWS Console cũng không phải phiên tenant portal.

Nguồn chính: `docs/reports/2026-11-04-readiness-review.md`, `docs/reports/2026-11-02-services.md`, `infra/DEPLOYED_STATE.md`, `infra/README.md` và các file được dẫn trong bảng. Kết quả live của phiên làm việc hiện tại phải được ghi riêng, kèm giờ Việt Nam và phạm vi thao tác.
