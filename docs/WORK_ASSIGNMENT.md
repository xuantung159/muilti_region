# Phân công theo dịch vụ AWS và hướng dẫn tích hợp

Đây là tài liệu phân công hiện hành duy nhất. L/A/B/C điền tên thật khi nhóm xác nhận. Mỗi dịch vụ có owner chịu trách nhiệm cấu hình, kiểm thử và bàn giao; người phối hợp nhận hoặc cung cấp điểm nối.

## 1. Phạm vi và cách đọc

**Đợt hiện tại** Mục tiêu: Singapore chạy được đăng ký/đăng nhập → đăng ký API đích → cấp key có scope → gọi proxy tới backend mẫu → có telemetry → thu hồi key và chặn truy cập chéo tenant.

Từng người đọc dịch vụ mình phụ trách và các điểm nối liên quan. Không chia công việc theo từng ngày. Tokyo/Global Tables, S3 export/replication/RTC, CloudFront production, monitoring dữ liệu thật đầy đủ, X-Ray đầy đủ và failover là phạm vi sau review ngày 18/10; chưa có hạn hoàn thành cho đợt tiếp.

| Dịch vụ | Owner | Phối hợp | Phạm vi đợt hiện tại | Trạng thái theo infra |
|---|---|---|---|---|
| IAM | L: user/group/base/boundary; A: execution role và policy dữ liệu | B/C cung cấp nhu cầu quyền | Bàn giao role cho Lambda, quyền bảng/log đúng tài nguyên | **Đã xong một phần:** 5 policy base + trust/permission role dashboard |
| DynamoDB | A | L/B chốt schema và access pattern | Tiếp nhận control Singapore, tạo telemetry, test quyền/query/TTL | Chưa có cấu hình trong infra |
| Lambda | L: dashboard; B: api/proxy và authorizer | A cấp role, C nối API | Portal, key scope/revoke, proxy/authorizer và telemetry Singapore | Chưa có cấu hình trong infra |
| API Gateway | C | L/B bàn giao Lambda | REST API Regional, portal/proxy/health, stage và URL thật | Chưa có cấu hình trong infra |
| CloudWatch | L | A/B/C cấp nguồn và cấu hình phần mình | Log, chẩn đoán request và alarm cần thiết cho Singapore | Chưa có cấu hình trong infra |
| SNS và AWS Budgets | L | Thành viên xác nhận kênh nhận nếu cần | Hoàn tất cảnh báo chi phí/vận hành còn thiếu | Chưa có cấu hình trong infra |
| S3 | A | B/L xuất dữ liệu, C dùng bucket hosting | Chưa giao hoàn tất; chuẩn bị contract khi cần | Chưa có cấu hình trong infra |
| ACM | C, L chốt domain | Người quản lý DNS | Chuẩn bị domain/cert và phương án xác thực | Chưa có cấu hình trong infra |
| Route 53 | C | L chốt domain, B cung cấp health | Chuẩn bị DNS; failover hai Region làm sau | Chưa có cấu hình trong infra |
| CloudFront | C | A chuẩn bị hosting bucket, L chốt topology/quyền | Đề xuất topology/domain, chưa giao production | Chưa có cấu hình trong infra |
| X-Ray | L chủ trì; B/C bật ở phần mình | A cấp quyền role | Chuẩn bị điểm nối; chưa giao trace đầy đủ | Chưa có cấu hình trong infra |

**Cách đọc trạng thái:** chỉ đánh dấu đã xong phần có file cấu hình trong infra. README giữ chỗ không được tính là cấu hình đã xong. Chưa có hồ sơ infra không có nghĩa là chưa thao tác trên Console; bảng control và Lambda dashboard đã được báo cấu hình nhưng chưa lưu hồ sơ tại infra/dynamodb và infra/lambda. Quyền log/Route 53/X-Ray trong IAM không chứng minh các dịch vụ đó đã triển khai.

