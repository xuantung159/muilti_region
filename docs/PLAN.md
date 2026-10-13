# Kế hoạch 15 ngày — Multi-Region Active-Active API Platform

Trạng thái tài liệu: BẢN NHÁP v0 — chờ nhóm review trong Ngày 1–2.

## 1. Giả định

- 1 tài khoản AWS dùng chung, mới đăng ký, còn khoảng 200 USD credit. Chưa có IAM user, chưa có MFA.
- Chưa có domain, chưa có repository, cả 4 người chưa có kinh nghiệm AWS.
- Ngôn ngữ Lambda: Python 3.13 (ít boilerplate, có sẵn boto3).
- Tổng effort ước lượng: 216 giờ. Nhóm trưởng khoảng 5,1 giờ/ngày, mỗi thành viên khoảng 3,1 giờ/ngày.
- Giữ toàn bộ dịch vụ trong đề bài (kể cả S3 replication) vì ảnh hưởng điểm; không có phần nào được cắt.
- "Ngày N" là ngày làm việc thứ N kể từ ngày bắt đầu (chưa chốt ngày lịch).

## 2. Phạm vi

| Mức | Nội dung |
|---|---|
| Bắt buộc | Đăng ký tenant, tạo/thu hồi API key, authorizer, tạo/xem đơn hàng, biên nhận đơn hàng lưu S3 có replication 2 chiều, thống kê theo ngày, giao diện web, health check, 2 Region, Global Table, Route 53 latency routing + health check, test failover có đo, log + dashboard + alarm + budget |
| Thứ tự ưu tiên khi trễ | Làm sau cùng (không bỏ): trang thống kê trên giao diện, dashboard CloudWatch chi tiết |
| Không dùng | Usage Plans của API Gateway, Global Tables strong consistency, CDK (không nằm trong danh sách dịch vụ của đề bài) |

Cổng kiểm soát: nếu cuối Ngày 5 chưa demo được luồng Singapore thì không cắt phạm vi mà phải tăng giờ làm hoặc dùng Ngày 10 (ngày dự phòng duy nhất) — quyết định ngay trong Ngày 5.

## 3. Bảng task

Status: TODO / IN PROGRESS / IN REVIEW / DONE / BLOCKED. Kết quả review: ACCEPTED / NEEDS REVISION / BLOCKED.

### Đặng Xuân Tùng 

