# Phân công hiện hành — gateway multi-region

Cập nhật 14/10/2026. Đây là tài liệu phân công duy nhất áp dụng. L là Đặng Xuân Tùng; A/B/C điền tên thật khi nhóm xác nhận. **Đợt đang giao: 15–18/10/2026 (4 ngày tiếp theo), hạn nộp cuối ngày 18/10, giờ Việt Nam.** Sau báo cáo/review mới chia đợt tiếp; các phần dài hạn phía dưới chỉ để tham khảo hướng kiến trúc.

## 0. Mục tiêu và lịch đợt 4 ngày

**Mốc cần đạt:** Singapore chạy được đăng ký/đăng nhập → đăng ký API đích → tạo key có scope → gọi proxy tới backend mẫu → xem được bản ghi request → thu hồi key bị từ chối. Chứng minh API của tenant khác không truy cập được. Nếu chưa đạt, báo FAIL/BLOCKED và owner sửa, không ghi hệ thống đã chạy từ mock.

Đợt này ưu tiên luồng thật và hồ sơ cấu hình; **chưa giao hoàn tất** Tokyo, S3 replication/RTC/export producer, CloudFront production, frontend monitoring dữ liệu thật, X-Ray đầy đủ hoặc failover. Các phần đó vẫn thuộc kiến trúc, sẽ chia sau nghiệm thu. Domain/ACM và lựa chọn topology được chuẩn bị sớm vì có thời gian chờ xác thực.

| Ngày | L — Tùng | A — dữ liệu/quyền | B — proxy/authorizer | C — cửa vào/frontend | Kết quả trong ngày |
|---|---|---|---|---|---|
| **15/10** | Test Lambda dashboard; ghi IAM/Lambda thực tế vào infra; chốt API/key contract cùng B/A | Tiếp nhận control; chốt telemetry schema/query với B/L; chuẩn bị role proxy/authorizer | Backend mẫu success/error/delay; fixture key/API; chốt route/context/telemetry | Nối portal REST API/stage; gửi URL; khảo sát/chốt đề xuất CloudFront/domain | Schema/contract ghi trong DESIGN; bảng/role/ARN bàn giao; portal mở được |
| **16/10** | Tạo/thu hồi key có scope API; test dữ liệu quyền bằng bảng control | Tạo telemetry Singapore theo schema; gửi tên/ARN/query; cấp quyền data/log cho Lambda | Authorizer kiểm tra key/scope; proxy forwarding cơ bản test local với backend mẫu | Nối route proxy/health bằng mock nếu B chưa bàn giao; chuẩn bị DNS/ACM sau L chốt domain | Key/schema/role dùng được; proxy local và route wiring có test |
| **17/10** | Deploy portal phiên bản mới; test account/API/key scope; Budget/SNS nếu chưa có | Test access pattern/quyền thật; hỗ trợ B ghi telemetry; kiểm tra ttl/tag | Deploy proxy/authorizer Singapore; kiểm soát DNS/IP/header/timeout; ghi telemetry và test thật | Đổi integration mock sang Lambda thật; deploy stage; test request/auth/CORS; giữ frontend fixture đúng contract | Request proxy qua API Gateway trả đúng response và có telemetry thật |
| **18/10** | Chạy test chung/tenant/revoke; tổng hợp lỗi; nộp báo cáo L | Kiểm tra bản ghi request/schema/quyền; hoàn thiện infra/config/bằng chứng; nộp A | Sửa lỗi blocking; bàn giao code/ZIP/config/test; nộp B | Kiểm tra URL/route/stage; hoàn thiện infra và đề xuất CloudFront; nộp C | Demo nội bộ Singapore, đủ 4 báo cáo và danh sách lỗi để chia đợt sau |

### Bàn giao sớm để giảm chờ

- Ngày 15: L gửi ARN dashboard/tài nguyên đã có cho A/C; A gửi role ARN ngay khi tạo; B/C gửi quyết định method/path/context.
- Trước khi ghi telemetry ngày 16: A/B/L xác nhận schema và query. L/B xác nhận key scope và migration key cũ trước test thật.
- Khi chờ, B dùng fixture/backend mẫu, C dùng Lambda echo/fixture frontend, A dùng script ghi/đọc mẫu. Ghi rõ mock; ngày 17–18 phải ghép với Lambda/dữ liệu thật để nghiệm thu.
- Có lỗi chặn người khác thì báo ngay: action/resource/request lỗi đã che secret, ảnh/output, người cần hỗ trợ và việc vẫn làm độc lập được.