Frontend `monitoring-web/` do C làm; backend monitoring do L làm. Đây là phần ứng dụng sử dụng các dịch vụ trên, không phải một dịch vụ AWS riêng.

## 2. IAM — danh tính và quyền truy cập — ĐÃ XONG MỘT PHẦN

Trạng thái đối chiếu với `infra/` ngày 15/10/2026. **ĐÃ XONG** dưới đây là phần cấu hình đã lưu, chưa thay kết quả kiểm thử AWS hoặc xác nhận policy đã attach.

- **ĐÃ XONG:** policy developer IAM — [mrapi-dev-iam.json](../infra/iam/policies/mrapi-dev-iam.json).
- **ĐÃ XONG:** policy phạm vi dịch vụ — [mrapi-dev-services.json](../infra/iam/policies/mrapi-dev-services.json).
- **ĐÃ XONG:** policy bắt buộc MFA — [mrapi-force-mfa.json](../infra/iam/policies/mrapi-force-mfa.json); chưa xác nhận MFA từng user.
- **ĐÃ XONG:** policy giới hạn Region — [mrapi-region-guardrail.json](../infra/iam/policies/mrapi-region-guardrail.json).
- **ĐÃ XONG:** workload boundary — [mrapi-workload-boundary.json](../infra/iam/policies/mrapi-workload-boundary.json).
- **ĐÃ XONG:** trust role dashboard — [trust.json](../infra/iam/roles/mrapi-dashboard-role/trust.json).
- **ĐÃ XONG:** permission role dashboard — [permission.json](../infra/iam/roles/mrapi-dashboard-role/permission.json), gồm quyền bảng control, log dashboard và đọc health Route 53.
- **CHƯA XONG HỒ SƠ:** user/group membership, policy attachment/ARN/version, role ARN/boundary attachment, role proxy/authorizer và bằng chứng test quyền. Role monitoring bổ sung khi triển khai monitoring.

**Mục đích:** cho thành viên thao tác và dịch vụ truy cập đúng tài nguyên. **Owner:** L quản lý user/group/MFA/base/boundary; A quản lý execution role và policy dữ liệu, L review thay đổi boundary.

**Hướng dẫn:**

1. L bàn giao user/group/policy đã có, xác nhận MFA từng thành viên và ghi ARN/version/attachment thực tế. Không tạo lại tài nguyên đã có.
2. B/L gửi A danh sách thao tác cần dùng: bảng control/telemetry, log và trace nếu triển khai. A tạo hoặc tiếp nhận role từng Lambda.
3. Kiểm tra trust cho Lambda assume role; permission policy cấp quyền theo bảng/Region thực tế; boundary là trần quyền, không tự cấp quyền.

**Kết nối và lý do:** Lambda → IAM role → DynamoDB/CloudWatch/X-Ray để đọc dữ liệu và ghi quan sát. Trust và permission phải đúng để Lambda sử dụng role và truy cập tài nguyên.

**Bàn giao/kiểm thử:** trust, permission và boundary ARN; test đọc/ghi được tài nguyên cho phép và bị từ chối ngoài phạm vi. Lưu tại `infra/iam/`, role ARN trong `config/demo/global.json` theo cấu trúc hiện có. Không gắn workload boundary vào user để thay cho role.

## 3. DynamoDB — cấu hình, quyền API và telemetry — CHƯA CÓ CẤU HÌNH TRONG INFRA

**Mục đích:** lưu tài khoản/phiên/API/key và bản ghi request. **Owner:** A; L/B cùng chốt dữ liệu mà Lambda đọc/ghi.

**Hướng dẫn:**

