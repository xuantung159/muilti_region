# Multi-Region API Platform

**Hướng hiện tại: gateway chuyển tiếp request của doanh nghiệp.** Đọc [thiết kế mới](docs/GATEWAY_DESIGN.md) và [bốn phần đầu](docs/runbooks/FIRST_FOUR_PARTS.md). Lambda api hiện chỉ có health; proxy chưa triển khai. `npm run test:e2e --prefix src` hiện kiểm tra tài khoản/API đích.

Đồ án API đa doanh nghiệp chạy tại Singapore và Tokyo.

## Cấu trúc và owner

| Thư mục | Nội dung | Owner |
|---|---|---|
| src/ | Lambda api, dashboard doanh nghiệp, authorizer, shared; monitoring chưa triển khai | B, L |
| monitoring-web/ | Frontend giám sát React; backend monitoring ở src/monitoring do L làm | C |
| config/demo/ | Tên, ID và URL tài nguyên từng Region, không có secret | A/B/C/L |
| infra/ | Cấu hình dịch vụ, schema và IAM policy để dựng lại | Theo dịch vụ |
| scripts/ | Đóng gói Lambda và so sánh cấu hình Region | L, B |
| tests/ | Test e2e, bảo mật, replication, failover | Cả nhóm |
| docs/ | Thiết kế, phân công, runbook, báo cáo, bằng chứng | Cả nhóm |
| artifacts/ | ZIP/build sinh ra, không commit | — |

## Bắt đầu

[Giải thích toàn bộ thư mục và cách tích hợp](docs/PROJECT_STRUCTURE_AND_INTEGRATION.md).

[Phân công hiện hành theo cụm dịch vụ](docs/WORK_ASSIGNMENT.md).

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

## Dashboard giám sát

```powershell
npm ci --prefix monitoring-web
npm run dev --prefix monitoring-web
```

[Hướng dẫn frontend và tích hợp](monitoring-web/README.md). Cổng doanh nghiệp tại src/dashboard/page.html là giao diện khác, do Lambda dashboard phục vụ.

## Tài liệu và trạng thái

- [Thiết kế gateway](docs/GATEWAY_DESIGN.md)
- [Base IAM/Budget/SNS](docs/BASE_SETUP.md)
- [Báo cáo tiến độ](docs/reports/progress/Bao_cao_tien_do.docx)

Tên trong config là tên dự kiến, ô trống là chưa bàn giao. Có code/thư mục không chứng minh tài nguyên đã triển khai. Proxy, telemetry, backend monitoring và S3 export còn cần triển khai.

Không commit password, API key, token, AWS credentials, QR MFA hoặc gói build.

