# Multi-Region API Platform

**Hướng hiện tại: gateway chuyển tiếp request của doanh nghiệp.** Đọc [thiết kế mới](docs/thiet-ke-gateway.md) và [bốn phần đầu](docs/runbooks/dung-portal-singapore.md). Theo [hồ sơ triển khai](infra/DEPLOYED_STATE.md), proxy, authorizer có scope và telemetry đã triển khai hai Region và đã nghiệm thu bằng key thật trên AWS ngày 08/11/2026 ([kết quả E2E](docs/reports/e2e-acceptance.md)). `npm run test:e2e --prefix src` kiểm tra tài khoản/API đích; `npm run test:e2e:proxy --prefix src` kiểm tra proxy sau khi nối API Gateway.

Đồ án API đa doanh nghiệp chạy tại Singapore và Tokyo.

## Cấu trúc và owner

| Thư mục | Nội dung | Owner |
|---|---|---|
| src/ | Lambda proxy, dashboard doanh nghiệp, authorizer, monitoring, exporter và shared | B, L |
| monitoring-web/ | Frontend React dùng chung: portal doanh nghiệp và giám sát | C |
| config/demo/ | Tên, ID và URL tài nguyên từng Region, không có secret | A/B/C/L |
| infra/ | Cấu hình dịch vụ, schema và IAM policy để dựng lại | Theo dịch vụ |
| scripts/ | Đóng gói Lambda và so sánh cấu hình Region | L, B |
| tests/ | Test e2e, bảo mật, replication, failover | Cả nhóm |
| docs/ | Thiết kế, phân công, runbook, báo cáo, bằng chứng | Cả nhóm |
| artifacts/ | ZIP/build sinh ra, không commit | — |

## Bắt đầu

[Giải thích toàn bộ thư mục và cách tích hợp](docs/cau-truc-du-an.md).

[Phân công theo dịch vụ AWS và hướng dẫn tích hợp](docs/phan-cong.md).

1. Đọc [đăng nhập và MFA](docs/dang-nhap-mfa.md).
2. Làm theo [bốn phần đầu](docs/runbooks/dung-portal-singapore.md).
3. Điền tài nguyên tại [config](config/README.md).
4. Đọc [thiết kế gateway](docs/thiet-ke-gateway.md) và [dọn dẹp](docs/runbooks/don-tai-nguyen.md).

## Backend

```powershell
npm ci --prefix src
npm run package --prefix src
npm run test:e2e --prefix src
```

E2E cần API thật và baseUrl trong config/demo/ap-southeast-1.json. Script tạo dữ liệu thử thật; xem runbook triển khai trước khi chạy.

Control plane dùng bảng mrapi-control, khóa PK/SK. Portal dùng REST Lambda proxy integration và tự kiểm tra Bearer phiên; không gắn authorizer API key vào portal. Theo hồ sơ triển khai, route proxy đã nối REQUEST authorizer dùng x-api-key, cache TTL 0. Một bản code dùng cho cả hai Region.

## Frontend dùng chung

Đã có bản triển khai dùng hostname AWS: [mở portal](https://d2hkrs5dvlrte6.cloudfront.net/portal). Theo hồ sơ triển khai, CloudFront dùng API latency domain và monitoring đã có dữ liệu thật. Domain chính: [app.multi-region.io.vn/portal](https://app.multi-region.io.vn/portal). Xem [cấu hình hosting, kiểm thử và cách gắn domain sau](infra/cloudfront/README.md).

```powershell
npm ci --prefix monitoring-web
npm run dev --prefix monitoring-web
```

[Hướng dẫn frontend và tích hợp](monitoring-web/README.md). Mở `/portal` để đăng nhập, quản lý API đích và key; các trang giám sát dùng chung sidebar. Lambda `src/dashboard/` chỉ phục vụ API; giao diện HTML cũ đã chuyển sang React.

Portal cần cấu hình `VITE_PORTAL_API_URL` hoặc proxy dev `PORTAL_API_TARGET` trong `monitoring-web/.env.local`. Đây là URL API Gateway bao gồm stage, không thêm `/api`. Monitoring vẫn dùng `VITE_MONITORING_API_URL` riêng. Dữ liệu demo chỉ áp dụng cho monitoring.

## Tài liệu và trạng thái

- [Thiết kế gateway](docs/thiet-ke-gateway.md)
- [IAM](infra/iam/README.md), [Budget](infra/monitoring/budget.md) và [SNS us-east-1](infra/monitoring/sns/mrapi-alerts.us-east-1.md)
- [Báo cáo tiến độ](docs/reports/progress/Bao_cao_tien_do.docx)

Trạng thái hiện hành: [hồ sơ triển khai](infra/DEPLOYED_STATE.md). Nghiệm thu live ngày 08/11/2026: [E2E hai Region](docs/reports/e2e-acceptance.md) (38/39 ca đạt, ca còn lại là lệch tài liệu đã sửa; thu hồi key xuyên Region dưới 1,34 giây), [vận hành](docs/reports/ops-verification.md) (export theo lịch, replication, Route 53, alarm, X-Ray, bảo mật S3) và [sửa cấu hình](docs/reports/config-fixes.md). Còn lại: xác nhận thư cảnh báo tới hộp thư; quota Lambda 10 concurrent mỗi Region; REST API Tokyo còn TLS_1_0 ở endpoint execute-api. [Kịch bản quay video demo](docs/kich-ban-quay-video.md).

Không commit password, API key, token, AWS credentials, QR MFA hoặc gói build.

