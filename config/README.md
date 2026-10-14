# Cấu hình bàn giao

`demo/global.json`: C điền domain/hosted zone sau khi L chốt domain; A điền ARN role, tiếp nhận ARN role dashboard đã có từ L.
`demo/<region>.json`: A điền bảng và bucket khi schema export được chốt; B điền proxy/authorizer; L điền dashboard/monitoring; C điền API ID/stage/base URL. Cấu hình hiện chưa có trường bucket export, bổ sung khi thống nhất contract.

Tên đã điền là tên dự kiến, không chứng minh tài nguyên đã được tạo. Ô trống là chưa bàn giao. `baseUrl` phải gồm stage, không có dấu `/` cuối.

Không lưu password, API key, token hoặc AWS secret key. AWS credentials do CLI/profile hoặc CloudShell cung cấp.

Lambda không tự đọc config này: phải đặt env trên AWS. Xem [phân công](../docs/WORK_ASSIGNMENT.md).