| ID | Task | Reviewer | Giờ | Ngày | Phụ thuộc | Deliverable | Acceptance criteria | Bằng chứng | Thực tế | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| L-01 | Bảo mật tài khoản: MFA root, 4 IAM user, group, Budget | A | 4 | 1 | — | 4 user đăng nhập được, budget hoạt động | Root có MFA và không có access key; mỗi user có MFA; budget gửi email cảnh báo | Ảnh IAM dashboard, danh sách user (che ID), ảnh budget | | TODO |
| L-02 | GitHub repo, cấu trúc thư mục, branch protection, PR/issue template | B | 4 | 1–2 | — | Repo + README + template | Không push thẳng `main`; PR cần 1 approve; `.gitignore` chặn secret | Link repo, ảnh rule | | TODO |
| L-03 | Tài liệu kiến trúc, sơ đồ, quy ước đặt tên và log | C | 4 | 2 | — | `docs/DESIGN.md` bản chốt | Cả 3 thành viên đã comment và approve PR | PR đã merge | | TODO |
| L-04 | Chốt API contract v1 | B | 4 | 2 | L-03 | Mục contract trong `DESIGN.md` | Mỗi endpoint có request, response, mã lỗi; B và C xác nhận làm được | PR đã merge | | TODO |
| L-05 | Thư viện dùng chung: định dạng response/lỗi, log JSON | B | 5 | 3–4 | L-04 | `src/common/` + unit test | B dùng được trong ít nhất 1 Lambda; log có `requestId`, `tenantId`, `region` | PR, log CloudWatch mẫu | | TODO |
| L-06 | Lambda Authorizer kiểm tra API key | B | 8 | 4–5 | A-02, A-03, B-04 | Lambda authorizer + test | Key hợp lệ → cho qua kèm `tenantId`; key sai/thu hồi/thiếu → 401; không log key gốc | PR, kết quả test, log | | TODO |
| L-07 | Script test end-to-end Singapore | C | 5 | 5 | B-05, C-03 | `tests/e2e/` | Chạy 1 lệnh, đi hết luồng tenant → key → order → đọc lại | Output script | | TODO |
| L-08 | Script đối chiếu cấu hình 2 Region | B | 5 | 7–8 | B-08, C-06 | `tools/parity_check` | Phát hiện được khác biệt về code hash, biến môi trường, route | Output trước/sau khi sửa lệch | | TODO |
| L-09 | CloudWatch dashboard + alarms 2 Region | A | 8 | 8–10 | B-08 | Dashboard, alarm lỗi 5xx và Lambda error | Gây lỗi thử thì alarm chuyển ALARM và gửi thông báo | Ảnh dashboard, lịch sử alarm | | TODO |
| L-10 | Test chéo 2 Region + bảo mật (tenant isolation, key thu hồi, biên nhận S3) | A | 7 | 9, 13 | L-07, A-07, B-11 | Bổ sung `tests/e2e/` + báo cáo | Ghi ở Region này đọc được ở Region kia; tenant X không đọc được dữ liệu và biên nhận của tenant Y | Output script | | TODO |
| L-11 | Điều phối buổi test failover và xác minh kết quả | C | 5 | 11–12 | C-07 | Biên bản game-day | Có timeline, số liệu đo độc lập với C | Biên bản, log | | TODO |
| L-12 | Review code/cấu hình của thành viên | — | 6 | 3–14 | — | Nhận xét trên PR | Mỗi task của A/B/C có kết luận ACCEPTED/NEEDS REVISION | Lịch sử PR | | TODO |
| L-13 | Báo cáo, kịch bản demo, rà chi phí, danh sách dọn dẹp | A, B, C | 6 | 13–15 | tất cả | Báo cáo + demo script | Mọi kết luận trong báo cáo trỏ tới bằng chứng | File báo cáo | | TODO |
| L-14 | 2 bucket S3 (mỗi Region 1), versioning, chặn public, replication 2 chiều, lifecycle | A | 5 | 6–7 | Mốc Ngày 5, A-11 | 2 bucket + 2 replication rule | File ghi ở bucket này xuất hiện ở bucket kia theo cả 2 chiều; bucket không public | Output `aws s3api head-object` có `ReplicationStatus`, ảnh rule | | TODO |

### A

