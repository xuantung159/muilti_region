# Sửa thống kê trên portal

Gọi proxy thì vẫn 200 nhưng tab Tổng quan của portal trống. Nguyên nhân: proxy ghi vào bảng `mrapi-telemetry`, còn `/api/usage` lại đọc bộ đếm `USAGE#` cũ trong bảng control. Bản sửa cho `/api/usage` đọc thẳng telemetry theo tenant.

Toan đã deploy bản sửa lên hai region (xem [báo cáo](../reports/2026-11-01-dashboard-deploy.md)).

## Các bước

1. Đóng gói lại và upload `artifacts/lambda/dashboard.zip` cho `mrapi-dashboard`.
2. Thêm biến `TELEMETRY_TABLE=mrapi-telemetry`, giữ nguyên các biến cũ.
3. Role dashboard cần thêm quyền `dynamodb:Query` trên bảng telemetry (nhờ Tùng, file mẫu ở `infra/iam/roles/mrapi-dashboard-role/`).
4. Làm tương tự ở Tokyo với ARN của Tokyo. Chỉ sửa Lambda thì không cần deploy lại API Gateway.
5. Gọi vài request qua proxy, mở portal → Tổng quan → Làm mới. Response của `/api/usage` có `source: telemetry` là đúng bản mới.

## Vẫn trống thì xem

- Bảng telemetry có dòng mới của tenant đó chưa.
- Log proxy có `TELEMETRY_WRITE_FAILED` không. Proxy vẫn trả 200 dù ghi telemetry lỗi.
- Proxy có biến `TELEMETRY_TABLE` và quyền `PutItem` chưa.
- Request gọi thẳng vào backend hoặc bị authorizer chặn thì không được đếm, đó là đúng.