### Test bắt buộc ngày 18/10

| ID | Test | Mong đợi |
|---|---|---|
| D1 | Signup/login, tạo/sửa/bật/tắt API đích | Portal thật hoạt động, cấu hình đúng tenant |
| D2 | Key được cấp API A gọi backend mẫu qua proxy | Method/path/query/body, HTTP status/body khớp contract; không lộ key |
| D3 | Thiếu/sai/revoked key | Bị từ chối theo mã lỗi contract đã chốt |
| D4 | Key không có scope API B hoặc thuộc tenant khác | Bị từ chối; không gọi backend đích |
| D5 | API disabled, backend HTTP error và backend chậm | Chặn đúng trạng thái; lỗi/timeout phân loại đúng |
| D6 | Đích kết nối nội bộ/không hợp lệ | Bị chặn trước khi kết nối; validation registration không thay validation proxy |
| D7 | Request thật tạo telemetry | Có tenant/api/requestId/status/errorType/latency/region/time; truy vấn đúng tenant |
| D8 | Config/infra/hướng dẫn chạy lại | Reviewer mở URL/chạy test được; ARN/env/route thực tế đã bàn giao |

L chủ trì demo, A/B/C xác minh phần mình và review chéo. Endpoint method/error code chưa chốt thì cập nhật GATEWAY_DESIGN trước khi test; không tự ghi PASS theo dự đoán.

## 1. Bảng phân công theo cụm dịch vụ

| Người | Dịch vụ/phần chính | Công việc tiếp theo | Bàn giao và nghiệm thu |
|---|---|---|---|
| L — Tùng | Đợt này: portal, IAM base/Budget/SNS; dài hạn: monitoring/CloudWatch/X-Ray | Hoàn tất portal/API config, key scope và thu hồi; test chung; base và hồ sơ tài nguyên đã có | D1/D3/D4, test/report tổng hợp, schema key và cấu hình thật |
| A — tên: … | Đợt này: DynamoDB Singapore/role; dài hạn: Global Tables/S3 replication | Tiếp nhận control, tạo telemetry, policy quyền, test query/tenant/TTL | D7/D8, tên/ARN/schema/policy, script đọc/ghi và bằng chứng |
| B — tên: … | Lambda proxy/authorizer | Backend mẫu, key/scope validation, forwarding, kiểm soát đích/timeout/lỗi, telemetry Singapore | D2–D7, Lambda/commit/test; code không lộ secret |
| C — tên: … | Đợt này: REST API Singapore, chuẩn bị DNS/ACM/CloudFront; dài hạn: 2 Region/frontend | Portal/proxy/health routes, stage/integration/auth, URL test; đề xuất topology CloudFront và domain | D1–D5/D8, API/config/URL thật; fixture frontend ghi rõ; proposal CloudFront |

Tùng đã báo hoàn thành đến bước tạo/cấu hình Lambda dashboard Singapore. Bàn giao tiếp tài nguyên đã tạo, không tạo trùng hoặc xóa để làm lại.

### Tiến độ đã xác nhận — 14/10/2026

“Đã cấu hình” là trạng thái trên AWS do Tùng xác nhận; “đã lưu/commit” được đối chiếu trong repo. Test AWS và review chỉ ghi đạt khi có xác nhận/bằng chứng riêng, không suy ra từ code hoặc tên tài nguyên.