1. Tiếp nhận `mrapi-control` Singapore L đã tạo; kiểm tra PK/SK, capacity, TTL/tag/ARN. Schema hiện hành ở [GATEWAY_DESIGN.md](GATEWAY_DESIGN.md); không tạo lại bảng orders.
2. L/B/A chốt key hash/status/tenant/scope API và cách xử lý key cũ. Chốt telemetry: requestId, tenantId, apiId, method/path, status, errorType, latency, region, timestamp; xác định query, retention và index trước khi tạo bảng.
3. A tạo telemetry Singapore và cấp quyền theo access pattern. Dùng script/item mẫu kiểm tra đọc/ghi/query trước khi chờ proxy.
4. B/L nhận tên bảng, đặt biến môi trường đúng code đang đọc, test bằng role thật. TTL dọn dữ liệu không thay việc kiểm tra hết hạn trong code.
5. Sau nghiệm thu Singapore mới thêm replica Tokyo theo thiết kế; đo đồng bộ hai chiều và tác động tới revoke/logout/xung đột cập nhật.

**Kết nối và lý do:** dashboard ↔ control để quản lý tài khoản/API/key; authorizer đọc key/scope để xác thực; proxy đọc API config và ghi telemetry; monitoring đọc dữ liệu phục vụ thống kê. Global Tables phục vụ dữ liệu giữa hai Region, cần kiểm thử độ trễ thay vì giả định đồng bộ tức thời.

**Bàn giao/kiểm thử:** tên/ARN/schema/index/TTL/capacity, policy, query mẫu và kết quả tenant isolation; lưu `infra/dynamodb/`, `config/demo/`. Không ghi PASS replication chỉ từ việc có replica.

## 4. Lambda — xử lý nghiệp vụ — CHƯA CÓ CẤU HÌNH TRONG INFRA

**Owner:** L làm dashboard và backend monitoring; B làm api/proxy và authorizer. A cấp role, C nhận ARN để nối API Gateway.

### Dashboard/portal — L

1. Tiếp nhận `mrapi-dashboard` Singapore đã cấu hình. Test `GET /` trả HTML 200 và `GET /api/me` không phiên trả 401; ghi lỗi import/handler/role/table nếu có.
2. Hoàn tất account/API config, tạo key có scope và thu hồi. Key gốc chỉ trả một lần, lưu hash; tenant lấy từ phiên. Chốt migration key cũ với B/A.
3. Bàn giao ARN cho C nối portal, rồi test signup/login, tạo/sửa/bật/tắt API, tenant chéo và revoke trên AWS.
4. Sửa code trong `src/dashboard/`, dùng script đóng gói của repo. ZIP dashboard dùng handler `dashboard/index.handler`, phải chứa HTML, module apis, shared và dependency.

**Kết nối và lý do:** API Gateway chuyển request tới dashboard; dashboard dùng control qua execution role để lưu trạng thái. Portal dùng Bearer phiên; không gắn authorizer API key vào đăng ký/đăng nhập.

### Authorizer và proxy — B

1. Nhận contract key/API/telemetry; dựng fixture hai tenant và backend mẫu trả thành công, lỗi HTTP, delay để tự làm trước khi tích hợp.
2. Authorizer kiểm tra hash/status/scope/tenant; bàn giao context tenantId/keyId/apiId theo contract B/C/L chốt. Chốt policy resource và cache theo route; tắt cache lúc test revoke.
3. `src/api/` hiện chỉ có health. Bổ sung proxy: tra config bằng tenant/apiId, kiểm tra enabled, ghép base path/path/query, chuyển method/body và trả status/body/header theo contract.
4. Kiểm tra DNS/IP tại kết nối, IPv4/IPv6, private/link-local/loopback/reserved và rebinding; kiểm soát redirect. Không nhận URL đích tự do hoặc chuyển key gateway/token portal/hop-by-hop header tới backend.
5. Giới hạn timeout/payload, chốt binary/base64 nếu hỗ trợ; phân biệt upstream HTTP error, timeout, connection error và gateway error.
6. Ghi telemetry theo schema; chốt hành vi khi ghi thất bại, có log/cảnh báo và không coi thống kê đã đầy đủ khi mất bản ghi.
7. Deploy Singapore bằng role A bàn giao, gửi C ARN/handler/env/version; sau nghiệm thu mới nhân cùng code sang Tokyo.

