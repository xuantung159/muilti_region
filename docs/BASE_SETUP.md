# Nền tảng AWS và IAM đã áp dụng

Owner: L — Tùng. Phân công: [WORK_ASSIGNMENT.md](WORK_ASSIGNMENT.md). Tài liệu này ghi nhận cách IAM đã làm và hướng dẫn kiểm tra/bổ sung; không yêu cầu tạo lại user hoặc policy đã tồn tại.

## 1. Trạng thái đã biết

- Tùng xác nhận đã tạo IAM user admin/thành viên và đã kiểm tra IAM base theo hướng dẫn.
- Ảnh Console cung cấp cho thấy đủ 5 policy: mrapi-dev-iam, mrapi-dev-services, mrapi-force-mfa, mrapi-region-guardrail, mrapi-workload-boundary.
- Ảnh không xác nhận policy attachment, membership, MFA từng người, nội dung JSON hoặc phiên bản policy. Kiểm tra các mục này ở Console trước khi ghi bằng chứng.
- Tùng báo đã hoàn thành đến bước tạo/cấu hình Lambda dashboard Singapore, sau bảng control/role/đóng gói. Test Lambda/API Gateway/e2e chưa được xác nhận.
- Budget, SNS, Resource Groups và cost tag chưa được xác nhận hoàn tất.
- Repo hiện không có infra/iam/ và các JSON IAM từng được tham chiếu. Policy đang có trên AWS là nơi đối chiếu; không tự khôi phục hoặc tạo lại chỉ vì thiếu file repo. Khi cần bàn giao, xuất JSON từ Console về infra/iam/ theo mục 8.

## 2. User, group và policy: gắn ở đâu?

| Đối tượng | Cấu hình theo hướng dẫn đã áp dụng |
|---|---|
| User admin của Tùng | Thành viên group mrapi-admins; không gắn workload boundary vào user |
| User A, B, C | Thành viên group mrapi-developers; không gắn workload boundary vào user |
| Group mrapi-admins | AdministratorAccess + mrapi-force-mfa + mrapi-region-guardrail |
| Group mrapi-developers | PowerUserAccess + mrapi-force-mfa + mrapi-region-guardrail + mrapi-dev-services + mrapi-dev-iam |
| Role Lambda/S3 của dự án | Boundary mrapi-workload-boundary + policy cấp quyền thực tế + trust policy dịch vụ |

Danh sách 5 customer-managed policy trong ảnh khác danh sách 5 policy gắn vào group developers: developers dùng **PowerUserAccess**, không gắn **mrapi-workload-boundary** vào group.

Boundary chỉ giới hạn quyền tối đa; không tự cấp quyền. IAM hỗ trợ boundary cho user hoặc role, nhưng cấu hình dự án này chỉ dùng workload boundary cho role dịch vụ. [AWS: permissions boundaries](https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_boundaries.html).

### Kiểm tra group/user đã tạo

1. IAM → User groups → mrapi-admins → Permissions: đối chiếu 3 policy; Users: có admin của Tùng.
2. IAM → User groups → mrapi-developers → Permissions: đối chiếu 5 policy; Users: có các thành viên.
3. IAM → Users → chọn user → Groups: kiểm tra đúng group.
4. Tab Permissions → Permissions boundary: user không cần mrapi-workload-boundary.
5. Với admin, chỉ gỡ AdministratorAccess gắn Directly sau khi xác nhận quyền admin qua group đã có. Không xóa policy AdministratorAccess khỏi group.
6. Nếu policy/group đã đúng thì giữ nguyên, không thêm bản trùng tên.

### Ý nghĩa 5 policy trong ảnh

| Policy | Vai trò | Nơi dùng |
|---|---|---|
| mrapi-force-mfa | Chặn phần lớn thao tác khi phiên chưa có MFA, cho phép bước tự thiết lập được liệt kê | Admin/developer group |
| mrapi-region-guardrail | Deny Region ngoài danh sách, với ngoại lệ dịch vụ toàn cục | Admin/developer group |
| mrapi-dev-services | Giới hạn tập dịch vụ của developer | Developer group |
| mrapi-dev-iam | Quyền IAM developer cho role dự án và yêu cầu boundary | Developer group |
| mrapi-workload-boundary | Trần quyền workload trên dịch vụ/tài nguyên cho phép | Permissions boundary của role |