| Đầu việc | Người đã thực hiện | Trạng thái | Căn cứ/bàn giao | Việc còn lại |
|---|---|---|---|---|
| IAM user admin và thành viên, group/phân quyền base | L | Đã cấu hình, đã kiểm tra base theo xác nhận của Tùng | Trao đổi và ảnh Console 5 policy | Ghi membership/attachment thực tế và link bằng chứng trong infra/iam/README.md; MFA từng thành viên chưa có xác nhận riêng |
| 5 policy IAM base | L | Đã tạo, xuất JSON và commit | infra/iam/policies/; commit effdbdb; cả 5 file parse JSON hợp lệ | Ghi ARN/default version, reviewer khi bàn giao |
| Role mrapi-dashboard-role, trust và inline policy mrapi-dashboard-access | L | Đã cấu hình, xuất JSON và commit | infra/iam/roles/mrapi-dashboard-role/trust.json và permission.json; commit effdbdb; 2 file JSON hợp lệ | Ghi role/boundary ARN, tên policy trong README role; điền roles.dashboard trong config/demo/global.json |
| Bảng mrapi-control Singapore | L | Đã cấu hình theo xác nhận hoàn thành đến bước 5 | Schema/config tên bảng trong repo; chưa có bản ghi cấu hình Console ở infra/dynamodb | Ghi ARN/capacity/TTL/tag thực tế và test; A tiếp nhận để làm replica/telemetry |
| Dependency, test local và đóng gói Lambda | L cùng hỗ trợ code | Đã thực hiện local | 4 test local đã đạt trong lần kiểm tra trước; script package tạo dashboard.zip | Ghi commit đã upload và chạy lại khi code thay đổi; local PASS không thay test AWS |
| Lambda mrapi-dashboard Singapore | L | Đã tạo/cấu hình theo xác nhận của Tùng | Hoàn thành đến bước 5 hướng dẫn triển khai | Ghi infra/lambda/ap-southeast-1/mrapi-dashboard.md; test GET / và /api/me; bàn giao ARN cho C |
| Thiết kế gateway, code tài khoản/API đích và UI portal | L cùng hỗ trợ code | Có trong repo, test local đạt | GATEWAY_DESIGN.md, src/dashboard/, tests/control-plane/ | Chưa nghiệm thu luồng portal qua AWS API Gateway/e2e |

**Chưa có xác nhận hoàn tất:** API Gateway/stage/URL portal và e2e AWS; Budget/SNS/Resource Groups/cost tag; MFA riêng từng thành viên; key scope/proxy/telemetry mới; Tokyo/Global Tables/S3 replication; CloudFront/domain/ACM/Route 53; monitoring backend/dữ liệu thật/X-Ray/failover. Không đánh dấu toàn bộ phần của L/A/B/C là DONE chỉ vì các bước chuẩn bị đã xong.

**Bước tiếp theo:** L ghi lại cấu hình IAM/bảng/Lambda và test Lambda; C tiếp nhận ARN dashboard để nối REST API/stage; A tiếp nhận control/role đã có; B bắt đầu proxy/authorizer bằng fixture sau khi chốt key/API/telemetry contract.

## 2. Chốt điểm nối trước khi làm song song

| Điểm nối | Người cùng chốt | Nội dung |
|---|---|---|
| Proxy route | B/C/L | /proxy/{apiId}/{path}; cách gọi root, nối base path/query, method, status/header/body |
| Key scope | L/B/A | tenant, keyId/hash/status, danh sách API cho phép, migration key cũ, revoke/cache |
| API config | L/B/A | Schema hiện tại trong GATEWAY_DESIGN: tenant/apiId, baseUrl, timeoutMs, enabled |
| Telemetry | A/B/L | requestId, tenantId, apiId, method/path, status, errorType, latency, region, timestamp; retention/query |
| Monitoring | L/C | Contract monitoring-web/docs/integration/backend-api.md, frontend types và metric gateway mới |

Ghi quyết định vào GATEWAY_DESIGN.md. Đổi contract phải cập nhật producer, consumer, test và hướng dẫn trong cùng PR hoặc các PR liên kết.

## 3. Cách tự làm và tự kiểm thử

Các bước dưới mô tả toàn bộ cụm dịch vụ dài hạn. **Trong 15–18/10 chỉ làm phạm vi mục 0–1**; không coi các phần Tokyo/monitoring/failover là hạn nộp đợt này.

### L — portal và vận hành

1. Test Lambda đã tạo, hoàn tất portal qua REST API với C, chạy e2e control plane.
2. Chốt key scope với B/A; phát triển cấp quyền/thu hồi và test trên control Singapore, chưa cần proxy chạy thật.
3. Hoàn tất Budget/SNS/tag, CloudWatch alarm.
4. Viết backend monitoring theo contract; nguồn chưa có trả missing, sau đó nối metric thật.
5. Review điểm nối, tổng hợp bằng chứng và báo cáo.

### A — dữ liệu và replication

1. Nhận bảng control/role đã có từ L; ghi config và tiếp nhận quản lý.
2. Chốt/tạo telemetry, cấp role/policy cho B/L sớm; không tạo lại bảng orders.
3. Dùng script ghi/đọc item mẫu để kiểm tra quyền/access pattern, không chờ proxy.
4. Thêm replica Tokyo và đo đồng bộ dữ liệu theo thiết kế.
5. Tạo bucket export log hai Region, versioning/private/lifecycle, role và replication; tự test object mẫu hai chiều.

