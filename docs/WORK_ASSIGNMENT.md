# Phân công hiện hành — gateway multi-region

Cập nhật 14/10/2026. Đây là tài liệu phân công duy nhất áp dụng. L là Đặng Xuân Tùng; A/B/C điền tên thật khi nhóm xác nhận. Hạn từng mốc do nhóm chốt theo ngày demo thực tế.

## 1. Bảng phân công theo cụm dịch vụ

| Người | Dịch vụ/phần chính | Công việc tiếp theo | Bàn giao và nghiệm thu |
|---|---|---|---|
| L — Tùng | Lambda dashboard/monitoring, IAM base, Budgets, CloudWatch, SNS, giám sát X-Ray | Hoàn tất portal; API config/key scope; backend monitoring; cảnh báo và kiểm tra trace; tổng hợp tích hợp | Portal/key scope đúng contract, metric thật, alarm SNS và trace có bằng chứng |
| A — tên: … | DynamoDB Global Tables, S3 replication, IAM role dữ liệu | Tiếp nhận control Singapore; chốt telemetry schema; replica Tokyo; bucket export log và replication; policy quyền dữ liệu | Hai Region đọc/ghi được, đo replication, bucket private, ARN/policy/config trong repo |
| B — tên: … | Lambda proxy/authorizer, instrumentation tracing | Key/scope, forwarding/timeout/lỗi, telemetry, trace backend, backend mẫu | Cùng code hai Region, test proxy/bảo mật đạt, trace thể hiện lỗi/độ trễ |
| C — tên: … | API Gateway, Route 53, ACM, CloudFront, frontend giám sát | Route/stage/tracing API; domain/TLS/CloudFront; latency/health; hosting và tích hợp frontend | URL hai Region/domain, cấu hình CloudFront đúng phương án đã chốt, frontend dữ liệu thật và failover có đo |

Tùng đã báo hoàn thành đến bước tạo/cấu hình Lambda dashboard Singapore. Bàn giao tiếp tài nguyên đã tạo, không tạo trùng hoặc xóa để làm lại.

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

| Mốc | Điều kiện đạt |
|---|---|
| M1 | Contract chốt; tài nguyên có sẵn bàn giao; role chuẩn bị sớm |
| M2 — Singapore | Portal tạo API/key scope; gateway gọi backend mẫu; response/telemetry thật; revoke và tenant isolation đạt |
| M3 — Tokyo | Cùng code, hai Region xử lý được; dữ liệu cần thiết đồng bộ; S3 export/replication đạt |
| M4 — domain/giám sát | Topology CloudFront/domain đã chốt và kiểm thử; TLS/latency/health; frontend/backend monitoring dữ liệu thật; alarm SNS và trace X-Ray |
| M5 — nghiệm thu | Failover/phục hồi có đo; test chức năng/bảo mật/replication; báo cáo và tập demo |

L chốt ngày hoàn thành từng mốc theo lịch demo thực tế.

## 6. Báo cáo bàn giao và DONE

Mỗi người nộp docs/reports/<ngay>-<L-A-B-C>.md, bằng chứng tại docs/evidence/ hoặc link PR. Nội dung:

1. Việc đạt và commit/PR.
2. Tên/ARN/URL/Region, handler/env/route/quyền; cấu hình trong infra/config.
3. Test: input che secret, mong đợi/thực tế, PASS/FAIL/NOT TESTED, bằng chứng.
4. Cách người khác chạy lại.
5. Phần đang mock, lỗi/hạn chế, dependency chặn, owner và hạn sửa.
6. Reviewer khác owner và kết luận ACCEPTED/NEEDS REVISION/BLOCKED.

Review: L do B/C; A do L/B; B do A/L; C do B/L. DONE cần chức năng đạt, code/config bàn giao, bằng chứng thật và review. Không nộp password, token, API key gốc, AWS secret hoặc QR MFA.

## 7. Hướng dẫn thực hiện chi tiết — dùng cho bước tiếp theo

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
