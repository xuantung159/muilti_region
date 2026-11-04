# Monitoring và cảnh báo

## Chức năng

Thu thập metric, lưu log và cảnh báo khi dịch vụ có dấu hiệu lỗi.

## Ứng dụng trong project

CloudWatch và Lambda monitoring cung cấp số liệu hai Region cho dashboard; alarm gửi SNS khi vượt ngưỡng. Budget theo dõi chi phí riêng.

## Ý nghĩa các file cấu hình

| File | Ý nghĩa và cách dùng |
|---|---|
| `cloudwatch/mrapi-overview.dashboard.json` | Bố cục widget và metric của dashboard CloudWatch. Dùng cập nhật dashboard, không phải số liệu đo. |
| `cloudwatch/<region>/alarms.json` | Metric, ngưỡng, chu kỳ đánh giá và SNS action của alarm. Khi dựng lại cần tách từng alarm và chỉ dùng trường input hợp lệ. |
| `cloudwatch/<region>/log-groups.json` | Tên log group và retention. Dùng kiểm tra nơi lưu log và thời gian giữ; không chứa nội dung log. |
| `cloudwatch/<region>/metric-filters.json` | Mẫu lọc log thành custom metric, gồm lỗi ghi telemetry. Cần có filter thì alarm tương ứng mới có nguồn metric. |
| `sns/<region>.json` | Thuộc tính topic, policy và số subscription confirmed/pending. Dùng đối chiếu kênh cảnh báo; không lưu địa chỉ email. |
| `sns/mrapi-alerts.us-east-1.policy.json` | Access policy của topic us-east-1. Dùng cấu hình quyền publish/quản lý topic. |
| `budgets/mrapi-monthly.budget.json` | Định nghĩa Cost Budget 10 USD/tháng cho account. Dùng làm input phần Budget khi dựng lại. |
| `budgets/mrapi-monthly.notifications.json` | Ba ngưỡng và subscriber EMAIL. Phải thay placeholder người nhận trước khi dùng; không commit email thật. |

Các thư mục Region dùng cấu trúc tương tự. File đối chiếu có thể chứa trường chỉ đọc; cần chọn đúng trường và định dạng input trước khi dùng với AWS CLI. Sửa file trong repo không tự thay đổi tài nguyên AWS.

## Cấu hình và chi tiết

Website dùng metric thật từ CloudWatch ở Singapore, Tokyo và us-east-1.

## Đang dùng

| Thành phần | Cấu hình |
|---|---|
| CloudWatch dashboard | `mrapi-overview`: 11 widget, 44 metric |
| Alarm Singapore | 6: API 5xx, latency, Lambda, telemetry, monitoring, exporter |
| Alarm Tokyo | 5: API 5xx, latency, Lambda, telemetry, monitoring |
| Alarm us-east-1 | `mrapi-health-sg`, `mrapi-health-tyo` |
| SNS | `mrapi-alerts` ở cả ba Region, mỗi topic 1 email Confirmed |
| Log retention | 14 ngày cho các nhóm log đã rà |
| Budget | `mrapi-monthly`, 10 USD/tháng, theo dõi cả account |

Alarm gửi SNS cùng Region. Alarm tổng Lambda theo dõi proxy, dashboard và authorizer; monitoring/exporter có alarm riêng. Metric filter `mrapi-telemetry-write-failed` có ở hai Region.

## File cấu hình

- [Dashboard](cloudwatch/mrapi-overview.dashboard.json).
- Alarm [SG](cloudwatch/ap-southeast-1/alarms.json), [Tokyo](cloudwatch/ap-northeast-1/alarms.json).
- [Budget](budget.md), [định nghĩa](budgets/mrapi-monthly.budget.json), [ngưỡng cảnh báo](budgets/mrapi-monthly.notifications.json).
- [SNS us-east-1](sns/mrapi-alerts.us-east-1.md), [topic policy](sns/mrapi-alerts.us-east-1.policy.json).

Budget chỉ gửi EMAIL, không gửi SNS. Thay `THAY_EMAIL_NGUOI_NHAN` bằng địa chỉ thật trước khi dùng file notifications; không commit email cá nhân.

## Kiểm tra lại

```bash
aws cloudwatch describe-alarms --alarm-name-prefix mrapi --region ap-southeast-1
aws sns list-subscriptions-by-topic --region us-east-1 --topic-arn arn:aws:sns:us-east-1:138150704839:mrapi-alerts
aws budgets describe-budget --account-id 138150704839 --budget-name mrapi-monthly
aws budgets describe-notifications-for-budget --account-id 138150704839 --budget-name mrapi-monthly
```

Đổi Region để kiểm tra alarm/SNS ở nơi khác. Subscription còn `PendingConfirmation` thì chưa nhận được thông báo.

Thử kênh email bằng lệnh dưới sẽ gửi thư thật:

```bash
aws sns publish --region us-east-1 --topic-arn arn:aws:sns:us-east-1:138150704839:mrapi-alerts \
  --subject "mrapi test" --message "Thu kenh canh bao mrapi"
```

## Còn thiếu

- CloudWatch gọi SNS thành công trong bài failover; chưa xác nhận thư tới hộp thư.
- Budget email còn Pending, 0/1 verified. Chưa ngưỡng nào kích.
- Budget chỉ cảnh báo, không tự tắt tài nguyên. Số liệu chi phí có độ trễ; credits/refunds/taxes chưa được xác nhận đầy đủ.
- X-Ray chưa tích hợp vào dashboard. Monitoring S3 Tokyo còn ghi chưa bật metrics dù rule đã bật.