### B — proxy và authorizer

1. Tạo backend mẫu có endpoint thành công, lỗi HTTP và chậm.
2. Phát triển với fixture API config/key và lớp dữ liệu thay thế được, sau đó nối DynamoDB theo contract.
3. Implement key scope, tenant isolation, forwarding, timeout và phân loại lỗi.
4. Kiểm tra DNS/IP tại kết nối, redirect/header/payload trước khi mở proxy; validation URL portal chưa đủ bảo vệ đích.
5. Ghi telemetry theo schema đã chốt; deploy bằng role A cấp, bàn giao ARN/handler/env/hash cho C.

### C — cửa vào và frontend

1. Tiếp nhận REST portal nếu L đã tạo; chốt method/path với B/L.
2. Dựng route/stage bằng Lambda phản hồi mẫu; ghi rõ mock, thay integration bằng Lambda thật khi B bàn giao.
3. Làm DNS/ACM/custom domain sau khi L chốt và mua domain nếu cần.
4. Dựng monitoring frontend với fixture đúng types; đổi nguồn API khi L có backend monitoring.
5. Nối authorizer cho proxy, giữ portal xác thực bằng phiên; cấu hình hai Region, health check và routing.
6. Phối hợp nhóm đo failover/phục hồi và ảnh hưởng DNS cache.

Fixture/mock không được dùng làm bằng chứng AWS thật. Mỗi phần tự test trước rồi ghép theo contract; không có cụm dịch vụ nào hoàn toàn độc lập.

## 4. Ranh giới và thư mục phụ trách

| Phần/thư mục | Owner |
|---|---|
| src/dashboard, src/monitoring, infra/monitoring | L |
| src/api, src/authorizer | B |
| src/shared | L review; mọi thay đổi báo các consumer |
| infra/iam/policies, base trust/boundary | L |
| infra/iam/roles, infra/dynamodb, infra/s3 | A |
| infra/apigateway, infra/route53, infra/cloudfront (khi tạo), monitoring-web | C |
| infra/lambda | Người deploy function cập nhật, L review |
| config/demo | A: bảng/bucket/role; B: proxy/authorizer; L: dashboard/monitoring; C: API/domain; L review |
| tests, docs/reports, docs/evidence | Người làm nộp phần mình; L tổng hợp |

A phụ trách cả bucket và replication/role S3 để tránh chờ chéo. L giữ IAM user/group/base; A quản lý execution role/policy dữ liệu. Boundary cần mở rộng thì A báo L review. B làm authorizer, L làm portal cấp key; không tự đổi schema key ở một phía. L làm monitoring backend, C làm frontend và API integration.

## 5. Mốc ghép hệ thống

Đợt 4 ngày chỉ nghiệm thu M1 và M2. M3–M5 giữ làm mục tiêu dài hạn, chưa giao ngày/đầu việc chi tiết cho đợt tiếp theo.

| Mốc | Điều kiện đạt |
|---|---|
| M1 | Contract chốt; tài nguyên có sẵn bàn giao; role chuẩn bị sớm |
| M2 — Singapore | Portal tạo API/key scope; gateway gọi backend mẫu; response/telemetry thật; revoke và tenant isolation đạt |
| M3 — Tokyo | Cùng code, hai Region xử lý được; dữ liệu cần thiết đồng bộ; S3 export/replication đạt |
| M4 — domain/giám sát | Topology CloudFront/domain đã chốt và kiểm thử; TLS/latency/health; frontend/backend monitoring dữ liệu thật; alarm SNS và trace X-Ray |
| M5 — nghiệm thu | Failover/phục hồi có đo; test chức năng/bảo mật/replication; báo cáo và tập demo |

L chốt lịch M3–M5 sau khi review báo cáo ngày 18/10.

## 6. Báo cáo bàn giao và DONE

Hạn **cuối ngày 18/10/2026**: mỗi người nộp docs/reports/2026-10-18-<L-A-B-C>.md, dùng [mẫu báo cáo đợt 4 ngày](reports/FOUR_DAY_REPORT_TEMPLATE.md). Bằng chứng tại docs/evidence/2026-10-18/<L-A-B-C>/ hoặc link PR. Nội dung:

