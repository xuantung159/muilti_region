# Rà soát trước báo cáo 08/11/2026

Kiểm tra ngày 04/11/2026, khoảng 18:01–18:06 giờ Việt Nam. Chỉ đọc AWS Console, website thật và repo; không thay đổi tài nguyên AWS. Đây là danh sách đề xuất, chưa phải xác nhận nghiệm thu toàn hệ thống.

## Kết quả xác nhận hôm nay

- Console đã đăng nhập bằng admin. Singapore có 5 Lambda: authorizer, dashboard, monitoring, proxy, exporter; runtime Node.js 24.x.
- Monitoring Singapore có hash `f5BTOxk7f/SurRRfm2aTQJTufyavWbmqqh2qi127CGY=`. Monitoring cả Singapore và Tokyo có memory 256 MB, timeout 10 giây. Khuyến nghị tăng từ 128 MB/5 giây trong báo cáo cũ đã được xử lý.
- Website thật `https://app.multi-region.io.vn/`, lúc 18:02:27, cửa sổ 6 giờ: Singapore Healthy, 11.177 request, p95 35 ms; Tokyo Healthy, 11.258 request, p95 39 ms; lỗi 0,0%. Đây là số tổng API Gateway, chưa chứng minh lưu lượng nghiệp vụ qua proxy.
- Replication DynamoDB hai chiều hiện Unavailable; S3 hiện 0,0 giây. Không được dùng 0,0 làm kết luận độ trễ sao chép thực tế khi chưa có lượt chép kiểm thử.
- Data Sources: 6/7 nguồn Connected; X-Ray chưa tích hợp vào dashboard. S3 vẫn ghi Tokyo chưa bật metrics.
- Portal thật có nhãn "CHƯA NGHIỆM THU VỚI KEY THẬT"; các phần hướng dẫn chạy mẫu và mô phỏng đã có. Phiên AWS Console không đồng nghĩa có phiên tài khoản doanh nghiệp trên portal.
- S3 Singapore vẫn có `exports/ducminh_credentials.csv`, 112 byte, ngày 17/10. Chỉ xem metadata danh sách, không mở nội dung. Tên file gợi ý credential, chưa xác nhận nội dung. Báo cáo 01/11 ghi có bản sao Tokyo; hôm nay chưa kiểm lại bản sao hoặc các version.
- Test local: backend 27/27, frontend 34/34, monitoring 6/6 đều PASS. Không chạy E2E tạo dữ liệu thật, load test hoặc failover trong lần rà soát này.
- File boundary trong repo đã trùng SHA-256 với bản v3 lưu trong bằng chứng 01/11. `functions.api` đã là `mrapi-proxy`; `deployment.ts` đã cập nhật. Không đưa các lỗi cũ này vào danh sách còn tồn.

## Việc cần sửa và bổ sung

