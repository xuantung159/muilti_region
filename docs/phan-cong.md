# Phân công

Nhóm chia việc theo dịch vụ AWS. Mỗi người giữ trọn dịch vụ của mình ở cả hai region: làm Singapore trước, xong thì nhân sang Tokyo. Như vậy một dịch vụ không phải đi qua tay hai người.

| Người | Phụ trách |
|---|---|
| Tùng (nhóm trưởng) | Phần toàn cục: IAM, Route 53 và domain, CloudFront, ACM us-east-1, Budget, SNS và alarm ở us-east-1. Gom repo, review. |
| Minh | Dữ liệu: DynamoDB, S3, Lambda monitoring, Lambda exporter |
| Toan | Xử lý: các Lambda (proxy, authorizer, dashboard, monitoring), X-Ray |
| Nhân | Cửa vào và cảnh báo: API Gateway, ACM Regional, CloudWatch, SNS Regional, giao diện web |

Review chéo: Minh ↔ Toan, Nhân ↔ Tùng. IAM chỉ Tùng sửa; ai thiếu quyền thì gửi action, tài nguyên và lỗi thật.


## Ai đưa gì cho ai

| Từ | Đến | Bàn giao |
|---|---|---|
| Tùng | Toan | Role có ARN Tokyo và quyền X-Ray |
| Tùng | Nhân | Domain, hosted zone, tên `api.multi-region.io.vn` |
| Minh | Toan | Bảng Tokyo đã Active; file ZIP monitoring |
| Minh | Tùng | Bucket `mrapi-web-sg` cho CloudFront |
| Toan | Nhân | ARN Lambda ở hai region |
| Nhân | Tùng | URL execute-api và target custom domain của hai region |

Làm xong trên Console thì ghi cấu hình vào `infra/` và `config/demo/`.

## Tiêu chí nghiệm thu

D1–D8 là kiểm thử chức năng trên một region:

| ID | Nội dung |
|---|---|
| D1 | Đăng ký, đăng nhập, tạo/sửa/bật/tắt API đúng tenant |
| D2 | Key có phạm vi gọi được backend mẫu, giữ đúng method, path, query, body |
| D3 | Key thiếu, sai, đã thu hồi bị từ chối đúng mã lỗi |
| D4 | Key sai phạm vi hoặc tenant khác không gọi được |
| D5 | API tắt bị chặn; backend lỗi hoặc chậm được phân loại đúng |
| D6 | Đích nội bộ bị chặn trước khi kết nối |
| D7 | Request có telemetry đủ trường, truy vấn đúng tenant |
| D8 | Cấu hình và hướng dẫn chạy lại đã ghi vào repo |

R1–R10 là tiêu chí cho hai region; kết quả nghiệm thu ở [docs/reports](reports/README.md).

## Quy tắc chung

- Một bản code cho hai region, khác nhau ở biến môi trường.
- Sửa code trong repo rồi đóng gói, không sửa thẳng trên Console.
- Không ghi mật khẩu, token, key thật vào repo hay ảnh chụp.
- Chưa test thì ghi "chưa test", không ghi là xong.
