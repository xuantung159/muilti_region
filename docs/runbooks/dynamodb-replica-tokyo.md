# Thêm replica Tokyo cho DynamoDB

Minh làm. Áp dụng cho `mrapi-control` và `mrapi-telemetry` đang chạy ở Singapore. Làm hoàn toàn trên Console.

Lưu ý trước khi làm:

- Không xóa hay tạo lại bảng. Bảng đang có dữ liệu vẫn thêm replica được, AWS tự chép dữ liệu cũ sang.
- Làm từng bảng: xong `mrapi-control` rồi mới tới `mrapi-telemetry`.
- Giữ nguyên tên bảng ở Tokyo để Lambda Tokyo dùng chung biến môi trường.

## 1. Bật Streams (Singapore)

DynamoDB → Tables → chọn bảng → tab **Exports and streams** → **Turn on** → chọn **New and old images**.

Nếu stream đang bật kiểu khác thì tắt đi rồi bật lại đúng kiểu này.

## 2. Tạo replica

1. Vẫn ở bảng đó, tab **Global tables** → **Create replica**.
2. Chọn **Asia Pacific (Tokyo)**. Nếu có mục consistency thì để **Eventual** (Strong cần 3 region).
3. Bấm **Create replica**. Lần đầu AWS tự tạo role `AWSServiceRoleForDynamoDBReplication`, không cần làm tay.
4. Đợi dòng Tokyo từ Creating sang **Active**, thường vài phút.

Lặp lại cho `mrapi-telemetry`. Index GSI1 tự sang theo.

## 3. Kiểm tra ở Tokyo

Đổi region sang Tokyo, mở từng bảng:

- Explore items: số item bằng Singapore.
- TTL: On, thuộc tính `expiresAt`. Nếu Off thì bật lên.
- Tag: có `Project=mrapi`.
- Bảng telemetry: GSI1 Active.

PITR và deletion protection nếu bật thì bật ở cả hai bên. Nhóm đã bật đủ cả hai.

## 4. Quyền cho Lambda Tokyo

Lambda Tokyo dùng lại role của Singapore, chỉ cần thêm ARN bảng Tokyo vào policy. Việc này Tùng làm vì chỉ Tùng sửa IAM. Ví dụ:

```json
"Resource": [
  "arn:aws:dynamodb:ap-southeast-1:138150704839:table/mrapi-control",
  "arn:aws:dynamodb:ap-northeast-1:138150704839:table/mrapi-control"
]
```

## 5. Thử đồng bộ

Mở hai tab: một tab Singapore, một tab Tokyo, cùng vào Explore items của `mrapi-control`.

1. Tab Singapore tạo item `{"PK": "TEST#repl", "SK": "SG-1"}`.
2. Tab Tokyo Query `PK = TEST#repl`, bấm Run tới khi thấy. Thường thấy ngay lần đầu.
3. Làm 5 lần, rồi đổi chiều (ghi ở Tokyo, đọc ở Singapore).
4. Sửa và xóa một item ở bên này, xem bên kia có đổi theo không.
5. Dọn hết item `TEST#repl`.

Kết quả: 10/10 item thấy ở region kia trong khoảng 1 giây ([báo cáo](../reports/data-replication.md)).

## Những chuyện sẽ gặp (không phải lỗi)

- Thu hồi key ở Singapore, gọi ngay qua Tokyo vẫn có thể lọt trong khoảng 1 giây.
- Đăng nhập ở Singapore, request sau rơi sang Tokyo có thể bị 401 vì phiên chưa kịp sang. Route 53 thường giữ người dùng ở một region nên ít gặp.
- Hai region cùng sửa một item thì bản ghi sau thắng.
- Kiểm tra trùng email khi đăng ký chỉ chính xác trong một region.

## Chi phí và gỡ bỏ

Mỗi lần ghi bị tính thêm một lần ghi sang Tokyo, cộng phí truyền dữ liệu. Với lượng demo thì rất nhỏ.

Muốn gỡ: bảng Singapore → Global tables → chọn dòng Tokyo → Delete replica. Bảng Tokyo sẽ bị xóa, Singapore giữ nguyên.
