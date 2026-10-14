# Bàn giao IAM đã cấu hình trên AWS

Branch: feature/iam. Thư mục này lưu bản sao cấu hình Console thực tế, không tự tạo/cập nhật tài nguyên AWS. Hiện chưa có JSON xuất từ AWS; người thực hiện chép vào các đường dẫn dưới đây.

## Policy base đã tạo

IAM → Policies → chọn policy → JSON: copy phiên bản đang áp dụng vào:

| Policy AWS | File cần lưu |
|---|---|
| mrapi-dev-iam | policies/mrapi-dev-iam.json |
| mrapi-dev-services | policies/mrapi-dev-services.json |
| mrapi-force-mfa | policies/mrapi-force-mfa.json |
| mrapi-region-guardrail | policies/mrapi-region-guardrail.json |
| mrapi-workload-boundary | policies/mrapi-workload-boundary.json |

Giữ nội dung JSON thực tế. Không chép lại policy mẫu nếu nó khác bản đã áp dụng trên AWS. Giữ nguyên ${aws:username} trong policy MFA. Kiểm tra tên/ARN/default version ở Console và ghi dưới đây khi bàn giao.

## Role dashboard đã tạo

IAM → Roles → mrapi-dashboard-role:

- Trust relationships → JSON: roles/mrapi-dashboard-role/trust.json.
- Permissions → inline policy → JSON: roles/mrapi-dashboard-role/permissions.json.
- Nếu có nhiều inline policy, dùng file riêng theo tên policy và liệt kê tại README của role.
- Ghi role ARN, tên policy, managed policy attachment và boundary trong roles/mrapi-dashboard-role/README.md.
- Cập nhật ARN role thực tế vào ../../config/demo/global.json, trường roles.dashboard.

## User/group cần ghi lại

Đối chiếu IAM → User groups → Users/Permissions rồi điền:

| Group | User thực tế | Policy attachment thực tế |
|---|---|---|
| mrapi-admins | Chưa ghi nhận từ Console | Chưa ghi nhận từ Console |
| mrapi-developers | Chưa ghi nhận từ Console | Chưa ghi nhận từ Console |

Tham chiếu cấu hình nhóm mong đợi: [BASE_SETUP.md](../../docs/BASE_SETUP.md). Workload boundary dùng cho role, không gắn vào group/user trong cấu hình dự án này. Danh sách policy tồn tại không chứng minh đã attach.

## Thông tin phiên bản và kiểm thử

- Người xuất JSON/ngày giờ: Chưa điền.
- Policy ARN/default version: Chưa điền.
- Kết quả IAM test đã chạy/bằng chứng: Chưa dẫn link; đặt ảnh/output đã che secret tại docs/evidence/iam/.
- Reviewer: Chưa điền.

Không lưu password, AWS access/secret key, session token, API key hoặc QR MFA. Hướng dẫn chung: [RECORD_CONSOLE_CONFIG.md](../../docs/runbooks/RECORD_CONSOLE_CONFIG.md).
