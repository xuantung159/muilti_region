# Dọn dẹp sau demo

L kiểm tra danh sách tài nguyên trong `config/demo/` và Resource Groups ở cả hai Region trước khi xóa. Không chạy dọn dẹp trong lúc nhóm vẫn dùng hệ thống.

1. Lưu bằng chứng cần cho báo cáo.
2. Xóa record/health check, custom domain/API Gateway và chứng chỉ không còn dùng.
3. Xóa Lambda, alarm/dashboard và log group của dự án.
4. Tắt replication S3, dọn object/version/delete marker rồi xóa bucket export log của dự án.
5. Xóa replica và bảng DynamoDB theo trạng thái thực tế.
6. Dọn SNS subscription/topic và các role không còn được sử dụng.
7. Kiểm tra domain renewal, hosted zone và hóa đơn. Giữ quyền quản trị cần thiết đến khi kiểm tra xong chi phí cuối.

Ghi lại tài nguyên còn giữ và lý do; không xóa tài nguyên ngoài dự án theo tiền tố suy đoán.

