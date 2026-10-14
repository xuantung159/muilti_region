# Cấu hình AWS Console xong → ghi lại vào infra

Áp dụng cho mọi thành viên theo [WORK_ASSIGNMENT.md](../WORK_ASSIGNMENT.md). Làm trên Console trước, kiểm tra đã lưu/hoạt động, rồi ghi **giá trị thực tế đang áp dụng** vào repo. Không tạo lại tài nguyên chỉ vì repo chưa có file.

## 1. Quy trình cho mỗi tài nguyên

1. Tạo hoặc sửa tài nguyên trên AWS Console; bấm Save/Create/Deploy theo dịch vụ.
2. Mở lại trang tài nguyên, kiểm tra Region, tên, trạng thái và cấu hình đã lưu.
3. Tạo/cập nhật file tại infra/<dịch-vụ>/ theo bảng dưới. Ghi ngày giờ Việt Nam, người thực hiện, phiên bản code nếu có.
4. Copy JSON đang áp dụng từ Console nếu có policy/dashboard; không thay bằng JSON mẫu khác với AWS thật.
5. Cập nhật tên/ARN/ID/URL trong config/demo tương ứng khi schema config đã có trường đó. Nếu chưa có, bàn giao trong file infra rồi chốt bổ sung config với consumer.
6. Test thao tác thực tế; lưu ảnh/output đã che secret tại docs/evidence/<dịch-vụ>/ và dẫn link từ file infra/báo cáo. Chưa test thì ghi NOT TESTED.
7. Commit/PR gồm cấu hình infra, config và bằng chứng/báo cáo. Sửa Console lần sau phải cập nhật cùng file, tránh giữ hai bản mâu thuẫn.

infra lưu cấu hình để dựng lại; config lưu địa chỉ/tên cho tích hợp; evidence lưu kết quả kiểm thử. Viết file infra không tự deploy hoặc cập nhật AWS.

## 2. File cần ghi sau từng phần

| Cấu hình đã làm | File bàn giao đề xuất | Nội dung tối thiểu |
|---|---|---|
| User/group IAM | infra/iam/README.md | Group, username/membership, policy attachment, trạng thái MFA xác nhận; không lưu thiết bị/QR/secret |
| 5 policy base | infra/iam/policies/<tên-policy>.json | JSON phiên bản đang mặc định trên AWS; policy name/ARN/version ghi trong README |
| Role dịch vụ | infra/iam/roles/<role>/README.md, trust.json, permissions.json | Role ARN, service trust, boundary ARN, inline/managed policy, JSON thực tế |
| DynamoDB | infra/dynamodb/<region>/<table>.md | PK/SK, capacity, TTL, indexes nếu có, replica/consistency đã chọn, tags, ARN |
| Lambda | infra/lambda/<region>/<function>.md | Runtime, handler, role, env không secret, memory/timeout, ZIP/commit, tracing, log retention, resource permissions |
| REST API | infra/apigateway/<region>/<api>.md | API ID/type, stage, resource/method → Lambda, proxy integration, auth/cache, CORS, invoke permission, URL |
| Route 53/ACM | infra/route53/README.md, records.md, health-checks.md, certificates.md | Hosted zone/NS, record type/target/routing/region/health ID, health path/threshold, certificate ARN/Region/domain/status |
| CloudFront | infra/cloudfront/<distribution-id>.md | Origin/stage path, domains/cert, behavior/method/cache/header/query, OAC, error/health cache, routing topology |
| S3 | infra/s3/<bucket>/README.md, replication.json nếu xuất được | Region/ARN, public access, versioning, lifecycle, replication role/rules/RTC, policy thực tế; phân biệt hosting/export |
| SNS/CloudWatch/X-Ray | infra/monitoring/<tên>.md, dashboard.json nếu có | Topic/subscription trạng thái, alarm metric/dimension/threshold/action, dashboard JSON, tracing/sampling/role |
| Budget/cost tag | infra/monitoring/budget.md | Amount/currency/period/scope, credit/refund options, threshold/recipient phù hợp quyền riêng tư, trạng thái tag |
| Resource Groups | infra/monitoring/resource-groups.md | Region, tag query, resource types |