**Kết nối và lý do:** API Gateway gọi authorizer để xác thực, chuyển context cho proxy; proxy đọc control để chọn đích được đăng ký, gọi backend và ghi telemetry. Health phản ánh sức khỏe gateway, không mặc định coi backend của một khách hàng hỏng là cả Region hỏng.

### Backend monitoring — L, giai đoạn sau

Tạo `src/monitoring/index.mjs` theo [contract frontend](../monitoring-web/docs/integration/backend-api.md). Nhận nguồn metric/ARN từ các owner, trả missing khi chưa có nguồn. C nối API và frontend, xác thực quyền xem dữ liệu trước khi mở route.

**Bàn giao Lambda:** commit/ZIP hash, function ARN, runtime/handler/role/env/timeout, event test và response, context/error/telemetry contract; lưu `infra/lambda/` theo Region. Không lưu secret vào report/config.

## 5. API Gateway — cửa vào HTTP — CHƯA CÓ CẤU HÌNH TRONG INFRA

**Mục đích:** cung cấp URL, chọn Lambda và áp dụng authorizer. **Owner:** C, nhận dashboard từ L và api/authorizer từ B.

**Hướng dẫn:**

1. Tạo hoặc tiếp nhận REST API Regional Singapore; cấu hình Lambda proxy integration và stage `demo`.
2. Nối các route dưới đây. Có thể dùng Lambda echo kiểm tra wiring khi chờ code, ghi rõ mock và thay bằng Lambda thật trước nghiệm thu.

| Route | Lambda | Xác thực |
|---|---|---|
| `GET /` | dashboard | NONE tại API Gateway |
| `ANY /api/{proxy+}` | dashboard | Lambda kiểm tra Bearer cho route riêng tư |
| `/proxy/{apiId}` và đường dẫn con | api/proxy | REQUEST authorizer dùng x-api-key; method/path chi tiết phải chốt |
| `GET /health` | api | Công khai, không cache |
| Monitoring, giai đoạn sau | monitoring | Theo contract và quyền xem dữ liệu đã chốt |

3. Khi nối API Gateway với Lambda, C cấu hình resource policy cho phép API Gateway invoke đúng function, giới hạn theo API/stage/method phù hợp; L hỗ trợ review quyền nếu cần. Deploy stage sau khi đổi integration/route; test URL trực tiếp trước DNS/CloudFront. Cấu hình CORS/preflight khi khác origin, không bắt API key ở OPTIONS cần cho preflight.
4. Điền apiId/stage/baseUrl vào config. Mở portal ở URL gốc stage kết thúc bằng `/`; baseUrl trong config theo quy ước không có `/` cuối.
5. Sau Singapore, đối chiếu route/authorizer/cache/integration hai Region; không chỉ đối chiếu code Lambda.

**Kết nối và lý do:** client → API Gateway → authorizer/proxy hoặc dashboard; route phân biệt luồng quản trị và luồng gọi backend. `/api/{proxy+}` là catch-all của portal, khác `/proxy/...` chuyển tiếp tới backend.

**Bàn giao/kiểm thử:** `infra/apigateway/` có route/method/integration/auth/CORS/stage/resource permission, URL thật và response. Test key thiếu/sai/revoked/sai scope, portal và health; không dùng echo làm bằng chứng hoàn thành proxy.

## 6. CloudWatch — log, metric và cảnh báo — CHƯA CÓ CẤU HÌNH TRONG INFRA

**Owner:** L; B/C cấu hình log/metric tại Lambda/API Gateway, A bảo đảm quyền role.

**Hướng dẫn:** kiểm tra log từng function và stage; đối chiếu requestId xuyên API/proxy/telemetry, phân biệt lỗi backend với lỗi gateway. Chọn metric/period/threshold và retention rõ ràng; tạo dashboard/alarm theo Region, gây lỗi có kiểm soát rồi kiểm tra alarm. Giai đoạn sau L cấp metric thật cho monitoring backend, C đối chiếu giao diện với nguồn.