| ID | Task | Reviewer | Giờ | Ngày | Phụ thuộc | Deliverable | Acceptance criteria | Bằng chứng | Thực tế | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| A-01 | Thiết kế schema theo access pattern | L | 5 | 2 | L-03 | Mục schema trong `DESIGN.md` | Mỗi access pattern có key và thao tác (Get/Query) tương ứng, không cần Scan | PR | | TODO |
| A-02 | Tạo bảng Singapore, dữ liệu mẫu, test truy vấn | B | 4 | 3 | A-01 | Bảng `mrapi-main` | Query từng access pattern trả đúng kết quả | Output CLI/Console | | TODO |
| A-03 | IAM execution role least privilege cho từng Lambda | L | 6 | 3–4 | A-02 | Role + policy JSON trong repo | Không có `*` ở Action/Resource của DynamoDB; test từ chối thao tác ngoài quyền | Policy JSON, kết quả AccessDenied | | TODO |
| A-04 | Test tenant isolation ở tầng dữ liệu | B | 4 | 5 | B-05 | Test case + kết quả | Truy vấn theo tenant X không trả item của tenant Y | Output test | | TODO |
| A-05 | Thêm replica Tokyo (Global Table) | L | 4 | 6 | Mốc Ngày 5 | Replica ACTIVE | Item cũ xuất hiện ở Tokyo; bảng ở 2 Region cùng schema | Ảnh tab Global tables, output Get ở Tokyo | | TODO |
| A-06 | Cập nhật policy cho ARN Tokyo | L | 2 | 7 | A-05 | Policy cập nhật | Lambda Tokyo đọc/ghi được, vẫn least privilege | Policy JSON | | TODO |
| A-07 | Test replication 2 chiều + đo độ trễ | C | 6 | 7–8 | A-05 | Script đo + bảng số liệu | Ít nhất 20 lần đo mỗi chiều, có min/trung bình/max | Output script | | TODO |
| A-08 | Test ghi xung đột cùng bản ghi; kiểm chứng bộ đếm theo Region | L | 5 | 9 | A-07, B-07 | Báo cáo hành vi | Mô tả đúng bản ghi nào thắng, có dữ liệu chứng minh | Output test | | TODO |
| A-09 | Test dữ liệu trong tình huống lỗi Region | B | 4 | 11–12 | C-07 | Báo cáo | Dữ liệu ghi trong lúc failover không mất sau khi khôi phục | Output test | | TODO |
| A-10 | Tài liệu schema/IAM, bằng chứng, rà chi phí DynamoDB | L | 4 | 13–14 | — | Tài liệu bàn giao | Đủ các mục bàn giao của A | PR | | TODO |
| A-11 | IAM role cho S3 replication, quyền S3 theo prefix cho Lambda, đo độ trễ replication S3 | L | 3 | 6–8 | L-14 (bucket đã tạo) | Role + policy JSON, bảng số liệu | Role replication chỉ có quyền trên 2 bucket của dự án; Lambda chỉ đọc/ghi prefix `tenants/`; có ít nhất 10 lần đo mỗi chiều | Policy JSON, output đo | | TODO |

### B

| ID | Task | Reviewer | Giờ | Ngày | Phụ thuộc | Deliverable | Acceptance criteria | Bằng chứng | Thực tế | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| B-01 | Review contract, tạo Lambda "hello" đầu tiên ở Singapore | L | 3 | 2 | L-01 | Lambda chạy được | Test trong Console trả 200, có log | Ảnh kết quả test | | TODO |
| B-02 | `GET /health` | C | 2 | 3 | B-01 | Lambda health | Trả `status`, `region`, `version` | Response | | TODO |
| B-03 | Đăng ký tenant | L | 5 | 3–4 | A-02, A-03 | Lambda tenants | 201 kèm `tenantId` và API key đầu tiên; thiếu trường → 400 | Response, item trong bảng | | TODO |
| B-04 | Tạo, liệt kê, thu hồi API key | L | 7 | 4–5 | B-03 | Lambda keys | Chỉ lưu hash; key gốc chỉ trả 1 lần; thu hồi xong status = REVOKED | Response, item trong bảng | | TODO |
| B-05 | Tạo, xem, liệt kê đơn hàng | A | 7 | 5–6 | B-03 | Lambda orders | `tenantId` lấy từ authorizer; đơn của tenant khác → 404 | Response, test | | TODO |
| B-06 | Validation, exception, mã lỗi HTTP + test request sai | C | 5 | 6–7 | B-05, L-05 | Test âm tính | Mọi lỗi theo đúng định dạng contract, không lộ stack trace | Output test | | TODO |
| B-07 | Thống kê sử dụng (bộ đếm theo Region) | A | 5 | 8 | B-05 | Lambda stats | Tổng = cộng bộ đếm 2 Region | Response, item | | TODO |
| B-08 | Triển khai cùng phiên bản sang Tokyo | L | 4 | 7–8 | A-05, A-06 | Lambda Tokyo | Code SHA-256 hai Region trùng nhau | Output so sánh hash | | TODO |
| B-09 | Test backend khi một Region không khả dụng | A | 3 | 11 | C-07 | Báo cáo | Region còn lại xử lý đủ các endpoint | Output test | | TODO |
| B-10 | Tài liệu triển khai, danh sách Lambda, sửa lỗi regression | L | 3 | 13–14 | — | Tài liệu bàn giao | Đủ các mục bàn giao của B | PR | | TODO |
| B-11 | Ghi biên nhận đơn hàng lên S3 khi tạo đơn + endpoint trả presigned URL | C | 3 | 8 | L-14, A-11, B-05 | Cập nhật Lambda orders | Biên nhận nằm ở `tenants/<tenantId>/orders/<orderId>.json`; URL hết hạn sau 5 phút; đơn của tenant khác → 404 | Response, object trong bucket | | TODO |