1. Việc đạt và commit/PR.
2. Tên/ARN/URL/Region, handler/env/route/quyền; cấu hình trong infra/config.
3. Test: input che secret, mong đợi/thực tế, PASS/FAIL/NOT TESTED, bằng chứng.
4. Cách người khác chạy lại.
5. Phần đang mock, lỗi/hạn chế, dependency chặn, owner và hạn sửa.
6. Reviewer khác owner và kết luận ACCEPTED/NEEDS REVISION/BLOCKED.

Review: L do B/C; A do L/B; B do A/L; C do B/L. DONE cần chức năng đạt, code/config bàn giao, bằng chứng thật và review. Không nộp password, token, API key gốc, AWS secret hoặc QR MFA.

## 7. Hướng dẫn thực hiện chi tiết — dùng cho bước tiếp theo

Đây là tài liệu thao tác theo dịch vụ, gồm cả phần dài hạn. Lịch/phạm vi được giao trong đợt này lấy từ mục 0–1; không cần làm hết mục 7 trong 4 ngày.

Mọi người thực hiện **Console xong → ghi cấu hình vào infra**, theo [hướng dẫn và mẫu](runbooks/RECORD_CONSOLE_CONFIG.md). Dùng giá trị thực tế, copy JSON đang áp dụng; cập nhật config và dẫn link test/bằng chứng. Chưa có file infra thì phần cấu hình chưa đủ điều kiện bàn giao.

### 7.1. Chuẩn bị chung trước khi mỗi người bắt đầu

1. Đọc [GATEWAY_DESIGN.md](GATEWAY_DESIGN.md), [cấu trúc/tích hợp](PROJECT_STRUCTURE_AND_INTEGRATION.md) và bảng phân công phía trên.
2. Đăng nhập IAM user riêng, có MFA; chọn Singapore khi tạo dịch vụ Regional. Không gắn workload boundary vào user; gắn vào role dịch vụ.
3. Kiểm tra tài nguyên đã có trong config/Console. L bàn giao bảng control và Lambda dashboard đã tạo cho A/C/B theo nhu cầu.
4. Chốt các contract mục 2 trong issue/PR: tên bảng, keys/scope, context authorizer, telemetry, route và response. Chưa chốt thì viết bằng fixture có thể thay thế, không tự đặt schema khác nhau.
5. Mỗi người tạo branch/PR riêng; sửa shared/contract phải báo consumer. Config chưa có ARN/URL thì để trống và ghi chưa bàn giao.

### 7.2. L — Tùng: portal, backend monitoring, vận hành

**File chính:** src/dashboard/, src/monitoring/, infra/monitoring/, docs/runbooks/FIRST_FOUR_PARTS.md; review src/shared và IAM base.

**Thứ tự làm:**

1. Trong Lambda dashboard đã cấu hình, test GET / → HTML 200 và GET /api/me không token → 401. Xem log để xử lý lỗi handler/import/table/role trước khi nối gateway.
2. Cùng C nối GET / và ANY /api/{proxy+} tới dashboard. Deploy stage demo, mở portal tại URL gốc stage kết thúc bằng /. Điền URL vào config rồi chạy `npm run test:e2e --prefix src`.
3. Với API đích, thử tạo/sửa/bật/tắt và kiểm tra doanh nghiệp thứ hai không thấy dữ liệu doanh nghiệp đầu.
4. Nâng cấp key theo schema thống nhất: chọn API được phép khi tạo key; chỉ lưu hash; key gốc trả một lần; thao tác scope/revoke chỉ cho tenant sở hữu. Chốt migration key cũ với B trước khi authorizer dùng dữ liệu mới.
5. Tạo backend monitoring trong src/monitoring/index.mjs, trả JSON theo contract frontend. Nguồn chưa có trả missing, không trả số giả như metric thật. Nhận ARN role từ A, ARN/API ID/health ID từ C và tên function từ B.
6. Hoàn tất Budget/SNS/tag; tạo CloudWatch dashboard/alarm hai Region. Gây lỗi có kiểm soát, kiểm tra alarm/SNS thật. Kiểm tra trace API/Lambda và đối chiếu request ID với B/C.
7. Đóng gói/upload code mới, ghi handler/env/role/version. Lưu cấu hình và bằng chứng trước khi chuyển DONE.

