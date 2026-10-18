# API Gateway — trạng thái triển khai

Theo quy trình tại [runbook ghi nhận cấu hình Console](../../docs/runbooks/RECORD_CONSOLE_CONFIG.md): hồ sơ này ghi giá trị đã đối chiếu trong AWS, không tự triển khai tài nguyên.

| Region | API | Stage | Trạng thái |
|---|---|---|---|
| `ap-southeast-1` | `mrapi-api-sg` (`43vakggyh5`) | `demo` | Đã xác minh routes, Lambda integration, authorizer và Detailed metrics; xem [portal.md](ap-southeast-1/portal.md) |
| `ap-northeast-1` | Chưa có API trong AWS Console | `demo` dự kiến trong config | Chưa triển khai; không tự điền API ID/URL dự kiến |

Phần số liệu hai Region chưa hoàn tất vì Tokyo chưa có API Gateway. Việc truy vấn/đối chiếu CloudWatch và backend `/monitoring/*` thuộc phần tích hợp monitoring; chưa được xác nhận trong hồ sơ API Gateway này.