### C

| ID | Task | Reviewer | Giờ | Ngày | Phụ thuộc | Deliverable | Acceptance criteria | Bằng chứng | Thực tế | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| C-01 | Domain, hosted zone Route 53, trỏ name server | L | 3 | 1–3 | Quyết định mua domain | Hosted zone hoạt động | `nslookup -type=NS <domain>` trả name server của Route 53 | Output nslookup | | TODO |
| C-02 | HTTP API Singapore: route, integration, stage | B | 5 | 3–4 | B-02 | API + danh sách route | Gọi `/health` qua URL API Gateway trả 200 | Output curl | | TODO |
| C-03 | Gắn authorizer, CORS, throttling | L | 4 | 5 | L-06 | Cấu hình route | Route cần key trả 401 khi thiếu key; vượt ngưỡng trả 429 | Output curl | | TODO |
| C-04 | Giao diện web tối thiểu | B | 7 | 5–8 | C-03 | Trang tĩnh | Đăng ký tenant, tạo key, tạo/xem đơn từ trình duyệt | Link, ảnh | | TODO |
| C-05 | Chứng chỉ ACM + custom domain Singapore | A | 3 | 6 | C-01 | Custom domain | Chứng chỉ ISSUED; gọi qua domain riêng thành công | Output curl -v | | TODO |
| C-06 | HTTP API Tokyo + ACM + custom domain | L | 5 | 7–8 | B-08, C-05 | API Tokyo | Route và cấu hình trùng Singapore | Output parity check | | TODO |
| C-07 | Route 53 latency record + health check | A | 4 | 9–10 | C-06 | 2 record + 2 health check | Health check Healthy; `api.<domain>` phân giải được | Output nslookup, ảnh health check | | TODO |
| C-08 | Test failover, đo thời gian chuyển hướng, ảnh hưởng DNS cache | L | 6 | 11–12 | C-07 | Báo cáo đo | Có timeline theo giây, ít nhất 3 lần chạy | Log script đo | | TODO |
| C-09 | Bằng chứng TLS/DNS, tài liệu, trang thống kê | B | 5 | 13–14 | — | Tài liệu bàn giao | Đủ các mục bàn giao của C | PR | | TODO |
| C-10 | Route biên nhận ở 2 Region, nút tải biên nhận trên giao diện, test tải từ cả 2 Region | B | 4 | 8–9 | B-11, C-06 | Route + cập nhật giao diện | Tạo đơn ở Region này, tải được biên nhận qua Region kia | Output curl 2 Region, ảnh giao diện | | TODO |

## 5. Lịch theo ngày

| Ngày | L | A | B | C | Mốc |
|---|---|---|---|---|---|
| 1 | L-01, L-02 | Đọc tài liệu DynamoDB | Đọc tài liệu Lambda | C-01 (khảo sát domain) | Tài khoản an toàn |
| 2 | L-03, L-04 | A-01 | B-01 | C-01 | Chốt thiết kế |
| 3 | L-05 | A-02, A-03 | B-02, B-03 | C-01, C-02 | |
| 4 | L-05, L-06 | A-03 | B-03, B-04 | C-02 | |
| 5 | L-06, L-07 | A-04 | B-04, B-05 | C-03, C-04 | Demo luồng Singapore |
| 6 | L-12, L-14 | A-05, A-11 | B-05, B-06 | C-04, C-05 | |
| 7 | L-14, L-08 | A-06, A-07, A-11 | B-06, B-08 | C-06 | |
| 8 | L-08, L-09 | A-07, A-11 | B-07, B-08, B-11 | C-04, C-06, C-10 | |
| 9 | L-09, L-10 | A-08 | sửa lỗi | C-07, C-10 | 2 Region phục vụ + đồng bộ (DynamoDB và S3) |
| 10 | L-09 | dự phòng | dự phòng | C-07 | |
| 11 | L-11 | A-09 | B-09 | C-08 | |
| 12 | L-11 | A-09 | sửa lỗi | C-08 | Có số liệu failover |
| 13 | L-10, L-13 | A-10 | B-10 | C-09 | Regression |
| 14 | L-13 | A-10 | B-10 | C-09 | |
| 15 | L-13 | demo | demo | demo | Nghiệm thu |