**Tự kiểm thử:** tài khoản/API config/key scope bằng bảng Singapore, chưa cần proxy. Monitoring dùng fixture contract ở test local, sau đó đối chiếu số liệu CloudWatch thật. X-Ray có sampling nên không yêu cầu mọi request đều xuất hiện.

**Bàn giao:** contract/schema key, dashboard/monitoring ARN/handler/env, response mẫu đã che secret, test tenant/revoke, dashboard/alarm/SNS/trace và lỗi còn lại.

### 7.3. A: dữ liệu, quyền, S3 và replication

**File chính:** infra/dynamodb/, infra/s3/, infra/iam/roles/ (tạo lại nơi lưu JSON khi xuất policy từ Console), config/demo/, tests/replication/.

**Thứ tự làm:**

1. Nhận mrapi-control và dashboard role đã có; ghi schema PK/SK String, on-demand, TTL expiresAt, tag/ARN thực tế. Không tạo lại bảng hoặc role trùng.
2. Với B/L chốt access pattern telemetry: tra theo tenant/API/thời gian và request lỗi; chọn partition/sort key, retention, aggregation, pagination. Tạo tài nguyên theo schema đã chốt, không dùng bảng orders.
3. Tạo role proxy/authorizer/monitoring: trust Lambda, tên mrapi-..., workload boundary, inline policy theo action/resource cần dùng. Gửi ARN sớm; nếu boundary thiếu quyền cần thiết, gửi L action/resource để review.
4. Test đọc/ghi/query và AccessDenied ngoài phạm vi bằng script/dữ liệu mẫu, độc lập với code proxy.
5. Thêm replica Tokyo cho control và các bảng được thiết kế cần đồng bộ. Đợi ACTIVE, kiểm tra item cũ/mới, TTL/cấu hình và policy ARN hai Region. Bộ đếm phải tách theo Region nếu dùng mô hình ghi cộng dồn bất đồng bộ.
6. Tạo hai bucket export log, versioning, Block Public Access, lifecycle, role replication và rule mỗi chiều. Nếu RTC là yêu cầu kiến trúc/đề bài, bật RTC trên rule và ghi cấu hình/chi phí; không đồng nhất CRR thường với RTC.
7. Ghi object/item mẫu từng chiều, poll đích, lưu số đo replication. Độ trễ DynamoDB ~1 giây và S3 <15 phút trong hình là mục tiêu/diễn giải cần đo, không cam kết từng request/object.
8. Chuẩn bị bucket frontend riêng khi C cần: bucket private, quyền đọc CloudFront OAC và quyền upload triển khai phù hợp; không dùng bucket log làm bucket hosting.

**Tự kiểm thử:** script ghi/đọc hai Region và object mẫu không cần chờ B/C. Đề xuất bộ đo ít nhất 20 item DynamoDB mỗi chiều, 10 object S3 mỗi chiều; ghi số lần, min/trung bình/max và timeout thực tế, nhóm chốt theo đề bài.

**Bàn giao:** bảng/bucket/role ARN, schema/query ví dụ, policy/trust/boundary, replication/lifecycle/RTC, quyền xuất log và bucket hosting, output đo và hướng dẫn chạy lại.

### 7.4. B: proxy, authorizer và tracing backend

**File chính:** src/api/, src/authorizer/, tests/security/, tests/e2e/, infra/lambda/; thay shared qua review.

**Thứ tự làm:**

1. Nhận contract key/API/telemetry; tạo fixture tenant X/Y, key active/revoked, API enabled/disabled. Backend mẫu có echo, HTTP 4xx/5xx và delay; không gán nghiệp vụ orders cho nền tảng.
2. Authorizer: kiểm tra key/hash/status, quyền apiId và tenant; context trả tenantId/keyId/apiId theo contract C/L chốt. Policy resource và cache phải phù hợp route; TTL=0 lúc test để kiểm tra revoke.
3. Lambda api hiện chỉ có health; bổ sung proxy: tra API config bằng tenant/apiId, kiểm tra enabled, nối path/query với baseUrl theo contract, chuyển method/body đúng và trả status/body/content-type backend. Xử lý body binary/base64 theo loại payload đã chọn hỗ trợ.
4. Không nhận URL đích tự do từ client. Kiểm tra DNS/IP tại kết nối, cả IPv4/IPv6/private/link-local/loopback/reserved và rebinding; kiểm soát redirect. Không chuyển tiếp x-api-key gateway, token portal hoặc hop-by-hop header; chốt header backend cần giữ.
5. Áp dụng timeout cấu hình, giới hạn payload và method hỗ trợ; phân biệt upstream HTTP error, timeout, connection error, gateway error. Request ID được trả/ghi theo contract, không log secret/body nhạy cảm mặc định.
6. Ghi telemetry theo schema A/L chốt; lỗi telemetry cần có log/cảnh báo và hành vi đã thống nhất để không báo thành công thống kê khi mất dữ liệu.
7. Bật active tracing Lambda và bổ sung instrumentation tương thích để thấy thao tác DynamoDB/outbound HTTP; role cần quyền trace. C bật tracing REST stage, L xác minh service map/trace. Không ghi key/token vào trace metadata.
8. Cài dependency, chạy test, đóng gói, deploy Singapore rồi Tokyo cùng code; nhận role A cấp và gửi C ARN/handler/env/version. Giữ health riêng, không dùng backend khách hàng hỏng để mặc định đánh dấu toàn gateway hỏng.