Các thư mục/file chưa tồn tại thì người làm tạo khi ghi nhận; không tạo sẵn tài nguyên AWS để khớp cây thư mục. Policy managed gắn vào role có thể nhiều file: ghi từng tên/ARN và xuất từng JSON customer-managed cần bàn giao; không gộp lại làm thay đổi quyền.

## 3. IAM bạn đã làm: cách ghi lại

1. IAM → Policies → từng policy → JSON: copy nội dung đang áp dụng, lưu tên file tương ứng: mrapi-dev-iam.json, mrapi-dev-services.json, mrapi-force-mfa.json, mrapi-region-guardrail.json, mrapi-workload-boundary.json.
2. IAM → User groups → nhóm → Users/Permissions: ghi membership và attachment trong infra/iam/README.md, đối chiếu BASE_SETUP. Policy đã tạo không có nghĩa đã attach.
3. IAM → Roles → mrapi-dashboard-role → Trust relationships: copy JSON vào infra/iam/roles/mrapi-dashboard-role/trust.json.
4. Role → Permissions → inline policy → JSON: copy vào permissions.json; ghi tên policy, managed policy nếu có và boundary ARN trong README của role.
5. Copy ARN role vào config/demo/global.json nếu chưa có. Lưu bằng chứng test quyền vào docs/evidence/iam/.

Giữ ARN thực tế khi repo nội bộ cho phép; Account ID không phải password nhưng có thể che trong báo cáo công khai. Nếu thay bằng placeholder để chia sẻ thì ghi rõ đây là bản đã che, cần thay lại khi dựng. Không đổi ${aws:username} thành username cố định khi copy policy MFA.

## 4. Mẫu ghi nhận tài nguyên

Sao chép mẫu sau, thay placeholder bằng giá trị Console. Không ghi giá trị dự kiến thành đã áp dụng.

```markdown
# [Tên tài nguyên] — [Region hoặc global]

- Người thực hiện: [Tên]
- Lần đối chiếu Console: [Ngày/giờ Việt Nam]
- Trạng thái: [Đã cấu hình / Đã test / Chưa test]
- Tên/ARN/ID: [Thực tế]
- Tag: [Thực tế]

## Cấu hình đang áp dụng

| Thuộc tính | Giá trị |
|---|---|
| [Thuộc tính] | [Giá trị Console] |

## Cách dựng lại

1. [Console → dịch vụ → thao tác]
2. [Thiết lập theo bảng/JSON kèm theo]
3. [Save/Deploy và điều kiện trước khi dùng]

## Kiểm thử và bằng chứng

- Thao tác: [Input đã che secret]
- Mong đợi: […]
- Thực tế: […] hoặc NOT TESTED
- Bằng chứng: [Link ảnh/output]
- Lỗi/hạn chế: […]

## Bàn giao

- Config đã cập nhật: [File/trường]
- Consumer: [Người/phần sử dụng]
- Reviewer/kết luận: [Tên, kết quả]
```

## 5. Ví dụ Lambda dashboard

Tạo infra/lambda/ap-southeast-1/mrapi-dashboard.md. Đối chiếu Console rồi ghi:

- Runtime/architecture, handler dashboard/index.handler, execution role ARN thực tế.
- CONTROL_TABLE=mrapi-control, PROJECT=mrapi; memory 256 MB, timeout 10 giây **nếu đúng cấu hình hiện tại**.
- ZIP artifacts/lambda/dashboard.zip, commit dùng để tạo ZIP; nếu không biết commit đã upload thì ghi chưa xác nhận.
- Log group/retention thực tế, tracing, resource policy API Gateway nếu đã nối.
- Test GET / → 200 HTML, /api/me không token → 401; chưa chạy thì ghi NOT TESTED.

ZIP là file sinh ra, không commit vào infra. Password, token, API key, AWS secret, QR MFA và biến môi trường bí mật không được ghi; chỉ ghi tên biến và nơi quản lý secret nếu có.

## 6. Trước khi nộp PR

- Giá trị được kiểm tra từ Console, không copy cấu hình dự kiến mà chưa đối chiếu.
- Có file infra, thông tin config cho consumer và kết quả test/bằng chứng.
- JSON giữ nguyên ngữ nghĩa; nội dung không chứa secret.
- Đường dẫn/link tồn tại; nếu tài nguyên chưa làm, ghi rõ chưa làm.
- Reviewer có thể dựng lại hoặc kiểm tra dựa trên nội dung bàn giao.