Không suy ra nội dung policy chỉ từ tên. IAM → Policies → policy → JSON để đối chiếu phiên bản thực tế. Trước đây guardrail cho phép Singapore, Tokyo và us-east-1: us-east-1 không bị giới hạn riêng cho alarm nếu JSON chỉ kiểm tra Region; quy ước nhóm là dùng nó cho giám sát Route 53. Dịch vụ toàn cục có ngoại lệ theo NotAction. [AWS: Region deny](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_examples_aws_deny-requested-region.html).

## 3. MFA và đăng nhập

Các thành viên làm theo [MEMBER_LOGIN_MFA.md](MEMBER_LOGIN_MFA.md): đổi mật khẩu tạm → bật MFA → đăng xuất → đăng nhập lại bằng MFA. Tên user/alias phải dùng giá trị thực tế, không mặc định tung.dang hoặc mrapi-team đã tồn tại.

IAM user AWS khác tài khoản doanh nghiệp đăng ký trên portal. Password policy IAM không tự áp dụng cho mật khẩu portal.

Kiểm tra root có MFA và không dùng root để làm thường ngày. Kiểm tra access key root; nếu có key đang dùng, xác minh/chuyển workload trước khi thu hồi. Không tạo access key mới cho thành viên chỉ để chạy bài thử; ưu tiên CloudShell từ phiên phù hợp.

Chính sách mật khẩu IAM đã hướng dẫn: ít nhất 14 ký tự, chữ hoa/thường/số/ký tự đặc biệt, cho đổi mật khẩu, chống dùng lại 5 mật khẩu. Đây là cấu hình cần kiểm tra ở IAM → Account settings, chưa có ảnh xác nhận hiện tại.

## 4. Boundary khi tạo role

1. IAM → Roles → Create role → AWS service → Lambda hoặc S3 đúng mục đích.
2. Add permissions → Set permissions boundary → Use a permissions boundary → chọn mrapi-workload-boundary.
3. Đặt tên mrapi-<thành-phần>-role → tạo.
4. Role → Permissions → Add permissions → Create inline policy: cấp thao tác cần thiết trên ARN cụ thể.
5. Kiểm tra Trust relationships: dịch vụ nào được assume role.
6. Lưu ARN vào config/demo/global.json.

Role đã có: IAM → Roles → role → Permissions → Permissions boundary → Set boundary → chọn policy → lưu. Developer theo cấu hình đã kiểm tra phải gắn boundary ngay khi tạo role; không tạo thiếu rồi mới gắn.

Lambda: Change default execution role → Use an existing role. Không chọn tự tạo execution role thiếu boundary. API Gateway invoke Lambda cần resource-based permission trên Lambda, không được thay bằng việc gắn workload boundary.

Boundary có thể chặn quyền dù inline policy đã Allow. Khi lỗi, kiểm tra identity policy, boundary, resource policy và action/resource thực tế; lỗi thiếu Allow không nhất thiết có explicit deny.

## 5. Kiểm tra IAM base đã làm

Dùng developer đăng nhập lại bằng MFA, không dùng admin:

| Thử | Kết quả mong đợi |
|---|---|
| Tạo mrapi-test không boundary | Bị từ chối |
| Tạo mrapi-test với boundary đúng | Thành công |
| Gỡ boundary | Bị từ chối |
| Tạo test-x có boundary | Bị từ chối |
| Tạo Lambda Oregon bằng role có sẵn | Bị chặn Region |
| Xóa role thử mrapi-test | Thành công |

Tùng đã báo làm xong các bài thử này; lưu bằng chứng nếu có. Chỉ chạy lại khi sửa policy hoặc kết quả thực tế khác, không cần tạo role thử lại mỗi lần đọc tài liệu. Budget chưa xác nhận nên không mặc định ghi developer xem Budget thành công.