**Kết nối và lý do:** API Gateway/Lambda → CloudWatch để biết request hỏng ở đâu; CloudWatch alarm → SNS để thông báo; monitoring backend → CloudWatch để lấy số đo. Telemetry nghiệp vụ trong DynamoDB bổ sung cho metric hạ tầng, không thay thế lẫn nhau.

**Bàn giao/kiểm thử:** `infra/monitoring/` lưu log group/retention, dashboard JSON, alarm/nguồn metric/ARN và bằng chứng alarm thật. Không ghi key/token/body nhạy cảm vào log mặc định.

## 7. SNS và AWS Budgets — thông báo và chi phí — CHƯA CÓ CẤU HÌNH TRONG INFRA

**Owner:** L. Kiểm tra tài nguyên đã có, tạo hoặc tiếp nhận topic/subscription; xác nhận subscription cần thiết. Cấu hình budget và ngưỡng chi phí theo [BASE_SETUP.md](BASE_SETUP.md), nối kênh nhận được hỗ trợ; nối alarm vận hành với SNS.

**Kết nối và lý do:** CloudWatch alarm → SNS → người nhận để biết lỗi; Budgets → kênh thông báo chi phí để nhóm kiểm soát tài nguyên đồ án. Hai nguồn cảnh báo có mục đích khác nhau.

**Bàn giao/kiểm thử:** topic ARN, trạng thái subscription, budget/ngưỡng và bằng chứng nhận test notification. Test SNS không tự chứng minh budget đã vượt ngưỡng hay alarm thật đã kích hoạt. Ghi tại `infra/monitoring/` và hồ sơ base liên quan.

## 8. S3 — lưu export và hosting, giai đoạn sau — CHƯA CÓ CẤU HÌNH TRONG INFRA

**Owner:** A quản lý bucket/replication/role; B/L làm producer export; C dùng bucket hosting frontend.

**Hướng dẫn:** chốt định dạng object/prefix/retention/lịch export và producer trước; tạo bucket export Singapore/Tokyo với private access, versioning/lifecycle, replication và policy. Test object mẫu trước rồi test object do producer thật xuất; đo hai chiều/RTC nếu thuộc yêu cầu. Bucket hosting `monitoring-web/dist` chuẩn bị riêng theo thiết kế, C nối CloudFront/OAC.

**Kết nối và lý do:** telemetry → producer → S3 để lưu bản xuất/báo cáo; S3 replication → bucket Region còn lại để có bản sao. Không có producer thì cấu hình replication không tự xuất dữ liệu DynamoDB. CloudFront → bucket hosting để phân phối frontend; không dùng bucket log làm website công khai.

**Bàn giao/kiểm thử:** `infra/s3/` có bucket/Region/policy/versioning/lifecycle/replication/role, contract producer và bằng chứng object nguồn/đích cùng số đo. Không đánh dấu export hoàn tất từ object tải tay.

## 9. ACM — chứng chỉ TLS — CHƯA CÓ CẤU HÌNH TRONG INFRA

**Owner:** C; L chốt domain/quyền sở hữu trước khi tạo. Lập bảng hostname → nơi kết thúc TLS → Region certificate; tạo cert phù hợp, thực hiện DNS validation và đợi trạng thái hợp lệ. Tham chiếu hướng dẫn domain hiện có khi triển khai.

**Kết nối và lý do:** ACM → custom domain API Gateway/CloudFront để HTTPS có chứng chỉ đúng hostname; DNS cung cấp record xác thực. Cert API Gateway Regional đặt tại Region tương ứng; viewer certificate CloudFront dùng us-east-1 theo [hướng dẫn AWS](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cnames-and-https-requirements.html).

