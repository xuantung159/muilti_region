# Multi-Region API Platform

**Hướng hiện tại: gateway chuyển tiếp request của doanh nghiệp.** Đọc [thiết kế mới](docs/GATEWAY_DESIGN.md) và [bốn phần đầu](docs/runbooks/FIRST_FOUR_PARTS.md). Proxy, authorizer có scope và telemetry đã có code/test local, chưa deploy ([giải thích](docs/GIAI_THICH_UU_TIEN_2.md)). `npm run test:e2e --prefix src` kiểm tra tài khoản/API đích; `npm run test:e2e:proxy --prefix src` kiểm tra proxy sau khi nối API Gateway.

Đồ án API đa doanh nghiệp chạy tại Singapore và Tokyo.

## Cấu trúc và owner

| Thư mục | Nội dung | Owner |
|---|---|---|
| src/ | Lambda api, dashboard doanh nghiệp, authorizer, shared; monitoring chưa triển khai | B, L |
| monitoring-web/ | Frontend React dùng chung: portal doanh nghiệp và giám sát; backend monitoring chưa triển khai | C |
| config/demo/ | Tên, ID và URL tài nguyên từng Region, không có secret | A/B/C/L |
| infra/ | Cấu hình dịch vụ, schema và IAM policy để dựng lại | Theo dịch vụ |
| scripts/ | Đóng gói Lambda và so sánh cấu hình Region | L, B |
| tests/ | Test e2e, bảo mật, replication, failover | Cả nhóm |
| docs/ | Thiết kế, phân công, runbook, báo cáo, bằng chứng | Cả nhóm |
| artifacts/ | ZIP/build sinh ra, không commit | — |

## Bắt đầu

[Giải thích toàn bộ thư mục và cách tích hợp](docs/PROJECT_STRUCTURE_AND_INTEGRATION.md).

[Phân công theo dịch vụ AWS và hướng dẫn tích hợp](docs/WORK_ASSIGNMENT.md).

1. Đọc [đăng nhập và MFA](docs/MEMBER_LOGIN_MFA.md).
2. Làm theo [bốn phần đầu](docs/runbooks/FIRST_FOUR_PARTS.md).
3. Điền tài nguyên tại [config](config/README.md).
4. Đọc [thiết kế gateway](docs/GATEWAY_DESIGN.md) và [dọn dẹp](docs/runbooks/cleanup.md).

## Backend

```powershell
npm ci --prefix src
npm run package --prefix src
npm run test:e2e --prefix src
```

E2E cần API thật và baseUrl trong config/demo/ap-southeast-1.json. Script tạo dữ liệu thử thật; xem runbook triển khai trước khi chạy.

Control plane dùng bảng mrapi-control, khóa PK/SK. Portal dùng REST Lambda proxy integration và tự kiểm tra Bearer phiên; không gắn authorizer API key vào portal. REQUEST authorizer dùng x-api-key sẽ nối cho route proxy sau khi key scope/proxy hoàn tất. Một bản code dùng cho cả hai Region.

## Frontend dùng chung

```powershell
npm ci --prefix monitoring-web
npm run dev --prefix monitoring-web
```

[Hướng dẫn frontend và tích hợp](monitoring-web/README.md). Mở `/portal` để đăng nhập, quản lý API đích và key; các trang giám sát dùng chung sidebar. Lambda `src/dashboard/` chỉ phục vụ API; giao diện HTML cũ đã chuyển sang React.

Portal cần cấu hình `VITE_PORTAL_API_URL` hoặc proxy dev `PORTAL_API_TARGET` trong `monitoring-web/.env.local`. Đây là URL API Gateway bao gồm stage, không thêm `/api`. Monitoring vẫn dùng `VITE_MONITORING_API_URL` riêng. Dữ liệu demo chỉ áp dụng cho monitoring.

## Tài liệu và trạng thái

- [Thiết kế gateway](docs/GATEWAY_DESIGN.md)
- [Base IAM/Budget/SNS](docs/BASE_SETUP.md)
- [Báo cáo tiến độ](docs/reports/progress/Bao_cao_tien_do.docx)

Tên trong config là tên dự kiến, ô trống là chưa bàn giao. Có code/thư mục không chứng minh tài nguyên đã triển khai. Proxy, telemetry, backend monitoring và S3 export còn cần triển khai.

Không commit password, API key, token, AWS credentials, QR MFA hoặc gói build.

