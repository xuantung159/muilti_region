# Dọn tài nguyên sau khi chấm

Tùng làm, sau khi đã chấm xong và lưu đủ ảnh, số liệu cho báo cáo. Không dọn khi nhóm còn đang dùng.

Làm theo thứ tự dưới đây, vì có những thứ phải gỡ trước thì mới xóa được thứ sau:

1. Route 53: xóa 2 record latency và 2 health check.
2. API Gateway: xóa custom domain rồi xóa API ở cả hai region. Sau đó xóa cert ACM.
3. CloudFront: Disable, đợi xong rồi Delete. Xóa bucket `mrapi-web-sg`.
4. Lambda, alarm, log group `/aws/lambda/mrapi-*` ở hai region. Tắt rule EventBridge `mrapi-export-daily`.
5. S3: tắt replication, xóa hết object và các version cũ, rồi xóa hai bucket export.
6. DynamoDB: tắt deletion protection, xóa replica Tokyo trước, rồi mới xóa bảng Singapore.
7. SNS topic ở ba region, các role `mrapi-*` không còn dùng.
8. Xem lại hóa đơn tháng, hosted zone và lịch gia hạn domain.

Chỉ xóa đúng tài nguyên có tag `Project=mrapi`, không đoán theo tên. Thứ gì giữ lại thì ghi lý do.