**Bàn giao/kiểm thử:** hostname/cert ARN/Region/validation và HTTPS thật; lưu cùng hồ sơ `infra/route53/`, CloudFront khi tạo. Cert đã yêu cầu chưa đồng nghĩa domain đã dùng được.

## 10. Route 53 — DNS và lựa chọn Region — CHƯA CÓ CẤU HÌNH TRONG INFRA

**Owner:** C, L chốt domain; B bàn giao health endpoint.

**Hướng dẫn:** ghi hosted zone và domain mapping; sau khi hai Region hoạt động mới tạo routing/health check theo topology đã duyệt. Health check dùng endpoint riêng từng Region, không dùng domain chung đang định tuyến; xác định đúng `/health` hoặc `/demo/health` theo mapping. Tham số dự kiến 30 giây/3 lần lỗi phải ghi cấu hình thực tế khi triển khai.

**Kết nối và lý do:** DNS → endpoint từng Region giúp client tìm cửa vào; health check → routing giúp tránh endpoint không khỏe theo thiết kế. DNS không sửa được backend khách hàng hỏng, và cache làm thời gian chuyển hướng quan sát được thay đổi.

**Bàn giao/kiểm thử:** `infra/route53/` có record/target/routing/health ID/TTL và timeline lỗi → chuyển hướng → phục hồi. Dùng `HEALTH_FORCE_FAIL` có kiểm soát, thử ít nhất ba lần theo kế hoạch; không khẳng định failover cố định 90 giây.

## 11. CloudFront — phân phối nội dung và cửa vào theo topology — CHƯA CÓ CẤU HÌNH TRONG INFRA

**Owner:** C; A cấp hosting bucket, L review topology và quyền. Đợt hiện tại chỉ chốt đề xuất.

**Hướng dẫn:** khi bắt đầu triển khai CloudFront, C cùng L kiểm tra policy IAM thực tế và bổ sung quyền có phạm vi phù hợp nếu thiếu; policy giới hạn dịch vụ hiện chưa liệt kê CloudFront. Vẽ rõ domain → distribution → origin trước khi tạo. Không gắn cùng alternate domain name lên hai distribution để kỳ vọng DNS chọn theo Region; xem [giới hạn CNAME AWS](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/CNAMEs.html). Chốt cách DNS/failover tương tác với origin, rồi cấu hình origin/stage path, TLS và behavior.

**Kết nối và lý do:** CloudFront → S3 qua OAC phục vụ frontend private; nếu đặt API/portal phía sau thì CloudFront → API Gateway và phải forward method/query/Authorization/x-api-key cần thiết. Không cache dữ liệu có phiên/key hoặc health; static asset có policy riêng. Kiểm tra stage không bị thêm hai lần và Host/origin TLS khớp.

**Bàn giao/kiểm thử:** tạo `infra/cloudfront/` khi triển khai thật, lưu distribution/domain/cert/origin/behavior/cache/OAC. Test HTTPS, SPA deep link, auth/header/query, đổi dữ liệu không nhận response cache cũ và failover theo topology. Frontend dùng fixture phải giữ nhãn DEMO DATA đến khi nối nguồn thật.

## 12. X-Ray — theo dõi một request, giai đoạn sau — CHƯA CÓ CẤU HÌNH TRONG INFRA

**Owner:** L xác minh trace; C bật tracing REST stage, B/L bật Lambda tracing và instrumentation, A cấp quyền trace.

**Kết nối và lý do:** API Gateway → Lambda → DynamoDB/backend tạo trace để xác định đoạn chậm/lỗi trong cùng request. Bật tracing một dịch vụ chưa đủ chứng minh đã thấy mọi downstream call.

**Bàn giao/kiểm thử:** trace/service map và requestId đối chiếu log/telemetry; ghi cấu hình tại `infra/monitoring/`, `infra/lambda/`, `infra/apigateway/`. Không đưa secret vào metadata.

## 13. Thứ tự ghép các dịch vụ