## 6. Test plan ban đầu

| Nhóm | Test case | Owner | Kết quả |
|---|---|---|---|
| Chức năng | TC-01 Đăng ký tenant hợp lệ → 201 | B | NOT TESTED |
| Chức năng | TC-02 Tạo đơn rồi đọc lại → dữ liệu khớp | B | NOT TESTED |
| Chức năng | TC-03 Request thiếu trường bắt buộc → 400 | B | NOT TESTED |
| Bảo mật | TC-10 Không có API key → 401 | L | NOT TESTED |
| Bảo mật | TC-11 Key đã thu hồi → 401 (đo độ trễ ở Region kia) | L | NOT TESTED |
| Bảo mật | TC-12 Tenant X đọc đơn của tenant Y → 404 | L | NOT TESTED |
| Bảo mật | TC-13 Lambda thao tác ngoài quyền → AccessDenied | A | NOT TESTED |
| Dữ liệu | TC-20 Ghi Singapore, đọc Tokyo | A | NOT TESTED |
| Dữ liệu | TC-21 Ghi Tokyo, đọc Singapore | A | NOT TESTED |
| Dữ liệu | TC-22 Ghi đồng thời cùng bản ghi ở 2 Region | A | NOT TESTED |
| Dữ liệu | TC-23 Biên nhận ghi ở bucket Singapore xuất hiện ở bucket Tokyo và ngược lại | A | NOT TESTED |
| Dữ liệu | TC-24 Tạo đơn ở Region này, tải biên nhận qua Region kia | C | NOT TESTED |
| Bảo mật | TC-14 Truy cập trực tiếp object S3 không qua presigned URL → 403 | L | NOT TESTED |
| Routing | TC-30 `api.<domain>` trả về Region gần nhất | C | NOT TESTED |
| Routing | TC-31 Một Region báo unhealthy → request sang Region còn lại (đo thời gian) | C | NOT TESTED |
| Routing | TC-32 Region phục hồi → nhận lại request | C | NOT TESTED |
| Vận hành | TC-40 Gây lỗi 5xx → alarm kích hoạt | L | NOT TESTED |
| Vận hành | TC-41 Budget gửi cảnh báo | L | NOT TESTED |

## 7. Definition of Done

Một task chỉ chuyển DONE khi đủ cả 6 điều kiện:

1. Đáp ứng mọi acceptance criteria ghi trong bảng task.
2. Code hoặc cấu hình nằm trong repo qua PR đã merge; không có secret.
3. Có bằng chứng chạy thực tế (response, log, output script) đính kèm PR hoặc issue.
4. Có hướng dẫn để người khác chạy lại.
5. Reviewer khác owner đã tự kiểm tra lại và ghi ACCEPTED.
6. Lỗi còn tồn tại được ghi rõ, không che giấu.

## 8. Quyết định còn mở

| # | Quyết định | Hạn | Người quyết |
|---|---|---|---|
| 1 | Mua domain (khoảng 2–15 USD/năm, credit AWS có thể không áp dụng) hay bỏ custom domain | Ngày 2 | L |
| 2 | Tài khoản đang ở gói Free hay Paid; gói Free có giới hạn dịch vụ nào ảnh hưởng Route 53/ACM | Ngày 1 | L |
| 3 | Ngày bắt đầu và ngày nộp theo lịch | Ngày 1 | L |