## 6. Budget và cost tag — bổ sung nếu chưa làm

1. Kiểm tra quyền Billing bằng admin; nếu bị chặn, root kiểm tra Account → IAM user and role access to Billing information → Activate IAM Access.
2. Billing and Cost Management → Budgets → Create budget → Cost budget, monthly recurring.
3. Tên mrapi-monthly; mức tham khảo 40 USD/tháng, L chốt mức thực tế.
4. Muốn theo dõi chi phí trước credit/refund thì loại Credits/Refunds khỏi phép tính nếu giao diện có các tùy chọn này. Nếu giữ, credit/refund có thể làm giảm cost được theo dõi; không khẳng định luôn bằng 0.
5. Cảnh báo tham khảo: Actual 50%, Actual 80%, Forecasted 100%; nhập email người nhận.
6. Tạo và lưu cấu hình/ảnh. Budget là cảnh báo, không tự dừng tài nguyên; có cảnh báo forecast còn phụ thuộc dữ liệu dự báo.
7. Gắn Project=mrapi cho tài nguyên. Billing → Cost allocation tags → activate Project khi tag xuất hiện; tag có độ trễ, không hẹn theo Ngày 3–4 cũ.

[AWS: budget filters](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-create-filters.html).

## 7. SNS và Resource Groups

SNS mrapi-alerts: tạo Standard topic tại Singapore, Tokyo, us-east-1 nếu chưa có. Create subscription → Email → nhập từng địa chỉ → người nhận bấm Confirm subscription. Ghi ARN/Region/subscription thực tế; chưa Confirm thì không báo xong kênh nhận email. Alarm chọn topic cùng Region. us-east-1 dùng cho metric/alarms health check Route 53.

Resource Groups: Singapore và Tokyo → Create resource group → Tag based → Project=mrapi, tên mrapi. Group chỉ hỗ trợ loại tài nguyên nhất định; không coi danh sách group là toàn bộ inventory, bổ sung config và Tag Editor khi rà/dọn.

## 8. Bàn giao theo phân công mới

- L: user/group/base/boundary, Budget, SNS, CloudWatch, portal/monitoring backend.
- A: DynamoDB, S3/export log/replication, role/policy dữ liệu; tiếp nhận role dashboard đã tạo.
- B: Lambda proxy/authorizer.
- C: API Gateway, Route 53, ACM, frontend monitoring.

Tên/Region/tag: Singapore và Tokyo; không dùng mốc Ngày 5 cũ để bắt đầu Tokyo. Tên ví dụ: mrapi-control, mrapi-dashboard, mrapi-api, mrapi-authorizer, mrapi-dashboard-role, mrapi-logs-<suffix>-<region>. Project=mrapi và Owner=L/A/B/C.

Lưu cấu hình vào infra/<dịch-vụ>, thông tin bàn giao vào config/demo, bằng chứng vào docs/evidence. JSON IAM xuất từ Console lưu lại infra/iam/policies, infra/iam/trust, infra/iam/roles khi cần; các thư mục này hiện chưa có trong repo. Kiểm tra ARN Account ID trước khi dùng lại; không sửa ${aws:username} thành username cố định trong policy MFA.

Khi thêm dịch vụ/quyền: người cần cung cấp action/resource và lỗi thật, L review base/boundary; không cấp admin cho developer để chữa lỗi. Xem [WORK_ASSIGNMENT.md](WORK_ASSIGNMENT.md) để biết owner/điểm nối.

## 9. Sau demo

Theo [cleanup.md](runbooks/cleanup.md): lưu bằng chứng, rà inventory hai Region/toàn cục, dọn đúng tài nguyên dự án và kiểm tra chi phí/domain renewal. IAM user/MFA/access key cần xử lý theo trạng thái thực tế; không giả định Console tự gỡ mọi dependency khi xóa user. Giữ khả năng quản trị cho đến khi kiểm tra hóa đơn và tài nguyên còn lại xong.