```text
IAM role + DynamoDB control/telemetry
    → Lambda dashboard / authorizer / proxy
    → API Gateway Singapore
    → test request thật + CloudWatch + telemetry
    → review ngày 18/10
    → Tokyo + Global Tables / S3 export và replication
    → ACM + Route 53 + CloudFront theo topology đã chốt
    → monitoring thật + X-Ray + failover/phục hồi
```

Các dịch vụ có thể chuẩn bị song song bằng fixture/echo/script riêng. Điểm nối phải thống nhất trong [GATEWAY_DESIGN.md](GATEWAY_DESIGN.md): key/scope/migration, API config, proxy route/context/error, telemetry schema/query. Monitoring theo contract frontend. Đổi contract phải cập nhật producer, consumer, test và hướng dẫn cùng PR hoặc PR liên kết.

Sau thao tác Console, ghi cấu hình thật theo [RECORD_CONSOLE_CONFIG.md](runbooks/RECORD_CONSOLE_CONFIG.md). Config trong repo dùng bàn giao, không tự cập nhật AWS. Mỗi người sửa thư mục dịch vụ mình phụ trách; `src/shared/` do L review, thay đổi phải báo consumer.

## 14. Tiến độ giữ nguyên và nghiệm thu

**Đã xác nhận đến 14/10:** L đã cấu hình IAM user/group/base, 5 policy base, dashboard role, bảng control Singapore và Lambda dashboard. JSON policy/role đã có trong repo; từng ARN/version/attachment, MFA thành viên và cấu hình Console còn phải ghi theo bằng chứng thực tế. Local test/đóng gói đã làm không thay test AWS. Không tạo trùng hoặc xóa để làm lại.

**Chưa xác nhận hoàn tất:** API Gateway/stage/URL và e2e AWS, Budget/SNS/tag, key scope/proxy/telemetry mới, Tokyo/Global Tables, S3 replication/export, CloudFront/domain/ACM/Route 53, monitoring thật/X-Ray/failover.

| ID | Nghiệm thu ngày 18/10 | Owner phối hợp |
|---|---|---|
| D1 | Signup/login, tạo/sửa/bật/tắt API đúng tenant trên portal thật | L/C |
| D2 | Key có scope gọi backend mẫu, method/path/query/body/status đúng contract | B/C/L |
| D3 | Key thiếu/sai/revoked bị từ chối theo mã lỗi đã chốt | B/L/C |
| D4 | Key sai scope hoặc tenant không gọi được backend đích | B/L/A |
| D5 | API disabled bị chặn, backend lỗi/chậm được phân loại đúng | B/C |
| D6 | Đích nội bộ/không hợp lệ bị chặn trước kết nối | B |
| D7 | Request thật có telemetry đủ schema, query đúng tenant | A/B/L |
| D8 | Cấu hình/ARN/URL/code và hướng dẫn chạy lại đã bàn giao | Từng owner dịch vụ |

Mỗi người nộp `docs/reports/2026-10-18-<L-A-B-C>.md` theo [mẫu báo cáo](reports/FOUR_DAY_REPORT_TEMPLATE.md), bằng chứng tại `docs/evidence/2026-10-18/<L-A-B-C>/`. Báo cáo liệt kê theo dịch vụ: việc đạt, commit, tài nguyên/Region/config, input và output che secret, PASS/FAIL/NOT TESTED, cách chạy lại, mock/lỗi/dependency và người sửa.

Review: L do B/C; A do L/B; B do A/L; C do B/L. DONE cần chức năng đạt, code/config, bằng chứng thật và reviewer ACCEPTED. Không nộp password/token/key gốc/AWS secret/QR MFA.

L chủ trì review ngày 18/10. Nếu Singapore chưa đạt, sửa lỗi blocking và test lại trước khi nhân Region. Chỉ sau review mới giao ngày hạn đợt tiếp theo, dựa trên kết quả, ngày demo, tải từng người và topology đã chốt; cập nhật chính tài liệu này.