| Ưu tiên | Việc | Căn cứ và điều kiện hoàn tất | Ước lượng |
|---|---|---|---|
| P0 | Kiểm tra file tên credentials trên S3 | File còn tồn tại ở SG. Chủ tài khoản kiểm tra kín; nếu là credential thật thì vô hiệu hóa/đổi credential liên quan, xử lý mọi version ở cả hai bucket và kiểm lại. Không đưa nội dung vào ảnh/báo cáo. | 1–2 giờ |
| P0 | Nghiệm thu portal → key có scope → proxy → telemetry | Dùng hai tenant thử và backend HTTPS kiểm soát được. Kiểm tra đăng nhập, API CRUD, key hiện một lần, request hợp lệ, thiếu/sai/thu hồi key, sai scope, truy cập chéo tenant, upstream lỗi/timeout. Kiểm tra thống kê portal tăng đúng, không có AccessDenied. Có bằng chứng ở cả hai Region. | 0,5–1 ngày |
| P1 | Đo thu hồi key xuyên Region (R3) | Thu hồi tại SG, đo lúc Tokyo từ chối; làm chiều ngược lại. Ghi timestamp, số lần và độ phân giải; không giả định Global Tables tức thời. | 2–3 giờ |
| P1 | Sửa monitoring S3 Tokyo | Hồ sơ 02/11 ghi metrics đã Enabled, nhưng code mặc định vẫn `s3: null` cho Tokyo và `/sources` ghi chưa bật. Đọc lại rule, bổ sung cấu hình truy vấn đúng Region và sửa nhãn; tạo lượt chép hai chiều, đối chiếu metric thật trước khi kết luận. | 2–4 giờ |
| P1 | Bổ sung bằng chứng replication mới | Sinh lượt ghi thử có kiểm soát, đo dữ liệu xuất hiện ở Region kia; dùng timestamp và khoảng xem còn dữ liệu. Hiển thị rõ thiếu mẫu, tránh đồng nhất Unavailable với lỗi replication. | 2–3 giờ |
| P1 | Kiểm tra lịch export tự chạy | Exporter và rule đã được dựng theo hồ sơ 01/11, nhưng lần theo lịch chưa được nghiệm thu trong hồ sơ đã đọc. Xem log EventBridge/Lambda sau 01:00 giờ VN, export COMPLETED, object mới ở SG và REPLICA ở Tokyo; lưu ngày chạy và kích thước/hash. Không kết luận chỉ từ việc hàm tồn tại. | 1–2 giờ |
| P1 | Hoàn tất cảnh báo Budget và SNS (R8) | Hồ sơ 01/11 ghi Budget email Pending, 0/1 verified; hôm nay trang Billing không tải nội dung nên chưa xác nhận lại. Xác minh người nhận Budget và kiểm tra email SNS đã tới hộp thư. Phân biệt action SNS thành công với nhận email. | 1–2 giờ + chờ người nhận |
| P1 | Liên kết requestId với trace/log/telemetry (R9) | Chọn request proxy thật được sampling; đối chiếu X-Ray, CloudWatch và DynamoDB. Dashboard X-Ray chưa kết nối; có thể dùng Console làm bằng chứng nếu phạm vi báo cáo cho phép. Không cần xây màn hình trace mới để có bằng chứng. | 2–4 giờ |
| P1 | Kiểm lại quota và giới hạn demo | Hồ sơ 01/11 ghi concurrent executions chỉ 10 mỗi Region, phép thử đồng thời đã gây API 500. Chưa đọc lại quota hôm nay. Xin tăng nếu cần demo tải; nếu chưa được thì giới hạn số client, giảm polling và công bố phạm vi kiểm thử. | 1–2 giờ, quota có thể cần chờ |
| P1 | Đồng bộ tài liệu và đóng phiên bản | README, thiet-ke-gateway, dung-portal-singapore, phan-cong còn mô tả chưa deploy/chưa có infra, trái hồ sơ mới. Gom một bảng R1–R10 hiện hành, sửa trạng thái cũ, rà thay đổi local/untracked, ghi commit/build đã deploy và hướng dẫn rollback. | 0,5 ngày |
| P2 | Hoàn thiện hosting và độ gọn frontend | Báo cáo 02/11 ghi index.html thiếu Cache-Control và bundle khoảng 818 KB. Xác nhận lại trước khi sửa; cân nhắc chia bundle, cache HTML ngắn và asset có hash dài hạn. | 2–3 giờ |

Ước lượng là thời gian công việc, không phải cam kết; có thể phân công song song cho thành viên nhóm. Chưa xác định tên owner, dùng phân công dịch vụ hiện có để giao người cụ thể.

## Các phần đã làm, tránh giao lại

Theo hồ sơ 01–02/11, cần đọc lại khi lấy bằng chứng cuối nhưng không xếp là triển khai mới: proxy/authorizer hai Region, dashboard đọc telemetry, monitoring backend, export Lambda và lịch EventBridge, failover mô phỏng 3 lần mỗi chiều, CloudFront qua latency domain, alarm monitoring/exporter, PITR và deletion protection của hai bảng ở hai Region, lifecycle export và tag Lambda.

PITR/deletion protection/lifecycle/tag dựa trên báo cáo 02/11, không phải kiểm tra lại trực tiếp hôm nay. Failover đã đo là mô phỏng health lỗi; không chứng minh mất toàn Region. Không tuyên bố zero downtime hay failover tức thời.

## Lịch đề xuất trước hạn

| Ngày | Kết quả phải có |
|---|---|
| 04/11 | Chốt phạm vi, xử lý nghi vấn credential, chuẩn bị hai tenant/backend thử, xác minh Budget, kiểm tra quota và lịch export. |
| 05/11 | Hoàn tất E2E thật hai Region, sửa lỗi chặn; nghiệm thu scope/revoke/tenant isolation và thống kê telemetry. |
| 06/11 | Sửa S3 Tokyo monitoring, đo replication/revoke, gom trace-log-telemetry và email cảnh báo. Dùng timeline failover có sẵn; chỉ đo lại khi cấu hình thay đổi hoặc thiếu bằng chứng. |
| 07/11 | Chốt phiên bản, cập nhật báo cáo và slide, diễn tập bằng key thật; chuẩn bị video/ảnh dự phòng và rollback. |
| 08/11 | Báo cáo với trạng thái PASS/PARTIAL/NOT TESTED rõ ràng, nêu giới hạn và số liệu đo. |

Không nên mở thêm tính năng lớn trong bốn ngày này. Nếu thiếu thời gian, ưu tiên luồng nghiệp vụ thật, cách ly tenant/thu hồi key, số liệu replication, bằng chứng và tài liệu đúng trạng thái.
