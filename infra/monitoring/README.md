# infra/monitoring — SNS và AWS Budgets

Trạng thái 17/10/2026: **chưa triển khai trên AWS**. Các file JSON trong thư mục là cấu hình chuẩn bị sẵn để chạy; sau khi tạo thật, ghi lại ARN, trạng thái subscription và bằng chứng vào cuối file này. CloudWatch alarm/dashboard do thành viên khác làm, chỉ nối vào topic ở đây.

## Hai thứ này để làm gì

- **SNS topic `mrapi-alerts`** là "loa thông báo" chung: dịch vụ nào cần báo động (Budgets, CloudWatch alarm) thì gửi vào topic, topic chuyển tiếp tới email của những người đã đăng ký (subscription). Người nhận phải bấm **Confirm subscription** trong email thì mới nhận được.
- **Budget `mrapi-monthly`** theo dõi chi phí của cả tài khoản trong tháng, mức 40 USD (L chốt lại nếu cần). Gửi cảnh báo khi chi phí thực tế vượt 50% và 80%, và khi dự báo cuối tháng vượt 100%. Budget **chỉ cảnh báo, không tự tắt tài nguyên**.

Budget theo dõi cả tài khoản, không lọc theo tag `Project=mrapi`, để tài nguyên quên gắn tag vẫn được tính.

## File

| File | Nội dung |
|---|---|
| `sns/mrapi-alerts.us-east-1.policy.json` | Access policy của topic: chủ tài khoản quản lý; Budgets và CloudWatch (chỉ của tài khoản này) được publish |
| `budgets/mrapi-monthly.budget.json` | Budget chi phí hằng tháng 40 USD, không trừ credit/refund |
| `budgets/mrapi-monthly.notifications.json` | 3 ngưỡng, mỗi ngưỡng gửi tới topic và một email. **Thay `THAY_EMAIL_NGUOI_NHAN` trước khi chạy, không commit email cá nhân nếu nhóm không muốn** |

## Ai làm và quyền cần có

L làm bằng tài khoản thuộc `mrapi-admins`. Policy `mrapi-dev-services` chặn developer tạo/sửa budget (chỉ cho xem), nên developer chạy lệnh dưới sẽ bị AccessDenied — đó là đúng thiết kế. Nếu admin cũng không xem được Billing, root bật "IAM user and role access to Billing information" trong Account.

## Các bước (CloudShell, Region us-east-1)

Topic đặt ở us-east-1 vì Budgets và Billing là dịch vụ toàn cục vận hành tại đây; alarm health check Route 53 sau này cũng nằm ở us-east-1. Alarm Singapore/Tokyo cần topic cùng Region, tạo thêm `mrapi-alerts` tại Region đó bằng các bước 1–3 khi làm CloudWatch.

1. Tạo topic (chạy lại an toàn, nếu đã có thì trả lại ARN cũ):

   ```bash
   aws sns create-topic --name mrapi-alerts --region us-east-1 --tags Key=Project,Value=mrapi Key=Owner,Value=L
   ```

2. Gắn access policy (clone repo vào CloudShell hoặc upload file):

   ```bash
   aws sns set-topic-attributes --region us-east-1 \
     --topic-arn arn:aws:sns:us-east-1:138150704839:mrapi-alerts \
     --attribute-name Policy --attribute-value file://infra/monitoring/sns/mrapi-alerts.us-east-1.policy.json
   ```

3. Đăng ký email cho từng người nhận, rồi người đó mở email và bấm Confirm:

   ```bash
   aws sns subscribe --region us-east-1 --protocol email \
     --topic-arn arn:aws:sns:us-east-1:138150704839:mrapi-alerts \
     --notification-endpoint <email>
   ```

   Kiểm tra: `aws sns list-subscriptions-by-topic --region us-east-1 --topic-arn arn:aws:sns:us-east-1:138150704839:mrapi-alerts` — dòng nào còn `PendingConfirmation` là chưa nhận được thông báo.

4. Gửi thử, mọi người đã Confirm phải nhận được email:

   ```bash
   aws sns publish --region us-east-1 --topic-arn arn:aws:sns:us-east-1:138150704839:mrapi-alerts \
     --subject "mrapi test" --message "Thu kenh canh bao mrapi"
   ```

5. Sửa email trong `mrapi-monthly.notifications.json`, rồi tạo budget:

   ```bash
   aws budgets create-budget --account-id 138150704839 \
     --budget file://infra/monitoring/budgets/mrapi-monthly.budget.json \
     --notifications-with-subscribers file://infra/monitoring/budgets/mrapi-monthly.notifications.json
   ```

   Nếu báo `DuplicateRecordException` thì budget đã có: mở Console Billing → Budgets → `mrapi-monthly`, đối chiếu mức và ngưỡng với file thay vì tạo lại.

6. Kiểm tra và lưu bằng chứng:

   ```bash
   aws budgets describe-budget --account-id 138150704839 --budget-name mrapi-monthly
   aws budgets describe-notifications-for-budget --account-id 138150704839 --budget-name mrapi-monthly
   ```

   Lưu output (không có secret) và ảnh email test tại `docs/evidence/2026-10-18/L/`.

## Giới hạn cần ghi trong báo cáo

- Email test ở bước 4 chỉ chứng minh **kênh nhận** hoạt động; không chứng minh budget hay alarm đã từng kích hoạt thật.
- Budget cập nhật số liệu chi phí vài lần mỗi ngày, cảnh báo có độ trễ nhiều giờ; ngưỡng dự báo cần đủ dữ liệu lịch sử mới gửi.
- Không thể ép budget vượt ngưỡng để test mà không tốn tiền thật; có thể tạm hạ `BudgetLimit` xuống mức đã chi (vd. 0.01 USD) để xem cảnh báo, rồi trả lại 40 USD. Ghi rõ nếu làm cách này.
- Khi CloudWatch sẵn sàng, alarm chọn topic `mrapi-alerts` **cùng Region** với alarm.

## Kết quả thực tế (điền sau khi làm)

- Người thực hiện / ngày giờ: …
- Topic ARN từng Region: …
- Subscription: email (che bớt) → Confirmed / Pending: …
- Budget: tên, mức, 3 ngưỡng đã đối chiếu: …
- Bằng chứng email test: …