**Tự kiểm thử:** chạy với fixture và backend mẫu trước; sau đó test qua API Gateway: status/body/query/method đúng, key thiếu/sai/revoked bị từ chối, tenant chéo bị chặn, API disabled không được gọi, lỗi/chậm được phân loại đúng. Có test đích nội bộ và payload binary nếu công bố hỗ trợ.

**Bàn giao:** ZIP/commit/hash, Lambda ARN, handler/env/role, authorizer context, proxy response/error/telemetry contract, output test và trace mẫu.

### 7.5. C: API Gateway, CloudFront, DNS/TLS và frontend giám sát

**File chính:** infra/apigateway/, infra/route53/, infra/cloudfront/ (bổ sung khi làm), monitoring-web/, config/demo/.

**Chốt thiết kế CloudFront trước khi tạo:** CloudFront là dịch vụ toàn cục. Không cấu hình cùng một alternate domain name lên hai distribution rồi kỳ vọng Route 53 chọn distribution theo Region: AWS không cho trùng tên đó. Sơ đồ “CloudFront SG/JP” cần được L/C chốt thành topology/domain thực hiện được trước khi M4. Không báo đã đúng sơ đồ chỉ vì có hai distribution. [AWS: CNAME restrictions](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/CNAMEs.html).

**Thứ tự làm:**

1. Nhận dashboard ARN từ L; proxy/authorizer ARN từ B khi có. Tạo REST API **Regional** Singapore, stage demo, Lambda proxy integration. Có thể dùng Lambda echo mẫu để kiểm tra wiring trước; ghi rõ mock.
2. Portal: GET /, ANY /api/{proxy+} → dashboard, Authorization NONE tại API Gateway; Lambda tự kiểm tra phiên. Proxy: root/path theo contract → api, REQUEST authorizer dùng x-api-key. Health: GET /health → api, công khai và không cache. Monitoring route theo contract phải có cơ chế xác thực đã chốt, không tự công khai dữ liệu tenant.
3. Cho API Gateway invoke Lambda; deploy stage; test trực tiếp URL stage trước khi thêm CloudFront/DNS. Kiểm tra CORS/preflight nếu frontend khác origin; không bắt authorizer ở OPTIONS cần cho preflight.
4. Bật X-Ray tracing trên REST stage; kiểm tra với B/L. Nhân cấu hình sang Tokyo, đối chiếu route/authorizer/cache/env integration, không chỉ code hash.
5. ACM Regional cho custom domain API Gateway tại mỗi Region. Viewer certificate cho CloudFront dùng ACM us-east-1. Ghi domain/cert ARN/DNS validation và API mappings. [AWS: CloudFront certificate](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cnames-and-https-requirements.html).
6. CloudFront origin API dùng endpoint/API custom domain và stage path đã chốt. Không thêm stage hai lần. Behavior API/portal không cache dữ liệu có phiên/key; forward method/query/header cần thiết gồm Authorization/x-api-key, kiểm tra Host/origin TLS và response/error cache. Static asset có policy cache riêng.
7. Monitoring frontend: `npm ci --prefix monitoring-web`, `npm test --prefix monitoring-web`, `npm run build --prefix monitoring-web`; cấu hình API URL trước khi build. Upload dist vào bucket hosting riêng A chuẩn bị, CloudFront đọc qua OAC, bucket không public. Test HTTPS, deep link SPA và không có AWS key trong bundle.
8. Giao diện portal doanh nghiệp vẫn là Lambda dashboard trả HTML qua API Gateway/CloudFront; không upload page.html sang monitoring-web để thay portal. Hai giao diện/domain có chức năng khác nhau.
9. Route 53: latency record và health check độc lập cho từng Region theo topology đã chốt. Health check dùng endpoint riêng, path /health hoặc /demo/health tùy domain mapping, interval 30 giây, failure threshold 3. Không kiểm tra domain latency chung, không cache health.
10. Gây HEALTH_FORCE_FAIL ở một Region, lưu thời điểm health/DNS/request chuyển hướng; khôi phục và thử lại. DNS cache và lớp CloudFront có thể ảnh hưởng quan sát, không khẳng định failover đúng 90 giây. Chạy ít nhất 3 lần theo kế hoạch nhóm.

**Tự kiểm thử:** API bằng Lambda echo; frontend bằng fixture contract; DNS/ACM kiểm tra độc lập. Chỉ đổi nhãn dữ liệu thật sau khi nối monitoring backend và đối chiếu CloudWatch.

**Bàn giao:** API/stage/route/integration/authorizer, URL trực tiếp hai Region, domain/ACM/CloudFront origin/behavior/OAC, CORS/auth, config frontend/build, output request và timeline failover.

## 8. Checklist kiến trúc và phối hợp cuối

Checklist toàn dự án để chia tiếp sau báo cáo; không phải checklist tất cả phải DONE ngày 18/10.

| Thành phần | Owner chính | Bằng chứng |
|---|---|---|
| Route 53 latency + health/failover | C | DNS/health/timeline độc lập từng Region |
| CloudFront và hosting frontend | C, A chuẩn bị bucket | Topology/domain đã chốt, behavior/header/cache/OAC, HTTPS |
| REST API hai Region | C | Route/integration/auth/trace stage và response thật |
| Lambda proxy/authorizer | B | Test forwarding/key scope, code hai Region và trace |
| Portal + monitoring backend | L | Account/API/key scope, contract và metric thật |
| DynamoDB Global Tables | A | Ghi/đọc/đo hai chiều |
| S3 export và replication/RTC | A, B/L producer theo contract | Object xuất thật, replication/RTC và số đo |
| CloudWatch/SNS/X-Ray | L, B/C cấu hình tracing phần mình | Alarm email, service map/trace/log đối chiếu |

CloudFront có thể chưa nằm trong allowlist IAM base đã áp dụng. L kiểm tra policy thực tế trước khi C triển khai và cập nhật quyền/guardrail có phạm vi phù hợp nếu cần; không gắn AdministratorAccess cho C để vượt lỗi. Các thư mục/config dành cho CloudFront/X-Ray chỉ bổ sung khi có cấu hình thật, chưa tự xem là đã triển khai.

## 9. Review báo cáo và chia đợt tiếp theo

Sau khi nhận đủ báo cáo ngày 18/10, L tổng hợp và reviewer kiểm tra lại kết quả. **Chưa tự giao lịch đợt 2 trước khi biết kết quả đợt 1.**

1. Đánh dấu D1–D8 PASS/FAIL/NOT TESTED, chỉ ra commit và bằng chứng. Chốt lỗi blocking trước.
2. Nếu Singapore chưa đạt: giao sửa đúng owner và test hồi quy trước khi nhân sang Tokyo; phần data/S3/DNS độc lập có thể tiếp tục khi không làm lệch contract.
3. Nếu Singapore đạt: chia tiếp Tokyo/Global Tables, S3 export/replication/RTC, topology CloudFront/domain/TLS, monitoring frontend/backend và X-Ray, rồi failover/phục hồi.
4. Mỗi đầu việc đợt 2 phải có owner, input đã nhận, deliverable, test/reviewer và ngày hạn dựa trên ngày demo thực tế. Cân lại tải L/C sau đợt 1.
5. Cập nhật chính file WORK_ASSIGNMENT này bằng mục “Đợt 2”; giữ kết quả đợt 1 làm lịch sử, không tạo thêm file phân công song song.

Tại buổi review cần chốt: ngày demo thật, thời gian mỗi người có thể làm, topology CloudFront khả thi, trạng thái domain/cert, quyền IAM còn thiếu và số lượng lỗi chưa sửa. Báo cáo trung thực là căn cứ phân công tiếp, không mặc định mọi phần đã xong.
